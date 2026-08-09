import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import Decimal from 'decimal.js';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { runInTenant } from '../../core/tenancy/tenant-transaction';
import { NumberingService } from '../../core/numbering/numbering.service';
import { returningRows } from '../../core/database/returning.util';
import {
  CalcComponent,
  CalcOuvrage,
  NATURES,
  computeNatureBreakdownMap,
} from '../estimating/ouvrage-calc';
import { BUDGET_NATURES, BudgetNature } from './budget-nature';

/**
 * Frais de chantier prêts à être budgétés, calculés par la feuille de vente (module étude de prix)
 * et transmis à l'acceptation : le suivi de chantier ne recalcule pas de prix de vente, il reçoit
 * des montants déjà arbitrés.
 */
export interface FraisChantierInput {
  postes: { code: string; label: string; nature: string; montant: string }[];
}

interface OuvrageComp {
  kind: string;
  child_resource_id: string | null;
  child_ouvrage_id: string | null;
  quantity: string | null;
  rate: string | null;
}

@Injectable()
export class ChantierService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly context: TenantContext,
    private readonly numbering: NumberingService,
  ) {}

  /**
   * Creates the marché (the contract, cahier §5.4) rooted on a chantier — existing (aggregate,
   * budget incremented) or new. Guards against double acceptance of a version. The étude
   * d'exécution and the facturation lines are added separately by the callers.
   */
  async createMarche(
    em: EntityManager,
    args: {
      tenantId: string;
      affaire: { id: string; code: string; name: string };
      marcheName: string;
      versionId: string;
      venteTotal: string;
      targetChantierId?: string | null;
    },
  ) {
    const { tenantId, affaire, marcheName, versionId, venteTotal, targetChantierId } = args;
    if ((await em.query(`SELECT id FROM marche WHERE devis_version_id = $1`, [versionId])).length > 0) {
      throw new ConflictException('Cette version du devis a déjà été acceptée (un marché existe).');
    }
    let chantierId: string;
    if (targetChantierId) {
      const found = await em.query(`SELECT id FROM chantier WHERE id = $1 FOR UPDATE`, [targetChantierId]);
      if (found.length === 0) {
        throw new NotFoundException(`Chantier introuvable (${targetChantierId}).`);
      }
      chantierId = found[0].id;
      await em.query(
        `UPDATE chantier SET budget_vente_ht = budget_vente_ht + $1, updated_at = now() WHERE id = $2`,
        [venteTotal, chantierId],
      );
    } else {
      // Code chantier attribué automatiquement (numérotation société), dans cette transaction.
      const chantierCode = await this.numbering.next(em, 'chantier');
      chantierId = (
        await em.query(
          `INSERT INTO chantier (tenant_id, code, name, affaire_id, devis_version_id, budget_vente_ht)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
          [tenantId, chantierCode, affaire.name, affaire.id, versionId, venteTotal],
        )
      )[0].id;
    }
    // Code marché attribué automatiquement (distinct du numéro de devis).
    const marcheCode = await this.numbering.next(em, 'marche');
    return (
      await em.query(
        `INSERT INTO marche
           (tenant_id, affaire_id, devis_version_id, chantier_id, code, name, total_ht,
            execution_form, contre_etude_status, execution_phase, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'by_ouvrage','draft','etude','active') RETURNING *`,
        [tenantId, affaire.id, versionId, chantierId, marcheCode, marcheName, venteTotal],
      )
    )[0];
  }

  /** Journalise une modification/validation d'exécution (horodaté, avec l'auteur). Cahier §5.5. */
  private logChange(
    em: EntityManager,
    tenantId: string,
    marcheId: string,
    action: string,
    detail: Record<string, unknown>,
    executionLineId: string | null = null,
  ): Promise<unknown> {
    return em.query(
      `INSERT INTO execution_change_log
         (tenant_id, marche_id, execution_line_id, actor_user_id, action, detail)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [tenantId, marcheId, executionLineId, this.context.getUserId() ?? null, action, JSON.stringify(detail)],
    );
  }

  /**
   * Materialises the étude d'exécution (déboursé hierarchy) of a marché's affaire version under
   * that marché (cahier §5.5), aggregated at its chantier. Shared by the site-tracking acceptance
   * and the unified invoicing /accept. No-op if the marché already has execution.
   */
  async materialiseExecutionForMarche(marcheId: string): Promise<number> {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, (em) =>
      this.materialiseExecutionInTx(em, tenantId, marcheId),
    );
  }

  /**
   * Même travail, mais DANS la transaction de l'appelant : l'acceptation de commande crée le
   * marché et son étude d'exécution d'un seul tenant. Sans cela, un échec de matérialisation
   * laisserait un marché sans budget — un chantier à moitié né, que rien ne rattrape ensuite.
   */
  async materialiseExecutionInTx(
    em: EntityManager,
    tenantId: string,
    marcheId: string,
    frais?: FraisChantierInput | null,
  ): Promise<number> {
    {
      const marcheRows = await em.query(
        `SELECT chantier_id, devis_version_id FROM marche WHERE id = $1`,
        [marcheId],
      );
      if (marcheRows.length === 0) {
        throw new NotFoundException(`Unknown marché "${marcheId}"`);
      }
      const chantier = { id: marcheRows[0].chantier_id as string };
      const versionId = marcheRows[0].devis_version_id as string;
      if ((await em.query(`SELECT 1 FROM execution_line WHERE marche_id = $1 LIMIT 1`, [marcheId])).length > 0) {
        return 0;
      }

      // In-memory ouvrage graph for materialisation.
      const compByOuvrage = new Map<string, OuvrageComp[]>();
      for (const c of await em.query(
        `SELECT parent_ouvrage_id, kind, child_resource_id, child_ouvrage_id, quantity, rate
           FROM ouvrage_component ORDER BY sort_order ASC`,
      )) {
        const arr = compByOuvrage.get(c.parent_ouvrage_id) ?? [];
        arr.push(c);
        compByOuvrage.set(c.parent_ouvrage_id, arr);
      }
      const ouvById = new Map<string, { code: string; label: string; unit: string }>();
      for (const o of await em.query(`SELECT id, code, label, unit FROM ouvrage`)) {
        ouvById.set(o.id, o);
      }
      const resById = new Map<
        string,
        { code: string; label: string; unit: string; nature: string; unit_cost: string; code_analytique_id: string | null }
      >();
      for (const r of await em.query(
        `SELECT id, code, label, unit, nature, unit_cost, code_analytique_id FROM resource`,
      )) {
        resById.set(r.id, r);
      }
      // La nomenclature est unique par (chantier, code). Or le devis n'y est pour rien : il peut
      // porter des ressources sans code, deux fois le même code, et le chantier peut déjà tenir la
      // nomenclature d'un marché précédent. On reprend donc l'existant et on n'invente un code que
      // lorsqu'il le faut — jamais d'échec d'acceptation pour une collision de libellé technique.
      const nomencByResource = new Map<string, string>();
      const usedCodes = new Set<string>();
      for (const row of await em.query(
        `SELECT id, code, source_resource_id FROM nomenclature_resource WHERE chantier_id = $1`,
        [chantier.id],
      )) {
        usedCodes.add(row.code);
        if (row.source_resource_id) nomencByResource.set(row.source_resource_id, row.id);
      }
      /** Code libre pour ce chantier : le code souhaité, sinon suffixé, sinon généré. */
      const freeCode = (wanted: string | null | undefined): string => {
        const base = (wanted ?? '').trim();
        if (base && !usedCodes.has(base)) {
          usedCodes.add(base);
          return base;
        }
        const stem = base || 'RES';
        for (let i = 2; ; i += 1) {
          const candidate = `${stem}-${i}`.slice(0, 64);
          if (!usedCodes.has(candidate)) {
            usedCodes.add(candidate);
            return candidate;
          }
        }
      };

      const ensureNomenclature = async (resourceId: string): Promise<string> => {
        const cached = nomencByResource.get(resourceId);
        if (cached) return cached;
        const r = resById.get(resourceId)!;
        // Copie du rattachement analytique au transfert : la nomenclature porte SON code analytique
        // et n'est plus jamais lue en direct depuis la bibliothèque d'étude (catalogues indépendants).
        const row = (
          await em.query(
            `INSERT INTO nomenclature_resource
               (tenant_id, chantier_id, marche_id, source_resource_id, code, label, unit, nature,
                unit_cost_etude, unit_cost_objectif, code_analytique_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10) RETURNING id`,
            [tenantId, chantier.id, marcheId, resourceId, freeCode(r.code), r.label, r.unit, r.nature,
              r.unit_cost, r.code_analytique_id ?? null],
          )
        )[0];
        nomencByResource.set(resourceId, row.id);
        return row.id;
      };

      // Contenu RÉEL du devis (pas la bibliothèque) : sous-détail copié/manuel + ressources autonomes.
      // Le déboursé étudié se calcule dessus (feuille de vente) ; le chantier doit s'aligner, sinon
      // budget objectif ≠ déboursé (ouvrages manuels, sous-détail édité, ressources saisies à la main).
      interface DevisLine {
        id: string; parent_line_id: string | null; type: string; code: string | null;
        designation: string; unit: string | null; quantity: string | null; perte: string | null;
        pu: string | null; nature: string | null; source_ouvrage_id: string | null;
        source_resource_id: string | null; vendable: boolean; sort_order: number;
      }
      const allLines: DevisLine[] = await em.query(
        `SELECT id, parent_line_id, type, code, designation, unit, quantity, perte, pu, nature,
                source_ouvrage_id, source_resource_id, vendable, sort_order
           FROM devis_line WHERE devis_version_id = $1 ORDER BY sort_order ASC, created_at ASC`,
        [versionId],
      );
      const dById = new Map(allLines.map((l) => [l.id, l]));
      const dChildren = new Map<string, DevisLine[]>();
      for (const l of allLines) {
        if (!l.parent_line_id) continue;
        const arr = dChildren.get(l.parent_line_id) ?? [];
        arr.push(l);
        dChildren.set(l.parent_line_id, arr);
      }
      /** Nomenclature valorisée au PU du devis (ressource manuelle ou sous-détail édité). */
      const nomencFromDevisRes = async (l: DevisLine): Promise<string> => {
        const src = l.source_resource_id ? resById.get(l.source_resource_id) : undefined;
        const nature = l.nature ?? src?.nature ?? 'material';
        return (
          await em.query(
            `INSERT INTO nomenclature_resource
               (tenant_id, chantier_id, marche_id, source_resource_id, code, label, unit, nature,
                unit_cost_etude, unit_cost_objectif, code_analytique_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10) RETURNING id`,
            [tenantId, chantier.id, marcheId, l.source_resource_id ?? null, freeCode(l.code), l.designation,
              l.unit, nature, l.pu ?? '0', src?.code_analytique_id ?? null],
          )
        )[0].id;
      };
      const perteQty = (l: DevisLine) =>
        new Decimal(l.quantity ?? 0).times(new Decimal(1).plus(new Decimal(l.perte ?? 0).dividedBy(100))).toString();

      const materialize = async (
        ouvrageId: string,
        parentLineId: string | null,
        vendable: boolean,
        sourceDevisLineId: string | null,
        quantite: string,
        meta: { code: string | null; designation: string; unit: string | null },
        sortOrder: number,
      ): Promise<string> => {
        const line = (
          await em.query(
            `INSERT INTO execution_line
               (tenant_id, chantier_id, marche_id, parent_line_id, type, vendable, code, designation, unit,
                source_devis_line_id, source_ouvrage_id, quantite_etude, quantite_objectif,
                debourse_unitaire_etude, debourse_unitaire_objectif, sort_order)
             VALUES ($1,$2,$3,$4,'ouvrage',$5,$6,$7,$8,$9,$10,$11,$11,0,0,$12) RETURNING id`,
            [tenantId, chantier.id, marcheId, parentLineId, vendable, meta.code, meta.designation, meta.unit,
              sourceDevisLineId, ouvrageId, quantite, sortOrder],
          )
        )[0];

        let cSort = 0;
        for (const comp of compByOuvrage.get(ouvrageId) ?? []) {
          if (comp.kind === 'resource' && comp.child_resource_id) {
            const nomencId = await ensureNomenclature(comp.child_resource_id);
            await em.query(
              `INSERT INTO execution_component
                 (tenant_id, execution_line_id, kind, nomenclature_resource_id, quantite_etude, quantite_objectif, sort_order)
               VALUES ($1,$2,'resource',$3,$4,$4,$5)`,
              [tenantId, line.id, nomencId, comp.quantity ?? '0', cSort++],
            );
          } else if (comp.kind === 'sub_ouvrage' && comp.child_ouvrage_id) {
            const child = ouvById.get(comp.child_ouvrage_id);
            const childLineId = await materialize(
              comp.child_ouvrage_id, line.id, true, null, '1',
              { code: child?.code ?? null, designation: child?.label ?? 'Sous-ouvrage', unit: child?.unit ?? null },
              cSort,
            );
            await em.query(
              `INSERT INTO execution_component
                 (tenant_id, execution_line_id, kind, child_line_id, quantite_etude, quantite_objectif, sort_order)
               VALUES ($1,$2,'sub_line',$3,$4,$4,$5)`,
              [tenantId, line.id, childLineId, comp.quantity ?? '0', cSort++],
            );
          } else if (comp.kind === 'percentage') {
            await em.query(
              `INSERT INTO execution_component (tenant_id, execution_line_id, kind, rate, sort_order)
               VALUES ($1,$2,'percentage',$3,$4)`,
              [tenantId, line.id, comp.rate ?? '0', cSort++],
            );
          }
        }
        return line.id;
      };

      /** Crée une ligne d'exécution ouvrage à partir d'une ligne de devis (méta + qté). */
      const insertExecOuvrage = async (dl: DevisLine, parentLineId: string | null, sortOrder: number) =>
        (
          await em.query(
            `INSERT INTO execution_line
               (tenant_id, chantier_id, marche_id, parent_line_id, type, vendable, code, designation, unit,
                source_devis_line_id, source_ouvrage_id, quantite_etude, quantite_objectif,
                debourse_unitaire_etude, debourse_unitaire_objectif, sort_order)
             VALUES ($1,$2,$3,$4,'ouvrage',$5,$6,$7,$8,$9,$10,$11,$11,0,0,$12) RETURNING id`,
            [tenantId, chantier.id, marcheId, parentLineId, dl.vendable, dl.code, dl.designation, dl.unit,
              dl.id, dl.source_ouvrage_id, dl.quantity ?? '0', sortOrder],
          )
        )[0].id as string;

      /** Ouvrage du devis avec sous-détail COPIÉ/MANUEL (enfants ressource/ouvrage) : source de vérité. */
      const materializeFromChildren = async (dl: DevisLine, parentLineId: string | null, sortOrder: number): Promise<string> => {
        const lineId = await insertExecOuvrage(dl, parentLineId, sortOrder);
        let cSort = 0;
        for (const c of dChildren.get(dl.id) ?? []) {
          if (c.type === 'ressource') {
            const nomencId = await nomencFromDevisRes(c);
            await em.query(
              `INSERT INTO execution_component
                 (tenant_id, execution_line_id, kind, nomenclature_resource_id, quantite_etude, quantite_objectif, sort_order)
               VALUES ($1,$2,'resource',$3,$4,$4,$5)`,
              [tenantId, lineId, nomencId, perteQty(c), cSort++],
            );
          } else if (c.type === 'ouvrage') {
            const childLineId = await buildOuvrage(c, lineId, cSort);
            await em.query(
              `INSERT INTO execution_component
                 (tenant_id, execution_line_id, kind, child_line_id, quantite_etude, quantite_objectif, sort_order)
               VALUES ($1,$2,'sub_line',$3,$4,$4,$5)`,
              [tenantId, lineId, childLineId, perteQty(c), cSort++],
            );
          }
        }
        return lineId;
      };

      /** Dispatch d'un ouvrage : sous-détail du devis s'il existe, sinon bibliothèque, sinon manuel vide. */
      const buildOuvrage = async (dl: DevisLine, parentLineId: string | null, sortOrder: number): Promise<string> => {
        const hasCostChildren = (dChildren.get(dl.id) ?? []).some((c) => c.type === 'ressource' || c.type === 'ouvrage');
        if (hasCostChildren) return materializeFromChildren(dl, parentLineId, sortOrder);
        if (dl.source_ouvrage_id) {
          return materialize(dl.source_ouvrage_id, parentLineId, dl.vendable, dl.id, dl.quantity ?? '0',
            { code: dl.code, designation: dl.designation, unit: dl.unit }, sortOrder);
        }
        // Ouvrage manuel sans sous-détail : déboursé 0 (ligne facturée par son PV forcé seulement).
        return insertExecOuvrage(dl, parentLineId, sortOrder);
      };

      /** Ressource AUTONOME (sous un titre, hors ouvrage) : ligne d'exécution + 1 composant au pu du devis. */
      const materializeStandaloneRes = async (dl: DevisLine, sortOrder: number): Promise<void> => {
        const lineId = await insertExecOuvrage(dl, null, sortOrder);
        const nomencId = await nomencFromDevisRes(dl);
        const mult = new Decimal(1).plus(new Decimal(dl.perte ?? 0).dividedBy(100)).toString();
        await em.query(
          `INSERT INTO execution_component
             (tenant_id, execution_line_id, kind, nomenclature_resource_id, quantite_etude, quantite_objectif, sort_order)
           VALUES ($1,$2,'resource',$3,$4,$4,0)`,
          [tenantId, lineId, nomencId, mult],
        );
      };

      // Matérialise depuis le CONTENU DU DEVIS : ouvrages et ressources autonomes de premier niveau
      // (parent = titre/sous-titre ou racine) ; les enfants d'ouvrages sont traités par leur parent.
      let top = 0;
      let count = 0;
      for (const l of allLines) {
        if (l.type !== 'ouvrage' && l.type !== 'ressource') continue;
        const parent = l.parent_line_id ? dById.get(l.parent_line_id) : undefined;
        if (parent && parent.type !== 'titre' && parent.type !== 'sous_titre') continue; // enfant d'un ouvrage
        if (l.type === 'ouvrage') await buildOuvrage(l, null, top++);
        else await materializeStandaloneRes(l, top++);
        count++;
      }

      // Frais de chantier repris du devis : une ligne NON VENDABLE (donc budgétée en
      // « site_overhead »), un composant par poste pour qu'on sache toujours d'où vient l'argent.
      const postes = (frais?.postes ?? []).filter((p) => !new Decimal(p.montant).isZero());
      if (postes.length > 0) {
        const lineId = (
          await em.query(
            `INSERT INTO execution_line
               (tenant_id, chantier_id, marche_id, parent_line_id, type, vendable, code, designation, unit,
                quantite_etude, quantite_objectif, debourse_unitaire_etude, debourse_unitaire_objectif, sort_order)
             VALUES ($1,$2,$3,NULL,'ouvrage',false,'FRAIS','Frais de chantier','ens',1,1,0,0,$4) RETURNING id`,
            [tenantId, chantier.id, marcheId, top++],
          )
        )[0].id as string;
        let cSort = 0;
        for (const poste of postes) {
          const nomencId = (
            await em.query(
              `INSERT INTO nomenclature_resource
                 (tenant_id, chantier_id, marche_id, source_resource_id, code, label, unit, nature,
                  unit_cost_etude, unit_cost_objectif, code_analytique_id)
               VALUES ($1,$2,$3,NULL,$4,$5,'ens',$6,$7,$7,NULL) RETURNING id`,
              [tenantId, chantier.id, marcheId, freeCode(poste.code), poste.label, poste.nature, poste.montant],
            )
          )[0].id as string;
          await em.query(
            `INSERT INTO execution_component
               (tenant_id, execution_line_id, kind, nomenclature_resource_id, quantite_etude, quantite_objectif, sort_order)
             VALUES ($1,$2,'resource',$3,1,1,$4)`,
            [tenantId, lineId, nomencId, cSort++],
          );
        }
        count++;
      }

      await this.recompute(em, tenantId, chantier.id, true, marcheId);
      return count;
    }
  }

  /** Recomputes the objectif budget by nature for every top line (étude too when freeze). */
  private async recompute(
    em: EntityManager,
    tenantId: string,
    chantierId: string,
    freeze: boolean,
    marcheId?: string,
  ): Promise<void> {
    // When a marché is given, only its lines are (re)computed — so accepting a new marché on an
    // existing chantier never re-freezes or disturbs the other marchés' études d'exécution.
    const lines = await em.query(
      `SELECT id, parent_line_id, vendable, quantite_objectif FROM execution_line
        WHERE chantier_id = $1 AND ($2::uuid IS NULL OR marche_id = $2)`,
      [chantierId, marcheId ?? null],
    );
    const comps = await em.query(
      `SELECT ec.execution_line_id, ec.kind, ec.child_line_id, ec.quantite_objectif, ec.rate,
              n.nature, n.unit_cost_objectif
         FROM execution_component ec
         JOIN execution_line el ON el.id = ec.execution_line_id
         LEFT JOIN nomenclature_resource n ON n.id = ec.nomenclature_resource_id
        WHERE el.chantier_id = $1`,
      [chantierId],
    );
    const map = new Map<string, CalcOuvrage>();
    for (const l of lines) map.set(l.id, { id: l.id, components: [] });
    for (const c of comps) {
      const parent = map.get(c.execution_line_id);
      if (!parent) continue;
      const comp: CalcComponent = { kind: c.kind === 'sub_line' ? 'sub_ouvrage' : c.kind };
      if (c.kind === 'resource') {
        comp.quantity = c.quantite_objectif ?? 0;
        comp.unitCost = c.unit_cost_objectif ?? 0;
        // Le moteur de déboursé ne connaît que les 4 natures de coût direct. Les postes de frais
        // de chantier (« site_overhead ») gardent leur nature en base — c'est ce qui les rend
        // lisibles — mais entrent ici sous une nature neutre : leur ligne étant non vendable,
        // la totalité retombe de toute façon dans le budget « frais de chantier ».
        comp.nature = NATURES.includes(c.nature as (typeof NATURES)[number])
          ? (c.nature as (typeof NATURES)[number])
          : 'material';
      } else if (c.kind === 'sub_line') {
        comp.quantity = c.quantite_objectif ?? 0;
        comp.childOuvrageId = c.child_line_id;
      } else {
        comp.rate = c.rate ?? 0;
      }
      parent.components.push(comp);
    }
    const breakdown = computeNatureBreakdownMap(map);

    const debourseClause = freeze
      ? 'debourse_unitaire_objectif = $1, debourse_unitaire_etude = $1'
      : 'debourse_unitaire_objectif = $1';
    const budgetSet = freeze
      ? 'montant_objectif = EXCLUDED.montant_objectif, montant_etude = EXCLUDED.montant_objectif'
      : 'montant_objectif = EXCLUDED.montant_objectif';

    for (const l of lines) {
      if (l.parent_line_id) continue; // budget only on top lines
      const unit = breakdown.get(l.id)!;
      const qty = new Decimal(l.quantite_objectif ?? 0);
      const totalUnit = NATURES.reduce((a, n) => a.plus(unit[n]), new Decimal(0));
      const amounts: Record<BudgetNature, Decimal> = {
        labor: new Decimal(0), material: new Decimal(0), equipment: new Decimal(0),
        subcontract: new Decimal(0), site_overhead: new Decimal(0),
      };
      if (l.vendable) {
        for (const n of NATURES) amounts[n] = unit[n].times(qty);
      } else {
        amounts.site_overhead = totalUnit.times(qty);
      }
      await em.query(
        `UPDATE execution_line SET ${debourseClause}, updated_at = now() WHERE id = $2`,
        [totalUnit.toDecimalPlaces(4).toString(), l.id],
      );
      for (const nature of BUDGET_NATURES) {
        const montant = amounts[nature].toDecimalPlaces(2).toString();
        await em.query(
          `INSERT INTO execution_line_budget (tenant_id, execution_line_id, nature, montant_etude, montant_objectif)
           VALUES ($1, $2, $3, $4, $4)
           ON CONFLICT (execution_line_id, nature) DO UPDATE SET ${budgetSet}`,
          [tenantId, l.id, nature, montant],
        );
      }
    }
  }

  /**
   * L'édition n'est permise qu'en phase `contre_etude` (cahier §5.5) : le budget d'étude doit
   * d'abord être validé, et une fois la contre-étude validée le marché passe en exécution (figé).
   */
  private async assertMarcheEditable(em: EntityManager, marcheId: string): Promise<void> {
    const m = await em.query(`SELECT execution_phase FROM marche WHERE id = $1`, [marcheId]);
    if (m.length === 0) throw new NotFoundException(`Unknown marché "${marcheId}"`);
    if (m[0].execution_phase === 'etude') {
      throw new ConflictException('Validez d’abord le budget d’étude pour passer en contre-étude.');
    }
    if (m[0].execution_phase === 'execution') {
      throw new ConflictException('La contre-étude est validée : le marché est en exécution (figé).');
    }
  }

  /** Valide le budget d'étude d'un marché : passe de la phase `etude` à `contre_etude` (horodaté). */
  validateEtude(marcheId: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const m = await em.query(`SELECT chantier_id, execution_phase FROM marche WHERE id = $1`, [marcheId]);
      if (m.length === 0) throw new NotFoundException(`Unknown marché "${marcheId}"`);
      if (m[0].execution_phase !== 'etude') {
        throw new ConflictException('Le budget d’étude est déjà validé.');
      }
      await em.query(
        `UPDATE marche SET execution_phase = 'contre_etude', etude_validated_at = now(), updated_at = now()
          WHERE id = $1`,
        [marcheId],
      );
      await this.logChange(em, tenantId, marcheId, 'validate_etude', {});
      return this.getChantierInTx(em, m[0].chantier_id);
    });
  }

  /** Renegotiate a resource unit price (contre-étude) and recompute the marché's objectif budget. */
  renegotiateResource(chantierId: string, nomenclatureResourceId: string, unitCostObjectif: string | number) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const nomenc = await em.query(
        `SELECT marche_id FROM nomenclature_resource WHERE id = $1 AND chantier_id = $2`,
        [nomenclatureResourceId, chantierId],
      );
      if (nomenc.length === 0) throw new NotFoundException('Unknown nomenclature resource');
      const marcheId = nomenc[0].marche_id as string;
      await this.assertMarcheEditable(em, marcheId);
      await em.query(
        `UPDATE nomenclature_resource SET unit_cost_objectif = $1, updated_at = now() WHERE id = $2`,
        [String(unitCostObjectif), nomenclatureResourceId],
      );
      await this.recompute(em, tenantId, chantierId, false, marcheId);
      await this.logChange(em, tenantId, marcheId, 'renegotiate_resource', {
        nomenclatureResourceId, unitCostObjectif: String(unitCostObjectif),
      });
      return this.getChantierInTx(em, chantierId);
    });
  }

  /** Adjust a component quantity (contre-étude) and recompute the marché's objectif budget. */
  setComponentQuantity(componentId: string, quantiteObjectif: string | number) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const rows = await em.query(
        `SELECT el.chantier_id, el.marche_id FROM execution_component ec
           JOIN execution_line el ON el.id = ec.execution_line_id WHERE ec.id = $1`,
        [componentId],
      );
      if (rows.length === 0) throw new NotFoundException(`Unknown component "${componentId}"`);
      const { chantier_id: chantierId, marche_id: marcheId } = rows[0];
      await this.assertMarcheEditable(em, marcheId);
      await em.query(
        `UPDATE execution_component SET quantite_objectif = $1, updated_at = now() WHERE id = $2`,
        [String(quantiteObjectif), componentId],
      );
      await this.recompute(em, tenantId, chantierId, false, marcheId);
      await this.logChange(em, tenantId, marcheId, 'set_component_quantity', {
        componentId, quantiteObjectif: String(quantiteObjectif),
      });
      return this.getChantierInTx(em, chantierId);
    });
  }

  /* ───────── Édition structurelle (contre-étude, cahier §5.5) — modifier les prestations ───────── */

  /** Ajoute une ressource PROPRE au chantier comme composant d'un ouvrage (source_resource_id NULL). */
  addResourceComponent(
    executionLineId: string,
    input: { code: string; label: string; unit?: string | null; nature: string; unitCost: string | number; quantity: string | number },
  ) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const rows = await em.query(
        `SELECT chantier_id, marche_id FROM execution_line WHERE id = $1`,
        [executionLineId],
      );
      if (rows.length === 0) throw new NotFoundException(`Unknown execution line "${executionLineId}"`);
      const { chantier_id: chantierId, marche_id: marcheId } = rows[0];
      await this.assertMarcheEditable(em, marcheId);
      const nomenc = (
        await em.query(
          `INSERT INTO nomenclature_resource
             (tenant_id, chantier_id, marche_id, source_resource_id, code, label, unit, nature,
              unit_cost_etude, unit_cost_objectif)
           VALUES ($1,$2,$3,NULL,$4,$5,$6,$7,$8,$8) RETURNING id`,
          [tenantId, chantierId, marcheId, input.code, input.label, input.unit ?? null, input.nature, String(input.unitCost)],
        )
      )[0];
      const sort = Number(
        (await em.query(
          `SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM execution_component WHERE execution_line_id = $1`,
          [executionLineId],
        ))[0].n,
      );
      await em.query(
        `INSERT INTO execution_component
           (tenant_id, execution_line_id, kind, nomenclature_resource_id, quantite_etude, quantite_objectif, sort_order)
         VALUES ($1,$2,'resource',$3,$4,$4,$5)`,
        [tenantId, executionLineId, nomenc.id, String(input.quantity), sort],
      );
      await this.recompute(em, tenantId, chantierId, false, marcheId);
      await this.logChange(em, tenantId, marcheId, 'add_resource_component', {
        code: input.code, nature: input.nature, quantity: String(input.quantity), unitCost: String(input.unitCost),
      }, executionLineId);
      return this.getChantierInTx(em, chantierId);
    });
  }

  /** Supprime un composant d'un ouvrage (ressource / % / sous-ligne). */
  removeComponent(componentId: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const rows = await em.query(
        `SELECT el.chantier_id, el.marche_id FROM execution_component ec
           JOIN execution_line el ON el.id = ec.execution_line_id WHERE ec.id = $1`,
        [componentId],
      );
      if (rows.length === 0) throw new NotFoundException(`Unknown component "${componentId}"`);
      const { chantier_id: chantierId, marche_id: marcheId } = rows[0];
      await this.assertMarcheEditable(em, marcheId);
      await em.query(`DELETE FROM execution_component WHERE id = $1`, [componentId]);
      await this.recompute(em, tenantId, chantierId, false, marcheId);
      await this.logChange(em, tenantId, marcheId, 'remove_component', { componentId });
      return this.getChantierInTx(em, chantierId);
    });
  }

  /** Ajoute un ouvrage (prestation) au marché : ligne de haut niveau, budget alimenté par ses composants. */
  addOuvrageLine(
    marcheId: string,
    input: { code?: string | null; designation: string; unit?: string | null; quantiteObjectif: string | number },
  ) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const m = await em.query(`SELECT chantier_id FROM marche WHERE id = $1`, [marcheId]);
      if (m.length === 0) throw new NotFoundException(`Unknown marché "${marcheId}"`);
      const chantierId = m[0].chantier_id as string;
      await this.assertMarcheEditable(em, marcheId);
      const sort = Number(
        (await em.query(
          `SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM execution_line
            WHERE marche_id = $1 AND parent_line_id IS NULL`,
          [marcheId],
        ))[0].n,
      );
      const line = (
        await em.query(
          `INSERT INTO execution_line
             (tenant_id, chantier_id, marche_id, parent_line_id, type, vendable, code, designation, unit,
              quantite_etude, quantite_objectif, debourse_unitaire_etude, debourse_unitaire_objectif, sort_order)
           VALUES ($1,$2,$3,NULL,'ouvrage',true,$4,$5,$6,$7,$7,0,0,$8) RETURNING id`,
          [tenantId, chantierId, marcheId, input.code ?? null, input.designation, input.unit ?? null,
            String(input.quantiteObjectif), sort],
        )
      )[0];
      await this.recompute(em, tenantId, chantierId, false, marcheId);
      await this.logChange(em, tenantId, marcheId, 'add_ouvrage_line', {
        code: input.code ?? null, designation: input.designation,
      }, line.id);
      return this.getChantierInTx(em, chantierId);
    });
  }

  /** Modifie la quantité d'un ouvrage (ligne) — recalcule son budget objectif. */
  setLineQuantity(lineId: string, quantiteObjectif: string | number) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const rows = await em.query(`SELECT chantier_id, marche_id FROM execution_line WHERE id = $1`, [lineId]);
      if (rows.length === 0) throw new NotFoundException(`Unknown execution line "${lineId}"`);
      const { chantier_id: chantierId, marche_id: marcheId } = rows[0];
      await this.assertMarcheEditable(em, marcheId);
      await em.query(
        `UPDATE execution_line SET quantite_objectif = $1, updated_at = now() WHERE id = $2`,
        [String(quantiteObjectif), lineId],
      );
      await this.recompute(em, tenantId, chantierId, false, marcheId);
      await this.logChange(em, tenantId, marcheId, 'set_line_quantity', {
        lineId, quantiteObjectif: String(quantiteObjectif),
      }, lineId);
      return this.getChantierInTx(em, chantierId);
    });
  }

  /** Supprime un ouvrage (et son sous-arbre : composants, budgets, lignes filles) du marché. */
  removeLine(lineId: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const rows = await em.query(`SELECT chantier_id, marche_id FROM execution_line WHERE id = $1`, [lineId]);
      if (rows.length === 0) throw new NotFoundException(`Unknown execution line "${lineId}"`);
      const { chantier_id: chantierId, marche_id: marcheId } = rows[0];
      await this.assertMarcheEditable(em, marcheId);
      // FKs ON DELETE CASCADE : composants, budgets et lignes filles suivent.
      await em.query(`DELETE FROM execution_line WHERE id = $1`, [lineId]);
      await this.recompute(em, tenantId, chantierId, false, marcheId);
      await this.logChange(em, tenantId, marcheId, 'remove_line', { lineId });
      return this.getChantierInTx(em, chantierId);
    });
  }

  /**
   * Valide la contre-étude d'un marché : passe de `contre_etude` à `execution`, fige l'objectif
   * comme « budget initial » du contrôle de gestion et initialise le prévisionnel (horodaté).
   */
  validateContreEtude(marcheId: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const m = await em.query(`SELECT chantier_id, execution_phase FROM marche WHERE id = $1`, [marcheId]);
      if (m.length === 0) throw new NotFoundException(`Unknown marché "${marcheId}"`);
      if (m[0].execution_phase === 'etude') {
        throw new ConflictException('Validez d’abord le budget d’étude.');
      }
      if (m[0].execution_phase === 'execution') {
        throw new ConflictException('La contre-étude est déjà validée.');
      }
      await em.query(
        `UPDATE marche SET execution_phase = 'execution', contre_etude_status = 'validated',
                contre_etude_validated_at = now(), updated_at = now()
          WHERE id = $1`,
        [marcheId],
      );
      // Initialise the prévisionnel budget from the validated objectif (this marché's lines).
      await em.query(
        `UPDATE execution_line_budget b SET montant_previsionnel = b.montant_objectif
           FROM execution_line l
          WHERE l.id = b.execution_line_id AND l.marche_id = $1`,
        [marcheId],
      );
      await this.logChange(em, tenantId, marcheId, 'validate_contre_etude', {});
      return this.getChantierInTx(em, m[0].chantier_id);
    });
  }

  /** Adjusts the prévisionnel budget of a line/nature (after the marché's contre-étude is validated). */
  setPrevisionnel(lineId: string, nature: string, montant: string | number) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const rows = await em.query(
        `SELECT l.chantier_id, m.execution_phase
           FROM execution_line l JOIN marche m ON m.id = l.marche_id
          WHERE l.id = $1`,
        [lineId],
      );
      if (rows.length === 0) {
        throw new NotFoundException(`Unknown execution line "${lineId}"`);
      }
      if (rows[0].execution_phase !== 'execution') {
        throw new ConflictException('Validate the contre-étude before adjusting the prévisionnel.');
      }
      const upd = returningRows<{ id: string }>(
        await em.query(
          `UPDATE execution_line_budget SET montant_previsionnel = $1
          WHERE execution_line_id = $2 AND nature = $3 RETURNING id`,
          [String(montant), lineId, nature],
        ),
      );
      if (upd.length === 0) {
        throw new NotFoundException(`No budget line for nature "${nature}"`);
      }
      return this.getChantierInTx(em, rows[0].chantier_id);
    });
  }

  /** Creates a standalone (empty) chantier — an aggregation unit; marchés are added by acceptance. */
  createChantier(input: { code?: string; name: string }) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      // Code chantier attribué automatiquement, sauf code explicite (import/reprise).
      const code = input.code?.trim() || (await this.numbering.next(em, 'chantier'));
      const existing = await em.query(`SELECT id FROM chantier WHERE code = $1`, [code]);
      if (existing.length > 0) {
        throw new ConflictException(`Chantier code "${code}" already exists`);
      }
      return (
        await em.query(
          `INSERT INTO chantier (tenant_id, code, name, budget_vente_ht, status)
           VALUES ($1, $2, $3, 0, 'open') RETURNING *`,
          [tenantId, code, input.name],
        )
      )[0];
    });
  }

  getChantier(chantierId: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, (em) => this.getChantierInTx(em, chantierId));
  }

  /** Lists the marchés aggregated by a chantier (Chantier 1→N Marché). */
  listMarches(chantierId: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      await this.getChantierInTx(em, chantierId); // 404 if unknown
      return em.query(
        `SELECT id, code, name, total_ht, contre_etude_status, execution_phase,
                etude_validated_at, contre_etude_validated_at, status, affaire_id
           FROM marche WHERE chantier_id = $1 ORDER BY created_at ASC`,
        [chantierId],
      );
    });
  }

  private async getChantierInTx(em: EntityManager, chantierId: string) {
    const chantier = await em.query(`SELECT * FROM chantier WHERE id = $1`, [chantierId]);
    if (chantier.length === 0) throw new NotFoundException(`Unknown chantier "${chantierId}"`);
    const lines = await em.query(
      `SELECT * FROM execution_line WHERE chantier_id = $1 AND parent_line_id IS NULL ORDER BY sort_order ASC`,
      [chantierId],
    );
    const budgetByNature = await em.query(
      `SELECT b.nature,
              SUM(b.montant_etude)::numeric(16,2) AS etude,
              SUM(b.montant_objectif)::numeric(16,2) AS objectif,
              SUM(b.montant_previsionnel)::numeric(16,2) AS previsionnel
         FROM execution_line_budget b
         JOIN execution_line l ON l.id = b.execution_line_id
        WHERE l.chantier_id = $1 AND l.parent_line_id IS NULL
        GROUP BY b.nature ORDER BY b.nature`,
      [chantierId],
    );
    return { chantier: chantier[0], lines, budgetByNature };
  }

  listChantiers() {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, (em) =>
      em.query(`SELECT * FROM chantier WHERE deleted_at IS NULL ORDER BY created_at DESC`),
    );
  }

  listNomenclature(chantierId: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, (em) =>
      em.query(`SELECT * FROM nomenclature_resource WHERE chantier_id = $1 ORDER BY code ASC`, [chantierId]),
    );
  }

  /**
   * Ventilation analytique d'une ressource de chantier (cahier §5.8). Une ressource chiffrée sans
   * code analytique arrive en « 999 — À ventiler » ; le conducteur la range ici, sur le chantier
   * et sans toucher à la bibliothèque d'étude (catalogues indépendants). Autorisé à toute phase :
   * classer un coût n'est pas modifier le budget, et l'on découvre souvent l'imputation en cours
   * de chantier. `codeAnalytiqueId: null` la renvoie à ventiler.
   */
  ventileResource(chantierId: string, resourceId: string, codeAnalytiqueId: string | null) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const found = await em.query(
        `SELECT id FROM nomenclature_resource WHERE id = $1 AND chantier_id = $2`,
        [resourceId, chantierId],
      );
      if (found.length === 0) {
        throw new NotFoundException(`Ressource de nomenclature introuvable (${resourceId}).`);
      }
      if (codeAnalytiqueId) {
        const code = await em.query(`SELECT id FROM analytical_code WHERE id = $1`, [codeAnalytiqueId]);
        if (code.length === 0) {
          throw new NotFoundException(`Code analytique introuvable (${codeAnalytiqueId}).`);
        }
      }
      await em.query(
        `UPDATE nomenclature_resource SET code_analytique_id = $1, updated_at = now() WHERE id = $2`,
        [codeAnalytiqueId, resourceId],
      );
      return (await em.query(`SELECT * FROM nomenclature_resource WHERE id = $1`, [resourceId]))[0];
    });
  }

  /**
   * Arbre d'exécution d'un chantier (cahier §5.5) : par marché, la MÊME structure que le déboursé
   * (titre/ouvrage → sous-ouvrages → composants ressources/%), avec le budget étude / objectif /
   * prévisionnel à chaque ouvrage. C'est la vue pilotée pendant la contre-étude et l'exécution.
   */
  executionTree(chantierId: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const chantier = await em.query(`SELECT * FROM chantier WHERE id = $1`, [chantierId]);
      if (chantier.length === 0) throw new NotFoundException(`Unknown chantier "${chantierId}"`);

      const marches = await em.query(
        `SELECT id, code, name, total_ht, execution_phase, etude_validated_at,
                contre_etude_validated_at, status
           FROM marche WHERE chantier_id = $1 ORDER BY created_at ASC`,
        [chantierId],
      );

      const lines = await em.query(
        `SELECT id, marche_id, parent_line_id, type, vendable, code, designation, unit,
                quantite_etude, quantite_objectif, debourse_unitaire_etude, debourse_unitaire_objectif, sort_order
           FROM execution_line WHERE chantier_id = $1 ORDER BY sort_order ASC`,
        [chantierId],
      );
      const budgets = await em.query(
        `SELECT b.execution_line_id, b.nature, b.montant_etude, b.montant_objectif, b.montant_previsionnel
           FROM execution_line_budget b
           JOIN execution_line l ON l.id = b.execution_line_id
          WHERE l.chantier_id = $1`,
        [chantierId],
      );
      const comps = await em.query(
        `SELECT ec.id, ec.execution_line_id, ec.kind, ec.child_line_id, ec.rate,
                ec.quantite_etude, ec.quantite_objectif, ec.sort_order,
                n.id AS nomenclature_id, n.code AS n_code, n.label AS n_label, n.nature AS n_nature,
                n.unit AS n_unit, n.unit_cost_etude, n.unit_cost_objectif
           FROM execution_component ec
           JOIN execution_line el ON el.id = ec.execution_line_id
           LEFT JOIN nomenclature_resource n ON n.id = ec.nomenclature_resource_id
          WHERE el.chantier_id = $1 ORDER BY ec.sort_order ASC`,
        [chantierId],
      );

      // Engagé (commandes validées) + réalisé (factures fournisseur + pointages) rattachés à la
      // ligne budgétée de tête (parent_line_id IS NULL) — axe structurel du pilotage (§5.8).
      const engageRows = await em.query(
        `SELECT top.id AS line_id, SUM(l.amount_ht)::numeric(16,2) AS montant
           FROM purchase_order_line l
           JOIN purchase_order o ON o.id = l.order_id
           JOIN execution_line el ON el.id = l.execution_line_id
           JOIN execution_line top ON top.id = COALESCE(el.parent_line_id, el.id)
          WHERE o.chantier_id = $1 AND o.status = 'validated' AND l.execution_line_id IS NOT NULL
          GROUP BY top.id`,
        [chantierId],
      );
      const realiseRows = await em.query(
        `SELECT top.id AS line_id, SUM(m.montant)::numeric(16,2) AS montant FROM (
           SELECT execution_line_id, amount_ht AS montant FROM supplier_invoice
             WHERE chantier_id = $1 AND execution_line_id IS NOT NULL
           UNION ALL
           SELECT execution_line_id, cost AS montant FROM timesheet
             WHERE chantier_id = $1 AND execution_line_id IS NOT NULL
         ) m
         JOIN execution_line el ON el.id = m.execution_line_id
         JOIN execution_line top ON top.id = COALESCE(el.parent_line_id, el.id)
         GROUP BY top.id`,
        [chantierId],
      );
      const engageByLine = new Map<string, string>(engageRows.map((r: { line_id: string; montant: string }) => [r.line_id, r.montant]));
      const realiseByLine = new Map<string, string>(realiseRows.map((r: { line_id: string; montant: string }) => [r.line_id, r.montant]));

      // Index budgets + composants par ligne.
      const budgetByLine = new Map<string, Array<Record<string, unknown>>>();
      for (const b of budgets) {
        const arr = budgetByLine.get(b.execution_line_id) ?? [];
        arr.push(b);
        budgetByLine.set(b.execution_line_id, arr);
      }
      const compByLine = new Map<string, Array<Record<string, unknown>>>();
      for (const c of comps) {
        const arr = compByLine.get(c.execution_line_id) ?? [];
        arr.push(c);
        compByLine.set(c.execution_line_id, arr);
      }
      const childrenOf = new Map<string | null, Array<Record<string, unknown>>>();
      for (const l of lines) {
        const key = l.parent_line_id ?? null;
        const arr = childrenOf.get(key) ?? [];
        arr.push(l);
        childrenOf.set(key, arr);
      }

      const sum = (rows: Array<Record<string, unknown>>, field: string) =>
        rows.reduce((acc, r) => acc.plus(new Decimal((r[field] as string) ?? 0)), new Decimal(0)).toFixed(2);

      const buildNode = (l: Record<string, unknown>): Record<string, unknown> => {
        const lineId = l.id as string;
        const lineBudgets = budgetByLine.get(lineId) ?? [];
        const lineComps = (compByLine.get(lineId) ?? []).map((c) => ({
          id: c.id,
          kind: c.kind,
          childLineId: c.child_line_id,
          rate: c.rate,
          quantiteEtude: c.quantite_etude,
          quantiteObjectif: c.quantite_objectif,
          nomenclature: c.nomenclature_id
            ? {
                id: c.nomenclature_id, code: c.n_code, label: c.n_label, nature: c.n_nature,
                unit: c.n_unit, unitCostEtude: c.unit_cost_etude, unitCostObjectif: c.unit_cost_objectif,
              }
            : null,
        }));
        return {
          id: lineId,
          parentLineId: l.parent_line_id,
          marcheId: l.marche_id,
          type: l.type,
          vendable: l.vendable,
          code: l.code,
          designation: l.designation,
          unit: l.unit,
          quantiteEtude: l.quantite_etude,
          quantiteObjectif: l.quantite_objectif,
          debourseUnitaireEtude: l.debourse_unitaire_etude,
          debourseUnitaireObjectif: l.debourse_unitaire_objectif,
          engage: engageByLine.get(lineId) ?? '0.00',
          realise: realiseByLine.get(lineId) ?? '0.00',
          budget: lineBudgets.length
            ? {
                etude: sum(lineBudgets, 'montant_etude'),
                objectif: sum(lineBudgets, 'montant_objectif'),
                previsionnel: sum(lineBudgets, 'montant_previsionnel'),
                byNature: lineBudgets.map((b) => ({
                  nature: b.nature, etude: b.montant_etude,
                  objectif: b.montant_objectif, previsionnel: b.montant_previsionnel,
                })),
              }
            : null,
          components: lineComps,
          children: (childrenOf.get(lineId) ?? []).map(buildNode),
        };
      };

      const marcheTree = marches.map((m: Record<string, unknown>) => {
        const topLines = (childrenOf.get(null) ?? []).filter((l) => l.marche_id === m.id);
        const nodes = topLines.map(buildNode);
        const total = (field: string) =>
          nodes.reduce((acc, n) => acc.plus(new Decimal((n.budget as Record<string, string> | null)?.[field] ?? 0)), new Decimal(0)).toFixed(2);
        return {
          ...m,
          totals: { etude: total('etude'), objectif: total('objectif'), previsionnel: total('previsionnel') },
          lines: nodes,
        };
      });

      return { chantier: chantier[0], marches: marcheTree };
    });
  }

  /** Journal horodaté des modifications et validations de phase d'un marché (cahier §5.5). */
  listChangeLog(marcheId: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, (em) =>
      em.query(
        `SELECT id, execution_line_id, actor_user_id, action, detail, created_at
           FROM execution_change_log WHERE marche_id = $1 ORDER BY created_at DESC`,
        [marcheId],
      ),
    );
  }
}

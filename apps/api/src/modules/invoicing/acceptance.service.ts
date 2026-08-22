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
import { ActivityService } from '../../core/activity/activity.service';
import { isTransferable } from '../estimating/devis-workflow';
import { VenteService } from '../estimating/vente.service';
import { ChantierService, FraisChantierInput } from '../site-tracking/chantier.service';
import { VenteResult } from '../estimating/vente-calc';

/** Intitulés des natures pour les postes de frais généraux repris au chantier. */
const NATURE_LABELS: Record<string, string> = {
  labor: "main-d'œuvre",
  material: 'matériaux',
  equipment: 'matériel',
  subcontract: 'sous-traitance',
};

interface CorpsLine {
  id: string;
  parent_line_id: string | null;
  type: string;
  code: string | null;
  designation: string;
  unit: string | null;
  quantity: string | null;
  vendable: boolean;
  source_ouvrage_id: string | null;
  section_type: string | null;
}

@Injectable()
export class AcceptanceService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly context: TenantContext,
    private readonly vente: VenteService,
    private readonly chantiers: ChantierService,
    private readonly activity: ActivityService,
  ) {}

  /**
   * File d'attente de l'acceptation : les devis GAGNÉS dont la dernière version n'a pas encore
   * donné de marché. Le montant affiché est celui de la VENTE (feuille de vente), pas le déboursé :
   * c'est la commande que l'on s'apprête à passer, pas son coût.
   */
  async listPending() {
    const tenantId = this.context.requireTenantId();
    const rows: Array<{
      devis_id: string;
      numero: string | null;
      designation: string;
      affaire_id: string;
      affaire_code: string;
      affaire_name: string;
      client_name: string | null;
      version_id: string;
      updated_at: Date;
    }> = await runInTenant(this.dataSource, tenantId, (em) =>
      em.query(
        `SELECT d.id AS devis_id, d.numero, d.designation, d.updated_at,
                a.id AS affaire_id, a.code AS affaire_code, a.name AS affaire_name,
                c.name AS client_name,
                dv.id AS version_id
           FROM devis d
           JOIN affaire a ON a.id = d.affaire_id
           LEFT JOIN client c ON c.id = a.client_id
           JOIN LATERAL (
                SELECT id FROM devis_version WHERE devis_id = d.id
                 ORDER BY version_no DESC LIMIT 1
           ) dv ON true
          WHERE d.status = 'won'
            AND NOT EXISTS (SELECT 1 FROM marche m WHERE m.devis_version_id = dv.id)
          ORDER BY d.updated_at DESC`,
      ),
    );
    // Un calcul de feuille de vente par ligne, chacun dans SA transaction : lancés tous à la
    // fois, ils saturent le pool de connexions et la liste finit par attendre. En file, elle
    // reste prévisible.
    const fiches = [];
    for (const r of rows) {
      fiches.push({
        devisId: r.devis_id,
        numero: r.numero,
        designation: r.designation,
        affaireId: r.affaire_id,
        affaireCode: r.affaire_code,
        affaireName: r.affaire_name,
        clientName: r.client_name,
        montantHt: (await this.vente.computeForVersion(r.version_id)).totalPvHt,
        updatedAt: r.updated_at,
      });
    }
    return fiches;
  }

  /** Commandes déjà acceptées : marché + chantier issus d'un devis, pour le suivi de l'écran. */
  listAccepted() {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const rows = await em.query(
        `SELECT m.id AS marche_id, m.code, m.name, m.total_ht, m.created_at,
                ch.id AS chantier_id, ch.code AS chantier_code, ch.name AS chantier_name,
                d.id AS devis_id, d.numero,
                a.code AS affaire_code, cl.name AS client_name
           FROM marche m
           JOIN chantier ch ON ch.id = m.chantier_id
           JOIN devis_version dv ON dv.id = m.devis_version_id
           JOIN devis d ON d.id = dv.devis_id
           JOIN affaire a ON a.id = d.affaire_id
           LEFT JOIN client cl ON cl.id = a.client_id
          ORDER BY m.created_at DESC`,
      );
      return rows.map(
        (r: Record<string, unknown>) => ({
          marcheId: r.marche_id,
          code: r.code,
          name: r.name,
          totalHt: r.total_ht,
          acceptedAt: r.created_at,
          chantierId: r.chantier_id,
          chantierCode: r.chantier_code,
          chantierName: r.chantier_name,
          devisId: r.devis_id,
          numero: r.numero,
          affaireCode: r.affaire_code,
          clientName: r.client_name,
        }),
      );
    });
  }

  /**
   * Fiche d'acceptation : tout ce que l'utilisateur doit voir AVANT de transformer le devis —
   * qui, combien, quelles options le client retient, et sur quel chantier on rattache le marché.
   */
  async getSheet(devisId: string) {
    const tenantId = this.context.requireTenantId();
    const rows = await runInTenant(this.dataSource, tenantId, (em) =>
      em.query(
        `SELECT d.id, d.numero, d.designation, d.status, d.type,
                a.id AS affaire_id, a.code AS affaire_code, a.name AS affaire_name,
                c.id AS client_id, c.name AS client_name, c.email AS client_email
           FROM devis d
           JOIN affaire a ON a.id = d.affaire_id
           LEFT JOIN client c ON c.id = a.client_id
          WHERE d.id = $1`,
        [devisId],
      ),
    );
    if (rows.length === 0) {
      throw new NotFoundException(`Devis introuvable (${devisId}).`);
    }
    const d = rows[0];
    const versionRow = await runInTenant(this.dataSource, tenantId, (em) =>
      em.query(
        `SELECT id, version_no FROM devis_version WHERE devis_id = $1 ORDER BY version_no DESC LIMIT 1`,
        [devisId],
      ),
    );
    const alerts: Array<{ level: 'blocking' | 'warning'; message: string }> = [];
    if (!isTransferable(d.status)) {
      alerts.push({ level: 'blocking', message: 'Seul un devis « Gagné » peut être accepté.' });
    }
    if (versionRow.length === 0) {
      alerts.push({ level: 'blocking', message: 'Ce devis n’a aucune version à accepter.' });
    }
    const already =
      versionRow.length > 0 &&
      (
        await runInTenant(this.dataSource, tenantId, (em) =>
          em.query(`SELECT id FROM marche WHERE devis_version_id = $1`, [versionRow[0].id]),
        )
      ).length > 0;
    if (already) {
      alerts.push({ level: 'blocking', message: 'Cette version a déjà été acceptée (marché existant).' });
    }

    const fv = versionRow.length > 0 ? await this.vente.computeForVersion(versionRow[0].id) : null;
    if (fv && Number(fv.totalDebourse ?? 0) === 0) {
      alerts.push({ level: 'warning', message: 'Le déboursé du devis est nul.' });
    }

    // Options / variantes : une section = la ligne qui PORTE le section_type ; son montant est la
    // somme des PV des lignes qu'elle couvre (les enfants héritent de la section).
    const sections: Array<{
      lineId: string;
      code: string | null;
      designation: string;
      sectionType: 'option' | 'variante';
      montantHt: string;
    }> = [];
    if (fv && versionRow.length > 0) {
      const roots = await runInTenant(this.dataSource, tenantId, (em) =>
        em.query(
          `SELECT id, code, designation, section_type
             FROM devis_line
            WHERE devis_version_id = $1 AND section_type IS NOT NULL
            ORDER BY sort_order ASC, created_at ASC`,
          [versionRow[0].id],
        ),
      );
      const parents = await runInTenant(this.dataSource, tenantId, (em) =>
        em.query(`SELECT id, parent_line_id FROM devis_line WHERE devis_version_id = $1`, [
          versionRow[0].id,
        ]),
      );
      const parentOf = new Map<string, string | null>(
        parents.map((p: { id: string; parent_line_id: string | null }) => [p.id, p.parent_line_id]),
      );
      const rootOfLine = (lineId: string): string | null => {
        const rootIds = new Set(roots.map((r: { id: string }) => r.id));
        let cur: string | null | undefined = lineId;
        while (cur) {
          if (rootIds.has(cur)) return cur;
          cur = parentOf.get(cur) ?? null;
        }
        return null;
      };
      const totalByRoot = new Map<string, Decimal>();
      for (const item of fv.items) {
        if (item.section === 'main') continue;
        const root = rootOfLine(item.id);
        if (!root) continue;
        totalByRoot.set(root, (totalByRoot.get(root) ?? new Decimal(0)).plus(item.pv));
      }
      for (const r of roots) {
        sections.push({
          lineId: r.id,
          code: r.code,
          designation: r.designation,
          sectionType: r.section_type,
          montantHt: (totalByRoot.get(r.id) ?? new Decimal(0)).toString(),
        });
      }
    }

    const chantiers = await runInTenant(this.dataSource, tenantId, (em) =>
      em.query(
        `SELECT id, code, name FROM chantier
          WHERE deleted_at IS NULL AND status <> 'closed'
          ORDER BY created_at DESC`,
      ),
    );

    return {
      devis: {
        id: d.id,
        numero: d.numero,
        designation: d.designation,
        status: d.status,
        type: d.type,
        affaireId: d.affaire_id,
        affaireCode: d.affaire_code,
        affaireName: d.affaire_name,
        versionId: versionRow[0]?.id ?? null,
        versionNo: versionRow[0]?.version_no ?? null,
      },
      client: d.client_id
        ? { id: d.client_id, name: d.client_name, email: d.client_email }
        : null,
      montants: {
        debourse: fv?.totalDebourse ?? '0',
        pvHt: fv?.totalPvHt ?? '0',
        tva: fv?.tva ?? '0',
        ttc: fv?.totalTtc ?? '0',
        optionsPvHt: fv?.optionsPvHt ?? '0',
        variantesPvHt: fv?.variantesPvHt ?? '0',
      },
      sections,
      chantiers,
      suggestedChantierCode: `${d.affaire_code}-CH`,
      acceptable: alerts.every((a) => a.level !== 'blocking'),
      alerts,
    };
  }

  /**
   * Acceptation unifiée (cahier des charges §5.4, « le pont ») : crée UN marché rattaché à un
   * chantier (nouveau ou existant), portant À LA FOIS sa chaîne de facturation (lignes de marché)
   * ET son étude d'exécution (déboursé). Remplace les deux anciens transferts séparés.
   *
   * Seul le tronc commun du devis entre au marché : les options et variantes s'arbitrent DANS le
   * devis, avant l'acceptation. Celle-ci ne rejoue pas ce choix.
   */
  async accept(devisId: string, targetChantierId?: string | null) {
    const tenantId = this.context.requireTenantId();

    const devisRows = await runInTenant(this.dataSource, tenantId, (em) =>
      em.query(
        `SELECT d.id, d.status, d.numero, d.designation, d.affaire_id,
                a.code AS affaire_code, a.name AS affaire_name
           FROM devis d JOIN affaire a ON a.id = d.affaire_id
          WHERE d.id = $1`,
        [devisId],
      ),
    );
    if (devisRows.length === 0) {
      throw new NotFoundException(`Devis introuvable (${devisId}).`);
    }
    const devis = devisRows[0];
    if (!isTransferable(devis.status)) {
      throw new ConflictException('Seul un devis « Gagné » peut être accepté.');
    }
    const affaire = [{ id: devis.affaire_id, code: devis.affaire_code, name: devis.affaire_name }];
    // Le code du marché est attribué automatiquement par la numérotation société (dans createMarche).
    const marcheName = devis.designation as string;
    const versionRow = await runInTenant(this.dataSource, tenantId, (em) =>
      em.query(
        `SELECT id FROM devis_version WHERE devis_id = $1 ORDER BY version_no DESC LIMIT 1`,
        [devisId],
      ),
    );
    if (versionRow.length === 0) {
      throw new ConflictException('Ce devis n’a aucune version à accepter.');
    }
    const versionId = versionRow[0].id as string;
    const fv = await this.vente.computeForVersion(versionId);
    const pvByLine = new Map(fv.items.map((i) => [i.id, i.pv]));

    // Corps du devis (titres + ouvrages) pour reproduire l'ARBRE dans le marché (cahier §5.6) :
    // la situation de travaux aura la même structure que le devis.
    // Corps facturable : titres + ouvrages + ressources AUTONOMES (posées sous un titre, hors
    // ouvrage). Les ressources sous-détail d'un ouvrage sont exclues (facturées via leur ouvrage).
    const corps: CorpsLine[] = await runInTenant(this.dataSource, tenantId, (em) =>
      em.query(
        `SELECT dl.id, dl.parent_line_id, dl.type, dl.code, dl.designation, dl.unit, dl.quantity,
                dl.vendable, dl.source_ouvrage_id, dl.section_type
           FROM devis_line dl
           LEFT JOIN devis_line p ON p.id = dl.parent_line_id
          WHERE dl.devis_version_id = $1
            AND (dl.type IN ('titre','sous_titre','ouvrage')
                 OR (dl.type = 'ressource' AND (dl.parent_line_id IS NULL OR p.type IN ('titre','sous_titre'))))
          ORDER BY dl.sort_order ASC, dl.created_at ASC`,
        [versionId],
      ),
    );
    const byId = new Map(corps.map((l) => [l.id, l]));
    const sectionRootOf = (l: CorpsLine): CorpsLine | null => {
      let cur: CorpsLine | undefined = l;
      while (cur) {
        if (cur.section_type) return cur;
        cur = cur.parent_line_id ? byId.get(cur.parent_line_id) : undefined;
      }
      return null;
    };
    const excludedSection = (l: CorpsLine) => Boolean(l.section_type);
    // Lignes facturables : ouvrages (biblio OU manuels à PV) + ressources autonomes, vendables et
    // au tronc commun — options et variantes restent hors commande.
    const billable = corps.filter(
      (l) =>
        (l.type === 'ouvrage' || l.type === 'ressource') &&
        l.vendable &&
        pvByLine.has(l.id) &&
        sectionRootOf(l) === null,
    );
    // Inclure la chaîne de titres ancêtres de chaque ouvrage facturable.
    const included = new Set<string>();
    for (const o of billable) {
      included.add(o.id);
      let p = o.parent_line_id;
      while (p && byId.has(p) && !included.has(p)) {
        const parent = byId.get(p)!;
        if (excludedSection(parent)) break;
        included.add(p);
        p = parent.parent_line_id;
      }
    }
    // Le montant du marché = le total contractuel du devis (options et variantes exclues).
    const venteTotal = fv.totalPvHt;

    const childrenOf = new Map<string | null, CorpsLine[]>();
    for (const l of corps) {
      const k = l.parent_line_id ?? null;
      const arr = childrenOf.get(k);
      if (arr) arr.push(l);
      else childrenOf.set(k, [l]);
    }

    // Phase B — create the marché (on a chantier) + its facturation tree in one transaction.
    const marche = await runInTenant(this.dataSource, tenantId, async (em) => {
      const current = await em.query(`SELECT status FROM devis WHERE id = $1 FOR UPDATE`, [devisId]);
      if (!isTransferable(current[0].status)) {
        throw new ConflictException('Seul un devis « Gagné » peut être accepté.');
      }
      const m = await this.chantiers.createMarche(em, {
        tenantId,
        affaire: affaire[0],
        marcheName,
        versionId,
        venteTotal,
        targetChantierId: targetChantierId ?? null,
      });
      const marcheLineIdByDevis = new Map<string, string>();
      let sort = 0;
      // DFS : parent inséré avant ses enfants ; les titres portent la structure, les ouvrages le montant.
      const insertNode = async (l: CorpsLine): Promise<void> => {
        if (included.has(l.id)) {
          const parentMarcheId = l.parent_line_id ? marcheLineIdByDevis.get(l.parent_line_id) ?? null : null;
          let row: { id: string };
          // Ouvrage OU ressource autonome = ligne facturable (type marche_line 'ouvrage') ; titre = structure.
          if (l.type === 'ouvrage' || l.type === 'ressource') {
            const pv = new Decimal(pvByLine.get(l.id) ?? 0);
            const qty = new Decimal(l.quantity ?? 0);
            const pu = qty.isZero() ? new Decimal(0) : pv.dividedBy(qty).toDecimalPlaces(4);
            row = (
              await em.query(
                `INSERT INTO marche_line
                   (tenant_id, marche_id, parent_line_id, type, code, designation, unit, quantite, pu,
                    montant_ht, source_devis_line_id, sort_order)
                 VALUES ($1,$2,$3,'ouvrage',$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
                [tenantId, m.id, parentMarcheId, l.code, l.designation, l.unit, qty.toString(), pu.toString(),
                  pv.toDecimalPlaces(2).toString(), l.id, sort++],
              )
            )[0];
          } else {
            row = (
              await em.query(
                `INSERT INTO marche_line
                   (tenant_id, marche_id, parent_line_id, type, code, designation, unit, quantite, pu,
                    montant_ht, source_devis_line_id, sort_order)
                 VALUES ($1,$2,$3,'titre',$4,$5,NULL,0,0,0,$6,$7) RETURNING id`,
                [tenantId, m.id, parentMarcheId, l.code, l.designation, l.id, sort++],
              )
            )[0];
          }
          marcheLineIdByDevis.set(l.id, row.id);
        }
        for (const c of childrenOf.get(l.id) ?? []) await insertNode(c);
      };
      for (const root of childrenOf.get(null) ?? []) await insertNode(root);

      // Étude d'exécution DANS LA MÊME transaction : soit la commande donne un marché ET ses
      // budgets, soit rien du tout. Un marché sans budget serait un chantier ingérable que
      // l'écran ne proposerait même plus de reprendre (la version compte comme déjà acceptée).
      const executionLineCount = await this.chantiers.materialiseExecutionInTx(
        em,
        tenantId,
        m.id,
        await this.fraisChantierPostes(em, versionId, fv.fraisChantier),
      );
      // Même transaction que le marché et ses budgets : l'acceptation entre au fil seulement si
      // la commande est réellement passée.
      await this.activity.log(em, {
        entityType: 'marche',
        entityId: m.id,
        action: 'acceptation',
        label: `Commande acceptée : ${m.code} — ${marcheName} (${affaire[0].code})`,
        detail: { devisId, versionId, chantierId: m.chantier_id, montantHt: venteTotal },
      });
      return { m, executionLineCount };
    });

    const chantier = await runInTenant(this.dataSource, tenantId, (em) =>
      em.query(`SELECT * FROM chantier WHERE id = $1`, [marche.m.chantier_id]),
    );
    return {
      chantier: chantier[0],
      marche: marche.m,
      lineCount: billable.length,
      executionLineCount: marche.executionLineCount,
    };
  }

  /**
   * Traduit les frais de la feuille de vente en postes budgétaires de chantier : un poste par
   * nature portant des frais généraux, un par type de sous-traitance, un par frais annexe. Le
   * chantier hérite ainsi de TOUT ce que le devis a prévu au-delà du déboursé direct.
   */
  private async fraisChantierPostes(
    em: EntityManager,
    versionId: string,
    frais: VenteResult['fraisChantier'],
  ): Promise<FraisChantierInput | null> {
    if (!frais) return null;
    const postes: FraisChantierInput['postes'] = [];

    for (const [nature, montant] of Object.entries(frais.fgByNature)) {
      if (new Decimal(montant).isZero()) continue;
      postes.push({
        code: `FG-${nature.toUpperCase()}`,
        label: `Frais généraux — ${NATURE_LABELS[nature] ?? nature}`,
        nature,
        montant,
      });
    }

    // Les types de sous-traitance portent leurs propres taux : on reprend leur intitulé du devis.
    const stTypes: Array<{ id: string; label: string }> = Object.keys(frais.fgBySt).length
      ? ((
          await em.query(`SELECT st_types FROM sale_sheet WHERE devis_version_id = $1`, [versionId])
        )[0]?.st_types ?? [])
      : [];
    const stLabel = new Map(stTypes.map((t) => [t.id, t.label]));
    for (const [typeId, montant] of Object.entries(frais.fgBySt)) {
      if (new Decimal(montant).isZero()) continue;
      postes.push({
        code: `FG-ST-${typeId}`.slice(0, 64),
        label: `Frais généraux — sous-traitance ${stLabel.get(typeId) ?? typeId}`,
        nature: 'subcontract',
        montant,
      });
    }

    // Frais annexes : noyés dans les prix ou facturés à part, le chantier les paye pareil.
    // Code court numéroté (FA-1, FA-2…) : l'intitulé du poste reste le libellé, pas le code.
    let rang = 0;
    for (const poste of frais.postes) {
      if (new Decimal(poste.montant).isZero()) continue;
      rang += 1;
      postes.push({
        code: `FA-${rang}`,
        label: poste.designation,
        nature: 'site_overhead',
        montant: poste.montant,
      });
    }

    return postes.length > 0 ? { postes } : null;
  }

  getMarche(marcheId: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const marche = await em.query(`SELECT * FROM marche WHERE id = $1`, [marcheId]);
      if (marche.length === 0) {
        throw new NotFoundException(`Marché introuvable (${marcheId}).`);
      }
      const lines = await em.query(
        `SELECT * FROM marche_line WHERE marche_id = $1 ORDER BY sort_order ASC`,
        [marcheId],
      );
      return { marche: marche[0], lines };
    });
  }

  listMarches() {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, (em) =>
      em.query(`SELECT * FROM marche ORDER BY created_at DESC`),
    );
  }
}

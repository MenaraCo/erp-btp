import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { runInTenant } from '../../core/tenancy/tenant-transaction';
import {
  DataGridQuery,
  PaginatedResult,
  paginate,
} from '../../core/common/data-grid/data-grid';
import { AffaireEntity } from './entities/affaire.entity';
import {
  evaluateMetre,
  UnknownVariableError,
} from './metre-eval';
import { deriveAffaireStatus } from './affaire-derived-status';
import { computeLineNumbers, NumberingLine } from './devis-numbering';
import { DevisStatus } from './devis-workflow';
import { VenteService } from './vente.service';
import { flattenOuvrageToResources, RawOuvrage } from './ouvrage-flatten';
import { computeApproLine } from './appro-calc';
import Decimal from 'decimal.js';

export interface InsertOuvrageInput {
  ouvrageId: string;
  parentLineId?: string | null;
  quantity?: string | number | null;
  designation?: string | null;
  sortOrder?: number;
}

export interface DevisLinePatch {
  designation?: string;
  quantity?: string | number | null;
  unit?: string | null;
  pu?: string | number | null;
  perte?: string | number | null;
  nature?: string | null;
  /** Cadence (rendement, ex. m²/h) — pour la MO, le temps unitaire en découle. */
  cadence?: string | number | null;
  /** Prix public catalogue (affiché en regard du déboursé, mention « conv »). */
  prixPublic?: string | number | null;
  numCustom?: string | null;
  code?: string | null;
  codeAnalytique?: string | null;
  sortOrder?: number | null;
  /** Déplacer la ligne vers un nouveau parent (null = racine). Recalcule sort_order au bout. */
  parentLineId?: string | null;
  /** Propager désignation/pu/perte à toutes les ressources du même devis partageant le même code. */
  syncByCode?: boolean;
  /** Type de sous-traitance du devis auquel rattacher la ligne (nature = subcontract). */
  stTypeId?: string | null;
  /** Assiette de ventilation d'une ligne de frais : 'propre' | 'st' | 'all'. */
  ventilationBase?: string | null;
  /** false = ligne de FRAIS (non vendable) : son déboursé est ventilé sur les lignes vendables. */
  vendable?: boolean;
  /** Champs d'achat de la ligne (indépendants de la bibliothèque). */
  uniteAchat?: string | null;
  coeffConversion?: string | number | null;
  supplierId?: string | null;
  refFournisseur?: string | null;
  conditionnement?: string | null;
}

export interface AffairePatch {
  name?: string;
  clientId?: string | null;
  moa?: string | null;
  lieuExecution?: Record<string, unknown> | null;
  budgetObjectif?: number | string | null;
  responsable?: string | null;
  notes?: string | null;
}

export interface DevisPatch {
  designation?: string;
  numero?: string | null;
  type?: DevisType;
  affaire_id?: string;
}

export interface DevisPlanningPatch {
  responsable?: string | null;
  priorite?: 'basse' | 'normale' | 'urgente' | 'critique';
  dateDebut?: string | null;
  dateEcheance?: string | null;
}

export type DevisLineType = 'titre' | 'sous_titre' | 'ouvrage' | 'ressource' | 'texte';
export type DevisType = 'principal' | 'lot' | 'avenant';

export interface AffaireInput {
  code: string;
  name: string;
  clientId?: string | null;
  moa?: string | null;
}

export interface DevisInput {
  designation: string;
  type?: DevisType;
  numero?: string | null;
}

export interface DevisLineInput {
  type: DevisLineType;
  parentLineId?: string | null;
  code?: string | null;
  codeAnalytique?: string | null;
  designation: string;
  unit?: string | null;
  quantity?: string | number | null;
  quantityFormula?: string | null;
  pu?: string | number | null;
  perte?: string | number | null;
  nature?: string | null;
  cadence?: string | number | null;
  prixPublic?: string | number | null;
  sourceOuvrageId?: string | null;
  sourceResourceId?: string | null;
  sortOrder?: number;
  /** false for titres non vendables / frais de chantier (ventilated by the feuille de vente). */
  vendable?: boolean;
  /** marks a titre/sous-titre as option/variante (propagates to descendants). */
  sectionType?: 'option' | 'variante' | null;
  /** Champs d'achat (copiés de la biblio à l'ajout, éditables dans le devis). */
  uniteAchat?: string | null;
  coeffConversion?: string | number | null;
  supplierId?: string | null;
  refFournisseur?: string | null;
  conditionnement?: string | null;
}

@Injectable()
export class DevisService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly context: TenantContext,
    private readonly vente: VenteService,
  ) {}

  /** Creates an affaire with its first (principal) devis and that devis's first version. */
  createAffaire(input: AffaireInput) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const affaire = (
        await em.query(
          `INSERT INTO affaire (tenant_id, code, name, client_id, moa, status)
           VALUES ($1, $2, $3, $4, $5, 'en_cours') RETURNING *`,
          [tenantId, input.code, input.name, input.clientId ?? null, input.moa ?? null],
        )
      )[0];
      const numero = (await this.nextDevisNumero(em)) ?? input.code;
      const devis = (
        await em.query(
          `INSERT INTO devis (tenant_id, affaire_id, numero, designation, type, status, sort_order)
           VALUES ($1, $2, $3, $4, 'principal', 'open', 0) RETURNING *`,
          [tenantId, affaire.id, numero, input.name],
        )
      )[0];
      const version = (
        await em.query(
          `INSERT INTO devis_version (tenant_id, devis_id, version_no, label)
           VALUES ($1, $2, 1, 'v1') RETURNING *`,
          [tenantId, devis.id],
        )
      )[0];
      return { affaire, devis, version };
    });
  }


  /**
   * Numéro de devis suivant, selon le paramétrage société (préfixe, séparateur, année,
   * longueur de séquence). Ex. « DEV-2026-0007 ».
   *
   * La séquence se déduit du plus grand numéro existant du MÊME gabarit plutôt que d'un
   * compteur stocké : ainsi une suppression ou un import ne crée jamais de doublon ni de trou
   * qui se propagerait.
   */
  private async nextDevisNumero(em: EntityManager): Promise<string | null> {
    const [p] = await em.query(
      `SELECT devis_prefix, devis_separator, devis_numero_annee, devis_numero_digits
         FROM company_preferences LIMIT 1`,
    );
    const prefix = (p?.devis_prefix ?? 'DEV').trim();
    if (!prefix) return null;
    const sep = p?.devis_separator ?? '-';
    const digits = Math.max(1, Math.min(8, Number(p?.devis_numero_digits ?? 4)));
    const withYear = p?.devis_numero_annee !== false;
    const base = withYear ? `${prefix}${sep}${new Date().getFullYear()}${sep}` : `${prefix}${sep}`;

    const rows = await em.query(
      `SELECT numero FROM devis WHERE numero LIKE $1 || '%'`,
      [base],
    );
    let max = 0;
    for (const r of rows) {
      const tail = String(r.numero).slice(base.length);
      // On n'accepte que le gabarit exact : « DEV-2026-0007 », pas « DEV-2026-0007-bis ».
      if (/^\d+$/.test(tail)) {
        max = Math.max(max, Number(tail));
      }
    }
    return `${base}${String(max + 1).padStart(digits, '0')}`;
  }

  /** Adds a devis to an affaire (Lot 2, avenant…). Client/lieu are inherited from the affaire. */
  createDevis(affaireId: string, input: DevisInput) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const affaire = await em.query(`SELECT id, code FROM affaire WHERE id = $1`, [affaireId]);
      if (affaire.length === 0) {
        throw new NotFoundException(`Unknown affaire "${affaireId}"`);
      }
      const order = (
        await em.query(
          `SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM devis WHERE affaire_id = $1`,
          [affaireId],
        )
      )[0].n;
      const devis = (
        await em.query(
          `INSERT INTO devis (tenant_id, affaire_id, numero, designation, type, status, sort_order)
           VALUES ($1, $2, $3, $4, $5, 'open', $6) RETURNING *`,
          [
            tenantId,
            affaireId,
            input.numero?.trim() || (await this.nextDevisNumero(em)),
            input.designation,
            input.type ?? 'lot',
            order,
          ],
        )
      )[0];
      const version = (
        await em.query(
          `INSERT INTO devis_version (tenant_id, devis_id, version_no, label)
           VALUES ($1, $2, 1, 'v1') RETURNING *`,
          [tenantId, devis.id],
        )
      )[0];
      await this.recomputeAffaireStatus(em, affaireId);
      return { devis, version };
    });
  }

  listAffaires(query: DataGridQuery): Promise<PaginatedResult<AffaireEntity>> {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, (em) =>
      paginate(em.getRepository(AffaireEntity).createQueryBuilder('p'), query, {
        alias: 'p',
        sortable: ['code', 'name', 'status', 'createdAt'],
        searchable: ['code', 'name', 'moa'],
        defaultSort: 'code',
      }),
    );
  }

  /**
   * Returns a single affaire with its devis (each with versions + aggregated KPIs from its latest
   * version's feuille de vente), for the affaire screen. KPIs are computed outside the read
   * transaction to avoid nesting runInTenant.
   */
  async getAffaire(affaireId: string) {
    const tenantId = this.context.requireTenantId();
    const base = await runInTenant(this.dataSource, tenantId, async (em) => {
      const affaire = (await em.query(`SELECT * FROM affaire WHERE id = $1`, [affaireId]))[0];
      if (!affaire) {
        throw new NotFoundException(`Unknown affaire "${affaireId}"`);
      }
      const devis = await em.query(
        `SELECT id, numero, designation, type, status, sort_order FROM devis
          WHERE affaire_id = $1 ORDER BY sort_order ASC, created_at ASC`,
        [affaireId],
      );
      const versions = await em.query(
        `SELECT v.id, v.devis_id, v.version_no, v.label, v.created_at FROM devis_version v
           JOIN devis d ON d.id = v.devis_id
          WHERE d.affaire_id = $1 ORDER BY v.version_no ASC`,
        [affaireId],
      );
      return { affaire, devis, versions };
    });

    const devis = [];
    let totals = { debourse: 0, revient: 0, pvHt: 0, margeBrute: 0, margeNette: 0 };
    for (const d of base.devis as Array<{ id: string }>) {
      const dv = (base.versions as Array<{ id: string; devis_id: string; version_no: number }>)
        .filter((v) => v.devis_id === d.id)
        .sort((a, b) => b.version_no - a.version_no);
      let kpis = null;
      if (dv.length > 0) {
        const fv = await this.vente.computeForVersion(dv[0].id);
        kpis = {
          debourse: fv.totalDebourse,
          revient: fv.totalRevient,
          pvHt: fv.totalPvHt,
          margeBrute: fv.margeBrute,
          margeNette: fv.margeNette,
        };
        totals = {
          debourse: totals.debourse + Number(fv.totalDebourse),
          revient: totals.revient + Number(fv.totalRevient),
          pvHt: totals.pvHt + Number(fv.totalPvHt),
          margeBrute: totals.margeBrute + Number(fv.margeBrute),
          margeNette: totals.margeNette + Number(fv.margeNette),
        };
      }
      devis.push({ ...d, versions: dv.sort((a, b) => a.version_no - b.version_no), kpis });
    }
    return { affaire: base.affaire, devis, totals };
  }

  /** Aggregated études stats for the dashboard (synthèse de toutes les études). */
  getEstimatingStats() {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const affaires: Array<{ status: string; n: string }> = await em.query(
        `SELECT status, COUNT(*)::int AS n FROM affaire GROUP BY status`,
      );
      const devis: Array<{ status: string; n: string }> = await em.query(
        `SELECT status, COUNT(*)::int AS n FROM devis GROUP BY status`,
      );
      const toMap = (rows: Array<{ status: string; n: string }>) =>
        Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
      const affaireMap = toMap(affaires);
      const devisMap = toMap(devis);
      const totalAffaires = Object.values(affaireMap).reduce((s, v) => s + v, 0);
      const totalDevis = Object.values(devisMap).reduce((s, v) => s + v, 0);
      const won = devisMap['won'] ?? 0;
      const lost = devisMap['lost'] ?? 0;
      const tauxReussite = won + lost > 0 ? Math.round((won / (won + lost)) * 100) : null;
      return {
        affaires: { total: totalAffaires, byStatus: affaireMap },
        devis: { total: totalDevis, byStatus: devisMap, won, lost, tauxReussite },
      };
    });
  }

  /** Lists all devis (across affaires) with their affaire, for the devis list screen. */
  async listDevis() {
    const tenantId = this.context.requireTenantId();
    const rows: Array<Record<string, unknown>> = await runInTenant(
      this.dataSource,
      tenantId,
      (em) =>
        em.query(
          `SELECT d.id, d.numero, d.designation, d.type, d.status, d.affaire_id,
                  d.responsable, d.priorite,
                  to_char(d.date_debut, 'YYYY-MM-DD') AS date_debut,
                  to_char(d.date_echeance, 'YYYY-MM-DD') AS date_echeance,
                  to_char(d.created_at, 'YYYY-MM-DD') AS created_at,
                  a.code AS affaire_code, a.name AS affaire_name,
                  COALESCE(
                    json_agg(
                      json_build_object(
                        'id', v.id,
                        'version_no', v.version_no,
                        'label', v.label,
                        'created_at', to_char(v.created_at, 'YYYY-MM-DD')
                      ) ORDER BY v.version_no
                    ) FILTER (WHERE v.id IS NOT NULL),
                    '[]'
                  ) AS versions,
                  (SELECT id FROM devis_version
                    WHERE devis_id = d.id ORDER BY version_no DESC LIMIT 1
                  ) AS latest_version_id
             FROM devis d
             JOIN affaire a ON a.id = d.affaire_id
             LEFT JOIN devis_version v ON v.devis_id = d.id
             GROUP BY d.id, a.code, a.name
             ORDER BY d.created_at DESC`,
        ),
    );

    const totalsMap = new Map<string, Record<string, string>>();
    await Promise.all(
      rows
        .filter((r) => r.latest_version_id)
        .map(async (r) => {
          try {
            const fv = await this.vente.computeForVersion(r.latest_version_id as string);
            const pvHt = Number(fv.totalPvHt);
            const margeNette = Number(fv.margeNette);
            totalsMap.set(r.id as string, {
              debourse: fv.totalDebourse,
              revient: fv.totalRevient,
              pvHt: fv.totalPvHt,
              margeNette: fv.margeNette,
              margeNettePct:
                pvHt !== 0 ? ((margeNette / pvHt) * 100).toFixed(1) : '0.0',
            });
          } catch {
            /* version sans lignes — totaux à zéro */
          }
        }),
    );

    return rows.map((r) => {
      const { latest_version_id: _, ...rest } = r;
      return { ...rest, totals: totalsMap.get(r.id as string) ?? null };
    });
  }

  /** Deletes a devis and all its versions/lines (CASCADE). */
  deleteDevis(devisId: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const row = (await em.query(`SELECT id, affaire_id FROM devis WHERE id = $1`, [devisId]))[0];
      if (!row) throw new NotFoundException(`Unknown devis "${devisId}"`);
      await em.query(`DELETE FROM devis WHERE id = $1`, [devisId]);
      await this.recomputeAffaireStatus(em, row.affaire_id);
      return { deleted: devisId };
    });
  }

  /** Sets the devis status directly (status machine enforced on the frontend/business layer). */
  setDevisStatus(devisId: string, status: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const row = (await em.query(`SELECT id, affaire_id FROM devis WHERE id = $1`, [devisId]))[0];
      if (!row) throw new NotFoundException(`Unknown devis "${devisId}"`);
      await em.query(`UPDATE devis SET status = $1, updated_at = now() WHERE id = $2`, [status, devisId]);
      await this.recomputeAffaireStatus(em, row.affaire_id);
      return { id: devisId, status };
    });
  }

  /** Deep-copies a devis (latest version + all lines) under the same affaire. */
  async duplicateDevis(devisId: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const src = (await em.query(`SELECT * FROM devis WHERE id = $1`, [devisId]))[0];
      if (!src) throw new NotFoundException(`Unknown devis "${devisId}"`);

      const newDevis = (await em.query(
        `INSERT INTO devis (tenant_id, affaire_id, numero, designation, type, status, sort_order)
         VALUES ($1, $2, NULL, $3, $4, 'open',
                 (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM devis WHERE affaire_id = $2))
         RETURNING id`,
        [tenantId, src.affaire_id, `${src.designation} (copie)`, src.type],
      ))[0];

      const latestV = (await em.query(
        `SELECT * FROM devis_version WHERE devis_id = $1 ORDER BY version_no DESC LIMIT 1`,
        [devisId],
      ))[0];
      if (!latestV) return { id: newDevis.id, affaireId: src.affaire_id };

      const newVersion = (await em.query(
        `INSERT INTO devis_version (tenant_id, devis_id, version_no, label)
         VALUES ($1, $2, 1, $3) RETURNING id`,
        [tenantId, newDevis.id, latestV.label ?? 'v1'],
      ))[0];

      const lines: Array<{ id: string; parent_line_id: string | null; [k: string]: unknown }> =
        await em.query(
          `SELECT * FROM devis_line WHERE devis_version_id = $1 ORDER BY sort_order ASC`,
          [latestV.id],
        );

      const idMap = new Map<string, string>();
      for (const l of lines) {
        const nl = (await em.query(
          `INSERT INTO devis_line
             (tenant_id, devis_version_id, parent_line_id, type, code, code_analytique,
              designation, unit, quantity, pu, perte, nature,
              source_ouvrage_id, source_resource_id, sort_order, num_custom,
              section_type, vendable,
              unite_achat, coeff_conversion, supplier_id, ref_fournisseur, conditionnement,
              st_type_id, ventilation_base)
           VALUES ($1,$2,NULL,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
                   $18,$19,$20,$21,$22,$23,$24)
           RETURNING id`,
          [
            tenantId, newVersion.id,
            l['type'], l['code'], l['code_analytique'],
            l['designation'], l['unit'], l['quantity'], l['pu'], l['perte'], l['nature'],
            l['source_ouvrage_id'], l['source_resource_id'],
            l['sort_order'], l['num_custom'], l['section_type'], l['vendable'] ?? true,
            l['unite_achat'], l['coeff_conversion'], l['supplier_id'],
            l['ref_fournisseur'], l['conditionnement'],
            l['st_type_id'], l['ventilation_base'],
          ],
        ))[0];
        idMap.set(l.id, nl.id);
      }
      for (const l of lines) {
        if (l.parent_line_id) {
          const newParentId = idMap.get(l.parent_line_id);
          if (newParentId) {
            await em.query(`UPDATE devis_line SET parent_line_id = $1 WHERE id = $2`, [
              newParentId, idMap.get(l.id),
            ]);
          }
        }
      }

      return { id: newDevis.id, affaireId: src.affaire_id };
    });
  }

  /** Returns a devis with its versions (read-side, for the devis editor). */
  getDevis(devisId: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const devis = (
        await em.query(
          `SELECT d.*, a.client_id, a.lieu_execution
             FROM devis d JOIN affaire a ON a.id = d.affaire_id
            WHERE d.id = $1`,
          [devisId],
        )
      )[0];
      if (!devis) {
        throw new NotFoundException(`Unknown devis "${devisId}"`);
      }
      const versions = await em.query(
        `SELECT id, version_no, label, created_at FROM devis_version
          WHERE devis_id = $1 ORDER BY version_no ASC`,
        [devisId],
      );
      return { devis, versions };
    });
  }

  /** Updates affaire metadata (lieu d'exécution structuré, budget, responsable, notes…). */
  updateAffaire(affaireId: string, patch: AffairePatch) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const exists = await em.query(`SELECT id FROM affaire WHERE id = $1`, [affaireId]);
      if (exists.length === 0) {
        throw new NotFoundException(`Unknown affaire "${affaireId}"`);
      }
      await em.query(
        `UPDATE affaire SET
           name = COALESCE($2, name),
           client_id = $3,
           moa = $4,
           lieu_execution = $5::jsonb,
           budget_objectif = $6,
           responsable = $7,
           notes = $8,
           updated_at = now()
         WHERE id = $1`,
        [
          affaireId,
          patch.name ?? null,
          patch.clientId ?? null,
          patch.moa ?? null,
          patch.lieuExecution != null ? JSON.stringify(patch.lieuExecution) : null,
          patch.budgetObjectif != null ? String(patch.budgetObjectif) : null,
          patch.responsable ?? null,
          patch.notes ?? null,
        ],
      );
      return (await em.query(`SELECT * FROM affaire WHERE id = $1`, [affaireId]))[0];
    });
  }

  /** Updates a devis's metadata (designation, numero, type). */
  updateDevis(devisId: string, patch: DevisPatch) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const exists = await em.query(`SELECT id, affaire_id FROM devis WHERE id = $1`, [devisId]);
      if (exists.length === 0) {
        throw new NotFoundException(`Unknown devis "${devisId}"`);
      }
      if (patch.affaire_id) {
        const affaire = await em.query(`SELECT id FROM affaire WHERE id = $1`, [patch.affaire_id]);
        if (affaire.length === 0) throw new NotFoundException(`Unknown affaire "${patch.affaire_id}"`);
      }
      await em.query(
        `UPDATE devis SET
           designation  = COALESCE($2, designation),
           numero       = $3,
           type         = COALESCE($4, type),
           affaire_id   = COALESCE($5, affaire_id),
           updated_at   = now()
         WHERE id = $1`,
        [devisId, patch.designation ?? null, patch.numero ?? null, patch.type ?? null, patch.affaire_id ?? null],
      );
      const old_affaire_id = exists[0].affaire_id as string;
      if (patch.affaire_id && patch.affaire_id !== old_affaire_id) {
        await this.recomputeAffaireStatus(em, old_affaire_id);
        await this.recomputeAffaireStatus(em, patch.affaire_id);
      }
      return (await em.query(`SELECT * FROM devis WHERE id = $1`, [devisId]))[0];
    });
  }

  /** Sets a devis's planning fields (responsable, priorité, échéances). */
  setDevisPlanning(
    devisId: string,
    p: { responsable?: string | null; priorite?: string; dateDebut?: string | null; dateEcheance?: string | null },
  ) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const exists = await em.query(`SELECT id FROM devis WHERE id = $1`, [devisId]);
      if (exists.length === 0) {
        throw new NotFoundException(`Unknown devis "${devisId}"`);
      }
      // Patch partiel : on ne touche qu'aux champs fournis (undefined = inchangé).
      await em.query(
        `UPDATE devis SET
           responsable = COALESCE($2, responsable),
           priorite = COALESCE($3, priorite),
           date_debut = COALESCE($4, date_debut),
           date_echeance = COALESCE($5, date_echeance),
           updated_at = now()
         WHERE id = $1`,
        [
          devisId,
          p.responsable === undefined ? null : p.responsable,
          p.priorite ?? null,
          p.dateDebut === undefined ? null : p.dateDebut,
          p.dateEcheance === undefined ? null : p.dateEcheance,
        ],
      );
      return (await em.query(`SELECT * FROM devis WHERE id = $1`, [devisId]))[0];
    });
  }

  /** Creates a new version by deep-copying all lines from the latest existing version. */
  createVersion(devisId: string, label?: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const devis = await em.query(`SELECT id FROM devis WHERE id = $1`, [devisId]);
      if (devis.length === 0) throw new NotFoundException(`Unknown devis "${devisId}"`);

      const next = (
        await em.query(
          `SELECT COALESCE(MAX(version_no), 0) + 1 AS n FROM devis_version WHERE devis_id = $1`,
          [devisId],
        )
      )[0].n;

      const newVersion = (
        await em.query(
          `INSERT INTO devis_version (tenant_id, devis_id, version_no, label)
           VALUES ($1, $2, $3, $4) RETURNING *`,
          [tenantId, devisId, next, label ?? `v${next}`],
        )
      )[0];

      // Copy all lines from the latest version (next - 1)
      const srcVersion = (
        await em.query(
          `SELECT id FROM devis_version WHERE devis_id = $1 AND version_no = $2`,
          [devisId, next - 1],
        )
      )[0];

      if (srcVersion) {
        const srcLines: Array<Record<string, unknown>> = await em.query(
          `SELECT * FROM devis_line WHERE devis_version_id = $1 ORDER BY sort_order ASC`,
          [srcVersion.id],
        );
        const idMap = new Map<string, string>();
        for (const l of srcLines) {
          const nl = (await em.query(
            `INSERT INTO devis_line
               (tenant_id, devis_version_id, parent_line_id, type, code, code_analytique,
                designation, unit, quantity, quantity_formula, pu, pu_vente, pu_vente_force,
                perte, nature, cadence, prix_public, source_ouvrage_id, source_resource_id,
                sort_order, num_custom, section_type, vendable, base_line_id,
                unite_achat, coeff_conversion, supplier_id, ref_fournisseur, conditionnement,
                st_type_id, ventilation_base)
             VALUES ($1,$2,NULL,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,
                     $24,$25,$26,$27,$28,$29,$30)
             RETURNING id`,
            [
              tenantId, newVersion.id,
              l['type'], l['code'], l['code_analytique'],
              l['designation'], l['unit'], l['quantity'], l['quantity_formula'],
              l['pu'], l['pu_vente'], l['pu_vente_force'] ?? false,
              l['perte'], l['nature'], l['cadence'], l['prix_public'],
              l['source_ouvrage_id'], l['source_resource_id'],
              l['sort_order'], l['num_custom'], l['section_type'], l['vendable'] ?? true,
              l['id'], // base_line_id → tracks lineage to previous version
              l['unite_achat'], l['coeff_conversion'], l['supplier_id'],
              l['ref_fournisseur'], l['conditionnement'],
              l['st_type_id'], l['ventilation_base'],
            ],
          ))[0];
          idMap.set(l['id'] as string, nl.id);
        }
        // Second pass: fix parent_line_id references
        for (const l of srcLines) {
          if (l['parent_line_id']) {
            const newParentId = idMap.get(l['parent_line_id'] as string);
            if (newParentId) {
              await em.query(`UPDATE devis_line SET parent_line_id = $1 WHERE id = $2`, [
                newParentId, idMap.get(l['id'] as string),
              ]);
            }
          }
        }
      }

      return newVersion;
    });
  }

  /** Deletes a specific version (not allowed if it is the only version). */
  deleteVersion(versionId: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const ver = (await em.query(
        `SELECT id, devis_id FROM devis_version WHERE id = $1`, [versionId],
      ))[0];
      if (!ver) throw new NotFoundException(`Unknown version "${versionId}"`);

      const count = (await em.query(
        `SELECT COUNT(*)::int AS n FROM devis_version WHERE devis_id = $1`, [ver.devis_id],
      ))[0].n;
      if (count <= 1) {
        throw new BadRequestException('Cannot delete the last version of a devis. Delete the devis instead.');
      }

      await em.query(`DELETE FROM devis_version WHERE id = $1`, [versionId]);
      return { deleted: versionId };
    });
  }

  /** Returns a diff of this version vs the previous version (added / removed / modified lines). */
  getVersionChangelog(versionId: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const ver = (await em.query(
        `SELECT id, devis_id, version_no FROM devis_version WHERE id = $1`, [versionId],
      ))[0];
      if (!ver) throw new NotFoundException(`Unknown version "${versionId}"`);

      const currLines: Array<Record<string, unknown>> = await em.query(
        `SELECT id, type, designation, quantity, unit, pu, base_line_id, sort_order
           FROM devis_line WHERE devis_version_id = $1 AND type IN ('titre','sous_titre','ouvrage','ressource')
           ORDER BY sort_order`,
        [versionId],
      );

      if (ver.version_no <= 1) {
        return {
          previousVersionNo: null,
          added: currLines.map((l) => ({ id: l['id'], designation: l['designation'], type: l['type'] })),
          removed: [],
          modified: [],
        };
      }

      const prevVer = (await em.query(
        `SELECT id FROM devis_version WHERE devis_id = $1 AND version_no = $2`,
        [ver.devis_id, ver.version_no - 1],
      ))[0];

      if (!prevVer) return { previousVersionNo: ver.version_no - 1, added: currLines, removed: [], modified: [] };

      const prevLines: Array<Record<string, unknown>> = await em.query(
        `SELECT id, type, designation, quantity, unit, pu, sort_order
           FROM devis_line WHERE devis_version_id = $1 AND type IN ('titre','sous_titre','ouvrage','ressource')
           ORDER BY sort_order`,
        [prevVer.id],
      );

      const prevById = new Map(prevLines.map((l) => [l['id'] as string, l]));
      const baseLineIds = new Set(
        currLines.filter((l) => l['base_line_id']).map((l) => l['base_line_id'] as string),
      );

      const added = currLines.filter((l) => !l['base_line_id']);
      const removed = prevLines.filter((l) => !baseLineIds.has(l['id'] as string));
      const modified: Array<Record<string, unknown>> = [];

      for (const curr of currLines) {
        const baseId = curr['base_line_id'] as string | null;
        if (!baseId) continue;
        const prev = prevById.get(baseId);
        if (!prev) continue;
        const changes: string[] = [];
        if (curr['designation'] !== prev['designation']) changes.push(`Désignation : « ${prev['designation']} » → « ${curr['designation']} »`);
        if (String(curr['quantity'] ?? '') !== String(prev['quantity'] ?? '')) changes.push(`Quantité : ${prev['quantity']} → ${curr['quantity']}`);
        if (String(curr['pu'] ?? '') !== String(prev['pu'] ?? '')) changes.push(`PU : ${prev['pu']} → ${curr['pu']}`);
        if ((curr['unit'] ?? '') !== (prev['unit'] ?? '')) changes.push(`Unité : ${prev['unit'] ?? '—'} → ${curr['unit'] ?? '—'}`);
        if (changes.length > 0) {
          modified.push({ id: curr['id'], designation: curr['designation'], type: curr['type'], changes });
        }
      }

      return { previousVersionNo: ver.version_no - 1, added, removed, modified };
    });
  }

  /** Recomputes the affaire's derived status from the statuses of its devis. */
  async recomputeAffaireStatus(em: EntityManager, affaireId: string): Promise<void> {
    const rows = await em.query(`SELECT status FROM devis WHERE affaire_id = $1`, [affaireId]);
    const derived = deriveAffaireStatus(rows.map((r: { status: DevisStatus }) => r.status));
    await em.query(`UPDATE affaire SET status = $1, updated_at = now() WHERE id = $2`, [
      derived,
      affaireId,
    ]);
  }

  addLine(versionId: string, input: DevisLineInput) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const version = await em.query(`SELECT id FROM devis_version WHERE id = $1`, [
        versionId,
      ]);
      if (version.length === 0) {
        throw new NotFoundException(`Unknown version "${versionId}"`);
      }
      if (input.parentLineId) {
        const parent = await em.query(
          `SELECT id FROM devis_line WHERE id = $1 AND devis_version_id = $2`,
          [input.parentLineId, versionId],
        );
        if (parent.length === 0) {
          throw new BadRequestException('parent line does not belong to this version');
        }
      }

      let quantity = input.quantity != null ? String(input.quantity) : null;
      if (input.quantityFormula) {
        const vars = await this.loadVariables(em, versionId);
        const computed = this.tryEvaluate(input.quantityFormula, vars);
        quantity = computed ? computed.toString() : null;
      }

      // Ressource ajoutée depuis la bibliothèque : hériter automatiquement de sa NATURE
      // (matériaux / MO / matériel / sous-traitance), de son code analytique et de ses champs
      // d'achat lorsqu'ils ne sont pas fournis. C'est une COPIE de valeurs — la ligne du devis
      // reste découplée de la biblio.
      let code = input.code ?? null;
      let unit = input.unit ?? null;
      let nature = input.nature ?? null;
      let prixPublic = input.prixPublic != null ? String(input.prixPublic) : null;
      let pu = input.pu != null ? String(input.pu) : null;
      let codeAnalytique = input.codeAnalytique ?? null;
      let uniteAchat = input.uniteAchat ?? null;
      let coeffConversion = input.coeffConversion != null ? String(input.coeffConversion) : null;
      let supplierId = input.supplierId ?? null;
      let refFournisseur = input.refFournisseur ?? null;
      let conditionnement = input.conditionnement ?? null;
      if (input.sourceResourceId) {
        const res = await em.query(
          `SELECT r.code, r.nature, r.unit, r.prix_public, r.unit_cost,
                  r.unite_achat, r.coeff_conversion, r.supplier_id, r.ref_fournisseur,
                  r.conditionnement, ac.code AS code_analytique
             FROM resource r
             LEFT JOIN analytical_code ac ON ac.id = r.code_analytique_id
            WHERE r.id = $1 AND r.tenant_id = $2`,
          [input.sourceResourceId, tenantId],
        );
        if (res.length > 0) {
          const r = res[0];
          code = code ?? r.code ?? null;
          unit = unit ?? r.unit ?? null;
          nature = nature ?? r.nature ?? null;
          prixPublic = prixPublic ?? (r.prix_public != null ? String(r.prix_public) : null);
          pu = pu ?? (r.unit_cost != null ? String(r.unit_cost) : null);
          codeAnalytique = codeAnalytique ?? r.code_analytique ?? null;
          uniteAchat = uniteAchat ?? r.unite_achat ?? null;
          coeffConversion =
            coeffConversion ?? (r.coeff_conversion != null ? String(r.coeff_conversion) : null);
          supplierId = supplierId ?? r.supplier_id ?? null;
          refFournisseur = refFournisseur ?? r.ref_fournisseur ?? null;
          conditionnement = conditionnement ?? r.conditionnement ?? null;
        }
      }

      return (
        await em.query(
          `INSERT INTO devis_line
             (tenant_id, devis_version_id, parent_line_id, type, code, code_analytique, designation, unit,
              quantity, quantity_formula, pu, perte, nature, cadence, prix_public,
              source_ouvrage_id, source_resource_id, sort_order, vendable, section_type,
              unite_achat, coeff_conversion, supplier_id, ref_fournisseur, conditionnement)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
                   $21,$22,$23,$24,$25) RETURNING *`,
          [
            tenantId,
            versionId,
            input.parentLineId ?? null,
            input.type,
            code,
            codeAnalytique,
            input.designation,
            unit,
            quantity,
            input.quantityFormula ?? null,
            pu,
            input.perte != null ? String(input.perte) : '0',
            nature,
            input.cadence != null ? String(input.cadence) : null,
            prixPublic,
            input.sourceOuvrageId ?? null,
            input.sourceResourceId ?? null,
            input.sortOrder ?? 0,
            input.vendable !== false,
            input.sectionType ?? null,
            uniteAchat,
            coeffConversion,
            supplierId,
            refFournisseur,
            conditionnement,
          ],
        )
      )[0];
    });
  }

  /** Marks a titre/sous-titre (or any line) as option/variante, or clears it (null). */
  setLineSection(lineId: string, sectionType: 'option' | 'variante' | null) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const exists = await em.query(`SELECT id FROM devis_line WHERE id = $1`, [lineId]);
      if (exists.length === 0) {
        throw new NotFoundException(`Unknown devis line "${lineId}"`);
      }
      await em.query(
        `UPDATE devis_line SET section_type = $1, updated_at = now() WHERE id = $2`,
        [sectionType, lineId],
      );
      return (await em.query(`SELECT * FROM devis_line WHERE id = $1`, [lineId]))[0];
    });
  }

  /** Loads all ouvrages + components (with resource meta) for the pure flatten. */
  private async loadRawOuvrages(em: EntityManager): Promise<Map<string, RawOuvrage>> {
    const ouvrages = await em.query(`SELECT id FROM ouvrage`);
    const components = await em.query(
      `SELECT oc.parent_ouvrage_id, oc.kind, oc.quantity, oc.rate, oc.cadence,
              oc.child_ouvrage_id, oc.child_resource_id,
              r.code, r.label, r.nature, r.unit, r.unit_cost, r.prix_public,
              ca.code AS code_analytique
         FROM ouvrage_component oc
         LEFT JOIN resource r ON r.id = oc.child_resource_id
         LEFT JOIN analytical_code ca ON ca.id = r.code_analytique_id`,
    );
    const map = new Map<string, RawOuvrage>();
    for (const o of ouvrages) {
      map.set(o.id, { id: o.id, components: [] });
    }
    for (const c of components) {
      const parent = map.get(c.parent_ouvrage_id);
      if (!parent) continue;
      parent.components.push({
        kind: c.kind,
        quantity: c.quantity ?? 0,
        rate: c.rate ?? 0,
        childOuvrageId: c.child_ouvrage_id ?? null,
        resourceId: c.child_resource_id ?? null,
        code: c.code ?? null,
        codeAnalytique: c.code_analytique ?? null,
        designation: c.label ?? 'Ressource',
        nature: c.nature ?? 'material',
        unit: c.unit ?? null,
        unitCost: c.unit_cost ?? 0,
        prixPublic: c.prix_public ?? null,
        cadence: c.cadence ?? null,
      });
    }
    return map;
  }

  /**
   * Inserts a library ouvrage into a version, COPYING its sous-détail into editable child
   * ressource lines (M.4). The copy is a snapshot, decoupled from the library.
   */
  insertOuvrageFromLibrary(versionId: string, input: InsertOuvrageInput) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const version = await em.query(`SELECT id FROM devis_version WHERE id = $1`, [versionId]);
      if (version.length === 0) {
        throw new NotFoundException(`Unknown version "${versionId}"`);
      }
      if (input.parentLineId) {
        const parent = await em.query(
          `SELECT id FROM devis_line WHERE id = $1 AND devis_version_id = $2`,
          [input.parentLineId, versionId],
        );
        if (parent.length === 0) {
          throw new BadRequestException('parent line does not belong to this version');
        }
      }
      const ouvrage = (
        await em.query(`SELECT id, code, label, unit FROM ouvrage WHERE id = $1`, [input.ouvrageId])
      )[0];
      if (!ouvrage) {
        throw new BadRequestException(`Unknown ouvrage "${input.ouvrageId}"`);
      }

      const ouvrageLine = (
        await em.query(
          `INSERT INTO devis_line
             (tenant_id, devis_version_id, parent_line_id, type, code, designation, unit,
              quantity, source_ouvrage_id, sort_order, vendable)
           VALUES ($1,$2,$3,'ouvrage',$4,$5,$6,$7,$8,$9,true) RETURNING *`,
          [
            tenantId,
            versionId,
            input.parentLineId ?? null,
            ouvrage.code ?? null,
            input.designation ?? ouvrage.label,
            ouvrage.unit ?? null,
            input.quantity != null ? String(input.quantity) : '1',
            input.ouvrageId,
            input.sortOrder ?? 0,
          ],
        )
      )[0];

      const raws = await this.loadRawOuvrages(em);
      const flat = flattenOuvrageToResources(input.ouvrageId, raws);
      const components = [];
      for (let i = 0; i < flat.length; i++) {
        const f = flat[i];
        const child = (
          await em.query(
            `INSERT INTO devis_line
               (tenant_id, devis_version_id, parent_line_id, type, code, code_analytique,
                designation, unit, quantity, pu, perte, nature, cadence, prix_public,
                source_resource_id, sort_order, vendable)
             VALUES ($1,$2,$3,'ressource',$4,$5,$6,$7,$8,$9,0,$10,$11,$12,$13,$14,true) RETURNING *`,
            [
              tenantId,
              versionId,
              ouvrageLine.id,
              f.code,
              f.codeAnalytique ?? null,
              f.designation,
              f.unit,
              f.qtyPerUnit,
              f.unitCost,
              f.nature,
              f.cadence,
              f.prixPublic,
              f.resourceId,
              i,
            ],
          )
        )[0];
        components.push(child);
      }

      // Les composants copiés héritent aussi des champs d'achat de leur ressource bibliothèque
      // (unité d'achat, coeff de conversion, distributeur…), nécessaires au Calcul Appro et
      // éditables ensuite dans le devis sans impacter la bibliothèque.
      await em.query(
        `UPDATE devis_line dl SET
           unite_achat = COALESCE(dl.unite_achat, r.unite_achat),
           coeff_conversion = COALESCE(dl.coeff_conversion, r.coeff_conversion),
           supplier_id = COALESCE(dl.supplier_id, r.supplier_id),
           ref_fournisseur = COALESCE(dl.ref_fournisseur, r.ref_fournisseur),
           conditionnement = COALESCE(dl.conditionnement, r.conditionnement)
         FROM resource r
         WHERE dl.source_resource_id = r.id AND dl.parent_line_id = $1`,
        [ouvrageLine.id],
      );

      return { ouvrage: ouvrageLine, components };
    });
  }

  /** Updates an editable devis line. Supports move (parentLineId) and syncByCode propagation. */
  updateLine(lineId: string, patch: DevisLinePatch) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const [cur] = await em.query(
        `SELECT id, code, type, devis_version_id FROM devis_line WHERE id = $1`, [lineId],
      );
      if (!cur) throw new NotFoundException(`Unknown devis line "${lineId}"`);

      // Move to new parent: set parent_line_id and append at end of destination.
      if (patch.parentLineId !== undefined) {
        const [maxRow] = await em.query(
          `SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM devis_line
           WHERE parent_line_id IS NOT DISTINCT FROM $1 AND id != $2`,
          [patch.parentLineId, lineId],
        );
        await em.query(
          `UPDATE devis_line SET parent_line_id = $2, sort_order = $3, updated_at = now() WHERE id = $1`,
          [lineId, patch.parentLineId, maxRow.n],
        );
      }

      await em.query(
        `UPDATE devis_line SET
           designation = COALESCE($2, designation),
           quantity = COALESCE($3, quantity),
           unit = COALESCE($4, unit),
           pu = COALESCE($5, pu),
           perte = COALESCE($6, perte),
           nature = COALESCE($7, nature),
           num_custom = CASE WHEN $8 = '__KEEP__' THEN num_custom ELSE NULLIF($8, '') END,
           code = CASE WHEN $9 = '__KEEP__' THEN code ELSE NULLIF($9, '') END,
           code_analytique = CASE WHEN $10 = '__KEEP__' THEN code_analytique ELSE NULLIF($10, '') END,
           sort_order = COALESCE($11, sort_order),
           cadence = CASE WHEN $12 = '__KEEP__' THEN cadence ELSE NULLIF($12, '')::numeric END,
           prix_public = CASE WHEN $13 = '__KEEP__' THEN prix_public ELSE NULLIF($13, '')::numeric END,
           unite_achat = CASE WHEN $14 = '__KEEP__' THEN unite_achat ELSE NULLIF($14, '') END,
           coeff_conversion = CASE WHEN $15 = '__KEEP__' THEN coeff_conversion ELSE NULLIF($15, '')::numeric END,
           supplier_id = CASE WHEN $16 = '__KEEP__' THEN supplier_id ELSE NULLIF($16, '')::uuid END,
           ref_fournisseur = CASE WHEN $17 = '__KEEP__' THEN ref_fournisseur ELSE NULLIF($17, '') END,
           conditionnement = CASE WHEN $18 = '__KEEP__' THEN conditionnement ELSE NULLIF($18, '') END,
           st_type_id = CASE WHEN $19 = '__KEEP__' THEN st_type_id ELSE NULLIF($19, '') END,
           ventilation_base = CASE WHEN $20 = '__KEEP__' THEN ventilation_base ELSE NULLIF($20, '') END,
           vendable = COALESCE($21, vendable),
           updated_at = now()
         WHERE id = $1`,
        [
          lineId,
          patch.designation ?? null,
          patch.quantity != null ? String(patch.quantity) : null,
          patch.unit ?? null,
          patch.pu != null ? String(patch.pu) : null,
          patch.perte != null ? String(patch.perte) : null,
          patch.nature ?? null,
          patch.numCustom === undefined ? '__KEEP__' : (patch.numCustom ?? ''),
          patch.code === undefined ? '__KEEP__' : (patch.code ?? ''),
          patch.codeAnalytique === undefined ? '__KEEP__' : (patch.codeAnalytique ?? ''),
          patch.sortOrder != null ? patch.sortOrder : null,
          patch.cadence === undefined ? '__KEEP__' : (patch.cadence != null ? String(patch.cadence) : ''),
          patch.prixPublic === undefined ? '__KEEP__' : (patch.prixPublic != null ? String(patch.prixPublic) : ''),
          patch.uniteAchat === undefined ? '__KEEP__' : (patch.uniteAchat ?? ''),
          patch.coeffConversion === undefined ? '__KEEP__' : (patch.coeffConversion != null ? String(patch.coeffConversion) : ''),
          patch.supplierId === undefined ? '__KEEP__' : (patch.supplierId ?? ''),
          patch.refFournisseur === undefined ? '__KEEP__' : (patch.refFournisseur ?? ''),
          patch.conditionnement === undefined ? '__KEEP__' : (patch.conditionnement ?? ''),
          patch.stTypeId === undefined ? '__KEEP__' : (patch.stTypeId ?? ''),
          patch.ventilationBase === undefined ? '__KEEP__' : (patch.ventilationBase ?? ''),
          patch.vendable ?? null,
        ],
      );

      // Propagate designation/pu/perte/nature to all ressources with same code in this version.
      const codeToSync = patch.code !== undefined ? patch.code : cur.code;
      if (patch.syncByCode && codeToSync && cur.type === 'ressource') {
        const sets: string[] = [];
        const vals: unknown[] = [codeToSync, cur.devis_version_id, lineId];
        if (patch.designation !== undefined) { sets.push(`designation = $${vals.length + 1}`); vals.push(patch.designation); }
        if (patch.pu !== undefined) { sets.push(`pu = $${vals.length + 1}`); vals.push(patch.pu != null ? String(patch.pu) : null); }
        if (patch.perte !== undefined) { sets.push(`perte = $${vals.length + 1}`); vals.push(patch.perte != null ? String(patch.perte) : null); }
        if (patch.nature !== undefined) { sets.push(`nature = $${vals.length + 1}`); vals.push(patch.nature ?? null); }
        if (sets.length > 0) {
          await em.query(
            `UPDATE devis_line SET ${sets.join(', ')}, updated_at = now()
             WHERE code = $1 AND devis_version_id = $2 AND id != $3 AND type = 'ressource'`,
            vals,
          );
        }
      }

      return (await em.query(`SELECT * FROM devis_line WHERE id = $1`, [lineId]))[0];
    });
  }

  /** Reorders siblings by assigning sort_order = 0,1,2,… to orderedIds in sequence. */
  reorderLines(versionId: string, parentLineId: string | null, orderedIds: string[]) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      for (let i = 0; i < orderedIds.length; i++) {
        await em.query(
          `UPDATE devis_line SET sort_order = $1, updated_at = now()
           WHERE id = $2 AND devis_version_id = $3`,
          [i, orderedIds[i], versionId],
        );
      }
    });
  }

  /** Duplicates a line and its whole subtree at the same level (sort_order = max+1). */
  duplicateLine(lineId: string, keepCode: boolean) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const copySubtree = async (srcId: string, destParentId: string | null): Promise<string> => {
        const [maxRow] = await em.query(
          `SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM devis_line
           WHERE parent_line_id IS NOT DISTINCT FROM $1`,
          [destParentId],
        );
        const [newRow] = await em.query(
          `INSERT INTO devis_line
             (tenant_id, devis_version_id, parent_line_id, type, designation,
              code, code_analytique, unit, quantity, quantity_formula, pu, perte, nature,
              source_ouvrage_id, source_resource_id, sort_order, vendable, section_type,
              cadence, prix_public, unite_achat, coeff_conversion, supplier_id,
              ref_fournisseur, conditionnement, st_type_id, ventilation_base)
           SELECT tenant_id, devis_version_id, $2, type, designation,
              ${keepCode ? 'code' : 'NULL::varchar(64)'},
              ${keepCode ? 'code_analytique' : 'NULL::varchar(64)'},
              unit, quantity, quantity_formula, pu, perte, nature,
              source_ouvrage_id, source_resource_id, $3, vendable, section_type,
              cadence, prix_public, unite_achat, coeff_conversion, supplier_id,
              ref_fournisseur, conditionnement, st_type_id, ventilation_base
           FROM devis_line WHERE id = $1
           RETURNING id`,
          [srcId, destParentId, maxRow.n],
        );
        const newId: string = newRow.id;
        const children: { id: string }[] = await em.query(
          `SELECT id FROM devis_line WHERE parent_line_id = $1 ORDER BY sort_order`, [srcId],
        );
        for (const child of children) await copySubtree(child.id, newId);
        return newId;
      };

      const [src] = await em.query(
        `SELECT parent_line_id FROM devis_line WHERE id = $1`, [lineId],
      );
      if (!src) throw new NotFoundException(`Line ${lineId} not found`);
      const newId = await copySubtree(lineId, src.parent_line_id);
      return { duplicatedId: newId };
    });
  }

  /** Deletes a line and (via ON DELETE CASCADE) its whole subtree. */
  deleteLine(lineId: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const exists = await em.query(`SELECT id FROM devis_line WHERE id = $1`, [lineId]);
      if (exists.length === 0) {
        throw new NotFoundException(`Unknown devis line "${lineId}"`);
      }
      await em.query(`DELETE FROM devis_line WHERE id = $1`, [lineId]);
      return { deleted: lineId };
    });
  }

  /**
   * Calcul Appro : agrège les ressources du devis (issues de la bibliothèque) et convertit la
   * quantité d'emploi en quantité d'achat via le coefficient de conversion de chaque ressource.
   */
  computeApproForVersion(versionId: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      // Toutes les ressources du devis (biblio ET saisies à la main). Les métadonnées d'achat
      // (unité d'achat, coeff de conversion, prix public…) sont prises EN PRIORITÉ sur la ligne
      // du devis — elles y sont copiées à l'ajout puis éditables sans toucher la bibliothèque —
      // avec repli sur la ressource bibliothèque quand la ligne ne les porte pas.
      const rows: Array<{
        line_id: string;
        resource_id: string | null;
        code: string | null;
        label: string;
        unite_emploi: string | null;
        unite_achat: string | null;
        coeff_conversion: string | null;
        prix_public: string | null;
        conditionnement: string | null;
        ref_fournisseur: string | null;
        fournisseur: string | null;
        quantity: string | null;
        perte: string | null;
        pu: string | null;
        ouvrage_qty: string | null;
      }> = await em.query(
        `SELECT dl.id AS line_id, r.id AS resource_id,
                COALESCE(r.code, dl.code) AS code, COALESCE(r.label, dl.designation) AS label,
                COALESCE(dl.unit, r.unit) AS unite_emploi,
                COALESCE(dl.unite_achat, r.unite_achat) AS unite_achat,
                COALESCE(dl.coeff_conversion, r.coeff_conversion) AS coeff_conversion,
                COALESCE(dl.prix_public, r.prix_public) AS prix_public,
                COALESCE(dl.conditionnement, r.conditionnement) AS conditionnement,
                COALESCE(dl.ref_fournisseur, r.ref_fournisseur) AS ref_fournisseur,
                s.code AS fournisseur,
                dl.quantity, dl.perte, dl.pu, p.quantity AS ouvrage_qty
           FROM devis_line dl
           LEFT JOIN resource r ON r.id = dl.source_resource_id
           LEFT JOIN supplier s ON s.id = COALESCE(dl.supplier_id, r.supplier_id)
           LEFT JOIN devis_line p ON p.id = dl.parent_line_id AND p.type = 'ouvrage'
          WHERE dl.devis_version_id = $1 AND dl.type = 'ressource'`,
        [versionId],
      );

      const agg = new Map<
        string,
        { meta: (typeof rows)[number]; qteEmploi: Decimal }
      >();
      for (const r of rows) {
        const ouvrageQty = new Decimal(r.ouvrage_qty ?? 1);
        const eff = ouvrageQty
          .times(new Decimal(r.quantity ?? 0))
          .times(new Decimal(1).plus(new Decimal(r.perte ?? 0).dividedBy(100)));
        // Agrégation par ressource biblio si rattachée, sinon par code (ou id de ligne) pour le manuel.
        const key = r.resource_id ?? `manual:${r.code ?? r.line_id}`;
        const cur = agg.get(key) ?? { meta: r, qteEmploi: new Decimal(0) };
        cur.qteEmploi = cur.qteEmploi.plus(eff);
        agg.set(key, cur);
      }

      return Array.from(agg.values()).map(({ meta, qteEmploi }) => {
        const appro = computeApproLine({
          qteEmploi: qteEmploi.toString(),
          coeffConversion: meta.coeff_conversion ?? 1,
          prixPublic: meta.prix_public,
          puDebours: meta.pu ?? 0,
        });
        return {
          code: meta.code,
          designation: meta.label,
          uniteEmploi: meta.unite_emploi,
          qteEmploi: qteEmploi.toDecimalPlaces(3).toString(),
          uniteAchat: meta.unite_achat,
          coeffConversion: meta.coeff_conversion,
          conditionnement: meta.conditionnement,
          fournisseur: meta.fournisseur,
          refFournisseur: meta.ref_fournisseur,
          prixPublic: meta.prix_public,
          qteAppro: appro.qteAppro,
          montant: appro.montant,
        };
      });
    });
  }

  async listLines(versionId: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const rows = await em.query(
        `SELECT * FROM devis_line WHERE devis_version_id = $1
          ORDER BY sort_order ASC, created_at ASC`,
        [versionId],
      );
      // Numérotation hiérarchique (source de vérité unique : débours, client, PDF)
      const numbers = computeLineNumbers(rows as NumberingLine[]);
      return rows.map((r: Record<string, unknown>) => ({ ...r, numero: numbers.get(r.id as string) ?? null }));
    });
  }

  /** Upserts a métré variable and recomputes formula-based quantities of the version. */
  setVariable(versionId: string, name: string, value: string | number) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const version = await em.query(`SELECT id FROM devis_version WHERE id = $1`, [
        versionId,
      ]);
      if (version.length === 0) {
        throw new NotFoundException(`Unknown version "${versionId}"`);
      }
      await em.query(
        `INSERT INTO metre_variable (tenant_id, devis_version_id, name, value)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (devis_version_id, name) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [tenantId, versionId, name, String(value)],
      );
      await this.recomputeFormulas(em, versionId);
    });
  }

  private async recomputeFormulas(em: EntityManager, versionId: string): Promise<void> {
    const vars = await this.loadVariables(em, versionId);
    const lines = await em.query(
      `SELECT id, quantity_formula FROM devis_line
        WHERE devis_version_id = $1 AND quantity_formula IS NOT NULL`,
      [versionId],
    );
    for (const line of lines) {
      const computed = this.tryEvaluate(line.quantity_formula, vars);
      if (computed) {
        await em.query(
          `UPDATE devis_line SET quantity = $1, updated_at = now() WHERE id = $2`,
          [computed.toString(), line.id],
        );
      }
    }
  }

  private async loadVariables(
    em: EntityManager,
    versionId: string,
  ): Promise<Record<string, number>> {
    const rows = await em.query(
      `SELECT name, value FROM metre_variable WHERE devis_version_id = $1`,
      [versionId],
    );
    const out: Record<string, number> = {};
    for (const r of rows) {
      out[r.name] = Number(r.value);
    }
    return out;
  }

  /** Evaluates a formula; returns null when a referenced variable is not set yet. */
  private tryEvaluate(formula: string, vars: Record<string, number>) {
    try {
      return evaluateMetre(formula, vars);
    } catch (e) {
      if (e instanceof UnknownVariableError) {
        return null;
      }
      throw new BadRequestException((e as Error).message);
    }
  }
}

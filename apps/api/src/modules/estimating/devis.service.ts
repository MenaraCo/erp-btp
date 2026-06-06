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
import { DevisStatus } from './devis-workflow';
import { VenteService } from './vente.service';
import { flattenOuvrageToResources, RawOuvrage } from './ouvrage-flatten';

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
}

export type DevisLineType = 'titre' | 'sous_titre' | 'ouvrage' | 'ressource';
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
  designation: string;
  unit?: string | null;
  quantity?: string | number | null;
  quantityFormula?: string | null;
  pu?: string | number | null;
  sourceOuvrageId?: string | null;
  sourceResourceId?: string | null;
  sortOrder?: number;
  /** false for titres non vendables / frais de chantier (ventilated by the feuille de vente). */
  vendable?: boolean;
  /** marks a titre/sous-titre as option/variante (propagates to descendants). */
  sectionType?: 'option' | 'variante' | null;
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
      const devis = (
        await em.query(
          `INSERT INTO devis (tenant_id, affaire_id, numero, designation, type, status, sort_order)
           VALUES ($1, $2, $3, $4, 'principal', 'open', 0) RETURNING *`,
          [tenantId, affaire.id, input.code, input.name],
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
          [tenantId, affaireId, input.numero ?? null, input.designation, input.type ?? 'lot', order],
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

  /** Lists all devis (across affaires) with their affaire, for the devis list screen. */
  listDevis() {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, (em) =>
      em.query(
        `SELECT d.id, d.numero, d.designation, d.type, d.status, d.affaire_id,
                a.code AS affaire_code, a.name AS affaire_name
           FROM devis d JOIN affaire a ON a.id = d.affaire_id
          ORDER BY d.created_at DESC`,
      ),
    );
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
      const exists = await em.query(`SELECT id FROM devis WHERE id = $1`, [devisId]);
      if (exists.length === 0) {
        throw new NotFoundException(`Unknown devis "${devisId}"`);
      }
      await em.query(
        `UPDATE devis SET
           designation = COALESCE($2, designation),
           numero = $3,
           type = COALESCE($4, type),
           updated_at = now()
         WHERE id = $1`,
        [devisId, patch.designation ?? null, patch.numero ?? null, patch.type ?? null],
      );
      return (await em.query(`SELECT * FROM devis WHERE id = $1`, [devisId]))[0];
    });
  }

  createVersion(devisId: string, label?: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const devis = await em.query(`SELECT id FROM devis WHERE id = $1`, [devisId]);
      if (devis.length === 0) {
        throw new NotFoundException(`Unknown devis "${devisId}"`);
      }
      const next = (
        await em.query(
          `SELECT COALESCE(MAX(version_no), 0) + 1 AS n FROM devis_version WHERE devis_id = $1`,
          [devisId],
        )
      )[0].n;
      return (
        await em.query(
          `INSERT INTO devis_version (tenant_id, devis_id, version_no, label)
           VALUES ($1, $2, $3, $4) RETURNING *`,
          [tenantId, devisId, next, label ?? `v${next}`],
        )
      )[0];
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

      return (
        await em.query(
          `INSERT INTO devis_line
             (tenant_id, devis_version_id, parent_line_id, type, code, designation, unit,
              quantity, quantity_formula, pu, source_ouvrage_id, source_resource_id, sort_order,
              vendable, section_type)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
          [
            tenantId,
            versionId,
            input.parentLineId ?? null,
            input.type,
            input.code ?? null,
            input.designation,
            input.unit ?? null,
            quantity,
            input.quantityFormula ?? null,
            input.pu != null ? String(input.pu) : null,
            input.sourceOuvrageId ?? null,
            input.sourceResourceId ?? null,
            input.sortOrder ?? 0,
            input.vendable !== false,
            input.sectionType ?? null,
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
      `SELECT oc.parent_ouvrage_id, oc.kind, oc.quantity, oc.rate,
              oc.child_ouvrage_id, oc.child_resource_id,
              r.code, r.label, r.nature, r.unit, r.unit_cost
         FROM ouvrage_component oc
         LEFT JOIN resource r ON r.id = oc.child_resource_id`,
    );
    const map = new Map<string, RawOuvrage>();
    for (const o of ouvrages) {
      map.set(o.id, { id: o.id, components: [] });
    }
    for (const c of components) {
      const parent = map.get(c.parent_ouvrage_id);
      if (!parent) {
        continue;
      }
      parent.components.push({
        kind: c.kind,
        quantity: c.quantity ?? 0,
        rate: c.rate ?? 0,
        childOuvrageId: c.child_ouvrage_id ?? null,
        resourceId: c.child_resource_id ?? null,
        code: c.code ?? null,
        designation: c.label ?? 'Ressource',
        nature: c.nature ?? 'material',
        unit: c.unit ?? null,
        unitCost: c.unit_cost ?? 0,
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
               (tenant_id, devis_version_id, parent_line_id, type, code, designation, unit,
                quantity, pu, perte, nature, source_resource_id, sort_order, vendable)
             VALUES ($1,$2,$3,'ressource',$4,$5,$6,$7,$8,0,$9,$10,$11,true) RETURNING *`,
            [
              tenantId,
              versionId,
              ouvrageLine.id,
              f.code,
              f.designation,
              f.unit,
              f.qtyPerUnit,
              f.unitCost,
              f.nature,
              f.resourceId,
              i,
            ],
          )
        )[0];
        components.push(child);
      }
      return { ouvrage: ouvrageLine, components };
    });
  }

  /** Updates an editable devis line (designation, quantity, unit, pu, perte, nature). */
  updateLine(lineId: string, patch: DevisLinePatch) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const exists = await em.query(`SELECT id FROM devis_line WHERE id = $1`, [lineId]);
      if (exists.length === 0) {
        throw new NotFoundException(`Unknown devis line "${lineId}"`);
      }
      await em.query(
        `UPDATE devis_line SET
           designation = COALESCE($2, designation),
           quantity = COALESCE($3, quantity),
           unit = COALESCE($4, unit),
           pu = COALESCE($5, pu),
           perte = COALESCE($6, perte),
           nature = COALESCE($7, nature),
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
        ],
      );
      return (await em.query(`SELECT * FROM devis_line WHERE id = $1`, [lineId]))[0];
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

  listLines(versionId: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, (em) =>
      em.query(
        `SELECT * FROM devis_line WHERE devis_version_id = $1
          ORDER BY sort_order ASC, created_at ASC`,
        [versionId],
      ),
    );
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

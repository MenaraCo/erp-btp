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

export type DevisLineType = 'titre' | 'sous_titre' | 'ouvrage' | 'ressource';

export interface AffaireInput {
  code: string;
  name: string;
  clientId?: string | null;
  moa?: string | null;
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
}

@Injectable()
export class DevisService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly context: TenantContext,
  ) {}

  /** Creates an affaire with its first version. */
  createAffaire(input: AffaireInput) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const affaire = (
        await em.query(
          `INSERT INTO affaire (tenant_id, code, name, client_id, moa)
           VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [tenantId, input.code, input.name, input.clientId ?? null, input.moa ?? null],
        )
      )[0];
      const version = (
        await em.query(
          `INSERT INTO affaire_version (tenant_id, affaire_id, version_no, label)
           VALUES ($1, $2, 1, 'v1') RETURNING *`,
          [tenantId, affaire.id],
        )
      )[0];
      return { affaire, version };
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

  createVersion(affaireId: string, label?: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const affaire = await em.query(`SELECT id FROM affaire WHERE id = $1`, [affaireId]);
      if (affaire.length === 0) {
        throw new NotFoundException(`Unknown affaire "${affaireId}"`);
      }
      const next = (
        await em.query(
          `SELECT COALESCE(MAX(version_no), 0) + 1 AS n FROM affaire_version WHERE affaire_id = $1`,
          [affaireId],
        )
      )[0].n;
      return (
        await em.query(
          `INSERT INTO affaire_version (tenant_id, affaire_id, version_no, label)
           VALUES ($1, $2, $3, $4) RETURNING *`,
          [tenantId, affaireId, next, label ?? `v${next}`],
        )
      )[0];
    });
  }

  addLine(versionId: string, input: DevisLineInput) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const version = await em.query(`SELECT id FROM affaire_version WHERE id = $1`, [
        versionId,
      ]);
      if (version.length === 0) {
        throw new NotFoundException(`Unknown version "${versionId}"`);
      }
      if (input.parentLineId) {
        const parent = await em.query(
          `SELECT id FROM devis_line WHERE id = $1 AND affaire_version_id = $2`,
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
             (tenant_id, affaire_version_id, parent_line_id, type, code, designation, unit,
              quantity, quantity_formula, pu, source_ouvrage_id, source_resource_id, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
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
          ],
        )
      )[0];
    });
  }

  listLines(versionId: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, (em) =>
      em.query(
        `SELECT * FROM devis_line WHERE affaire_version_id = $1
          ORDER BY sort_order ASC, created_at ASC`,
        [versionId],
      ),
    );
  }

  /** Upserts a métré variable and recomputes formula-based quantities of the version. */
  setVariable(versionId: string, name: string, value: string | number) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const version = await em.query(`SELECT id FROM affaire_version WHERE id = $1`, [
        versionId,
      ]);
      if (version.length === 0) {
        throw new NotFoundException(`Unknown version "${versionId}"`);
      }
      await em.query(
        `INSERT INTO metre_variable (tenant_id, affaire_version_id, name, value)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (affaire_version_id, name) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [tenantId, versionId, name, String(value)],
      );
      await this.recomputeFormulas(em, versionId);
    });
  }

  private async recomputeFormulas(em: EntityManager, versionId: string): Promise<void> {
    const vars = await this.loadVariables(em, versionId);
    const lines = await em.query(
      `SELECT id, quantity_formula FROM devis_line
        WHERE affaire_version_id = $1 AND quantity_formula IS NOT NULL`,
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
      `SELECT name, value FROM metre_variable WHERE affaire_version_id = $1`,
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

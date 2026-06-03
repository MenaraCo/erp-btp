import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { runInTenant } from '../../core/tenancy/tenant-transaction';
import {
  ANALYTICAL_NATURES,
  ANALYTICAL_PLAN_TEMPLATE,
  AnalyticalNature,
  NATURE_LABELS,
} from './analytical-plan.config';

export interface LotInput {
  nature: AnalyticalNature;
  code: string;
  label: string;
}
export interface FamilleInput {
  lotId: string;
  code: string;
  label: string;
}
export interface CodeInput {
  familleId: string;
  code: string;
  label: string;
}

interface LotRow {
  id: string;
  nature: AnalyticalNature;
  code: string;
  label: string;
}
interface FamilleRow {
  id: string;
  lot_id: string;
  code: string;
  label: string;
}
interface CodeRow {
  id: string;
  famille_id: string;
  code: string;
  label: string;
}

/**
 * Plan analytique (cahier des charges §5.8). Manages the tenant's analytical hierarchy
 * nature → lot → famille → code analytique, seeded from the "plan modèle" template then tailored.
 * Read by estimating (to classify resources) and by Gestion financière (to aggregate the axis).
 */
@Injectable()
export class AnalyticalPlanService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly context: TenantContext,
  ) {}

  /** Idempotently duplicates the plan modèle into the tenant's own rows when the plan is empty. */
  async ensurePlan(tenantId = this.context.requireTenantId()): Promise<void> {
    await runInTenant(this.dataSource, tenantId, async (em) => {
      const existing = await em.query(
        `SELECT 1 FROM analytical_lot WHERE tenant_id = $1 LIMIT 1`,
        [tenantId],
      );
      if (existing.length > 0) return;
      for (const lot of ANALYTICAL_PLAN_TEMPLATE) {
        const [lotRow] = await em.query(
          `INSERT INTO analytical_lot (tenant_id, nature, code, label)
             VALUES ($1, $2, $3, $4) RETURNING id`,
          [tenantId, lot.nature, lot.code, lot.label],
        );
        for (const fam of lot.familles) {
          const [famRow] = await em.query(
            `INSERT INTO analytical_famille (tenant_id, lot_id, code, label)
               VALUES ($1, $2, $3, $4) RETURNING id`,
            [tenantId, lotRow.id, fam.code, fam.label],
          );
          for (const code of fam.codes) {
            await em.query(
              `INSERT INTO analytical_code (tenant_id, famille_id, code, label)
                 VALUES ($1, $2, $3, $4)`,
              [tenantId, famRow.id, code.code, code.label],
            );
          }
        }
      }
    });
  }

  /** Full plan as an expandable tree nature → lot → famille → code analytique (cahier §5.8). */
  async getTree(tenantId = this.context.requireTenantId()) {
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const lots: LotRow[] = await em.query(
        `SELECT id, nature, code, label FROM analytical_lot ORDER BY nature, code`,
      );
      const familles: FamilleRow[] = await em.query(
        `SELECT id, lot_id, code, label FROM analytical_famille ORDER BY code`,
      );
      const codes: CodeRow[] = await em.query(
        `SELECT id, famille_id, code, label FROM analytical_code ORDER BY code`,
      );
      const famByLot = new Map<string, FamilleRow[]>();
      for (const f of familles) {
        (famByLot.get(f.lot_id) ?? famByLot.set(f.lot_id, []).get(f.lot_id)!).push(f);
      }
      const codeByFamille = new Map<string, CodeRow[]>();
      for (const c of codes) {
        (codeByFamille.get(c.famille_id) ?? codeByFamille.set(c.famille_id, []).get(c.famille_id)!).push(c);
      }
      return ANALYTICAL_NATURES.map((nature) => ({
        nature,
        label: NATURE_LABELS[nature],
        lots: lots
          .filter((l) => l.nature === nature)
          .map((l) => ({
            id: l.id,
            code: l.code,
            label: l.label,
            familles: (famByLot.get(l.id) ?? []).map((f) => ({
              id: f.id,
              code: f.code,
              label: f.label,
              codes: (codeByFamille.get(f.id) ?? []).map((c) => ({
                id: c.id,
                code: c.code,
                label: c.label,
              })),
            })),
          })),
      }));
    });
  }

  async createLot(input: LotInput) {
    const tenantId = this.context.requireTenantId();
    if (!ANALYTICAL_NATURES.includes(input.nature)) {
      throw new BadRequestException(`Unknown nature "${input.nature}"`);
    }
    if (!input.code?.trim() || !input.label?.trim()) {
      throw new BadRequestException('code and label are required');
    }
    return runInTenant(this.dataSource, tenantId, async (em) => {
      await this.assertCodeFree(em, input.code);
      const [row] = await em.query(
        `INSERT INTO analytical_lot (tenant_id, nature, code, label)
           VALUES ($1, $2, $3, $4) RETURNING id, nature, code, label`,
        [tenantId, input.nature, input.code, input.label],
      );
      return row;
    });
  }

  async createFamille(input: FamilleInput) {
    const tenantId = this.context.requireTenantId();
    if (!input.code?.trim() || !input.label?.trim()) {
      throw new BadRequestException('code and label are required');
    }
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const lot = await em.query(`SELECT id FROM analytical_lot WHERE id = $1`, [input.lotId]);
      if (lot.length === 0) {
        throw new NotFoundException(`Unknown lot "${input.lotId}"`);
      }
      await this.assertCodeFree(em, input.code);
      const [row] = await em.query(
        `INSERT INTO analytical_famille (tenant_id, lot_id, code, label)
           VALUES ($1, $2, $3, $4) RETURNING id, lot_id, code, label`,
        [tenantId, input.lotId, input.code, input.label],
      );
      return row;
    });
  }

  async createCode(input: CodeInput) {
    const tenantId = this.context.requireTenantId();
    if (!input.code?.trim() || !input.label?.trim()) {
      throw new BadRequestException('code and label are required');
    }
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const fam = await em.query(`SELECT id FROM analytical_famille WHERE id = $1`, [input.familleId]);
      if (fam.length === 0) {
        throw new NotFoundException(`Unknown famille "${input.familleId}"`);
      }
      await this.assertCodeFree(em, input.code);
      const [row] = await em.query(
        `INSERT INTO analytical_code (tenant_id, famille_id, code, label)
           VALUES ($1, $2, $3, $4) RETURNING id, famille_id, code, label`,
        [tenantId, input.familleId, input.code, input.label],
      );
      return row;
    });
  }

  /** A code is the société analytical identifier; unique across lots, familles and codes analytiques. */
  private async assertCodeFree(em: EntityManager, code: string): Promise<void> {
    for (const table of ['analytical_lot', 'analytical_famille', 'analytical_code']) {
      const rows = await em.query(`SELECT 1 FROM ${table} WHERE code = $1 LIMIT 1`, [code]);
      if (rows.length > 0) {
        throw new ConflictException(`Analytical code "${code}" already exists`);
      }
    }
  }
}

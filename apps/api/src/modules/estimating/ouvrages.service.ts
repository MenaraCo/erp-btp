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
import { OuvrageEntity } from './entities/ouvrage.entity';
import {
  CalcComponent,
  CalcOuvrage,
  ComponentKind,
  CycleDetectedError,
  computeDebourseMap,
  roundDebourse,
} from './ouvrage-calc';

export interface OuvrageInput {
  code: string;
  label: string;
  unit: string;
  description?: string | null;
  categorie?: string | null;
  lotId?: string | null;
}

export interface ComponentInput {
  kind: ComponentKind;
  childResourceId?: string;
  childOuvrageId?: string;
  quantity?: string | number;
  perte?: string | number;
  rate?: string | number;
  sortOrder?: number;
}

@Injectable()
export class OuvragesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly context: TenantContext,
  ) {}

  createOuvrage(libraryId: string, input: OuvrageInput): Promise<OuvrageEntity> {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const library = await em.query(`SELECT id FROM library WHERE id = $1`, [libraryId]);
      if (library.length === 0) {
        throw new NotFoundException(`Unknown library "${libraryId}"`);
      }
      const rows = await em.query(
        `INSERT INTO ouvrage (tenant_id, library_id, code, label, unit, debourse, description, categorie, lot_id)
         VALUES ($1, $2, $3, $4, $5, 0, $6, $7, $8) RETURNING *`,
        [tenantId, libraryId, input.code, input.label, input.unit,
         input.description ?? null, input.categorie ?? null, input.lotId ?? null],
      );
      return this.mapOuvrage(rows[0]);
    });
  }

  /** Met à jour les infos d'un ouvrage (éditeur dédié). */
  async updateOuvrage(ouvrageId: string, input: Partial<OuvrageInput>): Promise<OuvrageEntity> {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const existing = await em.query(`SELECT id FROM ouvrage WHERE id = $1`, [ouvrageId]);
      if (existing.length === 0) throw new NotFoundException('Ouvrage introuvable.');
      try {
        await em.query(
          `UPDATE ouvrage SET
             code        = COALESCE($2, code),
             label       = COALESCE($3, label),
             unit        = COALESCE($4, unit),
             description = $5,
             categorie   = $6,
             lot_id      = $7,
             updated_at  = now()
           WHERE id = $1`,
          [ouvrageId, input.code ?? null, input.label ?? null, input.unit ?? null,
           input.description ?? null, input.categorie ?? null, input.lotId ?? null],
        );
      } catch (e) {
        const err = e as { code?: string };
        if (err?.code === '23505') {
          throw new BadRequestException(`Le code « ${input.code ?? ''} » existe déjà dans cette bibliothèque.`);
        }
        throw e;
      }
      return (await em.query(`SELECT * FROM ouvrage WHERE id = $1`, [ouvrageId])).map((r: Record<string, unknown>) => this.mapOuvrage(r))[0];
    });
  }

  /** Composants d'un ouvrage, enrichis (détail ressource + montant calculé). */
  async getComponents(ouvrageId: string): Promise<Record<string, unknown>[]> {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, (em) =>
      em.query(
        `SELECT oc.id, oc.kind, oc.quantity, oc.perte, oc.rate, oc.sort_order,
                oc.child_resource_id, oc.child_ouvrage_id,
                COALESCE(r.code, o.code)   AS "childCode",
                COALESCE(r.label, o.label) AS "childLabel",
                COALESCE(r.unit, o.unit)   AS "childUnit",
                COALESCE(r.unit_cost, o.debourse) AS "childUnitCost",
                r.nature AS "childNature"
         FROM ouvrage_component oc
         LEFT JOIN resource r ON r.id = oc.child_resource_id
         LEFT JOIN ouvrage o  ON o.id = oc.child_ouvrage_id
         WHERE oc.parent_ouvrage_id = $1
         ORDER BY oc.sort_order ASC, oc.created_at ASC`,
        [ouvrageId],
      ),
    );
  }

  async updateComponent(ouvrageId: string, componentId: string, input: { quantity?: string | number; perte?: string | number; rate?: string | number }): Promise<OuvrageEntity> {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const ex = await em.query(`SELECT id FROM ouvrage_component WHERE id = $1 AND parent_ouvrage_id = $2`, [componentId, ouvrageId]);
      if (ex.length === 0) throw new NotFoundException('Composant introuvable.');
      const num = (v: unknown) => v == null ? null : String(Number(String(v).replace(',', '.')) || 0);
      await em.query(
        `UPDATE ouvrage_component SET
           quantity = COALESCE($2, quantity),
           perte    = COALESCE($3, perte),
           rate     = COALESCE($4, rate),
           updated_at = now()
         WHERE id = $1`,
        [componentId, num(input.quantity), num(input.perte), num(input.rate)],
      );
      await this.recompute(em);
      return (await em.query(`SELECT * FROM ouvrage WHERE id = $1`, [ouvrageId])).map((r: Record<string, unknown>) => this.mapOuvrage(r))[0];
    });
  }

  async deleteComponent(ouvrageId: string, componentId: string): Promise<OuvrageEntity> {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      await em.query(`DELETE FROM ouvrage_component WHERE id = $1 AND parent_ouvrage_id = $2`, [componentId, ouvrageId]);
      await this.recompute(em);
      return (await em.query(`SELECT * FROM ouvrage WHERE id = $1`, [ouvrageId])).map((r: Record<string, unknown>) => this.mapOuvrage(r))[0];
    });
  }

  getOuvrage(ouvrageId: string): Promise<OuvrageEntity> {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const rows = await em.query(`SELECT * FROM ouvrage WHERE id = $1`, [ouvrageId]);
      if (rows.length === 0) {
        throw new NotFoundException(`Unknown ouvrage "${ouvrageId}"`);
      }
      return this.mapOuvrage(rows[0]);
    });
  }

  listOuvrages(
    libraryId: string,
    query: DataGridQuery,
  ): Promise<PaginatedResult<OuvrageEntity>> {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, (em) => {
      const qb = em
        .getRepository(OuvrageEntity)
        .createQueryBuilder('p')
        .where('p.library_id = :libraryId', { libraryId });
      return paginate(qb, query, {
        alias: 'p',
        sortable: ['code', 'label', 'debourse', 'createdAt'],
        searchable: ['code', 'label'],
        defaultSort: 'code',
      });
    });
  }

  /** Adds a component then recomputes; a resulting cycle rolls everything back (400). */
  addComponent(ouvrageId: string, input: ComponentInput): Promise<OuvrageEntity> {
    const tenantId = this.context.requireTenantId();
    this.validateComponent(ouvrageId, input);
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const ouvrage = await em.query(`SELECT id FROM ouvrage WHERE id = $1`, [ouvrageId]);
      if (ouvrage.length === 0) {
        throw new NotFoundException(`Unknown ouvrage "${ouvrageId}"`);
      }
      await em.query(
        `INSERT INTO ouvrage_component
           (tenant_id, parent_ouvrage_id, kind, child_resource_id, child_ouvrage_id, quantity, perte, rate, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          tenantId,
          ouvrageId,
          input.kind,
          input.childResourceId ?? null,
          input.childOuvrageId ?? null,
          input.quantity != null ? String(input.quantity) : null,
          input.perte != null ? String(input.perte) : 0,
          input.rate != null ? String(input.rate) : null,
          input.sortOrder ?? 0,
        ],
      );
      await this.recompute(em);
      const rows = await em.query(`SELECT * FROM ouvrage WHERE id = $1`, [ouvrageId]);
      return this.mapOuvrage(rows[0]);
    });
  }

  /** Recomputes every ouvrage's déboursé for the current tenant (e.g. after a price change). */
  recomputeTenant(): Promise<void> {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, (em) => this.recompute(em));
  }

  private async recompute(em: EntityManager): Promise<void> {
    const ouvrages = await em.query(`SELECT id FROM ouvrage`);
    const components = await em.query(
      `SELECT oc.parent_ouvrage_id, oc.kind, oc.quantity, oc.perte, oc.rate,
              oc.child_ouvrage_id, r.unit_cost, r.nature
         FROM ouvrage_component oc
         LEFT JOIN resource r ON r.id = oc.child_resource_id`,
    );

    const map = new Map<string, CalcOuvrage>();
    for (const o of ouvrages) {
      map.set(o.id, { id: o.id, components: [] });
    }
    for (const c of components) {
      const parent = map.get(c.parent_ouvrage_id);
      if (!parent) {
        continue;
      }
      const component: CalcComponent = { kind: c.kind };
      // Quantité effective = ratio × (1 + perte%) — la perte gonfle la consommation.
      const effQty = Number(c.quantity ?? 0) * (1 + Number(c.perte ?? 0) / 100);
      if (c.kind === 'resource') {
        component.quantity = effQty;
        component.unitCost = c.unit_cost ?? 0;
        component.nature = c.nature ?? 'material';
      } else if (c.kind === 'sub_ouvrage') {
        component.quantity = effQty;
        component.childOuvrageId = c.child_ouvrage_id;
      } else {
        component.rate = c.rate ?? 0;
      }
      parent.components.push(component);
    }

    let computed: Map<string, ReturnType<typeof roundDebourse>>;
    try {
      computed = computeDebourseMap(map);
    } catch (error) {
      if (error instanceof CycleDetectedError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }

    for (const [id, value] of computed) {
      await em.query(`UPDATE ouvrage SET debourse = $1, updated_at = now() WHERE id = $2`, [
        roundDebourse(value).toString(),
        id,
      ]);
    }
  }

  private validateComponent(ouvrageId: string, input: ComponentInput): void {
    const qty = input.quantity != null ? Number(input.quantity) : NaN;
    switch (input.kind) {
      case 'resource':
        if (!input.childResourceId || !(qty >= 0)) {
          throw new BadRequestException('resource component needs childResourceId and quantity >= 0');
        }
        break;
      case 'sub_ouvrage':
        if (!input.childOuvrageId || !(qty >= 0)) {
          throw new BadRequestException('sub_ouvrage component needs childOuvrageId and quantity >= 0');
        }
        if (input.childOuvrageId === ouvrageId) {
          throw new BadRequestException('an ouvrage cannot contain itself');
        }
        break;
      case 'percentage':
        if (input.rate == null || Number.isNaN(Number(input.rate))) {
          throw new BadRequestException('percentage component needs a rate');
        }
        break;
      default:
        throw new BadRequestException(`invalid component kind "${input.kind}"`);
    }
  }

  private mapOuvrage(row: Record<string, unknown>): OuvrageEntity {
    const o = new OuvrageEntity();
    o.id = row.id as string;
    o.tenantId = row.tenant_id as string;
    o.libraryId = row.library_id as string;
    o.code = row.code as string;
    o.label = row.label as string;
    o.unit = row.unit as string;
    o.debourse = String(row.debourse);
    o.description = (row.description as string) ?? null;
    o.categorie = (row.categorie as string) ?? null;
    o.lotId = (row.lot_id as string) ?? null;
    o.createdAt = row.created_at as Date;
    o.updatedAt = row.updated_at as Date;
    return o;
  }
}

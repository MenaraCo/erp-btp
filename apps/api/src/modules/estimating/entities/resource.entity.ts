import { Column, Entity, Index, Unique } from 'typeorm';
import { BaseTenantEntity } from '../../../core/tenancy/base-tenant.entity';

export type ResourceNature = 'labor' | 'material' | 'equipment' | 'subcontract';

@Entity('resource')
@Unique(['tenantId', 'libraryId', 'code'])
@Index(['libraryId'])
export class ResourceEntity extends BaseTenantEntity {
  @Column({ name: 'library_id', type: 'uuid' })
  libraryId!: string;

  @Column({ type: 'varchar', length: 64 })
  code!: string;

  @Column({ type: 'varchar', length: 255 })
  label!: string;

  @Column({ type: 'varchar', length: 16 })
  unit!: string;

  @Column({ type: 'varchar', length: 16 })
  nature!: ResourceNature;

  /** Déboursé unitaire (direct cost). NUMERIC in DB; string in JS to preserve precision. */
  @Column({ name: 'unit_cost', type: 'numeric', precision: 14, scale: 4, default: 0 })
  unitCost!: string;

  /** Output / rendement (e.g. hours per unit for labour). */
  @Column({ type: 'numeric', precision: 14, scale: 6, nullable: true })
  output?: string | null;
}

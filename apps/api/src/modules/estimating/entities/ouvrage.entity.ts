import { Column, Entity, Index, Unique } from 'typeorm';
import { BaseTenantEntity } from '../../../core/tenancy/base-tenant.entity';

@Entity('ouvrage')
@Unique(['tenantId', 'libraryId', 'code'])
@Index(['libraryId'])
export class OuvrageEntity extends BaseTenantEntity {
  @Column({ name: 'library_id', type: 'uuid' })
  libraryId!: string;

  @Column({ type: 'varchar', length: 64 })
  code!: string;

  @Column({ type: 'varchar', length: 255 })
  label!: string;

  @Column({ type: 'varchar', length: 16 })
  unit!: string;

  /** Cached déboursé sec, recomputed on every change. NUMERIC -> string in JS. */
  @Column({ type: 'numeric', precision: 14, scale: 4, default: 0 })
  debourse!: string;

  @Column({ type: 'text', nullable: true })
  description?: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  categorie?: string | null;

  @Column({ name: 'lot_id', type: 'uuid', nullable: true })
  lotId?: string | null;
}

import { Column, Entity, Index, Unique } from 'typeorm';
import { BaseTenantEntity } from '../../../core/tenancy/base-tenant.entity';

@Entity('library')
@Unique(['tenantId', 'code'])
@Index(['tenantId'])
export class LibraryEntity extends BaseTenantEntity {
  @Column({ type: 'varchar', length: 64 })
  code!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description?: string | null;
}

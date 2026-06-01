import { Column, Entity, Index, Unique } from 'typeorm';
import { BaseTenantEntity } from '../../../core/tenancy/base-tenant.entity';

@Entity('client')
@Unique(['tenantId', 'code'])
@Index(['tenantId'])
export class ClientEntity extends BaseTenantEntity {
  @Column({ type: 'varchar', length: 64 })
  code!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ name: 'vat_number', type: 'varchar', length: 32, nullable: true })
  vatNumber?: string | null;

  @Column({ type: 'varchar', length: 320, nullable: true })
  email?: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  phone?: string | null;

  @Column({ type: 'jsonb', nullable: true })
  address?: Record<string, unknown> | null;
}

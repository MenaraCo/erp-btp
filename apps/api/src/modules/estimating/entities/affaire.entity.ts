import { Column, Entity, Unique } from 'typeorm';
import { BaseTenantEntity } from '../../../core/tenancy/base-tenant.entity';

@Entity('affaire')
@Unique(['tenantId', 'code'])
export class AffaireEntity extends BaseTenantEntity {
  @Column({ type: 'varchar', length: 64 })
  code!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ name: 'client_id', type: 'uuid', nullable: true })
  clientId?: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  moa?: string | null;

  @Column({ type: 'varchar', length: 32, default: 'open' })
  status!: string;
}

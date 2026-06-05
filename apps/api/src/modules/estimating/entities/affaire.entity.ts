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

  @Column({ type: 'varchar', length: 32, default: 'en_cours' })
  status!: string;

  @Column({ name: 'lieu_execution', type: 'jsonb', nullable: true })
  lieuExecution?: Record<string, unknown> | null;

  @Column({ name: 'budget_objectif', type: 'numeric', precision: 14, scale: 2, nullable: true })
  budgetObjectif?: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  responsable?: string | null;

  @Column({ type: 'text', nullable: true })
  notes?: string | null;
}

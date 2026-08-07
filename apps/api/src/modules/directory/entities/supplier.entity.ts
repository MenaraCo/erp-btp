import { Column, Entity, Index, Unique } from 'typeorm';
import { BaseTenantEntity } from '../../../core/tenancy/base-tenant.entity';

@Entity('supplier')
@Unique(['tenantId', 'code'])
@Index(['tenantId'])
export class SupplierEntity extends BaseTenantEntity {
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

  /**
   * `a_valider` = fiche PROPOSÉE depuis le terrain, utilisable immédiatement mais signalée tant
   * qu'un porteur de `directory.validate` ne l'a pas régularisée. `valide` sinon.
   */
  @Column({ type: 'varchar', length: 16, default: 'valide' })
  statut!: 'valide' | 'a_valider';

  @Column({ name: 'proposed_by', type: 'uuid', nullable: true })
  proposedBy?: string | null;

  @Column({ name: 'proposed_at', type: 'timestamptz', nullable: true })
  proposedAt?: Date | null;

  @Column({ name: 'validated_by', type: 'uuid', nullable: true })
  validatedBy?: string | null;

  @Column({ name: 'validated_at', type: 'timestamptz', nullable: true })
  validatedAt?: Date | null;
}

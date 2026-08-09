import { Column, Entity, Unique } from 'typeorm';
import { BaseTenantEntity } from '../tenancy/base-tenant.entity';

/**
 * Le schéma de numérotation d'un type d'objet pour une société : le motif et la prochaine
 * séquence. Un enregistrement par (société, type d'objet).
 */
@Entity('numbering_scheme')
@Unique(['tenantId', 'entityType'])
export class NumberingSchemeEntity extends BaseTenantEntity {
  @Column({ name: 'entity_type', type: 'varchar', length: 32 })
  entityType!: string;

  @Column({ type: 'varchar', length: 64 })
  pattern!: string;

  @Column({ name: 'next_seq', type: 'int', default: 1 })
  nextSeq!: number;
}

import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import type { ComponentKind } from '../ouvrage-calc';

@Entity('ouvrage_component')
@Index(['parentOuvrageId'])
export class OuvrageComponentEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'parent_ouvrage_id', type: 'uuid' })
  parentOuvrageId!: string;

  @Column({ type: 'varchar', length: 16 })
  kind!: ComponentKind;

  @Column({ name: 'child_resource_id', type: 'uuid', nullable: true })
  childResourceId?: string | null;

  @Column({ name: 'child_ouvrage_id', type: 'uuid', nullable: true })
  childOuvrageId?: string | null;

  @Column({ type: 'numeric', precision: 14, scale: 4, nullable: true })
  quantity?: string | null;

  @Column({ type: 'numeric', precision: 9, scale: 6, nullable: true })
  rate?: string | null;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder!: number;
}

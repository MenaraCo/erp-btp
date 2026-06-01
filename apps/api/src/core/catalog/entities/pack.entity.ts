import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../database/base.entity';

@Entity('pack')
export class PackEntity extends BaseEntity {
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  code!: string;

  @Column({ type: 'varchar', length: 255 })
  label!: string;

  @Column({ name: 'discount_pct', type: 'numeric', precision: 5, scale: 2, default: 0 })
  discountPct!: string;

  @Column({ type: 'boolean', default: true })
  active!: boolean;
}

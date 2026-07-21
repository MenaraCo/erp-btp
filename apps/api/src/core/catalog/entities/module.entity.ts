import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../database/base.entity';

@Entity('module')
export class ModuleEntity extends BaseEntity {
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  code!: string;

  @Column({ type: 'varchar', length: 255 })
  label!: string;

  @Column({ name: 'is_addon', type: 'boolean', default: false })
  isAddon!: boolean;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  /**
   * Price €HT per seat and per month — the source of truth, editable from the editor back-office.
   * `null` = "sur devis", `0` = included in the Socle. pg returns numeric as a string.
   */
  @Column({ name: 'price_monthly', type: 'numeric', precision: 10, scale: 2, nullable: true })
  priceMonthly!: string | null;
}

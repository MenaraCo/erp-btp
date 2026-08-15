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

  /** Prix €HT par siège et par mois du palier. La base fait foi (éditable par l'éditeur). */
  @Column({ name: 'price_monthly', type: 'numeric', precision: 10, scale: 2, nullable: true })
  priceMonthly!: string | null;

  /**
   * Jetons ouverts par siège. `null` = par défaut, un jeton par module du palier.
   * Levier commercial de l'éditeur : rendre un palier plus généreux sans toucher au code.
   */
  @Column({ name: 'seat_tokens', type: 'int', nullable: true })
  seatTokens!: number | null;

  /** Rang du palier : 1 = entrée de gamme. Sert à l'éligibilité des add-ons. */
  @Column({ name: 'tier_level', type: 'int', default: 1 })
  tierLevel!: number;
}

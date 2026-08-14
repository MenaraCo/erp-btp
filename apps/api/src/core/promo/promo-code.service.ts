import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { returningRows } from '../database/returning.util';

export type DiscountType = 'percent' | 'fixed';
/** Portée : `monthly` (sans engagement), `annual` (engagement 12 mois), `both` (les deux). */
export type PromoAppliesTo = 'monthly' | 'annual' | 'both';

export interface PromoCode {
  id: string;
  code: string;
  label: string | null;
  discountType: DiscountType;
  discountValue: number;
  appliesTo: PromoAppliesTo;
  active: boolean;
  validFrom: Date | null;
  validUntil: Date | null;
  maxRedemptions: number | null;
  redemptions: number;
  /** Computed: usable right now (active, in window, under the redemption cap). */
  usable: boolean;
}

export interface PromoCodeInput {
  code?: string;
  label?: string | null;
  discountType?: DiscountType;
  discountValue?: number;
  appliesTo?: PromoAppliesTo;
  active?: boolean;
  validFrom?: string | null;
  validUntil?: string | null;
  maxRedemptions?: number | null;
}

interface PromoRow {
  id: string;
  code: string;
  label: string | null;
  discount_type: DiscountType;
  discount_value: string;
  applies_to: PromoAppliesTo;
  active: boolean;
  valid_from: Date | null;
  valid_until: Date | null;
  max_redemptions: number | null;
  redemptions: number;
}

/**
 * Promo codes (cahier §3.7 B). Editor-owned, global catalogue data — the table carries no
 * tenant_id and no RLS, so everything here runs on the plain data source.
 *
 * A code is *usable* when it is active, inside its validity window and under its redemption cap.
 * `applyDiscount` is the single place that turns a code into a price reduction, so MRR, quotes and
 * (later) billing all agree.
 */
@Injectable()
export class PromoCodeService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** Reduces an amount by a code's discount. Never returns a negative amount. */
  static applyDiscount(amount: number, code: Pick<PromoCode, 'discountType' | 'discountValue'> | null): number {
    if (!code || amount <= 0) return Math.max(0, amount);
    const reduced =
      code.discountType === 'percent'
        ? amount * (1 - code.discountValue / 100)
        : amount - code.discountValue;
    return Math.max(0, Math.round(reduced * 100) / 100);
  }

  async list(): Promise<PromoCode[]> {
    const rows: PromoRow[] = await this.dataSource.query(
      `SELECT * FROM promo_code ORDER BY created_at DESC`,
    );
    return rows.map((r) => this.toPromo(r));
  }

  async findByCode(code: string): Promise<PromoCode | null> {
    const rows: PromoRow[] = await this.dataSource.query(
      `SELECT * FROM promo_code WHERE upper(code) = upper($1)`,
      [(code ?? '').trim()],
    );
    return rows.length ? this.toPromo(rows[0]) : null;
  }

  async findById(id: string): Promise<PromoCode | null> {
    const rows: PromoRow[] = await this.dataSource.query(
      `SELECT * FROM promo_code WHERE id = $1`,
      [id],
    );
    return rows.length ? this.toPromo(rows[0]) : null;
  }

  /** Resolves a code and refuses it when unusable — the single validation entry point. */
  async requireUsable(code: string): Promise<PromoCode> {
    const promo = await this.findByCode(code);
    if (!promo) {
      throw new NotFoundException(`Code promo « ${code} » introuvable`);
    }
    if (!promo.usable) {
      throw new BadRequestException(
        `Code promo « ${promo.code} » inutilisable (inactif, hors période, ou quota atteint)`,
      );
    }
    return promo;
  }

  async create(input: PromoCodeInput): Promise<PromoCode> {
    const code = (input.code ?? '').trim().toUpperCase();
    if (!/^[A-Z0-9._-]{3,32}$/.test(code)) {
      throw new BadRequestException(
        'Code invalide (3 à 32 caractères : lettres, chiffres, . _ -)',
      );
    }
    const discountType = input.discountType === 'fixed' ? 'fixed' : 'percent';
    const discountValue = this.checkValue(discountType, input.discountValue);
    const appliesTo = this.checkAppliesTo(input.appliesTo);
    const { validFrom, validUntil } = this.checkWindow(input.validFrom, input.validUntil);
    const maxRedemptions = this.checkMax(input.maxRedemptions);

    const existing = await this.findByCode(code);
    if (existing) {
      throw new BadRequestException(`Le code « ${code} » existe déjà`);
    }

    const rows: PromoRow[] = await this.dataSource.query(
      `INSERT INTO promo_code
         (code, label, discount_type, discount_value, applies_to, active, valid_from, valid_until, max_redemptions)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        code,
        input.label?.trim() || null,
        discountType,
        discountValue,
        appliesTo,
        input.active ?? true,
        validFrom,
        validUntil,
        maxRedemptions,
      ],
    );
    return this.toPromo(rows[0]);
  }

  async update(id: string, input: PromoCodeInput): Promise<PromoCode> {
    const current = await this.findById(id);
    if (!current) {
      throw new NotFoundException('Code promo introuvable');
    }
    const discountType = input.discountType ?? current.discountType;
    const discountValue =
      input.discountValue === undefined
        ? current.discountValue
        : this.checkValue(discountType, input.discountValue);
    if (input.discountType !== undefined) {
      this.checkValue(discountType, discountValue);
    }
    const { validFrom, validUntil } = this.checkWindow(
      input.validFrom === undefined ? current.validFrom?.toISOString() ?? null : input.validFrom,
      input.validUntil === undefined ? current.validUntil?.toISOString() ?? null : input.validUntil,
    );
    const maxRedemptions =
      input.maxRedemptions === undefined
        ? current.maxRedemptions
        : this.checkMax(input.maxRedemptions);
    const appliesTo =
      input.appliesTo === undefined ? current.appliesTo : this.checkAppliesTo(input.appliesTo);

    const rows = returningRows<PromoRow>(
      await this.dataSource.query(
        `UPDATE promo_code
          SET label = $2, discount_type = $3, discount_value = $4, applies_to = $5, active = $6,
              valid_from = $7, valid_until = $8, max_redemptions = $9, updated_at = now()
        WHERE id = $1
        RETURNING *`,
        [
          id,
          input.label === undefined ? current.label : input.label?.trim() || null,
          discountType,
          discountValue,
          appliesTo,
          input.active ?? current.active,
          validFrom,
          validUntil,
          maxRedemptions,
        ],
      ),
    );
    return this.toPromo(rows[0]);
  }

  /**
   * Deletes a code. Subscriptions referencing it keep working: the FK is ON DELETE SET NULL, so
   * they simply lose the discount. Returns false when the code does not exist.
   */
  async remove(id: string): Promise<boolean> {
    const res = returningRows<{ id: string }>(
      await this.dataSource.query(
        `DELETE FROM promo_code WHERE id = $1 RETURNING id`,
        [id],
      ),
    );
    return res.length > 0;
  }

  /** Increments the redemption counter (called when a code is applied to a subscription). */
  async countRedemption(id: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE promo_code SET redemptions = redemptions + 1, updated_at = now() WHERE id = $1`,
      [id],
    );
  }

  private checkAppliesTo(value: PromoAppliesTo | undefined): PromoAppliesTo {
    if (value === undefined || value === null) return 'both';
    if (value !== 'monthly' && value !== 'annual' && value !== 'both') {
      throw new BadRequestException('La portée doit être « monthly », « annual » ou « both »');
    }
    return value;
  }

  private checkValue(type: DiscountType, value: number | undefined): number {
    const v = Number(value);
    if (!Number.isFinite(v) || v < 0) {
      throw new BadRequestException('Valeur de remise invalide');
    }
    if (type === 'percent' && v > 100) {
      throw new BadRequestException('Une remise en pourcentage ne peut pas dépasser 100');
    }
    return Math.round(v * 100) / 100;
  }

  private checkWindow(
    from?: string | null,
    until?: string | null,
  ): { validFrom: string | null; validUntil: string | null } {
    const parse = (v: string | null | undefined, label: string): string | null => {
      if (v === null || v === undefined || v === '') return null;
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) {
        throw new BadRequestException(`Date ${label} invalide`);
      }
      return d.toISOString();
    };
    const validFrom = parse(from, 'de début');
    const validUntil = parse(until, 'de fin');
    if (validFrom && validUntil && new Date(validFrom) > new Date(validUntil)) {
      throw new BadRequestException('La date de début doit précéder la date de fin');
    }
    return { validFrom, validUntil };
  }

  private checkMax(max: number | null | undefined): number | null {
    if (max === null || max === undefined || (max as unknown as string) === '') return null;
    const n = Math.trunc(Number(max));
    if (!Number.isFinite(n) || n < 1) {
      throw new BadRequestException('Le quota d’utilisations doit être un entier ≥ 1');
    }
    return n;
  }

  private toPromo(r: PromoRow): PromoCode {
    const now = Date.now();
    const startOk = !r.valid_from || new Date(r.valid_from).getTime() <= now;
    const endOk = !r.valid_until || new Date(r.valid_until).getTime() >= now;
    const quotaOk = r.max_redemptions === null || r.redemptions < r.max_redemptions;
    return {
      id: r.id,
      code: r.code,
      label: r.label,
      discountType: r.discount_type,
      discountValue: Number(r.discount_value),
      appliesTo: r.applies_to ?? 'both',
      active: r.active,
      validFrom: r.valid_from,
      validUntil: r.valid_until,
      maxRedemptions: r.max_redemptions,
      redemptions: r.redemptions,
      usable: r.active && startOk && endOk && quotaOk,
    };
  }
}

import { Module } from '@nestjs/common';
import { PromoCodeService } from './promo-code.service';

/** Promo codes (cahier §3.7 B) — editor-owned global catalogue data. */
@Module({
  providers: [PromoCodeService],
  exports: [PromoCodeService],
})
export class PromoModule {}

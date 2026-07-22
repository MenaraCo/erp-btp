import { Module } from '@nestjs/common';
import { PricingService } from './pricing.service';

/** Moteur de tarification : formules d'engagement, remises et réglages globaux de l'éditeur. */
@Module({
  providers: [PricingService],
  exports: [PricingService],
})
export class PricingModule {}

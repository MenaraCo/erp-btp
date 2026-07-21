import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { CatalogModule } from '../catalog/catalog.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { EntitlementsService } from './entitlements.service';
import { QuotaService } from './quota.service';
import { CapabilityGuard } from './capability.guard';
import { SeatController } from './seat.controller';

/**
 * Entitlements core: the capability guard (registered globally), seat (jeton) management
 * and quota checks. Imported once by AppModule so every gated endpoint is enforced.
 */
@Module({
  imports: [CatalogModule, TenancyModule],
  controllers: [SeatController],
  providers: [
    EntitlementsService,
    QuotaService,
    { provide: APP_GUARD, useClass: CapabilityGuard },
  ],
  exports: [EntitlementsService, QuotaService],
})
export class EntitlementsModule {}

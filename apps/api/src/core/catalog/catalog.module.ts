import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CatalogService } from './catalog.service';
import { CatalogController } from './catalog.controller';
import { PublicCatalogController } from './public-catalog.controller';
import { PricingModule } from '../pricing/pricing.module';
import { PromoModule } from '../promo/promo.module';
import { ModuleEntity } from './entities/module.entity';
import { CapabilityEntity } from './entities/capability.entity';
import { ModuleCapabilityEntity } from './entities/module-capability.entity';
import { PackEntity } from './entities/pack.entity';
import { PackModuleEntity } from './entities/pack-module.entity';
import { QuotaDefinitionEntity } from './entities/quota-definition.entity';

/** Global commercial catalogue (modules, capabilities, packs, quotas) — read access. */
@Module({
  imports: [
    PricingModule,
    PromoModule,
    TypeOrmModule.forFeature([
      ModuleEntity,
      CapabilityEntity,
      ModuleCapabilityEntity,
      PackEntity,
      PackModuleEntity,
      QuotaDefinitionEntity,
    ]),
  ],
  controllers: [CatalogController, PublicCatalogController],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}

import { Module } from '@nestjs/common';
import { TenancyModule } from '../../core/tenancy/tenancy.module';
import { EstimatingModule } from '../estimating/estimating.module';
import { ChantierService } from './chantier.service';
import { ChantierController } from './chantier.controller';

/** Suivi de chantiers — 3.1 transfert affaire gagnée → chantier (étude d'exécution + budget). */
@Module({
  imports: [TenancyModule, EstimatingModule],
  providers: [ChantierService],
  controllers: [ChantierController],
  exports: [ChantierService],
})
export class SiteTrackingModule {}

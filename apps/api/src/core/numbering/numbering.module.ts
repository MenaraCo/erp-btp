import { Module } from '@nestjs/common';
import { TenancyModule } from '../tenancy/tenancy.module';
import { NumberingController } from './numbering.controller';
import { NumberingService } from './numbering.service';

/**
 * Numérotation automatique, transversale : exportée pour que Directory (client/fournisseur),
 * Estimating (affaire) et Site-tracking (chantier/marché) réservent leurs codes via le même moteur.
 */
@Module({
  imports: [TenancyModule],
  controllers: [NumberingController],
  providers: [NumberingService],
  exports: [NumberingService],
})
export class NumberingModule {}

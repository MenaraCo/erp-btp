import { Module } from '@nestjs/common';
import { TenancyModule } from '../../core/tenancy/tenancy.module';
import { StockService } from './stock.service';
import { StockController } from './stock.controller';

/**
 * Stocks (cahier §6, guide Suivi de chantiers §26.2 et 35-36) : dépôts, articles, mouvements
 * valorisés au prix moyen pondéré. Une sortie vers un chantier devient une dépense réelle,
 * imputée au code analytique de l'article — c'est ce qui referme la boucle avec le contrôle de
 * gestion, plutôt que de laisser le magasin absorber des coûts invisibles.
 */
@Module({
  imports: [TenancyModule],
  providers: [StockService],
  controllers: [StockController],
  exports: [StockService],
})
export class StockModule {}

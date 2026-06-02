import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenancyModule } from '../../core/tenancy/tenancy.module';
import { LibraryEntity } from './entities/library.entity';
import { ResourceEntity } from './entities/resource.entity';
import { OuvrageEntity } from './entities/ouvrage.entity';
import { OuvrageComponentEntity } from './entities/ouvrage-component.entity';
import { AffaireEntity } from './entities/affaire.entity';
import { LibrariesService } from './libraries.service';
import { LibrariesController } from './libraries.controller';
import { OuvragesService } from './ouvrages.service';
import { OuvragesController } from './ouvrages.controller';
import { DevisService } from './devis.service';
import { DevisController } from './devis.controller';
import { VenteService } from './vente.service';
import { VenteController } from './vente.controller';
import { EstimatingSearchProvider } from './estimating-search.provider';

/**
 * Estimating (Études de prix) — 1.1 libraries/resources, 1.2 ouvrages + recalc,
 * 1.3 devis + métré, 1.4 feuille de vente.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      LibraryEntity,
      ResourceEntity,
      OuvrageEntity,
      OuvrageComponentEntity,
      AffaireEntity,
    ]),
    TenancyModule,
  ],
  providers: [
    LibrariesService,
    OuvragesService,
    DevisService,
    VenteService,
    EstimatingSearchProvider,
  ],
  controllers: [
    LibrariesController,
    OuvragesController,
    DevisController,
    VenteController,
  ],
  exports: [LibrariesService, OuvragesService, DevisService, VenteService, EstimatingSearchProvider],
})
export class EstimatingModule {}

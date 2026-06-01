import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenancyModule } from '../../core/tenancy/tenancy.module';
import { LibraryEntity } from './entities/library.entity';
import { ResourceEntity } from './entities/resource.entity';
import { OuvrageEntity } from './entities/ouvrage.entity';
import { OuvrageComponentEntity } from './entities/ouvrage-component.entity';
import { LibrariesService } from './libraries.service';
import { LibrariesController } from './libraries.controller';
import { OuvragesService } from './ouvrages.service';
import { OuvragesController } from './ouvrages.controller';
import { EstimatingSearchProvider } from './estimating-search.provider';

/** Estimating (Études de prix) — 1.1 libraries & resources, 1.2 composed ouvrages + recalc. */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      LibraryEntity,
      ResourceEntity,
      OuvrageEntity,
      OuvrageComponentEntity,
    ]),
    TenancyModule,
  ],
  providers: [LibrariesService, OuvragesService, EstimatingSearchProvider],
  controllers: [LibrariesController, OuvragesController],
  exports: [LibrariesService, OuvragesService, EstimatingSearchProvider],
})
export class EstimatingModule {}

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenancyModule } from '../../core/tenancy/tenancy.module';
import { LibraryEntity } from './entities/library.entity';
import { ResourceEntity } from './entities/resource.entity';
import { LibrariesService } from './libraries.service';
import { LibrariesController } from './libraries.controller';
import { EstimatingSearchProvider } from './estimating-search.provider';

/** Estimating (Études de prix) — increment 1.1: libraries & resources. */
@Module({
  imports: [TypeOrmModule.forFeature([LibraryEntity, ResourceEntity]), TenancyModule],
  providers: [LibrariesService, EstimatingSearchProvider],
  controllers: [LibrariesController],
  exports: [LibrariesService, EstimatingSearchProvider],
})
export class EstimatingModule {}

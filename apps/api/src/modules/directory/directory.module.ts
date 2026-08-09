import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenancyModule } from '../../core/tenancy/tenancy.module';
import { NumberingModule } from '../../core/numbering/numbering.module';
import { ClientEntity } from './entities/client.entity';
import { SupplierEntity } from './entities/supplier.entity';
import { DirectoryService } from './directory.service';
import { DirectoryController } from './directory.controller';
import { DirectorySearchProvider } from './directory-search.provider';

/** Base directory (clients/suppliers): CRUD with the reusable data-grid + search provider. */
@Module({
  imports: [TypeOrmModule.forFeature([ClientEntity, SupplierEntity]), TenancyModule, NumberingModule],
  providers: [DirectoryService, DirectorySearchProvider],
  controllers: [DirectoryController],
  exports: [DirectoryService, DirectorySearchProvider],
})
export class DirectoryModule {}

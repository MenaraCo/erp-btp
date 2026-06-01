import { Module } from '@nestjs/common';
import { DirectoryModule } from '../../../modules/directory/directory.module';
import { DirectorySearchProvider } from '../../../modules/directory/directory-search.provider';
import { EstimatingModule } from '../../../modules/estimating/estimating.module';
import { EstimatingSearchProvider } from '../../../modules/estimating/estimating-search.provider';
import { UniversalSearchService } from './universal-search.service';
import { SearchController } from './search.controller';
import { SEARCH_PROVIDERS } from './search-provider';

/**
 * Universal search. Assembles the registered SearchProviders; new searchable modules add their
 * provider to the SEARCH_PROVIDERS factory here (or via their own registration later).
 */
@Module({
  imports: [DirectoryModule, EstimatingModule],
  providers: [
    UniversalSearchService,
    {
      provide: SEARCH_PROVIDERS,
      useFactory: (
        directory: DirectorySearchProvider,
        estimating: EstimatingSearchProvider,
      ) => [directory, estimating],
      inject: [DirectorySearchProvider, EstimatingSearchProvider],
    },
  ],
  controllers: [SearchController],
  exports: [UniversalSearchService],
})
export class SearchModule {}

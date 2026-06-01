import { Module } from '@nestjs/common';
import { DirectoryModule } from '../../../modules/directory/directory.module';
import { DirectorySearchProvider } from '../../../modules/directory/directory-search.provider';
import { UniversalSearchService } from './universal-search.service';
import { SearchController } from './search.controller';
import { SEARCH_PROVIDERS } from './search-provider';

/**
 * Universal search. Assembles the registered SearchProviders; new searchable modules add their
 * provider to the SEARCH_PROVIDERS factory here (or via their own registration later).
 */
@Module({
  imports: [DirectoryModule],
  providers: [
    UniversalSearchService,
    {
      provide: SEARCH_PROVIDERS,
      useFactory: (directory: DirectorySearchProvider) => [directory],
      inject: [DirectorySearchProvider],
    },
  ],
  controllers: [SearchController],
  exports: [UniversalSearchService],
})
export class SearchModule {}

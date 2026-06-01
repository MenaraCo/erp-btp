import { Controller, Get, Query } from '@nestjs/common';
import { RequiresCapability } from '../../entitlements/requires-capability.decorator';
import { RequiresPermission } from '../../rbac/requires-permission.decorator';
import { UniversalSearchService } from './universal-search.service';

@Controller('search')
export class SearchController {
  constructor(private readonly search: UniversalSearchService) {}

  @Get()
  @RequiresCapability('directory')
  @RequiresPermission('directory.read')
  query(@Query('q') q?: string) {
    return this.search.search(q ?? '');
  }
}

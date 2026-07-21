import { Controller, Get, Query } from '@nestjs/common';
import { CompanyLookupService } from './company-lookup.service';

/**
 * Public company search for auto-filling legal info (raison sociale, SIRET, adresse, TVA) from the
 * French registry. Search by SIREN, SIRET or company name. No auth / no tenant: it proxies public
 * government data and carries no tenant/user data. Excluded from the tenant middleware in AppModule;
 * no capability/permission decorator, so the global guards let it through.
 */
@Controller('public/company-search')
export class PublicCompanyLookupController {
  constructor(private readonly lookup: CompanyLookupService) {}

  @Get()
  search(@Query('q') q?: string) {
    return this.lookup.search(q ?? '');
  }
}

import { Module } from '@nestjs/common';
import { CompanyLookupService } from './company-lookup.service';
import { PublicCompanyLookupController } from './public-company-lookup.controller';

/** Public French company registry lookup (raison sociale / SIREN / SIRET → legal info). */
@Module({
  controllers: [PublicCompanyLookupController],
  providers: [CompanyLookupService],
  exports: [CompanyLookupService],
})
export class CompanyLookupModule {}

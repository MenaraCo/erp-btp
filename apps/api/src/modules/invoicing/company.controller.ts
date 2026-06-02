import { BadRequestException, Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { RequiresCapability } from '../../core/entitlements/requires-capability.decorator';
import { RequiresPermission } from '../../core/rbac/requires-permission.decorator';
import { CompanyInput, CompanyService } from './company.service';

@Controller('companies')
export class CompanyController {
  constructor(private readonly companies: CompanyService) {}

  @Post()
  @RequiresCapability('invoicing.situations')
  @RequiresPermission('invoicing.write')
  create(@Body() body: CompanyInput) {
    if (!body?.code || !body?.name) {
      throw new BadRequestException('code and name are required');
    }
    return this.companies.createCompany(body);
  }

  @Get()
  @RequiresCapability('invoicing.situations')
  @RequiresPermission('invoicing.read')
  list() {
    return this.companies.listCompanies();
  }

  @Put(':companyId/chrono')
  @RequiresCapability('invoicing.situations')
  @RequiresPermission('invoicing.write')
  setChrono(@Param('companyId') companyId: string, @Body() body: { pattern?: string }) {
    if (!body?.pattern) {
      throw new BadRequestException('pattern is required');
    }
    return this.companies.setChrono(companyId, body.pattern);
  }

  @Get(':companyId/chrono')
  @RequiresCapability('invoicing.situations')
  @RequiresPermission('invoicing.read')
  getChrono(@Param('companyId') companyId: string) {
    return this.companies.getChrono(companyId);
  }
}

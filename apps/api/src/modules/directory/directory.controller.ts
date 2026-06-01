import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
} from '@nestjs/common';
import { RequiresCapability } from '../../core/entitlements/requires-capability.decorator';
import { RequiresPermission } from '../../core/rbac/requires-permission.decorator';
import { DataGridQuery } from '../../core/common/data-grid/data-grid';
import { DirectoryService, PartyInput } from './directory.service';

/**
 * Directory endpoints, gated by BOTH axes: the `directory` capability (commercial) and the
 * matching RBAC permission (organisational). Reads need directory.read, writes directory.write.
 */
@Controller()
export class DirectoryController {
  constructor(private readonly directory: DirectoryService) {}

  @Post('clients')
  @RequiresCapability('directory')
  @RequiresPermission('directory.write')
  createClient(@Body() body: PartyInput) {
    this.assertParty(body);
    return this.directory.createClient(body);
  }

  @Get('clients')
  @RequiresCapability('directory')
  @RequiresPermission('directory.read')
  listClients(@Query() query: DataGridQuery) {
    return this.directory.listClients(query);
  }

  @Post('suppliers')
  @RequiresCapability('directory')
  @RequiresPermission('directory.write')
  createSupplier(@Body() body: PartyInput) {
    this.assertParty(body);
    return this.directory.createSupplier(body);
  }

  @Get('suppliers')
  @RequiresCapability('directory')
  @RequiresPermission('directory.read')
  listSuppliers(@Query() query: DataGridQuery) {
    return this.directory.listSuppliers(query);
  }

  private assertParty(body: PartyInput): void {
    if (!body?.code || !body?.name) {
      throw new BadRequestException('code and name are required');
    }
  }
}

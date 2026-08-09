import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
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

  @Patch('clients/:id')
  @RequiresCapability('directory')
  @RequiresPermission('directory.write')
  updateClient(@Param('id') id: string, @Body() body: PartyInput) {
    this.assertParty(body);
    return this.directory.updateClient(id, body);
  }

  @Delete('clients/:id')
  @RequiresCapability('directory')
  @RequiresPermission('directory.write')
  deleteClient(@Param('id') id: string) {
    return this.directory.deleteClient(id);
  }

  @Post('suppliers')
  @RequiresCapability('directory')
  @RequiresPermission('directory.write')
  createSupplier(@Body() body: PartyInput) {
    this.assertParty(body);
    return this.directory.createSupplier(body);
  }

  /**
   * Voie du TERRAIN : le conducteur enregistre un fournisseur découvert en cours de chantier.
   * La fiche entre « à valider » — utilisable tout de suite, régularisée ensuite. Une route à part
   * plutôt qu'un aiguillage dans `POST /suppliers` : deux droits distincts, deux portes distinctes.
   */
  @Post('suppliers/proposer')
  @RequiresCapability('directory')
  @RequiresPermission('directory.propose')
  proposeSupplier(@Body() body: PartyInput) {
    this.assertParty(body);
    return this.directory.createSupplier(body, true);
  }

  /** File d'attente des fiches proposées. Déclarée avant toute route à paramètre. */
  @Get('suppliers/a-valider')
  @RequiresCapability('directory')
  @RequiresPermission('directory.read')
  listSuppliersAValider() {
    return this.directory.listSuppliersAValider();
  }

  @Post('suppliers/:id/valider')
  @RequiresCapability('directory')
  @RequiresPermission('directory.validate')
  validateSupplier(@Param('id') id: string) {
    return this.directory.validateSupplier(id);
  }

  @Get('suppliers')
  @RequiresCapability('directory')
  @RequiresPermission('directory.read')
  listSuppliers(@Query() query: DataGridQuery) {
    return this.directory.listSuppliers(query);
  }

  @Patch('suppliers/:id')
  @RequiresCapability('directory')
  @RequiresPermission('directory.write')
  updateSupplier(@Param('id') id: string, @Body() body: PartyInput) {
    this.assertParty(body);
    return this.directory.updateSupplier(id, body);
  }

  @Delete('suppliers/:id')
  @RequiresCapability('directory')
  @RequiresPermission('directory.write')
  deleteSupplier(@Param('id') id: string) {
    return this.directory.deleteSupplier(id);
  }

  private assertParty(body: PartyInput): void {
    // Le code n'est plus exigé : il est attribué automatiquement par la numérotation société.
    if (!body?.name) {
      throw new BadRequestException('name is required');
    }
  }
}

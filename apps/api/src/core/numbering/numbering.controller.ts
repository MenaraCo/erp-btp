import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { RequiresPermission } from '../rbac/requires-permission.decorator';
import { NumberingService } from './numbering.service';

/**
 * Réglage de la numérotation automatique — espace Configuration.
 * Même garde que les autres référentiels société (permission RBAC, pas de capacité module :
 * c'est de l'administration globale de la société).
 */
@Controller('numbering')
export class NumberingController {
  constructor(private readonly numbering: NumberingService) {}

  @Get()
  @RequiresPermission('estimating.devis.read')
  list() {
    return this.numbering.listSchemes();
  }

  @Patch(':entityType')
  @RequiresPermission('estimating.devis.write')
  update(
    @Param('entityType') entityType: string,
    @Body() body: { pattern?: string; nextSeq?: number },
  ) {
    return this.numbering.updateScheme(entityType, body);
  }
}

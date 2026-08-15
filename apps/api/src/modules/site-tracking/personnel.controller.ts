import { Controller, Get, Query } from '@nestjs/common';
import { RequiresCapability } from '../../core/entitlements/requires-capability.decorator';
import { RequiresPermission } from '../../core/rbac/requires-permission.decorator';
import { PersonnelService } from './personnel.service';

/**
 * Gestion du personnel — vue d'ENTREPRISE, tous chantiers confondus.
 * Un salarié n'appartient pas à un chantier : il se répartit. C'est ici qu'on le voit.
 */
@Controller('personnel')
export class PersonnelController {
  constructor(private readonly personnel: PersonnelService) {}

  @Get('occupation')
  @RequiresCapability('site_tracking.timesheet')
  @RequiresPermission('site_tracking.read')
  occupation(
    @Query('debut') debut: string,
    @Query('fin') fin: string,
    @Query('salarie') employeeId?: string,
    @Query('chantier') chantierId?: string,
    @Query('contrat') contractType?: string,
  ) {
    return this.personnel.occupation({ debut, fin, employeeId, chantierId, contractType });
  }

  /** Les journées à vérifier : double pointage, chevauchement de chantiers, cumul impossible. */
  @Get('conflits')
  @RequiresCapability('site_tracking.timesheet')
  @RequiresPermission('site_tracking.read')
  conflits(@Query('debut') debut: string, @Query('fin') fin: string) {
    return this.personnel.conflits(debut, fin);
  }
}

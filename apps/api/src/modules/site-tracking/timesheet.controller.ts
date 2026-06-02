import { BadRequestException, Body, Controller, Get, Param, Post } from '@nestjs/common';
import { RequiresCapability } from '../../core/entitlements/requires-capability.decorator';
import { RequiresPermission } from '../../core/rbac/requires-permission.decorator';
import { TimesheetInput, TimesheetService } from './timesheet.service';

@Controller('chantiers/:chantierId/timesheets')
export class TimesheetController {
  constructor(private readonly timesheets: TimesheetService) {}

  @Post()
  @RequiresCapability('site_tracking.timesheet')
  @RequiresPermission('site_tracking.write')
  create(@Param('chantierId') chantierId: string, @Body() body: TimesheetInput) {
    if (!body?.employee || !body?.date || body?.hours == null) {
      throw new BadRequestException('employee, date and hours are required');
    }
    return this.timesheets.create(chantierId, body);
  }

  @Get()
  @RequiresCapability('site_tracking.timesheet')
  @RequiresPermission('site_tracking.read')
  list(@Param('chantierId') chantierId: string) {
    return this.timesheets.list(chantierId);
  }

  @Get('summary')
  @RequiresCapability('site_tracking.timesheet')
  @RequiresPermission('site_tracking.read')
  summary(@Param('chantierId') chantierId: string) {
    return this.timesheets.summary(chantierId);
  }
}

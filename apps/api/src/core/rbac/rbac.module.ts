import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { TenancyModule } from '../tenancy/tenancy.module';
import { RbacService } from './rbac.service';
import { PermissionGuard } from './permission.guard';

/**
 * RBAC core: role/permission management and the permission guard (registered globally,
 * orthogonal to the capability guard).
 */
@Module({
  imports: [TenancyModule],
  providers: [
    RbacService,
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
  exports: [RbacService],
})
export class RbacModule {}

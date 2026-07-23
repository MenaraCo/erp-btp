import { Module } from '@nestjs/common';
import { TenancyModule } from '../tenancy/tenancy.module';
import { RbacModule } from '../rbac/rbac.module';
import { AuthModule } from '../auth/auth.module';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';

/**
 * User & role administration console (cahier §3.2). Composes RBAC (roles) and Auth (password
 * bootstrap) to let a tenant referent create colleagues and manage their roles.
 */
@Module({
  imports: [TenancyModule, RbacModule, AuthModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}

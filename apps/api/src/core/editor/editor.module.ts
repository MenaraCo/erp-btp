import { Module } from '@nestjs/common';
import { TenancyModule } from '../tenancy/tenancy.module';
import { CatalogModule } from '../catalog/catalog.module';
import { EditorService } from './editor.service';
import { EditorController } from './editor.controller';
import { PlatformAdminGuard } from './platform-admin.guard';

/**
 * Editor back-office (cahier §3.7 B) — the platform owner's cross-tenant console, strictly
 * separate from the client app and guarded by PlatformAdminGuard.
 */
@Module({
  imports: [TenancyModule, CatalogModule],
  providers: [EditorService, PlatformAdminGuard],
  controllers: [EditorController],
})
export class EditorModule {}

import { Module } from '@nestjs/common';
import { TenancyModule } from '../tenancy/tenancy.module';
import { ActivityService } from './activity.service';
import { ActivityController } from './activity.controller';

/**
 * Journal d'activité — transverse par nature : l'étude de prix y écrit ses créations et ses
 * changements de statut, la facturation ses acceptations de commande. Il vit donc dans le socle
 * plutôt que dans un module métier, pour qu'aucun module n'ait à en importer un autre juste
 * pour laisser une trace.
 */
@Module({
  imports: [TenancyModule],
  providers: [ActivityService],
  controllers: [ActivityController],
  exports: [ActivityService],
})
export class ActivityModule {}

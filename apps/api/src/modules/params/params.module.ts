import { Module } from '@nestjs/common';
import { TenancyModule } from '../../core/tenancy/tenancy.module';
import { ParamsController } from './params.controller';
import { ParamsService } from './params.service';

@Module({
  imports: [TenancyModule],
  controllers: [ParamsController],
  providers: [ParamsService],
  exports: [ParamsService],
})
export class ParamsModule {}

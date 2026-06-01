import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { loadAppConfig } from './config/env.config';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [loadAppConfig],
    }),
    HealthModule,
    // Phase 0.2 will add TenancyModule + TypeOrmModule here.
  ],
})
export class AppModule {}

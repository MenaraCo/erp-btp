import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { loadAppConfig } from './config/env.config';
import { applyGlobalPipes } from './core/common/global-pipes';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  applyGlobalPipes(app);
  // Dev: allow the local web app (and tooling) to call the API cross-origin.
  app.enableCors({
    origin: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-Id', 'X-Tenant-Slug', 'X-User-Id'],
  });
  const { port } = loadAppConfig();
  await app.listen(port);
  Logger.log(`ERP BTP API listening on http://localhost:${port}`, 'Bootstrap');
}

bootstrap();

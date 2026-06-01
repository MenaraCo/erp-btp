import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { loadAppConfig } from './config/env.config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const { port } = loadAppConfig();
  await app.listen(port);
  Logger.log(`ERP BTP API listening on http://localhost:${port}`, 'Bootstrap');
}

bootstrap();

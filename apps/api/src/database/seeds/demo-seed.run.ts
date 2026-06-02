import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { seedDemo } from './demo.seed';

/** CLI entrypoint: `pnpm seed:demo`. Boots a Nest context and seeds the demo dataset. */
async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    await seedDemo(app);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[demo] failed:', err);
  process.exit(1);
});

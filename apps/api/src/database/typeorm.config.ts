import { DataSourceOptions } from 'typeorm';
import { loadAppConfig } from '../config/env.config';

export type DbRole = 'owner' | 'app';

/**
 * Single source of TypeORM connection options, shared by:
 *  - the running app (TypeOrmModule in app.module.ts) — role 'app', subject to RLS;
 *  - the migration CLI data-source (data-source.ts) — role 'owner', runs DDL.
 * Reads env at call time so tests can point it at the embedded database.
 */
export function buildTypeOrmOptions(role: DbRole = 'app'): DataSourceOptions {
  const { database } = loadAppConfig();
  const useOwner = role === 'owner';
  return {
    type: 'postgres',
    host: database.host,
    port: database.port,
    username: useOwner ? database.username : database.appUsername,
    password: useOwner ? database.password : database.appPassword,
    database: database.database,
    entities: [__dirname + '/../**/*.entity.{ts,js}'],
    migrations: [__dirname + '/migrations/*.{ts,js}'],
    synchronize: false,
    logging: false,
  };
}

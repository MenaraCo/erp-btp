import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { buildTypeOrmOptions } from './typeorm.config';

/**
 * Stand-alone DataSource used by the TypeORM CLI (migration:run / generate / revert).
 * The running application builds its own connection via TypeOrmModule (app.module.ts);
 * both share buildTypeOrmOptions() so they never drift apart.
 */
export const AppDataSource = new DataSource(buildTypeOrmOptions('owner'));

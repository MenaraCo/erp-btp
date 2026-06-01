import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { loadAppConfig } from '../config/env.config';

/**
 * Stand-alone DataSource used by the TypeORM CLI (migration:run / generate / revert).
 * The running application builds its own DataSource via TypeOrmModule (added in phase 0.2);
 * both read the same env configuration so they stay in sync.
 */
const { database } = loadAppConfig();

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: database.host,
  port: database.port,
  username: database.username,
  password: database.password,
  database: database.database,
  entities: [__dirname + '/../**/*.entity.{ts,js}'],
  migrations: [__dirname + '/migrations/*.{ts,js}'],
  synchronize: false,
  logging: false,
});

export default AppDataSource;

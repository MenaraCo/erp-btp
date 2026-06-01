import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * RBAC: a global permission catalogue plus tenant-scoped roles and assignments.
 * permission is global (no RLS, seeded from config). role / role_permission / user_role are
 * tenant-scoped (RLS: ENABLE + FORCE + current_tenant policy).
 */
export class CreateRbac1748000000007 implements MigrationInterface {
  name = 'CreateRbac1748000000007';

  private async enableRls(qr: QueryRunner, table: string): Promise<void> {
    await qr.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`);
    await qr.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;`);
    await qr.query(`
      CREATE POLICY ${table}_tenant_isolation ON ${table}
        USING (tenant_id = current_tenant())
        WITH CHECK (tenant_id = current_tenant());
    `);
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Global permission catalogue (seeded from rbac.config.ts).
    await queryRunner.query(`
      CREATE TABLE permission (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        key         varchar(96) NOT NULL UNIQUE,
        label       varchar(255) NOT NULL,
        created_at  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE TABLE role (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        code        varchar(64) NOT NULL,
        label       varchar(255) NOT NULL,
        is_system   boolean NOT NULL DEFAULT false,
        created_at  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz NOT NULL DEFAULT now(),
        UNIQUE (tenant_id, code)
      );
    `);
    await this.enableRls(queryRunner, 'role');

    await queryRunner.query(`
      CREATE TABLE role_permission (
        tenant_id      uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        role_id        uuid NOT NULL REFERENCES role(id) ON DELETE CASCADE,
        permission_id  uuid NOT NULL REFERENCES permission(id) ON DELETE CASCADE,
        PRIMARY KEY (role_id, permission_id)
      );
    `);
    await this.enableRls(queryRunner, 'role_permission');

    await queryRunner.query(`
      CREATE TABLE user_role (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        user_id     uuid NOT NULL REFERENCES user_account(id) ON DELETE CASCADE,
        role_id     uuid NOT NULL REFERENCES role(id) ON DELETE CASCADE,
        assigned_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (tenant_id, user_id, role_id)
      );
    `);
    await this.enableRls(queryRunner, 'user_role');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS user_role;`);
    await queryRunner.query(`DROP TABLE IF EXISTS role_permission;`);
    await queryRunner.query(`DROP TABLE IF EXISTS role;`);
    await queryRunner.query(`DROP TABLE IF EXISTS permission;`);
  }
}

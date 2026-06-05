import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Couche `devis` (M.1b) : une affaire (client + lieu uniques) regroupe plusieurs `devis`
 * (Lot 1, Lot 2, avenant…). La version d'étude (`devis_version`) appartient désormais à un devis,
 * plus à l'affaire. Le workflow d'étude (open→…→won/lost) descend sur le `devis` ; le statut de
 * l'`affaire` devient DÉRIVÉ de ses devis (en_cours / gagnee_partielle / gagnee / perdue).
 *
 * Backfill non destructif : 1 devis « principal » par affaire existante, portant le statut
 * workflow courant ; les versions sont repointées sur ce devis. Réversible.
 */
export class CreateDevisLayer1748000000036 implements MigrationInterface {
  name = 'CreateDevisLayer1748000000036';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Table devis
    await queryRunner.query(`
      CREATE TABLE devis (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        affaire_id  uuid NOT NULL REFERENCES affaire(id) ON DELETE CASCADE,
        numero      varchar(64) NULL,
        designation varchar(255) NOT NULL,
        type        varchar(32) NOT NULL DEFAULT 'principal'
                      CHECK (type IN ('principal', 'lot', 'avenant')),
        status      varchar(32) NOT NULL DEFAULT 'open',
        sort_order  integer NOT NULL DEFAULT 0,
        created_at  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz NOT NULL DEFAULT now()
      );
    `);
    await queryRunner.query(`CREATE INDEX idx_devis_affaire ON devis(affaire_id);`);
    await queryRunner.query(`ALTER TABLE devis ENABLE ROW LEVEL SECURITY;`);
    await queryRunner.query(`ALTER TABLE devis FORCE ROW LEVEL SECURITY;`);
    await queryRunner.query(`
      CREATE POLICY devis_tenant_isolation ON devis
        USING (tenant_id = current_tenant())
        WITH CHECK (tenant_id = current_tenant());
    `);

    // 2. Backfill : 1 devis principal par affaire, portant le statut workflow actuel
    await queryRunner.query(`
      INSERT INTO devis (tenant_id, affaire_id, numero, designation, type, status, sort_order)
        SELECT tenant_id, id, code, name, 'principal', status, 0 FROM affaire;
    `);

    // 3. Repointage devis_version : affaire_id -> devis_id
    await queryRunner.query(`ALTER TABLE devis_version ADD COLUMN devis_id uuid;`);
    await queryRunner.query(`
      UPDATE devis_version dv SET devis_id = d.id
        FROM devis d WHERE d.affaire_id = dv.affaire_id;
    `);
    await queryRunner.query(`ALTER TABLE devis_version ALTER COLUMN devis_id SET NOT NULL;`);
    await queryRunner.query(`
      ALTER TABLE devis_version
        ADD CONSTRAINT devis_version_devis_id_fkey
        FOREIGN KEY (devis_id) REFERENCES devis(id) ON DELETE CASCADE;
    `);
    // DROP COLUMN affaire_id retire au passage son FK et l'unique (affaire_id, version_no)
    await queryRunner.query(`ALTER TABLE devis_version DROP COLUMN affaire_id;`);
    await queryRunner.query(`
      ALTER TABLE devis_version
        ADD CONSTRAINT devis_version_devis_id_version_no_key UNIQUE (devis_id, version_no);
    `);
    await queryRunner.query(`CREATE INDEX idx_devis_version_devis ON devis_version(devis_id);`);

    // 4. affaire.status devient dérivé (en_cours / gagnee_partielle / gagnee / perdue)
    await queryRunner.query(`ALTER TABLE affaire ALTER COLUMN status DROP DEFAULT;`);
    await queryRunner.query(`
      UPDATE affaire SET status = CASE
        WHEN status = 'won' THEN 'gagnee'
        WHEN status = 'lost' THEN 'perdue'
        ELSE 'en_cours' END;
    `);
    await queryRunner.query(`ALTER TABLE affaire ALTER COLUMN status SET DEFAULT 'en_cours';`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 4. revert affaire.status
    await queryRunner.query(`ALTER TABLE affaire ALTER COLUMN status DROP DEFAULT;`);
    await queryRunner.query(`
      UPDATE affaire SET status = CASE
        WHEN status = 'gagnee' THEN 'won'
        WHEN status = 'perdue' THEN 'lost'
        ELSE 'open' END;
    `);
    await queryRunner.query(`ALTER TABLE affaire ALTER COLUMN status SET DEFAULT 'open';`);

    // 3. restore devis_version.affaire_id
    await queryRunner.query(`ALTER TABLE devis_version ADD COLUMN affaire_id uuid;`);
    await queryRunner.query(`
      UPDATE devis_version dv SET affaire_id = d.affaire_id
        FROM devis d WHERE d.id = dv.devis_id;
    `);
    await queryRunner.query(`ALTER TABLE devis_version ALTER COLUMN affaire_id SET NOT NULL;`);
    await queryRunner.query(`
      ALTER TABLE devis_version
        ADD CONSTRAINT affaire_version_affaire_id_fkey
        FOREIGN KEY (affaire_id) REFERENCES affaire(id) ON DELETE CASCADE;
    `);
    await queryRunner.query(
      `ALTER TABLE devis_version DROP CONSTRAINT devis_version_devis_id_version_no_key;`,
    );
    await queryRunner.query(`
      ALTER TABLE devis_version
        ADD CONSTRAINT affaire_version_affaire_id_version_no_key UNIQUE (affaire_id, version_no);
    `);
    await queryRunner.query(`ALTER TABLE devis_version DROP COLUMN devis_id;`);

    // 1. drop devis
    await queryRunner.query(`DROP TABLE IF EXISTS devis;`);
  }
}

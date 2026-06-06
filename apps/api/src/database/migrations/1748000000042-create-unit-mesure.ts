import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Référentiel des unités de mesure paramétrables par société (cahier des charges §5.1).
 *
 * Les unités étaient jusqu'ici un champ texte libre dans les ressources et ouvrages.
 * On crée une table `unit_mesure` tenant-scoped, ordonnée, avec abréviation + désignation.
 * Les valeurs existantes (resource.unit, ouvrage.unit, devis_line.unit) restent
 * valides — la FK est intentionnellement absente (souplesse de saisie libre conservée
 * pour l'import, la FK optionnelle pourra être ajoutée plus tard).
 *
 * Pré-seed des unités courantes BTP.
 */
export class CreateUnitMesure1748000000042 implements MigrationInterface {
  name = 'CreateUnitMesure1748000000042';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE unit_mesure (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        abrev       varchar(16) NOT NULL,
        label       varchar(128) NOT NULL,
        sort_order  integer NOT NULL DEFAULT 0,
        created_at  timestamptz NOT NULL DEFAULT now(),
        UNIQUE (tenant_id, abrev)
      );
    `);

    await queryRunner.query(`CREATE INDEX idx_unit_mesure_tenant ON unit_mesure(tenant_id, sort_order);`);

    await queryRunner.query(`ALTER TABLE unit_mesure ENABLE ROW LEVEL SECURITY;`);
    await queryRunner.query(`ALTER TABLE unit_mesure FORCE ROW LEVEL SECURITY;`);
    await queryRunner.query(`
      CREATE POLICY unit_mesure_tenant_isolation ON unit_mesure
        USING (tenant_id = current_tenant())
        WITH CHECK (tenant_id = current_tenant());
    `);

    /* Pré-seed pour le tenant demo */
    await queryRunner.query(`
      INSERT INTO unit_mesure (tenant_id, abrev, label, sort_order)
      SELECT t.id, u.abrev, u.label, u.sort_order
      FROM tenant t,
        (VALUES
          ('U',    'Unité',           1),
          ('M2',   'Mètre carré',     2),
          ('M3',   'Mètre cube',      3),
          ('ML',   'Mètre linéaire',  4),
          ('H',    'Heure',           5),
          ('J',    'Jour',            6),
          ('MOIS', 'Mois',            7),
          ('KG',   'Kilogramme',      8),
          ('TO',   'Tonne',           9),
          ('L',    'Litre',          10),
          ('S',    'Sac',            11),
          ('BD',   'Bidon',          12),
          ('BTE',  'Boîte',          13),
          ('KIT',  'Kit',            14),
          ('ENS',  'Ensemble',       15),
          ('FT',   'Forfait',        16),
          ('SC',   'Sceau',          17),
          ('SO',   'Sans objet',     18)
        ) AS u(abrev, label, sort_order)
      ON CONFLICT (tenant_id, abrev) DO NOTHING;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS unit_mesure;`);
  }
}

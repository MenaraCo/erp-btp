import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Rattache les ressources et les lignes de devis à un TYPE de déboursé, à la place du champ
 * « nature » à quatre valeurs figées. Une ressource « Location de matériel » suit désormais ses
 * propres coefficients, sans cesser d'alimenter la nature « matériel » en aval.
 *
 * `nature` est CONSERVÉE : elle reste le repli d'une ligne sans type, et la colonne que lisent les
 * budgets de chantier et l'analytique. Rien n'est supprimé — le type vient s'ajouter par-dessus.
 *
 * Reprise des données :
 *  1. chaque ressource et chaque ligne reçoit le type de base correspondant à sa nature ;
 *  2. les anciens « types de sous-traitance », jusqu'ici stockés dans le JSON de la feuille de
 *     vente, deviennent de vrais types rattachés à leur devis, et les lignes qui les portaient
 *     sont repointées dessus. `devis_line.st_type_id` est laissée en place comme filet.
 */
export class ResourceDebourseType1748000000075 implements MigrationInterface {
  name = 'ResourceDebourseType1748000000075';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE resource
        ADD COLUMN debourse_type_id uuid NULL REFERENCES debourse_type(id) ON DELETE SET NULL;
    `);
    await queryRunner.query(`
      ALTER TABLE devis_line
        ADD COLUMN debourse_type_id uuid NULL REFERENCES debourse_type(id) ON DELETE SET NULL;
    `);
    await queryRunner.query(
      `CREATE INDEX idx_resource_debourse_type ON resource(debourse_type_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_devis_line_debourse_type ON devis_line(debourse_type_id);`,
    );

    // 1. Type de base de la nature, société par société.
    await queryRunner.query(`
      UPDATE resource r SET debourse_type_id = t.id
        FROM debourse_type t
       WHERE t.tenant_id = r.tenant_id
         AND t.devis_version_id IS NULL
         AND t.builtin = true
         AND t.base_nature = r.nature
         AND r.debourse_type_id IS NULL;
    `);
    await queryRunner.query(`
      UPDATE devis_line dl SET debourse_type_id = t.id
        FROM debourse_type t
       WHERE t.tenant_id = dl.tenant_id
         AND t.devis_version_id IS NULL
         AND t.builtin = true
         AND t.base_nature = dl.nature
         AND dl.nature IS NOT NULL
         AND dl.debourse_type_id IS NULL;
    `);

    // 2. Anciens types de sous-traitance (JSON de la feuille de vente) → vrais types du devis.
    //    `legacy_st_id` sert le temps du repointage, puis disparaît.
    await queryRunner.query(`ALTER TABLE debourse_type ADD COLUMN legacy_st_id varchar(64) NULL;`);
    await queryRunner.query(`
      INSERT INTO debourse_type
        (tenant_id, devis_version_id, code, label, base_nature, builtin, sort_order, legacy_st_id)
      SELECT s.tenant_id,
             s.devis_version_id,
             COALESCE(NULLIF(t->>'code', ''), 'ST' || a.ord),
             COALESCE(NULLIF(t->>'label', ''), 'Sous-traitance ' || a.ord),
             'subcontract',
             false,
             100 + a.ord,
             t->>'id'
        FROM sale_sheet s
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s.st_types, '[]'::jsonb))
                    WITH ORDINALITY AS a(t, ord)
       WHERE t->>'id' IS NOT NULL
      ON CONFLICT DO NOTHING;
    `);
    await queryRunner.query(`
      UPDATE devis_line dl SET debourse_type_id = t.id
        FROM debourse_type t
       WHERE t.devis_version_id = dl.devis_version_id
         AND t.legacy_st_id = dl.st_type_id
         AND dl.st_type_id IS NOT NULL;
    `);
    await queryRunner.query(`ALTER TABLE debourse_type DROP COLUMN legacy_st_id;`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Non destructif : natures et anciens types de ST sont restés en place, seul le rattachement
    // ajouté par cette migration disparaît.
    await queryRunner.query(`DROP INDEX IF EXISTS idx_devis_line_debourse_type;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_resource_debourse_type;`);
    await queryRunner.query(`ALTER TABLE devis_line DROP COLUMN IF EXISTS debourse_type_id;`);
    await queryRunner.query(`ALTER TABLE resource DROP COLUMN IF EXISTS debourse_type_id;`);
  }
}

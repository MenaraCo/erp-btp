import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Options & variantes (M.3) : une ligne titre/sous-titre peut être marquée `option` ou
 * `variante` ; le marquage se propage à ses descendants. Ces lignes sont valorisées mais
 * EXCLUES du total contractuel (présentées à part). Additif nullable, réversible.
 */
export class DevisLineSectionType1748000000038 implements MigrationInterface {
  name = 'DevisLineSectionType1748000000038';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE devis_line
        ADD COLUMN section_type varchar(16) NULL
          CHECK (section_type IN ('option', 'variante'));
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE devis_line DROP COLUMN IF EXISTS section_type;`);
  }
}

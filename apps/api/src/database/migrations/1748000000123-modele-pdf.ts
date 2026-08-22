import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Le MODÈLE de document PDF, choisi une fois pour toute la société.
 *
 * Un devis, un bon de commande, une facture et une situation partent du même expéditeur : ils
 * doivent se ressembler. Le modèle ne touche pas à ce qui est écrit — montants, mentions légales,
 * ordre des colonnes n'ont rien d'une affaire de goût — il décide de la mise en forme, et les
 * deux couleurs de la société continuent de la teinter.
 */
export class ModelePdf1748000000123 implements MigrationInterface {
  name = 'ModelePdf1748000000123';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE company_preferences
        ADD COLUMN modele_pdf varchar(24) NOT NULL DEFAULT 'classique'
          CHECK (modele_pdf IN ('classique', 'contemporain', 'compact', 'bandeau'));
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE company_preferences DROP COLUMN IF EXISTS modele_pdf;`);
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Enrichissement affaire/devis (M.2) : l'affaire (pivot commercial) porte le lieu d'exécution
 * structuré (jsonb, pour enrichissement IA ultérieur), un budget objectif, un responsable et des
 * notes. Tous nullable — additif, non destructif. Réversible.
 */
export class EnrichAffaireDevis1748000000037 implements MigrationInterface {
  name = 'EnrichAffaireDevis1748000000037';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE affaire
        ADD COLUMN lieu_execution jsonb NULL,
        ADD COLUMN budget_objectif numeric(14,2) NULL,
        ADD COLUMN responsable varchar(255) NULL,
        ADD COLUMN notes text NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE affaire
        DROP COLUMN IF EXISTS notes,
        DROP COLUMN IF EXISTS responsable,
        DROP COLUMN IF EXISTS budget_objectif,
        DROP COLUMN IF EXISTS lieu_execution;
    `);
  }
}

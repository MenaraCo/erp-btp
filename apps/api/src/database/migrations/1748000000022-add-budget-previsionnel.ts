import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Budget prévisionnel (cahier des charges §5.5/§5.8) — increment 3.3. A third budget layer per
 * execution line + nature, initialised from the validated objectif and adjustable during the
 * works. Feeds the financial-management engine's "reste à dépenser" (budget prévisionnel − réalisé).
 */
export class AddBudgetPrevisionnel1748000000022 implements MigrationInterface {
  name = 'AddBudgetPrevisionnel1748000000022';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE execution_line_budget ADD COLUMN montant_previsionnel numeric(16,2) NOT NULL DEFAULT 0;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE execution_line_budget DROP COLUMN IF EXISTS montant_previsionnel;`,
    );
  }
}

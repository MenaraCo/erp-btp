import { MigrationInterface, QueryRunner } from 'typeorm';

export class DevisLineCodeAnalytique1748000000051 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE devis_line ADD COLUMN IF NOT EXISTS code_analytique VARCHAR(64)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE devis_line DROP COLUMN IF EXISTS code_analytique`,
    );
  }
}

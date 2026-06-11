import { MigrationInterface, QueryRunner } from 'typeorm';

export class DevisLineBaseLineId1748000000052 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE devis_line ADD COLUMN IF NOT EXISTS base_line_id UUID REFERENCES devis_line(id) ON DELETE SET NULL`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE devis_line DROP COLUMN IF EXISTS base_line_id`,
    );
  }
}

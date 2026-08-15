import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Nombre de jetons ouverts par siège, paramétrable par palier.
 *
 * Par défaut, un siège ouvre autant de jetons que le palier contient de modules (« Pro » = 3).
 * Cette valeur devient un LEVIER COMMERCIAL de l'éditeur : il peut être plus généreux sur un
 * palier d'entrée pour le rendre attractif, sans toucher au code.
 *
 * `NULL` = comportement par défaut (nombre de modules du palier), ce qui laisse les paliers
 * existants inchangés.
 */
export class PackSeatTokens1748000000089 implements MigrationInterface {
  name = 'PackSeatTokens1748000000089';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE pack
         ADD COLUMN seat_tokens int NULL
         CHECK (seat_tokens IS NULL OR seat_tokens >= 1);`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE pack DROP COLUMN IF EXISTS seat_tokens;`);
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Signature manuscrite du relevé mensuel.
 *
 * Le nom saisi vaut déjà signature — c'est ce qui figure sur un relevé papier. Mais le geste
 * manuscrit reste ce qu'un salarié reconnaît, et ce qu'un contrôle attend sur le document
 * imprimé : on conserve donc l'image tracée au doigt sur tablette, à côté du nom.
 *
 * Stockée en data URL PNG : quelques dizaines de kilo-octets, pas de fichier à gérer à part, et
 * l'image reste attachée au relevé qu'elle signe.
 */
export class ReleveSignature1748000000110 implements MigrationInterface {
  name = 'ReleveSignature1748000000110';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE payroll_releve ADD COLUMN signature_image text NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE payroll_releve DROP COLUMN IF EXISTS signature_image;
    `);
  }
}

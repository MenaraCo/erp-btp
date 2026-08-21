import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Amenée et repli : le transport du matériel sur le chantier.
 *
 * Une pelle ne se téléporte pas. L'amenée et le repli se facturent une fois par mission, souvent
 * quelques centaines d'euros — parfois davantage que deux journées d'utilisation. Les oublier
 * fausse le coût du matériel sur le chantier, et c'est l'oubli le plus courant.
 *
 * Ils appartiennent à l'AFFECTATION (une même machine coûte plus cher à amener loin qu'à côté),
 * avec un montant par défaut sur la fiche pour ne pas les ressaisir à chaque mission. Réservés,
 * ils sont engagés ; relevés, ils deviennent du réalisé — d'où le type porté par le relevé.
 */
export class MaterielTransport1748000000114 implements MigrationInterface {
  name = 'MaterielTransport1748000000114';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE equipment
        ADD COLUMN cout_amenee numeric(14,2) NOT NULL DEFAULT 0,
        ADD COLUMN cout_repli  numeric(14,2) NOT NULL DEFAULT 0;
    `);
    await queryRunner.query(`
      ALTER TABLE equipment_assignment
        ADD COLUMN cout_amenee numeric(14,2) NOT NULL DEFAULT 0,
        ADD COLUMN cout_repli  numeric(14,2) NOT NULL DEFAULT 0;
    `);
    await queryRunner.query(`
      ALTER TABLE equipment_usage
        ADD COLUMN type varchar(16) NOT NULL DEFAULT 'utilisation'
          CHECK (type IN ('utilisation', 'amenee', 'repli'));
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE equipment_usage DROP COLUMN IF EXISTS type;`);
    await queryRunner.query(`
      ALTER TABLE equipment_assignment
        DROP COLUMN IF EXISTS cout_amenee,
        DROP COLUMN IF EXISTS cout_repli;
    `);
    await queryRunner.query(`
      ALTER TABLE equipment
        DROP COLUMN IF EXISTS cout_amenee,
        DROP COLUMN IF EXISTS cout_repli;
    `);
  }
}

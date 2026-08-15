import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Couleur d'un chantier, pour le calendrier et la légende.
 *
 * La couleur était jusqu'ici DÉDUITE de l'identifiant : stable, mais arbitraire et non
 * modifiable — deux chantiers voisins pouvaient se retrouver avec des teintes proches, et le
 * conducteur n'avait aucun moyen de distinguer visuellement « son » chantier. La stocker la rend
 * choisie plutôt que subie.
 *
 * NULL reste accepté : les chantiers existants gardent leur teinte calculée jusqu'à ce qu'on leur
 * en choisisse une.
 */
export class ChantierCouleur1748000000096 implements MigrationInterface {
  name = 'ChantierCouleur1748000000096';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE chantier ADD COLUMN color varchar(7) NULL
         CHECK (color IS NULL OR color ~ '^#[0-9a-fA-F]{6}$');`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE chantier DROP COLUMN IF EXISTS color;`);
  }
}

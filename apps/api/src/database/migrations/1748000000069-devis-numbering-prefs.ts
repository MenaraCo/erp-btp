import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * E.2 — Numérotation automatique des devis, paramétrable par société.
 *
 * Le préfixe et le séparateur existaient déjà (devis_prefix, devis_separator) mais n'étaient
 * utilisés nulle part : les devis se créaient sans numéro. On complète le paramétrage :
 *   - devis_numero_annee  : inclure l'année dans le numéro (DEV-2026-0001 vs DEV-0001)
 *   - devis_numero_digits : longueur de la séquence (0001 = 4)
 *
 * La séquence n'est pas stockée : elle se déduit du plus grand numéro existant du même
 * gabarit, ce qui évite tout compteur qui dériverait en cas de suppression ou d'import.
 */
export class DevisNumberingPrefs1748000000069 implements MigrationInterface {
  name = 'DevisNumberingPrefs1748000000069';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE company_preferences
        ADD COLUMN devis_numero_annee boolean NOT NULL DEFAULT true,
        ADD COLUMN devis_numero_digits smallint NOT NULL DEFAULT 4;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE company_preferences
        DROP COLUMN IF EXISTS devis_numero_digits,
        DROP COLUMN IF EXISTS devis_numero_annee;
    `);
  }
}

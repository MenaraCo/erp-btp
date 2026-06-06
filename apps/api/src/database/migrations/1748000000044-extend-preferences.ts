import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Extension des préférences société (suite retour UX) :
 *  - taux_tva     : jsonb array des taux TVA disponibles (ex. [0,5.5,10,20])
 *  - default_tab  : onglet ouvert par défaut à l'ouverture d'un devis
 *  - nb_decimales : nombre de décimales affichées dans l'UI (2|3|4 ; calculs toujours en 4, PDF en 2)
 *
 * Suppression de resp_nom / resp_telephone / resp_email (déplacés vers la table affaire).
 */
export class ExtendPreferences1748000000044 implements MigrationInterface {
  name = 'ExtendPreferences1748000000044';

  public async up(queryRunner: QueryRunner): Promise<void> {
    /* Nouveaux champs */
    await queryRunner.query(
      `ALTER TABLE company_preferences
         ADD COLUMN IF NOT EXISTS taux_tva    jsonb        NOT NULL DEFAULT '[0, 5.5, 10, 20]',
         ADD COLUMN IF NOT EXISTS default_tab varchar(32)  NOT NULL DEFAULT 'etude',
         ADD COLUMN IF NOT EXISTS nb_decimales smallint    NOT NULL DEFAULT 2
           CONSTRAINT nb_decimales_range CHECK (nb_decimales BETWEEN 2 AND 4);`,
    );

    /* Responsable affaire → table affaire (colonne nullable, remplie au niveau de chaque affaire) */
    await queryRunner.query(
      `ALTER TABLE affaire
         ADD COLUMN IF NOT EXISTS resp_nom       varchar(128) NULL,
         ADD COLUMN IF NOT EXISTS resp_telephone varchar(32)  NULL,
         ADD COLUMN IF NOT EXISTS resp_email     varchar(255) NULL;`,
    );

    /* Suppression des colonnes responsable de company_preferences (déjà inutiles) */
    await queryRunner.query(
      `ALTER TABLE company_preferences
         DROP COLUMN IF EXISTS resp_nom,
         DROP COLUMN IF EXISTS resp_telephone,
         DROP COLUMN IF EXISTS resp_email;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE company_preferences
         ADD COLUMN IF NOT EXISTS resp_nom       varchar(128) NULL,
         ADD COLUMN IF NOT EXISTS resp_telephone varchar(32)  NULL,
         ADD COLUMN IF NOT EXISTS resp_email     varchar(255) NULL;`,
    );
    await queryRunner.query(
      `ALTER TABLE affaire
         DROP COLUMN IF EXISTS resp_nom,
         DROP COLUMN IF EXISTS resp_telephone,
         DROP COLUMN IF EXISTS resp_email;`,
    );
    await queryRunner.query(
      `ALTER TABLE company_preferences
         DROP COLUMN IF EXISTS taux_tva,
         DROP COLUMN IF EXISTS default_tab,
         DROP COLUMN IF EXISTS nb_decimales;`,
    );
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Renommage structurant (M.1a) : `affaire_version` devient `devis_version`. La version d'étude
 * appartiendra à un `devis` (couche insérée en M.1b) ; ce renommage est purement mécanique et
 * ne change aucun comportement. La colonne FK `affaire_version_id` devient `devis_version_id`
 * sur toutes les tables qui la portent (devis_line, metre_variable, sale_sheet,
 * devis_frais_annexe, marche, chantier). Réversible.
 */
export class RenameAffaireVersionToDevisVersion1748000000035 implements MigrationInterface {
  name = 'RenameAffaireVersionToDevisVersion1748000000035';

  private readonly fkTables = [
    'devis_line',
    'metre_variable',
    'sale_sheet',
    'devis_frais_annexe',
    'marche',
    'chantier',
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE affaire_version RENAME TO devis_version;`);
    await queryRunner.query(
      `ALTER POLICY affaire_version_tenant_isolation ON devis_version RENAME TO devis_version_tenant_isolation;`,
    );
    for (const t of this.fkTables) {
      await queryRunner.query(
        `ALTER TABLE ${t} RENAME COLUMN affaire_version_id TO devis_version_id;`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const t of [...this.fkTables].reverse()) {
      await queryRunner.query(
        `ALTER TABLE ${t} RENAME COLUMN devis_version_id TO affaire_version_id;`,
      );
    }
    await queryRunner.query(
      `ALTER POLICY devis_version_tenant_isolation ON devis_version RENAME TO affaire_version_tenant_isolation;`,
    );
    await queryRunner.query(`ALTER TABLE devis_version RENAME TO affaire_version;`);
  }
}

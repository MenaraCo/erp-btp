import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Rattachement d'une facture de location à l'engin qu'elle concerne.
 *
 * Le loueur facture un mois de camion ; l'entreprise, elle, impute des journées aux chantiers. Les
 * deux chiffres n'ont aucune raison d'être égaux — et c'est précisément l'écart qui intéresse :
 * une machine louée quatre semaines et imputée trois est une semaine payée par personne.
 *
 * Sans ce lien, la facture reste une dépense de chantier parmi d'autres et la comparaison est
 * impossible.
 */
export class FactureLocation1748000000113 implements MigrationInterface {
  name = 'FactureLocation1748000000113';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE supplier_invoice
        ADD COLUMN equipment_id uuid NULL REFERENCES equipment(id) ON DELETE SET NULL;
    `);
    await queryRunner.query(
      `CREATE INDEX idx_supplier_invoice_equipment ON supplier_invoice(equipment_id);`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_supplier_invoice_equipment;`);
    await queryRunner.query(`ALTER TABLE supplier_invoice DROP COLUMN IF EXISTS equipment_id;`);
  }
}

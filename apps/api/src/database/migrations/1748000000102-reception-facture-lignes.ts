import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Réception et facturation LIGNE À LIGNE.
 *
 * Une réception globale ne dit rien : on sait qu'« il est arrivé quelque chose », jamais ce qui
 * manque. Le conducteur qui attend ses 8 sacs de colle veut lire « 5 reçus, 3 en attente », pas
 * un bon de livraison sans détail. Même chose pour la facture : c'est en comparant la quantité
 * facturée ET le prix facturé à la commande qu'on repère le sac facturé plus cher que commandé.
 *
 * D'où deux tables de lignes, rattachées à la LIGNE DE COMMANDE — c'est elle qui porte la
 * quantité de référence, l'ouvrage et le code analytique. Le reste à recevoir se déduit ensuite
 * par différence, sans stocker un état qui pourrait dériver.
 */
export class ReceptionFactureLignes1748000000102 implements MigrationInterface {
  name = 'ReceptionFactureLignes1748000000102';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE delivery_note_line (
        id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id        uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        delivery_note_id uuid NOT NULL REFERENCES delivery_note(id) ON DELETE CASCADE,
        order_line_id    uuid NOT NULL REFERENCES purchase_order_line(id) ON DELETE CASCADE,
        quantite_livree  numeric(14,4) NOT NULL DEFAULT 0,
        commentaire      text NULL,
        created_at       timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT bl_ligne_quantite_positive CHECK (quantite_livree >= 0),
        UNIQUE (delivery_note_id, order_line_id)
      );
    `);
    await queryRunner.query(
      `CREATE INDEX idx_bl_ligne_commande ON delivery_note_line(order_line_id);`,
    );

    await queryRunner.query(`
      CREATE TABLE supplier_invoice_line (
        id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id         uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        invoice_id        uuid NOT NULL REFERENCES supplier_invoice(id) ON DELETE CASCADE,
        order_line_id     uuid NULL REFERENCES purchase_order_line(id) ON DELETE SET NULL,
        designation       varchar(255) NOT NULL,
        quantite_facturee numeric(14,4) NOT NULL DEFAULT 0,
        pu_facture        numeric(14,4) NOT NULL DEFAULT 0,
        montant_ht        numeric(16,2) NOT NULL DEFAULT 0,
        created_at        timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT facture_ligne_quantite_positive CHECK (quantite_facturee >= 0)
      );
    `);
    await queryRunner.query(
      `CREATE INDEX idx_facture_ligne_commande ON supplier_invoice_line(order_line_id);`,
    );

    for (const table of ['delivery_note_line', 'supplier_invoice_line']) {
      await queryRunner.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`);
      await queryRunner.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;`);
      await queryRunner.query(`
        CREATE POLICY ${table}_tenant_isolation ON ${table}
          USING (tenant_id = current_tenant())
          WITH CHECK (tenant_id = current_tenant());
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS supplier_invoice_line;`);
    await queryRunner.query(`DROP TABLE IF EXISTS delivery_note_line;`);
  }
}

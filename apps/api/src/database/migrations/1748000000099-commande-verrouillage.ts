import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Verrouillage des commandes envoyées, et journal de leur cycle de vie.
 *
 * Une commande envoyée au fournisseur est un ENGAGEMENT : la modifier après coup, c'est faire
 * mentir l'engagé du chantier et se retrouver avec une commande différente de celle qu'a reçue le
 * fournisseur. Elle se ferme donc à la modification. Une erreur reste possible — d'où la
 * réouverture, réservée à l'administrateur, jamais silencieuse : qui, quand, pourquoi.
 *
 * Le journal enregistre validation, annulation et réouverture. C'est ce qui permet de répondre à
 * « qui a rouvert ce BC et pourquoi », des mois plus tard.
 */
export class CommandeVerrouillage1748000000099 implements MigrationInterface {
  name = 'CommandeVerrouillage1748000000099';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE purchase_order_event (
        id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id      uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        order_id       uuid NOT NULL REFERENCES purchase_order(id) ON DELETE CASCADE,
        action         varchar(32) NOT NULL,
        actor_user_id  uuid NULL REFERENCES user_account(id) ON DELETE SET NULL,
        motif          text NULL,
        detail         jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at     timestamptz NOT NULL DEFAULT now()
      );
    `);
    await queryRunner.query(
      `CREATE INDEX idx_po_event_order ON purchase_order_event(order_id, created_at DESC);`,
    );
    await queryRunner.query(`ALTER TABLE purchase_order_event ENABLE ROW LEVEL SECURITY;`);
    await queryRunner.query(`ALTER TABLE purchase_order_event FORCE ROW LEVEL SECURITY;`);
    await queryRunner.query(`
      CREATE POLICY purchase_order_event_tenant_isolation ON purchase_order_event
        USING (tenant_id = current_tenant())
        WITH CHECK (tenant_id = current_tenant());
    `);

    // Combien de fois cette commande a été rouverte : visible sur la fiche, sans lire le journal.
    await queryRunner.query(
      `ALTER TABLE purchase_order ADD COLUMN reopened_count int NOT NULL DEFAULT 0;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE purchase_order DROP COLUMN IF EXISTS reopened_count;`);
    await queryRunner.query(`DROP TABLE IF EXISTS purchase_order_event;`);
  }
}

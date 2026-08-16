import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Circuit de validation des achats : qui a le droit d'engager l'entreprise, et jusqu'à quel
 * montant.
 *
 * Sans seuil, un conducteur engage 80 000 € d'un clic comme il commanderait des gants. Les règles
 * disent « au-delà de tel montant, telle personne doit approuver ». Elles se posent au niveau de
 * la SOCIÉTÉ (chantier_id NULL) et peuvent être précisées chantier par chantier — un chantier
 * sensible peut exiger davantage sans qu'on refasse tout le paramétrage.
 *
 * Les approbations sont conservées : elles répondent à « qui a approuvé cette commande ? », des
 * mois plus tard, quand la question se pose devant une facture contestée.
 */
export class ValidationAchats1748000000100 implements MigrationInterface {
  name = 'ValidationAchats1748000000100';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE purchase_approval_rule (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        chantier_id   uuid NULL REFERENCES chantier(id) ON DELETE CASCADE,
        montant_min   numeric(16,2) NOT NULL DEFAULT 0,
        validator_id  uuid NOT NULL REFERENCES user_account(id) ON DELETE CASCADE,
        created_at    timestamptz NOT NULL DEFAULT now(),
        updated_at    timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT purchase_rule_seuil_positif CHECK (montant_min >= 0),
        -- Deux fois la même personne au même seuil sur le même périmètre n'apporte rien.
        UNIQUE NULLS NOT DISTINCT (tenant_id, chantier_id, montant_min, validator_id)
      );
    `);
    await queryRunner.query(
      `CREATE INDEX idx_purchase_rule_perimetre ON purchase_approval_rule(chantier_id, montant_min);`,
    );

    await queryRunner.query(`
      CREATE TABLE purchase_approval (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        order_id      uuid NOT NULL REFERENCES purchase_order(id) ON DELETE CASCADE,
        validator_id  uuid NOT NULL REFERENCES user_account(id) ON DELETE CASCADE,
        decision      varchar(16) NOT NULL,
        motif         text NULL,
        created_at    timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT purchase_approval_decision CHECK (decision IN ('approved', 'rejected'))
      );
    `);
    await queryRunner.query(
      `CREATE INDEX idx_purchase_approval_order ON purchase_approval(order_id, created_at DESC);`,
    );

    for (const table of ['purchase_approval_rule', 'purchase_approval']) {
      await queryRunner.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`);
      await queryRunner.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;`);
      await queryRunner.query(`
        CREATE POLICY ${table}_tenant_isolation ON ${table}
          USING (tenant_id = current_tenant())
          WITH CHECK (tenant_id = current_tenant());
      `);
    }

    // Nouvel état : la commande soumise attend son ou ses validateurs avant de partir.
    await queryRunner.query(`ALTER TABLE purchase_order ADD COLUMN submitted_at timestamptz NULL;`);
    await queryRunner.query(
      `ALTER TABLE purchase_order DROP CONSTRAINT IF EXISTS purchase_order_status_check;`,
    );
    await queryRunner.query(`
      ALTER TABLE purchase_order ADD CONSTRAINT purchase_order_status_check
        CHECK (status IN ('draft', 'pending_approval', 'validated', 'cancelled'));
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE purchase_order SET status = 'draft' WHERE status = 'pending_approval';`,
    );
    await queryRunner.query(
      `ALTER TABLE purchase_order DROP CONSTRAINT IF EXISTS purchase_order_status_check;`,
    );
    await queryRunner.query(`
      ALTER TABLE purchase_order ADD CONSTRAINT purchase_order_status_check
        CHECK (status IN ('draft', 'validated', 'cancelled'));
    `);
    await queryRunner.query(`ALTER TABLE purchase_order DROP COLUMN IF EXISTS submitted_at;`);
    await queryRunner.query(`DROP TABLE IF EXISTS purchase_approval;`);
    await queryRunner.query(`DROP TABLE IF EXISTS purchase_approval_rule;`);
  }
}

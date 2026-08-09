import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Listes de valeurs paramétrables par société — pour harmoniser la saisie et éviter les
 * différences de frappe entre utilisateurs.
 *
 * Une seule table générique porte plusieurs listes, distinguées par `list_type` :
 *   - payment_term : conditions de paiement (« 30 j fin de mois », « acompte 30 % »…)
 *   - work_nature  : nature des travaux (« Neuf », « Rénovation », « Réhabilitation »…)
 *   - work_lot     : lots traités (« Peinture », « Sols souples », « Faux-plafonds »…)
 *
 * Ces valeurs alimentent des listes déroulantes (affaire, plus tard d'autres écrans) au lieu de
 * champs libres. Additif et réversible ; quelques valeurs par défaut sont semées pour démarrer.
 */
export class CompanyLists1748000000083 implements MigrationInterface {
  name = 'CompanyLists1748000000083';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE company_list_item (
        id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id  uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        list_type  varchar(32) NOT NULL,
        label      varchar(255) NOT NULL,
        sort_order int NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz NULL
      );
    `);
    await queryRunner.query(
      `CREATE INDEX idx_company_list_item ON company_list_item (tenant_id, list_type, sort_order) WHERE deleted_at IS NULL;`,
    );
    await queryRunner.query(`ALTER TABLE company_list_item ENABLE ROW LEVEL SECURITY;`);
    await queryRunner.query(`ALTER TABLE company_list_item FORCE ROW LEVEL SECURITY;`);
    await queryRunner.query(`
      CREATE POLICY company_list_item_tenant_isolation ON company_list_item
        USING (tenant_id = current_tenant())
        WITH CHECK (tenant_id = current_tenant());
    `);

    // Valeurs par défaut pour toutes les sociétés existantes (propriétaire → RLS contournée).
    await queryRunner.query(`
      INSERT INTO company_list_item (tenant_id, list_type, label, sort_order)
      SELECT t.id, v.list_type, v.label, v.ord
        FROM tenant t
        CROSS JOIN (VALUES
          ('payment_term', 'Comptant', 0),
          ('payment_term', '30 jours fin de mois', 1),
          ('payment_term', '45 jours fin de mois', 2),
          ('payment_term', 'Acompte 30 % puis solde à la livraison', 3),
          ('payment_term', 'Paiement à l''avancement (situations mensuelles)', 4),
          ('work_nature', 'Neuf', 0),
          ('work_nature', 'Rénovation', 1),
          ('work_nature', 'Réhabilitation', 2),
          ('work_nature', 'Extension', 3),
          ('work_nature', 'Entretien / maintenance', 4),
          ('work_lot', 'Gros œuvre', 0),
          ('work_lot', 'Peinture', 1),
          ('work_lot', 'Sols souples', 2),
          ('work_lot', 'Sols durs / carrelage', 3),
          ('work_lot', 'Faux-plafonds', 4),
          ('work_lot', 'Cloisons / doublage', 5),
          ('work_lot', 'Menuiserie', 6),
          ('work_lot', 'Électricité', 7),
          ('work_lot', 'Plomberie / CVC', 8)
        ) AS v(list_type, label, ord);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS company_list_item;`);
  }
}

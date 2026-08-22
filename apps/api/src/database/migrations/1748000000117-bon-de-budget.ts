import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Le BON DE BUDGET : ce qui arrive du devis attend d'être traité.
 *
 * Au transfert d'une affaire gagnée, les frais généraux et les frais annexes du devis entraient
 * d'office au budget, rangés en bloc sous un faux ouvrage « Frais de chantier ». Deux ennuis :
 * personne ne choisissait leur poste analytique, et personne ne pouvait dire qu'un compte prorata
 * est une RECETTE EN MOINS plutôt qu'une dépense en plus. L'application décidait à la place du
 * conducteur, et toujours de la même façon.
 *
 * Désormais ces montants forment un bon de budget « à traiter » (guide Suivi de chantiers §5.10 :
 * un bon se prépare, s'accepte, puis se traite). Tant qu'une ligne n'est pas traitée, elle ne
 * compte NULLE PART — ni en charges, ni en produits, ni dans le résultat. On lui attribue son code
 * analytique et son signe, on l'accepte, on traite : elle rejoint alors le bloc que sa catégorie
 * désigne.
 */
export class BonDeBudget1748000000117 implements MigrationInterface {
  name = 'BonDeBudget1748000000117';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE chantier_budget_document (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        chantier_id   uuid NOT NULL REFERENCES chantier(id) ON DELETE CASCADE,
        marche_id     uuid NULL REFERENCES marche(id) ON DELETE SET NULL,
        numero        varchar(32) NOT NULL,
        date          date NOT NULL DEFAULT CURRENT_DATE,
        libelle       varchar(255) NOT NULL,
        /* D'où vient le bon : repris d'un devis, ou saisi à la main. */
        source        varchar(16) NOT NULL DEFAULT 'saisie'
                        CHECK (source IN ('transfert', 'saisie')),
        statut        varchar(16) NOT NULL DEFAULT 'a_traiter'
                        CHECK (statut IN ('a_traiter', 'traite')),
        created_at    timestamptz NOT NULL DEFAULT now(),
        traite_at     timestamptz NULL,
        actor_user_id uuid NULL,
        UNIQUE (tenant_id, numero)
      );
    `);
    await queryRunner.query(
      `CREATE INDEX idx_budget_document_chantier ON chantier_budget_document(chantier_id, created_at DESC);`,
    );
    await queryRunner.query(`ALTER TABLE chantier_budget_document ENABLE ROW LEVEL SECURITY;`);
    await queryRunner.query(`ALTER TABLE chantier_budget_document FORCE ROW LEVEL SECURITY;`);
    await queryRunner.query(`
      CREATE POLICY chantier_budget_document_tenant_isolation ON chantier_budget_document
        USING (tenant_id = current_tenant())
        WITH CHECK (tenant_id = current_tenant());
    `);

    await queryRunner.query(`
      ALTER TABLE chantier_budget_movement
        ADD COLUMN document_id uuid NULL REFERENCES chantier_budget_document(id) ON DELETE CASCADE,
        ADD COLUMN statut varchar(16) NOT NULL DEFAULT 'traite'
          CHECK (statut IN ('a_traiter', 'traite')),
        /* Une ligne préparée mais non acceptée reste en attente : c'est le geste qui la valide. */
        ADD COLUMN accepte boolean NOT NULL DEFAULT true;
    `);
    // Une ligne en attente n'a pas encore de poste : c'est justement ce qu'on vient y mettre.
    await queryRunner.query(
      `ALTER TABLE chantier_budget_movement ALTER COLUMN code_analytique_id DROP NOT NULL;`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_budget_movement_document ON chantier_budget_movement(document_id);`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM chantier_budget_movement WHERE document_id IS NOT NULL;`);
    await queryRunner.query(`
      ALTER TABLE chantier_budget_movement
        DROP COLUMN IF EXISTS document_id,
        DROP COLUMN IF EXISTS statut,
        DROP COLUMN IF EXISTS accepte;
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS chantier_budget_document;`);
  }
}

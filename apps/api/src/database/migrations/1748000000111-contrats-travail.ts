import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Types de contrat réels, et contrat d'intérim détaillé.
 *
 * « salarié / intérimaire / apprenti » ne dit pas ce dont on a besoin : un CDD et un CDI ne se
 * gèrent pas pareil, un stage a une fin, une alternance aussi. Le type devient donc celui qu'on
 * lit sur le contrat, et TOUT contrat à durée déterminée porte sa date de fin — sans elle, rien
 * ne rappelle qu'une mission s'arrête vendredi.
 *
 * L'intérim, lui, n'est pas de la paye : c'est un ACHAT d'heures à une agence. Son coût réel est
 * le taux facturé (taux horaire × coefficient), auquel s'ajoutent paniers, trajets, IFM et ICCP.
 * Compter l'intérimaire à son taux horaire nu sous-estimerait le chantier de 60 à 100 %.
 */
export class ContratsTravail1748000000111 implements MigrationInterface {
  name = 'ContratsTravail1748000000111';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- Types de contrat ---
    await queryRunner.query(`ALTER TABLE employee DROP CONSTRAINT IF EXISTS employee_contract_type_check;`);
    await queryRunner.query(`
      ALTER TABLE employee ALTER COLUMN contract_type DROP DEFAULT;
    `);
    // Reprise : l'ancien vocabulaire se traduit sans perte.
    await queryRunner.query(`UPDATE employee SET contract_type = 'cdi' WHERE contract_type = 'salarie';`);
    await queryRunner.query(`UPDATE employee SET contract_type = 'apprentissage' WHERE contract_type = 'apprenti';`);
    await queryRunner.query(`
      ALTER TABLE employee
        ALTER COLUMN contract_type SET DEFAULT 'cdi',
        ADD CONSTRAINT employee_contract_type_check CHECK (contract_type IN (
          'cdi', 'cdd', 'alternance', 'stage', 'apprentissage', 'interimaire'
        )),
        ADD COLUMN date_fin_contrat date NULL;
    `);

    // --- Contrat d'intérim ---
    await queryRunner.query(`
      CREATE TABLE interim_contract (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        employee_id   uuid NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
        /* L'agence est un fournisseur : on lui achète des heures, elle nous facture. */
        supplier_id   uuid NULL REFERENCES supplier(id) ON DELETE SET NULL,
        agence        varchar(255) NULL,
        reference     varchar(64) NULL,
        date_debut    date NOT NULL,
        date_fin      date NULL,
        /* Taux horaire du contrat et coefficient de facturation de l'agence. */
        taux_horaire  numeric(14,4) NOT NULL DEFAULT 0,
        coefficient   numeric(8,4) NOT NULL DEFAULT 1,
        /* Coût réel de l'heure pour l'entreprise : taux × coefficient, figé au contrat. */
        taux_facture  numeric(14,4) NOT NULL DEFAULT 0,
        code_analytique_id uuid NULL REFERENCES analytical_code(id) ON DELETE SET NULL,
        commentaire   text NULL,
        created_at    timestamptz NOT NULL DEFAULT now(),
        updated_at    timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT interim_periode_coherente CHECK (date_fin IS NULL OR date_fin >= date_debut),
        CONSTRAINT interim_coefficient_positif CHECK (coefficient > 0)
      );
    `);
    await queryRunner.query(
      `CREATE INDEX idx_interim_contract_employe ON interim_contract(employee_id, date_debut);`,
    );

    await queryRunner.query(`
      CREATE TABLE interim_contract_element (
        id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id    uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        contract_id  uuid NOT NULL REFERENCES interim_contract(id) ON DELETE CASCADE,
        type         varchar(24) NOT NULL
                       CHECK (type IN ('panier', 'trajet', 'transport', 'ifm', 'iccp', 'prime', 'autre')),
        label        varchar(255) NOT NULL,
        montant      numeric(14,4) NOT NULL DEFAULT 0,
        unite        varchar(16) NOT NULL DEFAULT 'jour'
                       CHECK (unite IN ('jour', 'heure', 'forfait', 'pourcentage')),
        code_analytique_id uuid NULL REFERENCES analytical_code(id) ON DELETE SET NULL,
        created_at   timestamptz NOT NULL DEFAULT now()
      );
    `);
    await queryRunner.query(
      `CREATE INDEX idx_interim_element_contrat ON interim_contract_element(contract_id);`,
    );

    for (const table of ['interim_contract', 'interim_contract_element']) {
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
    await queryRunner.query(`DROP TABLE IF EXISTS interim_contract_element;`);
    await queryRunner.query(`DROP TABLE IF EXISTS interim_contract;`);
    await queryRunner.query(`ALTER TABLE employee DROP CONSTRAINT IF EXISTS employee_contract_type_check;`);
    await queryRunner.query(`UPDATE employee SET contract_type = 'salarie' WHERE contract_type IN ('cdi','cdd','alternance','stage');`);
    await queryRunner.query(`UPDATE employee SET contract_type = 'apprenti' WHERE contract_type = 'apprentissage';`);
    await queryRunner.query(`
      ALTER TABLE employee
        ALTER COLUMN contract_type SET DEFAULT 'salarie',
        ADD CONSTRAINT employee_contract_type_check
          CHECK (contract_type IN ('salarie', 'interimaire', 'apprenti')),
        DROP COLUMN IF EXISTS date_fin_contrat;
    `);
  }
}

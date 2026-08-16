import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Éléments variables de paye (rubriques) et relevé mensuel signable.
 *
 * Les heures pointées ne suffisent pas à payer un ouvrier du BTP : s'y ajoutent les paniers, les
 * déplacements, les primes et les majorations d'heures supplémentaires. Ces éléments se
 * RECALCULENT (un jour travaillé = un panier), mais doivent rester CORRIGEABLES à la main — la
 * réalité d'un chantier ne tient pas toujours dans une règle.
 *
 * D'où trois tables : le paramétrage des rubriques (société), les lignes du mois (calculées ou
 * saisies, l'origine est conservée), et le relevé mensuel par salarié — le document qu'on fait
 * signer et qui, une fois signé, fige le mois.
 */
export class PayeRubriques1748000000107 implements MigrationInterface {
  name = 'PayeRubriques1748000000107';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE payroll_rubrique (
        id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id    uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        code         varchar(32) NOT NULL,
        label        varchar(255) NOT NULL,
        /* Le type dicte la règle de calcul automatique ; « autre » reste toujours manuel. */
        type         varchar(24) NOT NULL
                       CHECK (type IN ('panier', 'deplacement', 'prime', 'heures_sup', 'autre')),
        unite        varchar(16) NOT NULL DEFAULT 'jour'
                       CHECK (unite IN ('jour', 'heure', 'forfait')),
        montant_unitaire numeric(14,4) NOT NULL DEFAULT 0,
        /* Heures supplémentaires : tranche hebdomadaire couverte par la rubrique (35 → 43, etc.). */
        seuil_debut  numeric(10,2) NULL,
        seuil_fin    numeric(10,2) NULL,
        /* Majoration appliquée au coût horaire du salarié (0.25 = +25 %). */
        majoration   numeric(6,4) NULL,
        actif        boolean NOT NULL DEFAULT true,
        sort_order   int NOT NULL DEFAULT 0,
        created_at   timestamptz NOT NULL DEFAULT now(),
        updated_at   timestamptz NOT NULL DEFAULT now(),
        UNIQUE (tenant_id, code),
        CONSTRAINT rubrique_tranche_coherente CHECK (
          seuil_debut IS NULL OR seuil_fin IS NULL OR seuil_fin > seuil_debut
        )
      );
    `);

    await queryRunner.query(`
      CREATE TABLE payroll_releve (
        id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id    uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        employee_id  uuid NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
        /* Premier jour du mois : une date se compare et se filtre, « 2026-08 » non. */
        mois         date NOT NULL,
        statut       varchar(16) NOT NULL DEFAULT 'brouillon'
                       CHECK (statut IN ('brouillon', 'valide', 'signe')),
        heures_travaillees numeric(10,2) NOT NULL DEFAULT 0,
        jours_travailles   numeric(10,2) NOT NULL DEFAULT 0,
        heures_absence     numeric(10,2) NOT NULL DEFAULT 0,
        montant_rubriques  numeric(16,2) NOT NULL DEFAULT 0,
        calcule_le   timestamptz NULL,
        valide_le    timestamptz NULL,
        valide_par   uuid NULL REFERENCES user_account(id) ON DELETE SET NULL,
        /* Signature : le nom porté sur le document et l'instant, comme sur un relevé papier. */
        signe_le     timestamptz NULL,
        signe_par    varchar(255) NULL,
        commentaire  text NULL,
        created_at   timestamptz NOT NULL DEFAULT now(),
        updated_at   timestamptz NOT NULL DEFAULT now(),
        UNIQUE (tenant_id, employee_id, mois)
      );
    `);
    await queryRunner.query(
      `CREATE INDEX idx_payroll_releve_mois ON payroll_releve(mois);`,
    );

    await queryRunner.query(`
      CREATE TABLE payroll_line (
        id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id    uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        employee_id  uuid NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
        mois         date NOT NULL,
        rubrique_id  uuid NOT NULL REFERENCES payroll_rubrique(id) ON DELETE RESTRICT,
        /* Rattachement facultatif : un panier se rattache au chantier où la journée s'est faite. */
        chantier_id  uuid NULL REFERENCES chantier(id) ON DELETE SET NULL,
        quantite     numeric(12,2) NOT NULL DEFAULT 0,
        montant_unitaire numeric(14,4) NOT NULL DEFAULT 0,
        montant      numeric(16,2) NOT NULL DEFAULT 0,
        /* « auto » = posée par le calcul, effacée au recalcul ; « manuel » = jamais écrasée. */
        origine      varchar(8) NOT NULL DEFAULT 'auto'
                       CHECK (origine IN ('auto', 'manuel')),
        commentaire  text NULL,
        created_at   timestamptz NOT NULL DEFAULT now(),
        updated_at   timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT payroll_line_quantite_positive CHECK (quantite >= 0)
      );
    `);
    await queryRunner.query(
      `CREATE INDEX idx_payroll_line_mois ON payroll_line(employee_id, mois);`,
    );

    for (const table of ['payroll_rubrique', 'payroll_releve', 'payroll_line']) {
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
    await queryRunner.query(`DROP TABLE IF EXISTS payroll_line;`);
    await queryRunner.query(`DROP TABLE IF EXISTS payroll_releve;`);
    await queryRunner.query(`DROP TABLE IF EXISTS payroll_rubrique;`);
  }
}

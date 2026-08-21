import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Budgets du chantier : enveloppe par code analytique, ripages et budget initial figé.
 *
 * Jusqu'ici le budget d'un chantier n'existait que sous une forme : celle CALCULÉE par l'étude
 * d'exécution (quantités × prix objectif). C'est le budget « d'où l'on part », mais un chantier
 * vit : on ajoute une enveloppe de frais de chantier qu'aucune étude n'a chiffrée, et surtout on
 * RIPE du budget d'une ressource vers une autre quand la réalité diffère de la prévision (moins
 * de béton, plus de coffrage). Sans traçabilité, ces mouvements deviennent invisibles et le
 * « budget initial » se perd — on ne sait plus si l'on tient l'objectif du départ ou une cible
 * repoussée mois après mois.
 *
 * D'où deux tables :
 *  - `chantier_budget_movement` : chaque mouvement de budget SAISI (dotation, reprise, ripage),
 *    daté, signé, horodaté, avec son auteur et son motif. Un ripage = deux lignes de signe opposé
 *    partageant `transfer_group_id` : la somme reste nulle, le budget global ne bouge pas.
 *  - `chantier_budget_initial` : la photo du budget global à l'instant où on le fige. C'est la
 *    référence de comparaison pour la vie du chantier (§17.1 et 18 du suivi de chantiers).
 *
 * Le budget GLOBAL lu par le contrôle de gestion = budget d'étude d'exécution + mouvements.
 */
export class BudgetChantier1748000000115 implements MigrationInterface {
  name = 'BudgetChantier1748000000115';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE chantier_budget_movement (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        chantier_id   uuid NOT NULL REFERENCES chantier(id) ON DELETE CASCADE,
        /* Date de valeur : le mois auquel le mouvement se rattache (gestion mensuelle §5.8). */
        date          date NOT NULL,
        type          varchar(16) NOT NULL DEFAULT 'saisie'
                        CHECK (type IN ('saisie', 'ripage')),
        /* Destination analytique du budget. Le code est obligatoire : un budget qui n'est rattaché
           à rien ne se compare à aucune dépense. La ressource, elle, reste facultative — on ripe
           parfois d'un code à l'autre sans descendre à la ressource. */
        code_analytique_id uuid NOT NULL REFERENCES analytical_code(id) ON DELETE RESTRICT,
        nomenclature_resource_id uuid NULL REFERENCES nomenclature_resource(id) ON DELETE SET NULL,
        nature        varchar(16) NOT NULL
                        CHECK (nature IN ('labor','material','equipment','subcontract','site_overhead')),
        libelle       varchar(255) NOT NULL,
        quantite      numeric(16,3) NOT NULL DEFAULT 0,
        /* Signé : + dotation, − reprise. Les deux jambes d'un ripage s'annulent. */
        montant       numeric(16,2) NOT NULL,
        motif         text NULL,
        transfer_group_id uuid NULL,
        actor_user_id uuid NULL,
        created_at    timestamptz NOT NULL DEFAULT now()
      );
    `);
    await queryRunner.query(
      `CREATE INDEX idx_budget_movement_chantier ON chantier_budget_movement(chantier_id, date DESC);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_budget_movement_code ON chantier_budget_movement(code_analytique_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_budget_movement_transfert ON chantier_budget_movement(transfer_group_id);`,
    );

    await queryRunner.query(`
      CREATE TABLE chantier_budget_initial (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        chantier_id   uuid NOT NULL REFERENCES chantier(id) ON DELETE CASCADE,
        code_analytique_id uuid NULL REFERENCES analytical_code(id) ON DELETE SET NULL,
        nature        varchar(16) NOT NULL
                        CHECK (nature IN ('labor','material','equipment','subcontract','site_overhead')),
        montant       numeric(16,2) NOT NULL DEFAULT 0,
        fixed_at      timestamptz NOT NULL DEFAULT now(),
        actor_user_id uuid NULL
      );
    `);
    await queryRunner.query(
      `CREATE INDEX idx_budget_initial_chantier ON chantier_budget_initial(chantier_id, fixed_at DESC);`,
    );

    for (const table of ['chantier_budget_movement', 'chantier_budget_initial']) {
      await queryRunner.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`);
      await queryRunner.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;`);
      await queryRunner.query(`
        CREATE POLICY ${table}_tenant_isolation ON ${table}
          USING (tenant_id = current_tenant())
          WITH CHECK (tenant_id = current_tenant());
      `);
    }

    /* Avancement CONSTATÉ : un pointage d'avancement se fait toujours « à une date » (le constat
       du 31 juillet), qui n'est pas l'instant de la saisie. Les deux doivent coexister : la date
       de constat sert de repère métier, l'horodatage sert de preuve. */
    await queryRunner.query(
      `ALTER TABLE execution_line_advancement ADD COLUMN constat_date date NULL;`,
    );
    await queryRunner.query(
      `ALTER TABLE chantier_advancement ADD COLUMN constat_date date NULL;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE chantier_advancement DROP COLUMN IF EXISTS constat_date;`);
    await queryRunner.query(
      `ALTER TABLE execution_line_advancement DROP COLUMN IF EXISTS constat_date;`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS chantier_budget_initial;`);
    await queryRunner.query(`DROP TABLE IF EXISTS chantier_budget_movement;`);
  }
}

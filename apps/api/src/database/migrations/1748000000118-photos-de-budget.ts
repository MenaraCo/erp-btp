import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Les PHOTOS DE BUDGET : étude, contre-étude, exécution — et toutes leurs révisions.
 *
 * Un chantier ne se compare pas à une seule référence. Il y a le budget arrêté à la fin de
 * l'étude, celui d'après la contre-étude (ce que la renégociation a fait gagner), celui de
 * l'exécution — et, quand la vie du chantier l'impose, des révisions de chacun. Le « budget
 * initial » unique de la première version écrasait tout cela : refiger effaçait la référence
 * précédente, et l'on perdait la trace de ce qui avait été décidé, quand, par qui.
 *
 * Chaque figeage crée donc une VERSION. La dernière version d'un niveau fait référence ; les
 * précédentes restent consultables et comparables — c'est ce qui permet de dire « on visait ça au
 * départ, on en est là ».
 */
export class PhotosDeBudget1748000000118 implements MigrationInterface {
  name = 'PhotosDeBudget1748000000118';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE chantier_budget_baseline (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        chantier_id   uuid NOT NULL REFERENCES chantier(id) ON DELETE CASCADE,
        /* Le moment du chantier que la photo immortalise. */
        niveau        varchar(16) NOT NULL
                        CHECK (niveau IN ('etude', 'contre_etude', 'execution')),
        /* 1, 2, 3… : une révision ne remplace pas, elle succède. */
        version       int NOT NULL DEFAULT 1,
        commentaire   text NULL,
        /* Totaux mémorisés : la liste des photos se lit sans recalculer chaque ligne. */
        total_charges         numeric(16,2) NOT NULL DEFAULT 0,
        total_frais_generaux  numeric(16,2) NOT NULL DEFAULT 0,
        total_produits        numeric(16,2) NOT NULL DEFAULT 0,
        resultat_net          numeric(16,2) NOT NULL DEFAULT 0,
        fixed_at      timestamptz NOT NULL DEFAULT now(),
        actor_user_id uuid NULL,
        UNIQUE (chantier_id, niveau, version)
      );
    `);
    await queryRunner.query(
      `CREATE INDEX idx_budget_baseline_chantier ON chantier_budget_baseline(chantier_id, fixed_at DESC);`,
    );

    await queryRunner.query(`
      CREATE TABLE chantier_budget_baseline_line (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        baseline_id   uuid NOT NULL REFERENCES chantier_budget_baseline(id) ON DELETE CASCADE,
        code_analytique_id uuid NULL REFERENCES analytical_code(id) ON DELETE SET NULL,
        nature        varchar(16) NOT NULL,
        montant       numeric(16,2) NOT NULL DEFAULT 0
      );
    `);
    await queryRunner.query(
      `CREATE INDEX idx_budget_baseline_line ON chantier_budget_baseline_line(baseline_id);`,
    );

    for (const table of ['chantier_budget_baseline', 'chantier_budget_baseline_line']) {
      await queryRunner.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`);
      await queryRunner.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;`);
      await queryRunner.query(`
        CREATE POLICY ${table}_tenant_isolation ON ${table}
          USING (tenant_id = current_tenant())
          WITH CHECK (tenant_id = current_tenant());
      `);
    }

    /* Les budgets initiaux déjà figés deviennent la première photo de leur chantier : une
       référence existante ne se perd pas au passage d'une version à l'autre. */
    const chantiers: Array<{ chantier_id: string; tenant_id: string; fixed_at: Date }> =
      await queryRunner.query(
        `SELECT chantier_id, MIN(tenant_id::text)::uuid AS tenant_id, MAX(fixed_at) AS fixed_at
           FROM chantier_budget_initial GROUP BY chantier_id`,
      );
    for (const c of chantiers) {
      const [baseline] = await queryRunner.query(
        `INSERT INTO chantier_budget_baseline
           (tenant_id, chantier_id, niveau, version, commentaire, fixed_at)
         VALUES ($1, $2, 'etude', 1, 'Budget initial repris', $3) RETURNING id`,
        [c.tenant_id, c.chantier_id, c.fixed_at],
      );
      await queryRunner.query(
        `INSERT INTO chantier_budget_baseline_line
           (tenant_id, baseline_id, code_analytique_id, nature, montant)
         SELECT tenant_id, $1, code_analytique_id, nature, montant
           FROM chantier_budget_initial WHERE chantier_id = $2`,
        [baseline.id, c.chantier_id],
      );
      await queryRunner.query(
        `UPDATE chantier_budget_baseline b SET
           total_charges = COALESCE((SELECT SUM(l.montant) FROM chantier_budget_baseline_line l
                                      JOIN analytical_code c ON c.id = l.code_analytique_id
                                     WHERE l.baseline_id = b.id AND c.categorie = 'charge'), 0),
           total_frais_generaux = COALESCE((SELECT SUM(l.montant) FROM chantier_budget_baseline_line l
                                       LEFT JOIN analytical_code c ON c.id = l.code_analytique_id
                                      WHERE l.baseline_id = b.id
                                        AND (c.categorie = 'frais_generaux' OR l.nature = 'site_overhead')), 0),
           total_produits = COALESCE((SELECT SUM(l.montant) FROM chantier_budget_baseline_line l
                                  LEFT JOIN analytical_code c ON c.id = l.code_analytique_id
                                 WHERE l.baseline_id = b.id
                                   AND (c.categorie = 'produit' OR l.nature = 'produit')), 0)
         WHERE b.id = $1`,
        [baseline.id],
      );
      await queryRunner.query(
        `UPDATE chantier_budget_baseline
            SET resultat_net = total_produits - total_charges - total_frais_generaux
          WHERE id = $1`,
        [baseline.id],
      );
    }
    await queryRunner.query(`DROP TABLE IF EXISTS chantier_budget_initial;`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS chantier_budget_initial (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        chantier_id   uuid NOT NULL REFERENCES chantier(id) ON DELETE CASCADE,
        code_analytique_id uuid NULL REFERENCES analytical_code(id) ON DELETE SET NULL,
        nature        varchar(16) NOT NULL,
        montant       numeric(16,2) NOT NULL DEFAULT 0,
        fixed_at      timestamptz NOT NULL DEFAULT now(),
        actor_user_id uuid NULL
      );
    `);
    await queryRunner.query(`ALTER TABLE chantier_budget_initial ENABLE ROW LEVEL SECURITY;`);
    await queryRunner.query(`ALTER TABLE chantier_budget_initial FORCE ROW LEVEL SECURITY;`);
    await queryRunner.query(`
      CREATE POLICY chantier_budget_initial_tenant_isolation ON chantier_budget_initial
        USING (tenant_id = current_tenant())
        WITH CHECK (tenant_id = current_tenant());
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS chantier_budget_baseline_line;`);
    await queryRunner.query(`DROP TABLE IF EXISTS chantier_budget_baseline;`);
  }
}

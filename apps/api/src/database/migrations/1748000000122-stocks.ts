import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Les STOCKS : ce que l'entreprise possède déjà, et ce qu'il en coûte au chantier.
 *
 * Sans stock, tout ce qui arrive sur un chantier passe par une commande fournisseur — donc rien
 * de ce qui dort au magasin n'est jamais valorisé, et le chantier qui pioche dedans paraît moins
 * cher qu'il ne l'est. À l'inverse, tout compter à l'achat ferait payer deux fois le même sac de
 * ciment : une fois à l'entrée en stock, une fois à la sortie.
 *
 * D'où le modèle retenu :
 *  - un DÉPÔT principal (le magasin) et, pour les chantiers qui en ont, des dépôts de chantier :
 *    on doit pouvoir dire ce qui dort là-bas plutôt que de le croire consommé ;
 *  - une valorisation au PRIX MOYEN PONDÉRÉ, recalculé à chaque entrée : les sorties partent
 *    toutes au même prix, ce qui évite qu'un même article coûte trois prix différents selon le
 *    lot dont il vient ;
 *  - une SORTIE vers un chantier est une dépense RÉELLE, imputée à son code analytique — c'est
 *    ce qui referme la boucle avec le contrôle de gestion.
 */
export class Stocks1748000000122 implements MigrationInterface {
  name = 'Stocks1748000000122';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE stock_depot (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        code        varchar(64) NOT NULL,
        label       varchar(255) NOT NULL,
        type        varchar(16) NOT NULL DEFAULT 'principal'
                      CHECK (type IN ('principal', 'chantier')),
        /* Renseigné pour un dépôt de chantier : le stock déporté a une adresse. */
        chantier_id uuid NULL REFERENCES chantier(id) ON DELETE CASCADE,
        actif       boolean NOT NULL DEFAULT true,
        created_at  timestamptz NOT NULL DEFAULT now(),
        UNIQUE (tenant_id, code)
      );
    `);

    await queryRunner.query(`
      CREATE TABLE stock_article (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        /* La ressource de la bibliothèque société dont l'article est la contrepartie physique. */
        resource_id   uuid NULL REFERENCES resource(id) ON DELETE SET NULL,
        code          varchar(64) NOT NULL,
        label         varchar(255) NOT NULL,
        unit          varchar(32) NULL,
        code_analytique_id uuid NULL REFERENCES analytical_code(id) ON DELETE SET NULL,
        /* Prix moyen pondéré courant : recalculé à chaque entrée, appliqué à chaque sortie. */
        pmp           numeric(14,4) NOT NULL DEFAULT 0,
        /* En dessous, le magasinier doit être prévenu — un chantier arrêté faute d'un sac coûte
           bien plus cher que le sac. */
        seuil_alerte  numeric(14,3) NULL,
        actif         boolean NOT NULL DEFAULT true,
        created_at    timestamptz NOT NULL DEFAULT now(),
        updated_at    timestamptz NOT NULL DEFAULT now(),
        UNIQUE (tenant_id, code)
      );
    `);

    await queryRunner.query(`
      CREATE TABLE stock_mouvement (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        article_id    uuid NOT NULL REFERENCES stock_article(id) ON DELETE CASCADE,
        depot_id      uuid NOT NULL REFERENCES stock_depot(id) ON DELETE CASCADE,
        /* Dépôt d'arrivée d'un transfert : le mouvement raconte les deux bouts. */
        depot_cible_id uuid NULL REFERENCES stock_depot(id) ON DELETE SET NULL,
        type          varchar(16) NOT NULL
                        CHECK (type IN ('entree', 'sortie', 'transfert', 'inventaire')),
        date          date NOT NULL DEFAULT CURRENT_DATE,
        /* Toujours positive : c'est le TYPE qui dit le sens, jamais le signe. */
        quantite      numeric(16,3) NOT NULL,
        pu            numeric(14,4) NOT NULL DEFAULT 0,
        montant       numeric(16,2) NOT NULL DEFAULT 0,
        /* Une sortie sert un chantier : c'est là que la dépense devient réelle. */
        chantier_id   uuid NULL REFERENCES chantier(id) ON DELETE SET NULL,
        code_analytique_id uuid NULL REFERENCES analytical_code(id) ON DELETE SET NULL,
        execution_line_id uuid NULL REFERENCES execution_line(id) ON DELETE SET NULL,
        purchase_order_id uuid NULL REFERENCES purchase_order(id) ON DELETE SET NULL,
        commentaire   text NULL,
        actor_user_id uuid NULL,
        created_at    timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT mouvement_quantite_positive CHECK (quantite > 0)
      );
    `);
    await queryRunner.query(
      `CREATE INDEX idx_stock_mouvement_article ON stock_mouvement(article_id, date DESC);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_stock_mouvement_depot ON stock_mouvement(depot_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_stock_mouvement_chantier ON stock_mouvement(chantier_id);`,
    );

    for (const table of ['stock_depot', 'stock_article', 'stock_mouvement']) {
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
    await queryRunner.query(`DROP TABLE IF EXISTS stock_mouvement;`);
    await queryRunner.query(`DROP TABLE IF EXISTS stock_article;`);
    await queryRunner.query(`DROP TABLE IF EXISTS stock_depot;`);
  }
}

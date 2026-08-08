import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Portée d'une bibliothèque : étude de prix, ou module chantier.
 *
 * Le chantier avait deux catalogues et il lui en manquait un troisième. Il y avait la
 * bibliothèque d'étude (celle qui sert à chiffrer) et la nomenclature de CHAQUE chantier (la copie
 * reçue à l'acceptation, qui évolue seule). Manquait le catalogue de référence du module chantier
 * lui-même : celui où l'entreprise range les articles et les prix du terrain, indépendamment de
 * tout chantier particulier.
 *
 * Plutôt qu'un catalogue parallèle avec ses propres tables, ses propres écrans et ses propres
 * bogues, on donne une PORTÉE à la bibliothèque existante. Les ressources, la fiche article, les
 * unités, les codes analytiques, l'unicité des codes : tout se réutilise à l'identique.
 *
 * Les bibliothèques existantes sont des bibliothèques d'étude — c'est le défaut, et la reprise
 * est donc silencieuse.
 */
export class LibraryScope1748000000080 implements MigrationInterface {
  name = 'LibraryScope1748000000080';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE library
        ADD COLUMN scope varchar(16) NOT NULL DEFAULT 'etude'
                   CHECK (scope IN ('etude','chantier'));
    `);
    // Chaque module ne liste que ses bibliothèques : l'index porte le filtre le plus fréquent.
    await queryRunner.query(
      `CREATE INDEX idx_library_scope ON library (tenant_id, scope) WHERE deleted_at IS NULL;`,
    );

    /*
     * Le code produit devient unique PAR BIBLIOTHÈQUE, et non plus par société.
     *
     * La contrainte d'origine datait de l'époque où l'entreprise n'avait qu'un catalogue. Avec
     * deux catalogues de référence, le même article figure légitimement dans les deux — c'est
     * même tout l'objet du transfert : « ce ciment, au prix d'étude ici, au prix négocié là ».
     * Une unicité à l'échelle de la société rendait ce modèle impossible.
     *
     * Ce qui compte est préservé : dans un catalogue donné, un code produit désigne exactement un
     * article, et une ressource garde un seul code analytique.
     */
    await queryRunner.query(
      `ALTER TABLE resource DROP CONSTRAINT IF EXISTS resource_tenant_code_produit_key;`,
    );
    await queryRunner.query(
      `ALTER TABLE resource ADD CONSTRAINT resource_library_code_produit_key
         UNIQUE (library_id, code_produit);`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Réversible sans perte : les bibliothèques de chantier redeviennent de simples bibliothèques.
    await queryRunner.query(
      `ALTER TABLE resource DROP CONSTRAINT IF EXISTS resource_library_code_produit_key;`,
    );
    // Rejouable : on retire d'abord la contrainte visée, sinon un `down` lancé sur une base
    // partiellement migrée échoue sur un « already exists » sans rien expliquer.
    await queryRunner.query(
      `ALTER TABLE resource DROP CONSTRAINT IF EXISTS resource_tenant_code_produit_key;`,
    );
    // Le retour à l'unicité par société n'est possible que si aucun code produit n'a été dupliqué
    // entre catalogues entre-temps ; on le tente, et l'échec est alors parlant plutôt que muet.
    await queryRunner.query(
      `ALTER TABLE resource ADD CONSTRAINT resource_tenant_code_produit_key
         UNIQUE (tenant_id, code_produit);`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS idx_library_scope;`);
    await queryRunner.query(`ALTER TABLE library DROP COLUMN IF EXISTS scope;`);
  }
}

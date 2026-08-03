import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Types de déboursé paramétrables (référentiel société).
 *
 * Jusqu'ici les natures de déboursé étaient figées à quatre (MO, matériaux, matériel,
 * sous-traitance) et seule la sous-traitance pouvait être détaillée en « types ». Une entreprise
 * a pourtant besoin de ses propres postes — « ST Moyens » et « ST Compétence », « Location »,
 * « Intérim »… — chacun avec ses propres % FG et % bénéfice.
 *
 * Chaque type se RATTACHE à l'une des quatre natures de base : c'est cette nature qui alimente
 * les budgets de chantier, l'axe analytique et les exports comptables. Le type, lui, porte
 * l'intitulé métier, le code et les taux. On gagne la souplesse sans casser la chaîne de gestion.
 *
 * `devis_version_id` NULL = type de la société, réutilisable par tous les devis ; renseigné = type
 * créé pour un devis seul (« promouvoir » revient à repasser la colonne à NULL).
 *
 * Les quatre types de base sont créés pour chaque société existante, avec les codes usuels du
 * métier (MO, M, MAT, ST) — modifiables ensuite comme les autres.
 */
export class DebourseType1748000000074 implements MigrationInterface {
  name = 'DebourseType1748000000074';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE debourse_type (
        id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id        uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        devis_version_id uuid NULL REFERENCES devis_version(id) ON DELETE CASCADE,
        code             varchar(16) NOT NULL,
        label            varchar(120) NOT NULL,
        base_nature      varchar(16) NOT NULL
                         CHECK (base_nature IN ('labor','material','equipment','subcontract')),
        builtin          boolean NOT NULL DEFAULT false,
        sort_order       integer NOT NULL DEFAULT 0,
        created_at       timestamptz NOT NULL DEFAULT now(),
        updated_at       timestamptz NOT NULL DEFAULT now()
      );
    `);
    // Un code est unique dans son périmètre : la société d'une part, chaque devis d'autre part.
    await queryRunner.query(`
      CREATE UNIQUE INDEX uniq_debourse_type_societe ON debourse_type (tenant_id, code)
        WHERE devis_version_id IS NULL;
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX uniq_debourse_type_devis ON debourse_type (devis_version_id, code)
        WHERE devis_version_id IS NOT NULL;
    `);
    await queryRunner.query(`ALTER TABLE debourse_type ENABLE ROW LEVEL SECURITY;`);
    await queryRunner.query(`ALTER TABLE debourse_type FORCE ROW LEVEL SECURITY;`);
    await queryRunner.query(`
      CREATE POLICY debourse_type_tenant_isolation ON debourse_type
        USING (tenant_id = current_tenant())
        WITH CHECK (tenant_id = current_tenant());
    `);

    // Les quatre types de base, pour chaque société déjà en place.
    await queryRunner.query(`
      INSERT INTO debourse_type (tenant_id, code, label, base_nature, builtin, sort_order)
      SELECT t.id, v.code, v.label, v.nature, true, v.ord
        FROM tenant t
        CROSS JOIN (VALUES
          ('MO',  'Main d''œuvre',   'labor',       0),
          ('M',   'Matériaux',       'material',    1),
          ('MAT', 'Matériel',        'equipment',   2),
          ('ST',  'Sous-traitance',  'subcontract', 3)
        ) AS v(code, label, nature, ord)
      ON CONFLICT DO NOTHING;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Non destructif pour le reste : seul le référentiel de types disparaît, les devis
    // retombent sur les quatre natures de base qu'ils portent déjà.
    await queryRunner.query(`DROP TABLE IF EXISTS debourse_type;`);
  }
}

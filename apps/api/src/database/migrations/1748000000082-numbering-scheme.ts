import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Numérotation automatique paramétrable — le motif et la séquence de chaque type d'objet, par
 * société.
 *
 * Jusqu'ici les codes (client, fournisseur, affaire, chantier, marché) étaient saisis à la main :
 * source d'erreurs, de doublons et de différences de frappe entre utilisateurs. Désormais chaque
 * société paramètre un motif (ex. « AFF-{YYYY}-{SEQ:4} ») dans Configuration, et le code est
 * réservé automatiquement à la création — plus rien en dur.
 *
 * Additif et réversible : les codes déjà posés restent inchangés ; les nouvelles créations suivent
 * la séquence. Les sociétés existantes reçoivent les motifs par défaut (repris ci-dessous).
 */
export class NumberingScheme1748000000082 implements MigrationInterface {
  name = 'NumberingScheme1748000000082';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE numbering_scheme (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        entity_type varchar(32) NOT NULL,
        pattern     varchar(64) NOT NULL,
        next_seq    int NOT NULL DEFAULT 1,
        created_at  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz NOT NULL DEFAULT now(),
        deleted_at  timestamptz NULL,
        UNIQUE (tenant_id, entity_type)
      );
    `);
    await queryRunner.query(`ALTER TABLE numbering_scheme ENABLE ROW LEVEL SECURITY;`);
    await queryRunner.query(`ALTER TABLE numbering_scheme FORCE ROW LEVEL SECURITY;`);
    await queryRunner.query(`
      CREATE POLICY numbering_scheme_tenant_isolation ON numbering_scheme
        USING (tenant_id = current_tenant())
        WITH CHECK (tenant_id = current_tenant());
    `);

    // Motifs par défaut pour toutes les sociétés existantes. La migration tourne en propriétaire
    // (RLS contournée) : l'insertion ensembliste par tenant est donc sûre.
    await queryRunner.query(`
      INSERT INTO numbering_scheme (tenant_id, entity_type, pattern)
      SELECT t.id, v.entity_type, v.pattern
        FROM tenant t
        CROSS JOIN (VALUES
          ('client',   'CLI-{YYYY}-{SEQ:4}'),
          ('supplier', 'FOU-{YYYY}-{SEQ:4}'),
          ('affaire',  'AFF-{YYYY}-{SEQ:4}'),
          ('chantier', 'CH-{YYYY}-{SEQ:4}'),
          ('marche',   'MAR-{YYYY}-{SEQ:4}')
        ) AS v(entity_type, pattern)
      ON CONFLICT (tenant_id, entity_type) DO NOTHING;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS numbering_scheme;`);
  }
}

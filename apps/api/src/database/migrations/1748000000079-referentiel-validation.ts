import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Gouvernance du référentiel — proposer n'est pas valider.
 *
 * Le conducteur découvre un fournisseur en cours de chantier et doit pouvoir l'enregistrer tout
 * de suite : le chantier n'attend pas. Mais une fiche ouverte dans l'urgence est souvent
 * incomplète, et le référentiel finit pollué de doublons mal renseignés. La fiche entre donc
 * « à valider » : utilisable immédiatement, signalée partout, régularisée ensuite.
 *
 * QUI valide ne se décrète pas ici : selon la société ce sera le directeur, la secrétaire, le
 * président, le deviseur ou le conducteur. C'est pourquoi la validation est une PERMISSION
 * (`directory.validate`) portée par un rôle satellite que l'administrateur pose sur qui il veut.
 *
 * Le client, lui, ne reçoit aucun circuit : il n'est ouvert que par ceux qui tiennent le
 * référentiel, une permission y suffit.
 */
export class ReferentielValidation1748000000079 implements MigrationInterface {
  name = 'ReferentielValidation1748000000079';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── 1. Le fournisseur porte son état de validation ────────────────────────────────────────
    // `valide` par défaut : tout l'existant a été saisi par des administrateurs, il ne doit pas
    // basculer d'un coup en « à valider » et noyer les valideurs sous une file d'attente fictive.
    await queryRunner.query(`
      ALTER TABLE supplier
        ADD COLUMN statut       varchar(16) NOT NULL DEFAULT 'valide'
                                CHECK (statut IN ('valide','a_valider')),
        ADD COLUMN proposed_by  uuid NULL REFERENCES user_account(id),
        ADD COLUMN proposed_at  timestamptz NULL,
        ADD COLUMN validated_by uuid NULL REFERENCES user_account(id),
        ADD COLUMN validated_at timestamptz NULL;
    `);
    // La file d'attente se lit en permanence dans l'écran : un index évite de balayer tout le
    // référentiel pour en extraire une poignée de fiches.
    await queryRunner.query(`
      CREATE INDEX idx_supplier_a_valider ON supplier (tenant_id)
        WHERE statut = 'a_valider' AND deleted_at IS NULL;
    `);

    // ── 2. Les deux nouvelles permissions au catalogue global ─────────────────────────────────
    await queryRunner.query(`
      INSERT INTO permission (key, label) VALUES
        ('directory.propose',  'Proposer une fiche au référentiel (à valider)'),
        ('directory.validate', 'Valider une fiche proposée au référentiel')
      ON CONFLICT (key) DO UPDATE SET label = EXCLUDED.label;
    `);

    // ── 3. Rattrapage des sociétés existantes ─────────────────────────────────────────────────
    // `provisionSystemRoles` ne tourne qu'à l'inscription : sans ce bloc, les nouveaux rôles
    // n'existeraient que pour les sociétés créées après la mise à jour.
    await queryRunner.query(`
      INSERT INTO role (tenant_id, code, label, is_system)
      SELECT t.id, v.code, v.label, true
        FROM tenant t
        CROSS JOIN (VALUES
          ('conducteur',            'Conducteur de travaux'),
          ('referentiel_valideur',  'Validation du référentiel')
        ) AS v(code, label)
      ON CONFLICT (tenant_id, code) DO UPDATE SET label = EXCLUDED.label, updated_at = now();
    `);
    await this.grant(queryRunner, 'conducteur', [
      'directory.read', 'directory.propose', 'estimating.devis.read',
      'invoicing.read', 'site_tracking.read', 'site_tracking.write',
    ]);
    await this.grant(queryRunner, 'referentiel_valideur', ['directory.read', 'directory.validate']);
    // Le deviseur tient désormais le référentiel.
    await this.grant(queryRunner, 'estimator', ['directory.write']);
    // L'administrateur reçoit tout ce qui est nouveau, comme le veut son rôle.
    await this.grant(queryRunner, 'admin', ['directory.propose', 'directory.validate']);
  }

  /** Accorde des permissions à un rôle système, dans toutes les sociétés. Rejouable. */
  private grant(qr: QueryRunner, roleCode: string, keys: string[]): Promise<unknown> {
    return qr.query(
      `INSERT INTO role_permission (tenant_id, role_id, permission_id)
       SELECT r.tenant_id, r.id, p.id
         FROM role r
         JOIN permission p ON p.key = ANY($2)
        WHERE r.code = $1
       ON CONFLICT (role_id, permission_id) DO NOTHING;`,
      [roleCode, keys],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Les deux rôles ajoutés disparaissent (user_role part en cascade) ; le deviseur reperd
    // l'écriture sur le référentiel, et le fournisseur retrouve sa forme d'origine.
    await queryRunner.query(
      `DELETE FROM role WHERE code IN ('conducteur','referentiel_valideur') AND is_system = true;`,
    );
    await queryRunner.query(`
      DELETE FROM role_permission rp
        USING role r, permission p
       WHERE rp.role_id = r.id AND rp.permission_id = p.id
         AND r.code = 'estimator' AND p.key = 'directory.write';
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_supplier_a_valider;`);
    await queryRunner.query(`
      ALTER TABLE supplier
        DROP COLUMN IF EXISTS statut,
        DROP COLUMN IF EXISTS proposed_by,
        DROP COLUMN IF EXISTS proposed_at,
        DROP COLUMN IF EXISTS validated_by,
        DROP COLUMN IF EXISTS validated_at;
    `);
    await queryRunner.query(
      `DELETE FROM permission WHERE key IN ('directory.propose','directory.validate');`,
    );
  }
}

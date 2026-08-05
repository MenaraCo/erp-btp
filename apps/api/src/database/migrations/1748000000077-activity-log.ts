import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Historique des modifications — le fil daté et signé de ce qui se passe dans l'application.
 *
 * Qui a créé cette affaire ? Quand ce devis est-il passé « Gagné », et par qui ? Ces questions se
 * posent tous les jours et ne trouvaient jusqu'ici aucune réponse : les tables métier ne gardent
 * que le dernier état (`updated_at`), jamais le chemin parcouru.
 *
 * Le fil est volontairement DÉNORMALISÉ : `label` porte la phrase telle qu'elle s'affiche, écrite
 * au moment du fait. Un devis renuméroté ou une affaire supprimée ne réécrit donc pas le passé —
 * l'historique dit ce qui était vrai ce jour-là, pas ce qui est vrai aujourd'hui. C'est aussi
 * pourquoi `entity_id` ne porte AUCUNE clé étrangère : l'objet peut disparaître, sa trace reste.
 *
 * `detail` garde le contexte machine (l'avant/après d'un changement de statut) pour un usage
 * ultérieur — filtres, export — sans obliger à réanalyser la phrase.
 */
export class ActivityLog1748000000077 implements MigrationInterface {
  name = 'ActivityLog1748000000077';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE activity_log (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        entity_type   varchar(32) NOT NULL
                      CHECK (entity_type IN ('affaire','devis','marche','chantier')),
        entity_id     uuid NULL,
        action        varchar(32) NOT NULL
                      CHECK (action IN ('creation','modification','statut','acceptation')),
        label         varchar(500) NOT NULL,
        detail        jsonb NULL,
        actor_user_id uuid NULL REFERENCES user_account(id),
        created_at    timestamptz NOT NULL DEFAULT now()
      );
    `);
    // Le fil se lit toujours du plus récent : l'index porte l'ordre de lecture, pas seulement le
    // filtre de tenant, pour que « les 20 derniers » ne balaie jamais tout l'historique.
    await queryRunner.query(
      `CREATE INDEX idx_activity_log_recent ON activity_log (tenant_id, created_at DESC);`,
    );
    await queryRunner.query(`ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;`);
    await queryRunner.query(`ALTER TABLE activity_log FORCE ROW LEVEL SECURITY;`);
    await queryRunner.query(`
      CREATE POLICY activity_log_tenant_isolation ON activity_log
        USING (tenant_id = current_tenant())
        WITH CHECK (tenant_id = current_tenant());
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Réversible et sans effet de bord : l'historique est une trace, aucune donnée métier n'en
    // dépend. Le supprimer ramène simplement l'application à son état d'avant le fil.
    await queryRunner.query(`DROP TABLE IF EXISTS activity_log;`);
  }
}

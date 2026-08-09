import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Journal des événements de paiement reçus du prestataire.
 *
 * Un prestataire de paiement REJOUE ses webhooks : en cas de doute sur la réception, il renvoie
 * le même événement, parfois plusieurs fois. Sans mémoire de ce qui a déjà été traité, un
 * renvoi de « paiement réussi » prolongerait l'abonnement une seconde fois. D'où
 * `provider_event_id UNIQUE` : la deuxième insertion échoue, et l'on sait alors qu'il n'y a rien
 * à refaire.
 *
 * Table de PLATEFORME, sans Row-Level Security : le webhook arrive sans contexte de société —
 * c'est précisément son contenu qui désigne la société concernée. Elle porte donc `tenant_id`
 * comme simple colonne, parfois nulle quand l'événement ne nous concerne pas.
 *
 * Le corps brut est conservé : quand un paiement sera contesté, c'est la seule trace de ce que le
 * prestataire a réellement envoyé.
 */
export class PaymentEvent1748000000081 implements MigrationInterface {
  name = 'PaymentEvent1748000000081';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE payment_event (
        id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        provider           varchar(16) NOT NULL,
        provider_event_id  varchar(255) NOT NULL UNIQUE,
        type               varchar(32) NOT NULL,
        type_brut          varchar(128) NOT NULL,
        tenant_id          uuid NULL REFERENCES tenant(id) ON DELETE SET NULL,
        corps              jsonb NULL,
        traite_le          timestamptz NOT NULL DEFAULT now()
      );
    `);
    // Le suivi d'un abonné se lit du plus récent : l'index porte l'ordre de lecture.
    await queryRunner.query(
      `CREATE INDEX idx_payment_event_tenant ON payment_event (tenant_id, traite_le DESC);`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Sans effet de bord : aucune donnée métier ne dépend de ce journal, il ne fait que
    // mémoriser ce qui a déjà été traité.
    await queryRunner.query(`DROP TABLE IF EXISTS payment_event;`);
  }
}

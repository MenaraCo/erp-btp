import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Gestion mensuelle du contrôle de gestion (cahier des charges §5.8).
 *
 * Les mouvements portent déjà leur date (commande validée, facture fournisseur, pointage), donc
 * les flux M / M-1 / CUMUL se calculent en temps réel par regroupement sur ces dates — aucune
 * dénormalisation n'est nécessaire pour lire.
 *
 * La **clôture mensuelle** fige en revanche un instantané de l'état du chantier en fin de mois
 * (avancement, engagé et réalisé cumulés, EAC, marge prévisionnelle) plus les flux du mois. C'est
 * cet historique figé qui alimente les comparaisons dans le temps et les courbes de pilotage.
 * Un enregistrement par (chantier, mois). Table tenant-scopée (RLS).
 */
export class MonthlyClosure1748000000057 implements MigrationInterface {
  name = 'MonthlyClosure1748000000057';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE monthly_closure (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        chantier_id uuid NOT NULL REFERENCES chantier(id) ON DELETE CASCADE,
        month       date NOT NULL,
        snapshot    jsonb NOT NULL,
        closed_at   timestamptz NOT NULL DEFAULT now(),
        UNIQUE (chantier_id, month)
      );
    `);
    await queryRunner.query(`ALTER TABLE monthly_closure ENABLE ROW LEVEL SECURITY;`);
    await queryRunner.query(`ALTER TABLE monthly_closure FORCE ROW LEVEL SECURITY;`);
    await queryRunner.query(`
      CREATE POLICY monthly_closure_tenant_isolation ON monthly_closure
        USING (tenant_id = current_tenant())
        WITH CHECK (tenant_id = current_tenant());
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS monthly_closure;`);
  }
}

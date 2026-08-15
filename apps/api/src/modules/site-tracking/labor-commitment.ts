import { EntityManager } from 'typeorm';

/**
 * Main d'œuvre ENGAGÉE : les heures planifiées qui n'ont pas encore eu lieu.
 *
 * Une commande validée engage l'entreprise ; une équipe affectée à un chantier l'engage tout
 * autant — elle sera payée, qu'on l'ait prévue ou non. Le tableau de bord ne comptait que les
 * achats : la main d'œuvre à venir n'apparaissait nulle part, et l'engagé sous-estimait ce qui
 * restait à dépenser.
 *
 * Le jour POINTÉ sort de l'engagé : il est passé dans le réalisé. Sans cette exclusion, une
 * journée prévue puis effectuée compterait deux fois — d'où le `NOT EXISTS` plutôt qu'un simple
 * filtre sur la date du jour, qui laisserait passer les prévisions non tenues.
 */
const SANS_POINTAGE = `
  NOT EXISTS (
    SELECT 1 FROM timesheet t
     WHERE t.chantier_id = f.chantier_id
       AND t.employee_id = f.employee_id
       AND t.work_date  = f.work_date
  )`;

/** Montant total de main d'œuvre engagée sur un chantier. */
export async function engageMainOeuvre(em: EntityManager, chantierId: string): Promise<string> {
  const rows = await em.query(
    `SELECT COALESCE(SUM(f.hours * e.hourly_cost), 0)::numeric(16,2) AS montant
       FROM timesheet_forecast f
       JOIN employee e ON e.id = f.employee_id
      WHERE f.chantier_id = $1 AND ${SANS_POINTAGE}`,
    [chantierId],
  );
  return String(rows[0]?.montant ?? '0.00');
}

/** Même engagement, ventilé par code analytique (celui de la fiche salarié). */
export function engageMainOeuvreParCode(
  em: EntityManager,
  chantierId: string,
): Promise<Array<{ code_id: string | null; montant: string }>> {
  return em.query(
    `SELECT e.code_analytique_id AS code_id,
            SUM(f.hours * e.hourly_cost)::numeric(16,2) AS montant
       FROM timesheet_forecast f
       JOIN employee e ON e.id = f.employee_id
      WHERE f.chantier_id = $1 AND ${SANS_POINTAGE}
      GROUP BY e.code_analytique_id`,
    [chantierId],
  );
}

/** Engagement mensuel, daté par le jour de travail prévu — pour les courbes et la clôture. */
export function engageMainOeuvreParMois(
  em: EntityManager,
  chantierId: string,
): Promise<Array<{ m: string; v: string }>> {
  return em.query(
    `SELECT to_char(date_trunc('month', f.work_date), 'YYYY-MM') AS m,
            SUM(f.hours * e.hourly_cost)::numeric(16,2) AS v
       FROM timesheet_forecast f
       JOIN employee e ON e.id = f.employee_id
      WHERE f.chantier_id = $1 AND ${SANS_POINTAGE}
      GROUP BY 1`,
    [chantierId],
  );
}

/** Engagement du mois / du mois précédent / cumulé — la présentation en 3 colonnes du §5.8. */
export async function engageMainOeuvreFlux(
  em: EntityManager,
  chantierId: string,
  bornes: { start: string; nextStart: string; prevStart: string },
): Promise<{ m: string; m1: string; cumul: string }> {
  const rows = await em.query(
    `SELECT COALESCE(SUM(f.hours * e.hourly_cost) FILTER (WHERE f.work_date >= $2 AND f.work_date < $3), 0)::numeric(16,2) AS m,
            COALESCE(SUM(f.hours * e.hourly_cost) FILTER (WHERE f.work_date >= $4 AND f.work_date < $2), 0)::numeric(16,2) AS m1,
            COALESCE(SUM(f.hours * e.hourly_cost) FILTER (WHERE f.work_date < $3), 0)::numeric(16,2) AS cumul
       FROM timesheet_forecast f
       JOIN employee e ON e.id = f.employee_id
      WHERE f.chantier_id = $1 AND ${SANS_POINTAGE}`,
    [chantierId, bornes.start, bornes.nextStart, bornes.prevStart],
  );
  return rows[0] ?? { m: '0.00', m1: '0.00', cumul: '0.00' };
}

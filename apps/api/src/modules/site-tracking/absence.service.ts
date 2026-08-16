import {
  BadRequestException, ConflictException, Injectable, NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import Decimal from 'decimal.js';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { runInTenant } from '../../core/tenancy/tenant-transaction';
import { returningRows } from '../../core/database/returning.util';
import { dureeDuCreneau, normaliserCreneau } from './timesheet.service';

/** Motifs d'absence retenus. Le libellé et la couleur d'affichage vivent côté écran. */
export const MOTIFS_ABSENCE = [
  'conges', 'rtt', 'maladie', 'accident', 'intemperie',
  'formation', 'ferie', 'sans_solde', 'autre',
] as const;
export type MotifAbsence = (typeof MOTIFS_ABSENCE)[number];

export interface AbsenceInput {
  employeeId: string;
  kind: MotifAbsence | string;
  /** Journée unique, ou premier jour d'une période. */
  debut: string;
  /** Dernier jour inclus ; absent, l'absence ne dure qu'un jour. */
  fin?: string | null;
  /** Heures neutralisées par jour. Un créneau, s'il est donné, prime. */
  hours?: string | number | null;
  startTime?: string | null;
  endTime?: string | null;
  comment?: string | null;
  /** Congés posés du lundi au vendredi : le week-end ne se décompte pas. */
  joursOuvres?: boolean;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
/** Journée type quand rien n'est précisé — la même que celle du planning. */
const HEURES_JOURNEE = 7;
/** Une pose de congés d'un an relève de l'erreur de saisie, pas du cas d'usage. */
const MAX_JOURS = 366;

/**
 * Congés et absences.
 *
 * Une absence ne coûte rien à un chantier : elle ne passe donc NI par `timesheet` (qui alimente
 * les résultats) NI par un pseudo-chantier « CONGÉS » qui fausserait l'analytique. Elle dit
 * seulement que la personne n'est pas disponible — ce que le planning doit savoir pour cesser de
 * mentir, et ce que la détection de conflits utilise pour signaler un salarié pointé alors qu'il
 * était en congés.
 */
@Injectable()
export class AbsenceService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly context: TenantContext,
  ) {}

  /** Absences d'une période, éventuellement d'un seul salarié. */
  list(debut: string, fin: string, employeeId?: string | null, motif?: string | null) {
    const tenantId = this.context.requireTenantId();
    if (!ISO.test(debut ?? '') || !ISO.test(fin ?? '')) {
      throw new BadRequestException('Période attendue au format AAAA-MM-JJ.');
    }
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const params: unknown[] = [debut, fin];
      let filtre = '';
      if (employeeId) { params.push(employeeId); filtre = `AND a.employee_id = $${params.length}`; }
      if (motif) { params.push(motif); filtre += ` AND a.kind = $${params.length}`; }
      const rows = await em.query(
        `SELECT a.id, a.employee_id, a.kind, a.work_date::text AS work_date, a.hours::text AS hours,
                to_char(a.start_time,'HH24:MI') AS debut, to_char(a.end_time,'HH24:MI') AS fin,
                a.comment, e.code AS matricule,
                trim(coalesce(e.first_name,'') || ' ' || e.last_name) AS label
           FROM absence a
           JOIN employee e ON e.id = a.employee_id
          WHERE a.work_date BETWEEN $1 AND $2 ${filtre}
          ORDER BY a.work_date ASC, label ASC`,
        params,
      );
      return rows.map((r: Record<string, unknown>) => ({
        id: r.id as string,
        employeeId: r.employee_id as string,
        matricule: (r.matricule as string | null) ?? null,
        label: r.label as string,
        kind: r.kind as string,
        date: r.work_date as string,
        heures: new Decimal(r.hours as string).toString(),
        debut: (r.debut as string | null) ?? null,
        fin: (r.fin as string | null) ?? null,
        commentaire: (r.comment as string | null) ?? null,
      }));
    });
  }

  /**
   * Pose une absence, éventuellement sur plusieurs jours d'un coup.
   *
   * Les congés se posent en semaines, pas en journées une par une : accepter une période est la
   * seule façon d'éviter dix saisies pour une semaine de vacances. Un jour déjà porteur du même
   * motif est mis à jour plutôt que refusé — reposer par-dessus est un geste normal.
   */
  create(input: AbsenceInput) {
    const tenantId = this.context.requireTenantId();
    const kind = String(input.kind ?? '').trim();
    if (!MOTIFS_ABSENCE.includes(kind as MotifAbsence)) {
      throw new BadRequestException(`Motif d'absence inconnu : « ${kind} ».`);
    }
    if (!input.employeeId) throw new BadRequestException('Le salarié est requis.');
    const debut = input.debut;
    const fin = input.fin || input.debut;
    if (!ISO.test(debut ?? '') || !ISO.test(fin ?? '')) {
      throw new BadRequestException('Dates attendues au format AAAA-MM-JJ.');
    }
    if (debut > fin) throw new BadRequestException('La date de début doit précéder la date de fin.');

    const creneau = normaliserCreneau(input.startTime, input.endTime);
    const heures = creneau
      ? dureeDuCreneau(creneau)
      : new Decimal(input.hours ?? HEURES_JOURNEE);
    if (heures.isNegative()) throw new BadRequestException('Les heures ne peuvent pas être négatives.');

    const jours = joursEntre(debut, fin, input.joursOuvres !== false);
    if (jours.length === 0) {
      throw new BadRequestException('Cette période ne contient aucun jour ouvré.');
    }
    if (jours.length > MAX_JOURS) {
      throw new BadRequestException('Période trop longue : un an au maximum.');
    }

    return runInTenant(this.dataSource, tenantId, async (em) => {
      const salarie = await em.query(`SELECT id FROM employee WHERE id = $1`, [input.employeeId]);
      if (salarie.length === 0) throw new NotFoundException('Salarié introuvable.');

      const commentaire = (input.comment ?? '').trim() || null;
      for (const jour of jours) {
        await em.query(
          `INSERT INTO absence
             (tenant_id, employee_id, work_date, kind, hours, start_time, end_time, comment)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (employee_id, work_date, kind)
           DO UPDATE SET hours = EXCLUDED.hours, start_time = EXCLUDED.start_time,
                         end_time = EXCLUDED.end_time, comment = EXCLUDED.comment,
                         updated_at = now()`,
          [tenantId, input.employeeId, jour, kind, heures.toString(),
            creneau?.debut ?? null, creneau?.fin ?? null, commentaire],
        );
      }
      return { jours: jours.length, debut: jours[0], fin: jours[jours.length - 1], kind };
    });
  }

  /** Corrige une absence : motif, jour, durée ou créneau. */
  update(id: string, patch: Partial<AbsenceInput> & { date?: string }) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const existante = (await em.query(
        `SELECT *, work_date::text AS work_date FROM absence WHERE id = $1`, [id],
      ))[0] as Record<string, unknown> | undefined;
      if (!existante) throw new NotFoundException('Absence introuvable.');

      const kind = patch.kind !== undefined ? String(patch.kind) : (existante.kind as string);
      if (!MOTIFS_ABSENCE.includes(kind as MotifAbsence)) {
        throw new BadRequestException(`Motif d'absence inconnu : « ${kind} ».`);
      }
      const date = patch.date ?? patch.debut ?? (existante.work_date as string);
      if (!ISO.test(date)) throw new BadRequestException('Date attendue au format AAAA-MM-JJ.');

      // Créneau : `undefined` laisse en place, `null` efface l'horaire (retour en journée).
      const creneau = patch.startTime === undefined && patch.endTime === undefined
        ? normaliserCreneau(
          existante.start_time ? String(existante.start_time).slice(0, 5) : null,
          existante.end_time ? String(existante.end_time).slice(0, 5) : null,
        )
        : normaliserCreneau(patch.startTime ?? null, patch.endTime ?? null);
      const heures = creneau
        ? dureeDuCreneau(creneau)
        : new Decimal(patch.hours ?? String(existante.hours));
      if (heures.isNegative()) throw new BadRequestException('Les heures ne peuvent pas être négatives.');

      const doublon = await em.query(
        `SELECT id FROM absence
          WHERE employee_id = $1 AND work_date = $2 AND kind = $3 AND id <> $4`,
        [existante.employee_id, date, kind, id],
      );
      if (doublon.length > 0) {
        throw new ConflictException('Cette personne a déjà cette absence ce jour-là.');
      }

      const rows = returningRows<Record<string, unknown>>(
        await em.query(
          `UPDATE absence
              SET work_date = $2, kind = $3, hours = $4, start_time = $5, end_time = $6,
                  comment = COALESCE($7, comment), updated_at = now()
            WHERE id = $1
        RETURNING id, work_date::text AS work_date, kind, hours::text AS hours,
                  to_char(start_time,'HH24:MI') AS debut, to_char(end_time,'HH24:MI') AS fin`,
          [id, date, kind, heures.toString(), creneau?.debut ?? null, creneau?.fin ?? null,
            patch.comment === undefined ? null : ((patch.comment ?? '').trim() || null)],
        ),
      );
      const r = rows[0];
      return {
        id: r.id as string,
        date: r.work_date as string,
        kind: r.kind as string,
        heures: new Decimal(r.hours as string).toString(),
        debut: (r.debut as string | null) ?? null,
        fin: (r.fin as string | null) ?? null,
      };
    });
  }

  remove(id: string): Promise<{ deleted: true }> {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const rows = returningRows<{ id: string }>(
        await em.query(`DELETE FROM absence WHERE id = $1 RETURNING id`, [id]),
      );
      if (rows.length === 0) throw new NotFoundException('Absence introuvable.');
      return { deleted: true as const };
    });
  }
}

/** Jours d'une période, week-end exclu par défaut (personne ne pose de congés un dimanche). */
function joursEntre(debut: string, fin: string, joursOuvres: boolean): string[] {
  const jours: string[] = [];
  const d = new Date(`${debut}T00:00:00Z`);
  const f = new Date(`${fin}T00:00:00Z`);
  for (const c = d; c <= f; c.setUTCDate(c.getUTCDate() + 1)) {
    const jour = c.getUTCDay();
    if (joursOuvres && (jour === 0 || jour === 6)) continue;
    jours.push(c.toISOString().slice(0, 10));
  }
  return jours;
}

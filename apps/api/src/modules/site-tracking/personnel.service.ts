import {
  BadRequestException, ConflictException, Injectable, NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import Decimal from 'decimal.js';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { runInTenant } from '../../core/tenancy/tenant-transaction';
import { returningRows } from '../../core/database/returning.util';
import { TimesheetService, dureeDuCreneau, normaliserCreneau } from './timesheet.service';

export interface FiltrePersonnel {
  debut: string;
  fin: string;
  employeeId?: string | null;
  chantierId?: string | null;
  contractType?: string | null;
}

export interface OccupationJour {
  date: string;
  chantiers: Array<{
    chantierId: string; code: string; nom: string; couleur: string | null;
    heures: string; prevu: boolean;
    debut?: string | null; fin?: string | null;
  }>;
  /** Congés, maladie, intempéries… : la journée n'est pas disponible, en tout ou partie. */
  absences: Array<{ id: string; kind: string; heures: string; debut: string | null; fin: string | null }>;
  totalHeures: string;
  /** Journée à regarder : cumul anormal, présence sur plusieurs chantiers, ou pointage en absence. */
  conflits: string[];
}

export interface LignePersonnel {
  employeeId: string;
  label: string;
  contractType: string;
  agency: string | null;
  codeAnalytique: string | null;
  jours: Record<string, OccupationJour>;
  totalHeures: string;
  totalPrevu: string;
  conflits: number;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
/** Au-delà, une journée d'homme n'est plus crédible : c'est une double saisie ou une erreur. */
const SEUIL_JOURNEE = 12;

/**
 * Vue d'entreprise du personnel : qui travaille où, quand, et ce qui cloche.
 *
 * Le pointage se saisit chantier par chantier, mais un salarié n'appartient pas à un chantier :
 * il se répartit entre plusieurs. Sans vue globale, personne ne voit qu'un maçon a été pointé le
 * même jour sur deux chantiers — chacun ayant raison de son côté, et l'entreprise payant deux
 * fois la même journée dans ses résultats.
 */
@Injectable()
export class PersonnelService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly context: TenantContext,
    // Créer une heure réalisée depuis le calendrier passe par le même chemin que la saisie
    // chantier : reprise du coût horaire et du code analytique de la fiche, sans copie de règle.
    private readonly timesheets: TimesheetService,
  ) {}

  /**
   * Occupation du personnel sur une période, tous chantiers confondus.
   * Les filtres servent à répondre à « où est Untel cette semaine ? » comme à « qui est sur ce
   * chantier ? » sans changer d'écran.
   */
  occupation(filtre: FiltrePersonnel) {
    const tenantId = this.context.requireTenantId();
    const { debut, fin } = bornes(filtre.debut, filtre.fin);
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const params: unknown[] = [debut, fin];
      const conditions: string[] = [];
      if (filtre.employeeId) { params.push(filtre.employeeId); conditions.push(`e.id = $${params.length}`); }
      if (filtre.chantierId) { params.push(filtre.chantierId); conditions.push(`c.id = $${params.length}`); }
      if (filtre.contractType) { params.push(filtre.contractType); conditions.push(`e.contract_type = $${params.length}`); }
      const filtres = conditions.length ? `AND ${conditions.join(' AND ')}` : '';

      // Réalisé et prévisionnel dans une seule lecture : le calendrier les montre côte à côte.
      const lignes: Array<{
        employee_id: string; label: string; contract_type: string; agency: string | null;
        code_analytique: string | null; chantier_id: string; chantier_code: string;
        chantier_nom: string; chantier_couleur: string | null;
        work_date: string; heures: string; prevu: boolean;
        debut: string | null; fin: string | null;
      }> = await em.query(
        `SELECT e.id AS employee_id,
                trim(coalesce(e.first_name, '') || ' ' || e.last_name) AS label,
                e.contract_type, e.agency, a.code AS code_analytique,
                c.id AS chantier_id, c.code AS chantier_code, c.name AS chantier_nom,
                c.color AS chantier_couleur,
                t.work_date::text AS work_date, SUM(t.hours)::text AS heures, false AS prevu,
                to_char(MIN(t.start_time), 'HH24:MI') AS debut,
                to_char(MAX(t.end_time), 'HH24:MI') AS fin
           FROM timesheet t
           JOIN employee e ON e.id = t.employee_id
           JOIN chantier c ON c.id = t.chantier_id
           LEFT JOIN analytical_code a ON a.id = e.code_analytique_id
          WHERE t.work_date BETWEEN $1 AND $2 ${filtres}
          GROUP BY e.id, label, e.contract_type, e.agency, a.code,
                   c.id, c.code, c.name, c.color, t.work_date
         UNION ALL
         SELECT e.id, trim(coalesce(e.first_name, '') || ' ' || e.last_name),
                e.contract_type, e.agency, a.code,
                c.id, c.code, c.name, c.color, f.work_date::text, SUM(f.hours)::text, true,
                to_char(MIN(f.start_time), 'HH24:MI'), to_char(MAX(f.end_time), 'HH24:MI')
           FROM timesheet_forecast f
           JOIN employee e ON e.id = f.employee_id
           JOIN chantier c ON c.id = f.chantier_id
           LEFT JOIN analytical_code a ON a.id = e.code_analytique_id
          WHERE f.work_date BETWEEN $1 AND $2 ${filtres}
          GROUP BY e.id, e.first_name, e.last_name, e.contract_type, e.agency, a.code,
                   c.id, c.code, c.name, c.color, f.work_date`,
        params,
      );

      const parSalarie = new Map<string, LignePersonnel>();
      for (const l of lignes) {
        const s = parSalarie.get(l.employee_id) ?? {
          employeeId: l.employee_id,
          label: l.label,
          contractType: l.contract_type,
          agency: l.agency,
          codeAnalytique: l.code_analytique,
          jours: {} as Record<string, OccupationJour>,
          totalHeures: '0',
          totalPrevu: '0',
          conflits: 0,
        };
        s.jours[l.work_date] ??= {
          date: l.work_date, chantiers: [], absences: [], totalHeures: '0', conflits: [],
        };
        const jour = s.jours[l.work_date];
        jour.chantiers.push({
          chantierId: l.chantier_id,
          code: l.chantier_code,
          nom: l.chantier_nom,
          couleur: l.chantier_couleur ?? null,
          heures: new Decimal(l.heures).toString(),
          prevu: l.prevu,
          debut: l.debut,
          fin: l.fin,
        });
        if (l.prevu) {
          s.totalPrevu = new Decimal(s.totalPrevu).plus(l.heures).toString();
        } else {
          jour.totalHeures = new Decimal(jour.totalHeures).plus(l.heures).toString();
          s.totalHeures = new Decimal(s.totalHeures).plus(l.heures).toString();
        }
        parSalarie.set(l.employee_id, s);
      }

      // Absences de la période : elles n'appartiennent à aucun chantier, mais elles décident de
      // la disponibilité — et un salarié pointé alors qu'il est en congés est une anomalie.
      const paramsAbs: unknown[] = [debut, fin];
      let filtreAbs = '';
      if (filtre.employeeId) {
        paramsAbs.push(filtre.employeeId);
        filtreAbs = `AND a.employee_id = $${paramsAbs.length}`;
      }
      const absences: Array<Record<string, unknown>> = await em.query(
        `SELECT a.id, a.employee_id, a.kind, a.work_date::text AS work_date, a.hours::text AS hours,
                to_char(a.start_time,'HH24:MI') AS debut, to_char(a.end_time,'HH24:MI') AS fin,
                trim(coalesce(e.first_name,'') || ' ' || e.last_name) AS label,
                e.contract_type, e.agency
           FROM absence a
           JOIN employee e ON e.id = a.employee_id
          WHERE a.work_date BETWEEN $1 AND $2 ${filtreAbs}`,
        paramsAbs,
      );
      for (const a of absences) {
        const employeeId = a.employee_id as string;
        // Un salarié qui n'a QUE des absences sur la période doit quand même apparaître : c'est
        // précisément l'information « il n'est pas disponible ».
        const s = parSalarie.get(employeeId) ?? {
          employeeId,
          label: a.label as string,
          contractType: a.contract_type as string,
          agency: (a.agency as string | null) ?? null,
          codeAnalytique: null,
          jours: {} as Record<string, OccupationJour>,
          totalHeures: '0',
          totalPrevu: '0',
          conflits: 0,
        };
        const date = a.work_date as string;
        s.jours[date] ??= { date, chantiers: [], absences: [], totalHeures: '0', conflits: [] };
        s.jours[date].absences.push({
          id: a.id as string,
          kind: a.kind as string,
          heures: new Decimal(a.hours as string).toString(),
          debut: (a.debut as string | null) ?? null,
          fin: (a.fin as string | null) ?? null,
        });
        parSalarie.set(employeeId, s);
      }

      // Conflits : c'est ici que la vue globale gagne sa place.
      for (const s of parSalarie.values()) {
        for (const jour of Object.values(s.jours)) {
          const reels = jour.chantiers.filter((c) => !c.prevu);
          const chantiersDistincts = new Set(reels.map((c) => c.chantierId));
          if (chantiersDistincts.size > 1) {
            // Quand les horaires sont connus, on ne crie que s'il y a VRAIMENT chevauchement :
            // le matin sur un chantier et l'après-midi sur un autre est parfaitement normal.
            const avecHoraire = reels.filter((c) => c.debut && c.fin);
            const chevauchements = paires(avecHoraire).filter(
              ([a, b]) => a.debut! < b.fin! && b.debut! < a.fin!,
            );
            if (avecHoraire.length === reels.length && chevauchements.length === 0) {
              // Journée partagée proprement : rien à signaler.
            } else if (chevauchements.length > 0) {
              const [a, b] = chevauchements[0];
              jour.conflits.push(
                `Présent au même moment sur ${a.code} (${a.debut}–${a.fin}) et ${b.code} (${b.debut}–${b.fin})`,
              );
            } else {
              jour.conflits.push(
                `Pointé sur ${chantiersDistincts.size} chantiers le même jour : ${reels.map((c) => c.code).join(', ')}`,
              );
            }
          }
          // Absences : une journée de chantier et une absence le même jour ne cohabitent que si
          // les horaires les séparent proprement (formation le matin, chantier l'après-midi).
          if (jour.absences.length > 0) {
            const motifs = jour.absences.map((a) => a.kind).join(', ');
            const prevus = jour.chantiers.filter((c) => c.prevu);
            if (reels.length > 0 && seChevauchent(reels, jour.absences)) {
              jour.conflits.push(
                `Pointé sur ${reels.map((c) => c.code).join(', ')} alors qu'une absence est saisie (${motifs})`,
              );
            }
            // Planifier quelqu'un qui sera absent est l'erreur que ce module doit rendre visible :
            // sans elle, le planning promet une équipe qui ne viendra pas.
            if (prevus.length > 0 && seChevauchent(prevus, jour.absences)) {
              jour.conflits.push(
                `Journée planifiée sur ${prevus.map((c) => c.code).join(', ')} alors qu'une absence est saisie (${motifs})`,
              );
            }
          }
          if (new Decimal(jour.totalHeures).greaterThan(SEUIL_JOURNEE)) {
            jour.conflits.push(`${jour.totalHeures} h cumulées — journée impossible`);
          }
          s.conflits += jour.conflits.length;
        }
      }

      const salaries = [...parSalarie.values()].sort((a, b) => a.label.localeCompare(b.label));
      return {
        debut,
        fin,
        jours: joursEntre(debut, fin),
        salaries,
        totalHeures: salaries.reduce((t, s) => t.plus(s.totalHeures), new Decimal(0)).toString(),
        totalPrevu: salaries.reduce((t, s) => t.plus(s.totalPrevu), new Decimal(0)).toString(),
        conflits: salaries.reduce((n, s) => n + s.conflits, 0),
      };
    });
  }

  /**
   * Les seuls conflits, à plat — pour une page d'alerte qui va droit au but.
   * Un conflit n'est jamais bloqué à la saisie : un salarié PEUT légitimement passer d'un chantier
   * à l'autre dans la journée. On le signale, le conducteur tranche.
   */
  async conflits(debut: string, fin: string) {
    const vue = await this.occupation({ debut, fin });
    const liste = vue.salaries.flatMap((s) =>
      Object.values(s.jours)
        .filter((j) => j.conflits.length > 0)
        .map((j) => ({
          employeeId: s.employeeId,
          label: s.label,
          date: j.date,
          totalHeures: j.totalHeures,
          chantiers: j.chantiers.filter((c) => !c.prevu),
          absences: j.absences,
          motifs: j.conflits,
        })),
    );
    return { debut: vue.debut, fin: vue.fin, conflits: liste, total: liste.length };
  }
  /**
   * Créneaux individuels d'une période — ce que la vue calendrier affiche et déplace.
   *
   * L'occupation agrège par jour ; ici on veut chaque bloc avec son identifiant, pour pouvoir le
   * saisir à la souris. Le réalisé et le prévisionnel arrivent ensemble, distingués par `kind`.
   */
  creneaux(filtre: FiltrePersonnel) {
    const tenantId = this.context.requireTenantId();
    const { debut, fin } = bornes(filtre.debut, filtre.fin);
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const params: unknown[] = [debut, fin];
      const conds: string[] = [];
      if (filtre.employeeId) { params.push(filtre.employeeId); conds.push(`e.id = $${params.length}`); }
      if (filtre.chantierId) { params.push(filtre.chantierId); conds.push(`c.id = $${params.length}`); }
      if (filtre.contractType) { params.push(filtre.contractType); conds.push(`e.contract_type = $${params.length}`); }
      const filtres = conds.length ? `AND ${conds.join(' AND ')}` : '';

      // Les absences ne connaissent ni chantier ni ouvrage : elles ont leurs propres filtres.
      const paramsAbsence: unknown[] = [debut, fin];
      const condsAbsence: string[] = [];
      if (filtre.employeeId) {
        paramsAbsence.push(filtre.employeeId);
        condsAbsence.push(`e.id = $${paramsAbsence.length}`);
      }
      if (filtre.contractType) {
        paramsAbsence.push(filtre.contractType);
        condsAbsence.push(`e.contract_type = $${paramsAbsence.length}`);
      }
      const filtresAbsence = condsAbsence.length ? `AND ${condsAbsence.join(' AND ')}` : '';

      // Les absences n'ont pas de chantier : elles rejoignent quand même la liste, car le
      // calendrier doit montrer POURQUOI une journée est vide autant que ce qu'on y fait.
      // Un filtre par chantier les écarte : on regarde alors ce chantier, pas la disponibilité.
      const rows: Array<Record<string, unknown>> = await em.query(
        `SELECT t.id, 'realise' AS kind, e.id AS employee_id,
                trim(coalesce(e.first_name,'') || ' ' || e.last_name) AS label,
                c.id AS chantier_id, c.code AS chantier_code, c.name AS chantier_nom,
                c.color AS chantier_couleur,
                t.work_date::text AS date, t.hours::text AS heures,
                to_char(t.start_time,'HH24:MI') AS debut, to_char(t.end_time,'HH24:MI') AS fin,
                (t.imputed_at IS NOT NULL) AS fige
           FROM timesheet t
           JOIN employee e ON e.id = t.employee_id
           JOIN chantier c ON c.id = t.chantier_id
          WHERE t.work_date BETWEEN $1 AND $2 ${filtres}
         UNION ALL
         SELECT f.id, 'prevu', e.id,
                trim(coalesce(e.first_name,'') || ' ' || e.last_name),
                c.id, c.code, c.name, c.color,
                f.work_date::text, f.hours::text,
                to_char(f.start_time,'HH24:MI'), to_char(f.end_time,'HH24:MI'), false
           FROM timesheet_forecast f
           JOIN employee e ON e.id = f.employee_id
           JOIN chantier c ON c.id = f.chantier_id
          WHERE f.work_date BETWEEN $1 AND $2 ${filtres}
          ORDER BY 8, 10 NULLS FIRST`,
        params,
      );

      const absences: Array<Record<string, unknown>> = filtre.chantierId ? [] : await em.query(
        `SELECT a.id, a.kind, e.id AS employee_id,
                trim(coalesce(e.first_name,'') || ' ' || e.last_name) AS label,
                a.work_date::text AS date, a.hours::text AS heures,
                to_char(a.start_time,'HH24:MI') AS debut, to_char(a.end_time,'HH24:MI') AS fin,
                a.comment
           FROM absence a
           JOIN employee e ON e.id = a.employee_id
          WHERE a.work_date BETWEEN $1 AND $2 ${filtresAbsence}
          ORDER BY a.work_date, a.start_time NULLS FIRST`,
        paramsAbsence,
      );

      const creneauxAbsence = absences.map((a) => ({
        id: a.id as string,
        kind: 'absence' as 'realise' | 'prevu' | 'absence',
        employeeId: a.employee_id as string,
        label: a.label as string,
        // Une absence occupe la place d'un chantier dans le calendrier, sans en être un.
        chantierId: '',
        chantierCode: '',
        chantierNom: '',
        chantierCouleur: null as string | null,
        motif: a.kind as string | null,
        commentaire: (a.comment as string | null) ?? null,
        date: a.date as string,
        heures: new Decimal(a.heures as string).toString(),
        debut: (a.debut as string | null) ?? null,
        fin: (a.fin as string | null) ?? null,
        fige: false,
      }));

      return {
        debut,
        fin,
        jours: joursEntre(debut, fin),
        creneaux: rows.map((r) => ({
          id: r.id as string,
          kind: r.kind as 'realise' | 'prevu' | 'absence',
          employeeId: r.employee_id as string,
          label: r.label as string,
          chantierId: r.chantier_id as string,
          chantierCode: r.chantier_code as string,
          chantierNom: r.chantier_nom as string,
          chantierCouleur: (r.chantier_couleur as string | null) ?? null,
          date: r.date as string,
          heures: new Decimal(r.heures as string).toString(),
          motif: null as string | null,
          commentaire: null as string | null,
          debut: (r.debut as string | null) ?? null,
          fin: (r.fin as string | null) ?? null,
          fige: Boolean(r.fige),
        })).concat(creneauxAbsence),
      };
    });
  }

  /**
   * Crée un créneau depuis le calendrier — la saisie « 8 h–12 h sur ce chantier ».
   *
   * Le réalisé passe par le service de pointage : coût horaire et code analytique viennent de la
   * fiche salarié, comme pour une saisie faite depuis le chantier. Rien ne doit dépendre de
   * l'écran par lequel l'heure est entrée.
   */
  creer(input: {
    kind: 'realise' | 'prevu';
    employeeId: string;
    chantierId: string;
    date: string;
    heures?: string | number | null;
    debut?: string | null;
    fin?: string | null;
  }) {
    const tenantId = this.context.requireTenantId();
    if (!input?.employeeId) throw new BadRequestException('Le salarié est requis.');
    if (!input?.chantierId) throw new BadRequestException('Le chantier est requis.');
    if (!ISO.test(input?.date ?? '')) {
      throw new BadRequestException('Date attendue au format AAAA-MM-JJ.');
    }
    const creneau = normaliserCreneau(input.debut, input.fin);
    const heures = creneau
      ? dureeDuCreneau(creneau)
      : new Decimal(input.heures ?? 0);
    if (heures.isNegative()) throw new BadRequestException('Les heures ne peuvent pas être négatives.');
    if (heures.isZero()) {
      throw new BadRequestException('Indiquez une durée, ou un créneau horaire.');
    }

    if (input.kind === 'realise') {
      return this.timesheets.create(input.chantierId, {
        employeeId: input.employeeId,
        date: input.date,
        hours: heures.toString(),
        hourlyCost: null as unknown as string,
        startTime: creneau?.debut ?? null,
        endTime: creneau?.fin ?? null,
      }).then((t: Record<string, unknown>) => ({
        id: t.id as string, kind: 'realise' as const, date: input.date, heures: heures.toString(),
      }));
    }

    return runInTenant(this.dataSource, tenantId, async (em) => {
      const salarie = await em.query(
        `SELECT id FROM employee WHERE id = $1 AND deleted_at IS NULL`, [input.employeeId],
      );
      if (salarie.length === 0) throw new NotFoundException('Salarié introuvable');
      const chantier = await em.query(`SELECT id FROM chantier WHERE id = $1`, [input.chantierId]);
      if (chantier.length === 0) throw new NotFoundException('Chantier introuvable');

      // Un prévisionnel est unique par salarié, chantier et jour : reposer dessus le remplace.
      const rows = await em.query(
        `INSERT INTO timesheet_forecast
           (tenant_id, chantier_id, employee_id, work_date, hours, start_time, end_time)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (chantier_id, employee_id, work_date)
         DO UPDATE SET hours = EXCLUDED.hours, start_time = EXCLUDED.start_time,
                       end_time = EXCLUDED.end_time, updated_at = now()
         RETURNING id, work_date::text AS work_date, hours::text AS hours`,
        [tenantId, input.chantierId, input.employeeId, input.date, heures.toString(),
          creneau?.debut ?? null, creneau?.fin ?? null],
      );
      return {
        id: rows[0].id as string, kind: 'prevu' as const,
        date: rows[0].work_date as string, heures: rows[0].hours as string,
      };
    });
  }

  /**
   * Supprime un créneau — « ce salarié n'était pas là ce jour-là ».
   * Un réalisé arrêté ne s'efface pas : il alimente un résultat déjà publié.
   */
  supprimer(kind: 'realise' | 'prevu', id: string): Promise<{ deleted: true }> {
    const tenantId = this.context.requireTenantId();
    const table = kind === 'prevu' ? 'timesheet_forecast' : 'timesheet';
    return runInTenant(this.dataSource, tenantId, async (em) => {
      if (kind === 'realise') {
        const ligne = (await em.query(`SELECT imputed_at FROM timesheet WHERE id = $1`, [id]))[0];
        if (!ligne) throw new NotFoundException('Créneau introuvable');
        if (ligne.imputed_at) {
          throw new ConflictException(
            'Ce créneau est arrêté : ses heures alimentent déjà le résultat du chantier.',
          );
        }
      }
      const rows = returningRows<{ id: string }>(
        await em.query(`DELETE FROM ${table} WHERE id = $1 RETURNING id`, [id]),
      );
      if (rows.length === 0) throw new NotFoundException('Créneau introuvable');
      return { deleted: true as const };
    });
  }

  /**
   * Déplace un créneau : nouveau jour, et éventuellement nouvel horaire.
   *
   * C'est le geste du glisser-déposer. Un créneau réalisé et ARRÊTÉ ne bouge pas : ses heures
   * alimentent un résultat déjà publié.
   */
  deplacer(
    kind: 'realise' | 'prevu',
    id: string,
    cible: {
      date?: string; debut?: string | null; fin?: string | null;
      heures?: string | number | null; chantierId?: string | null;
    },
  ) {
    const tenantId = this.context.requireTenantId();
    if (cible.date && !ISO.test(cible.date)) {
      throw new BadRequestException('Date attendue au format AAAA-MM-JJ.');
    }
    // Horaire non mentionné = horaire inchangé. Le confondre avec « pas d'horaire » effacerait le
    // créneau 8 h–12 h d'une intervention simplement parce qu'on l'a fait glisser d'un jour.
    const horaireTouche = cible.debut !== undefined || cible.fin !== undefined;
    const creneauDemande = horaireTouche ? normaliserCreneau(cible.debut, cible.fin) : null;
    const table = kind === 'prevu' ? 'timesheet_forecast' : 'timesheet';

    return runInTenant(this.dataSource, tenantId, async (em) => {
      const ligne = (
        await em.query(
          `SELECT *, work_date::text AS work_date FROM ${table} WHERE id = $1`,
          [id],
        )
      )[0] as Record<string, unknown> | undefined;
      if (!ligne) throw new NotFoundException('Créneau introuvable');
      if (kind === 'realise' && ligne.imputed_at) {
        throw new ConflictException(
          'Ce créneau est arrêté : ses heures alimentent déjà le résultat du chantier.',
        );
      }

      const date = cible.date ?? (ligne.work_date as string);
      const creneau = horaireTouche
        ? creneauDemande
        : normaliserCreneau(
          ligne.start_time ? String(ligne.start_time).slice(0, 5) : null,
          ligne.end_time ? String(ligne.end_time).slice(0, 5) : null,
        );
      // Un créneau donné fixe la durée ; sinon on prend les heures demandées, sinon celles en place.
      const heures = creneau
        ? dureeDuCreneau(creneau)
        : new Decimal(cible.heures ?? String(ligne.hours));
      if (heures.isNegative()) {
        throw new BadRequestException('Les heures ne peuvent pas être négatives.');
      }

      // Changer de chantier depuis le calendrier : « finalement, il était sur l'autre chantier ».
      let chantierId = ligne.chantier_id as string;
      if (cible.chantierId && cible.chantierId !== chantierId) {
        const cibleChantier = await em.query(
          `SELECT id FROM chantier WHERE id = $1 AND deleted_at IS NULL`, [cible.chantierId],
        );
        if (cibleChantier.length === 0) throw new NotFoundException('Chantier introuvable');
        chantierId = cible.chantierId;
      }

      if (kind === 'prevu') {
        // Le prévisionnel est unique par salarié et par jour : déposer sur un jour déjà planifié
        // remplace la valeur plutôt que d'échouer sur une contrainte.
        await em.query(
          `DELETE FROM timesheet_forecast
            WHERE chantier_id = $1 AND employee_id = $2 AND work_date = $3 AND id <> $4`,
          [chantierId, ligne.employee_id, date, id],
        );
        await em.query(
          `UPDATE timesheet_forecast
              SET work_date = $2, hours = $3, start_time = $4, end_time = $5,
                  chantier_id = $6, updated_at = now()
            WHERE id = $1`,
          [id, date, heures.toString(), creneau?.debut ?? null, creneau?.fin ?? null, chantierId],
        );
      } else {
        const cout = heures.times(String(ligne.hourly_cost)).toDecimalPlaces(2);
        // Changer de chantier détache la ligne de l'ouvrage d'origine : il appartient à l'autre
        // chantier, et la garder pointerait des heures sur une prestation étrangère.
        const detacheOuvrage = chantierId !== ligne.chantier_id;
        await em.query(
          `UPDATE timesheet
              SET work_date = $2, hours = $3, cost = $4, start_time = $5, end_time = $6,
                  chantier_id = $7,
                  execution_line_id = CASE WHEN $8 THEN NULL ELSE execution_line_id END,
                  updated_at = now()
            WHERE id = $1`,
          [id, date, heures.toString(), cout.toString(), creneau?.debut ?? null,
            creneau?.fin ?? null, chantierId, detacheOuvrage],
        );
      }
      return {
        id, kind, date, chantierId, heures: heures.toString(),
        debut: creneau?.debut ?? null, fin: creneau?.fin ?? null,
      };
    });
  }

}

function joursEntre(debut: string, fin: string): string[] {
  const jours: string[] = [];
  const d = new Date(`${debut}T00:00:00Z`);
  const f = new Date(`${fin}T00:00:00Z`);
  for (let c = d; c <= f; c.setUTCDate(c.getUTCDate() + 1)) jours.push(c.toISOString().slice(0, 10));
  return jours;
}

function bornes(debut: string, fin: string): { debut: string; fin: string } {
  if (!ISO.test(debut ?? '') || !ISO.test(fin ?? '')) {
    throw new BadRequestException('Période attendue au format AAAA-MM-JJ.');
  }
  if (debut > fin) throw new BadRequestException('La date de début doit précéder la date de fin.');
  if (joursEntre(debut, fin).length > 62) {
    throw new BadRequestException('Période trop longue : deux mois au maximum.');
  }
  return { debut, fin };
}

/**
 * Deux séries de créneaux se marchent-elles dessus ?
 *
 * Sans horaires des deux côtés, on ne peut rien départager : on considère alors qu'il y a
 * collision — mieux vaut une question posée qu'une journée comptée deux fois.
 */
function seChevauchent(
  a: Array<{ debut?: string | null; fin?: string | null }>,
  b: Array<{ debut?: string | null; fin?: string | null }>,
): boolean {
  const horodates = [...a, ...b].every((c) => c.debut && c.fin);
  if (!horodates) return true;
  return a.some((x) => b.some((y) => x.debut! < y.fin! && y.debut! < x.fin!));
}

/** Toutes les paires distinctes d'une liste — pour comparer les créneaux deux à deux. */
function paires<T>(liste: T[]): Array<[T, T]> {
  const out: Array<[T, T]> = [];
  for (let i = 0; i < liste.length; i += 1) {
    for (let j = i + 1; j < liste.length; j += 1) out.push([liste[i], liste[j]]);
  }
  return out;
}

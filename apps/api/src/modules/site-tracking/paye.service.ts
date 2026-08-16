import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import Decimal from 'decimal.js';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { runInTenant } from '../../core/tenancy/tenant-transaction';

export type TypeRubrique = 'panier' | 'deplacement' | 'prime' | 'heures_sup' | 'autre';

export interface RubriqueInput {
  code: string;
  label: string;
  type: TypeRubrique;
  unite?: 'jour' | 'heure' | 'forfait';
  montantUnitaire?: string | number;
  seuilDebut?: string | number | null;
  seuilFin?: string | number | null;
  majoration?: string | number | null;
  actif?: boolean;
}

export interface LigneManuelleInput {
  rubriqueId: string;
  quantite: string | number;
  montantUnitaire?: string | number | null;
  chantierId?: string | null;
  commentaire?: string | null;
}

const MOIS = /^\d{4}-\d{2}$/;

/** Rubriques posées par le calcul ; les autres types se saisissent à la main, toujours. */
const AUTO_PAR_JOUR: TypeRubrique[] = ['panier', 'deplacement'];

/**
 * Éléments variables de paye — rubriques, calcul du mois, relevé signable.
 *
 * Les heures pointées ne paient pas un ouvrier : s'y ajoutent paniers, déplacements, primes et
 * majorations d'heures supplémentaires. Ces éléments se RECALCULENT depuis les pointages, mais
 * doivent rester corrigeables : un chantier ne tient pas toujours dans une règle. Le calcul
 * n'écrase donc jamais une ligne saisie à la main — il ne remplace que ce qu'il a posé lui-même.
 *
 * Le relevé mensuel est le document que le salarié signe. Une fois signé, le mois est figé :
 * ni recalcul, ni retouche. Rouvrir est possible, mais c'est un geste d'administrateur, tracé
 * par le retour au statut brouillon — on ne modifie pas en douce un document signé.
 */
@Injectable()
export class PayeService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly context: TenantContext,
  ) {}

  /* ─────────── paramétrage des rubriques ─────────── */

  listerRubriques(toutes = false) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, (em) =>
      em.query(
        `SELECT * FROM payroll_rubrique
          ${toutes ? '' : 'WHERE actif = true'}
          ORDER BY sort_order, code`,
      ),
    );
  }

  creerRubrique(input: RubriqueInput) {
    const tenantId = this.context.requireTenantId();
    const code = (input.code ?? '').trim().toUpperCase();
    if (!code) throw new BadRequestException('Le code de la rubrique est requis.');
    if (!input.label?.trim()) throw new BadRequestException('Le libellé est requis.');
    this.verifierTranche(input);

    return runInTenant(this.dataSource, tenantId, async (em) => {
      const rang = Number(
        (await em.query(`SELECT COALESCE(MAX(sort_order), 0) AS m FROM payroll_rubrique`))[0]?.m ?? 0,
      ) + 10;
      const rows = await em.query(
        `INSERT INTO payroll_rubrique
           (tenant_id, code, label, type, unite, montant_unitaire,
            seuil_debut, seuil_fin, majoration, actif, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [
          tenantId, code, input.label.trim(), input.type, input.unite ?? 'jour',
          String(input.montantUnitaire ?? 0),
          input.seuilDebut != null ? String(input.seuilDebut) : null,
          input.seuilFin != null ? String(input.seuilFin) : null,
          input.majoration != null ? String(input.majoration) : null,
          input.actif ?? true, rang,
        ],
      );
      return rows[0];
    });
  }

  modifierRubrique(id: string, patch: Partial<RubriqueInput>) {
    const tenantId = this.context.requireTenantId();
    this.verifierTranche(patch);
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const rows = await em.query(
        `UPDATE payroll_rubrique SET
           code = COALESCE($2, code),
           label = COALESCE($3, label),
           type = COALESCE($4, type),
           unite = COALESCE($5, unite),
           montant_unitaire = COALESCE($6, montant_unitaire),
           seuil_debut = CASE WHEN $7::boolean THEN $8 ELSE seuil_debut END,
           seuil_fin = CASE WHEN $9::boolean THEN $10 ELSE seuil_fin END,
           majoration = CASE WHEN $11::boolean THEN $12 ELSE majoration END,
           actif = COALESCE($13, actif),
           updated_at = now()
         WHERE id = $1 RETURNING *`,
        [
          id,
          patch.code ? patch.code.trim().toUpperCase() : null,
          patch.label?.trim() ?? null,
          patch.type ?? null,
          patch.unite ?? null,
          patch.montantUnitaire != null ? String(patch.montantUnitaire) : null,
          patch.seuilDebut !== undefined, patch.seuilDebut != null ? String(patch.seuilDebut) : null,
          patch.seuilFin !== undefined, patch.seuilFin != null ? String(patch.seuilFin) : null,
          patch.majoration !== undefined, patch.majoration != null ? String(patch.majoration) : null,
          patch.actif ?? null,
        ],
      );
      const ligne = Array.isArray(rows[0]) ? rows[0][0] : rows[0];
      if (!ligne) throw new NotFoundException('Rubrique introuvable.');
      return ligne;
    });
  }

  /**
   * Une rubrique déjà employée dans un mois ne se supprime pas : elle se désactive. Effacer
   * réécrirait des relevés passés — dont des relevés signés.
   */
  supprimerRubrique(id: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const employee = Number(
        (await em.query(`SELECT COUNT(*)::int AS n FROM payroll_line WHERE rubrique_id = $1`, [id]))[0]?.n ?? 0,
      );
      if (employee > 0) {
        await em.query(`UPDATE payroll_rubrique SET actif = false, updated_at = now() WHERE id = $1`, [id]);
        return { supprimee: false, desactivee: true };
      }
      await em.query(`DELETE FROM payroll_rubrique WHERE id = $1`, [id]);
      return { supprimee: true, desactivee: false };
    });
  }

  /* ─────────── relevé mensuel ─────────── */

  /** Le relevé d'un salarié pour un mois : en-tête, heures par chantier, absences, rubriques. */
  releve(employeeId: string, mois: string) {
    const tenantId = this.context.requireTenantId();
    const debut = this.premierJour(mois);
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const salarie = (await em.query(
        `SELECT id, code, first_name, last_name, job_title, hourly_cost, contract_type
           FROM employee WHERE id = $1`, [employeeId],
      ))[0];
      if (!salarie) throw new NotFoundException('Salarié introuvable.');

      const entete = await this.enteteOuBrouillon(em, tenantId, employeeId, debut);

      const heuresParChantier = await em.query(
        `SELECT c.id AS chantier_id, c.code AS chantier_code, c.name AS chantier_nom,
                c.color AS chantier_couleur,
                SUM(t.hours)::numeric(10,2) AS heures,
                COUNT(DISTINCT t.work_date)::int AS jours,
                SUM(t.cost)::numeric(16,2) AS cout
           FROM timesheet t
           JOIN chantier c ON c.id = t.chantier_id
          WHERE t.employee_id = $1
            AND t.work_date >= $2::date AND t.work_date < ($2::date + INTERVAL '1 month')
          GROUP BY c.id, c.code, c.name, c.color
          ORDER BY SUM(t.hours) DESC`,
        [employeeId, debut],
      );

      const absences = await em.query(
        `SELECT kind, SUM(hours)::numeric(10,2) AS heures, COUNT(*)::int AS jours
           FROM absence
          WHERE employee_id = $1
            AND work_date >= $2::date AND work_date < ($2::date + INTERVAL '1 month')
          GROUP BY kind ORDER BY kind`,
        [employeeId, debut],
      );

      const lignes = await em.query(
        `SELECT l.id, l.rubrique_id, r.code, r.label, r.type, r.unite,
                l.quantite, l.montant_unitaire, l.montant, l.origine, l.commentaire,
                l.chantier_id, c.code AS chantier_code
           FROM payroll_line l
           JOIN payroll_rubrique r ON r.id = l.rubrique_id
           LEFT JOIN chantier c ON c.id = l.chantier_id
          WHERE l.employee_id = $1 AND l.mois = $2::date
          ORDER BY r.sort_order, r.code`,
        [employeeId, debut],
      );

      return {
        salarie,
        mois: debut,
        entete,
        heuresParChantier,
        absences,
        lignes,
        modifiable: entete.statut === 'brouillon',
      };
    });
  }

  /** Tous les relevés d'un mois : l'écran de suivi de la paye, salarié par salarié. */
  releves(mois: string) {
    const tenantId = this.context.requireTenantId();
    const debut = this.premierJour(mois);
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const lignes = await em.query(
        `SELECT e.id AS employee_id, e.code, e.first_name, e.last_name, e.contract_type,
                COALESCE(r.statut, 'brouillon') AS statut,
                COALESCE(r.heures_travaillees, 0)::numeric(10,2) AS heures_travaillees,
                COALESCE(r.jours_travailles, 0)::numeric(10,2) AS jours_travailles,
                COALESCE(r.heures_absence, 0)::numeric(10,2) AS heures_absence,
                COALESCE(r.montant_rubriques, 0)::numeric(16,2) AS montant_rubriques,
                r.calcule_le, r.signe_le, r.signe_par,
                -- Ce qui est pointé aujourd'hui, pour repérer un relevé calculé puis dépassé.
                COALESCE((SELECT SUM(t.hours) FROM timesheet t
                           WHERE t.employee_id = e.id
                             AND t.work_date >= $1::date
                             AND t.work_date < ($1::date + INTERVAL '1 month')), 0)::numeric(10,2)
                  AS heures_pointees
           FROM employee e
           LEFT JOIN payroll_releve r ON r.employee_id = e.id AND r.mois = $1::date
          WHERE e.active = true AND e.deleted_at IS NULL
          ORDER BY e.last_name, e.first_name`,
        [debut],
      );
      const total = lignes.reduce(
        (s: Decimal, l: Record<string, unknown>) => s.plus(String(l.montant_rubriques ?? 0)),
        new Decimal(0),
      );
      return {
        mois: debut,
        lignes,
        totalRubriques: total.toFixed(2),
        aCalculer: lignes.filter((l: Record<string, unknown>) =>
          Number(l.heures_pointees ?? 0) > 0 && !l.calcule_le).length,
      };
    });
  }

  /**
   * Recalcule les éléments AUTOMATIQUES du mois. Les lignes saisies à la main survivent : le
   * calcul ne supprime que ce qu'il a posé.
   */
  async calculer(employeeId: string, mois: string) {
    const tenantId = this.context.requireTenantId();
    const debut = this.premierJour(mois);
    // La relecture se fait APRÈS la transaction : ouvrir un second `runInTenant` sans avoir
    // refermé le premier prend une deuxième connexion du pool et attend la première — la requête
    // se figeait sans erreur, ce qui est le pire des symptômes.
    await runInTenant(this.dataSource, tenantId, async (em) => {
      const entete = await this.enteteOuBrouillon(em, tenantId, employeeId, debut);
      if (entete.statut !== 'brouillon') {
        throw new ConflictException(
          'Ce relevé est validé ou signé : rouvrez-le avant de le recalculer.',
        );
      }
      const salarie = (await em.query(`SELECT hourly_cost FROM employee WHERE id = $1`, [employeeId]))[0];
      if (!salarie) throw new NotFoundException('Salarié introuvable.');

      await em.query(
        `DELETE FROM payroll_line WHERE employee_id = $1 AND mois = $2::date AND origine = 'auto'`,
        [employeeId, debut],
      );

      const rubriques = await em.query(
        `SELECT * FROM payroll_rubrique WHERE actif = true ORDER BY sort_order, code`,
      );

      // Jours travaillés : un jour compte dès qu'une heure y est pointée, quel que soit le chantier.
      const jours = Number((await em.query(
        `SELECT COUNT(DISTINCT work_date)::int AS n FROM timesheet
          WHERE employee_id = $1 AND hours > 0
            AND work_date >= $2::date AND work_date < ($2::date + INTERVAL '1 month')`,
        [employeeId, debut],
      ))[0]?.n ?? 0);

      const heuresSupParSemaine = await this.heuresSupParSemaine(em, employeeId, debut);

      for (const r of rubriques) {
        if (AUTO_PAR_JOUR.includes(r.type) && jours > 0) {
          await this.poserLigne(em, tenantId, employeeId, debut, r.id, jours, r.montant_unitaire, 'auto');
        }
        if (r.type === 'heures_sup') {
          const heures = this.heuresDansLaTranche(heuresSupParSemaine, r);
          if (heures.greaterThan(0)) {
            // Majoration : sur le coût horaire du salarié si elle est paramétrée, sinon le
            // montant unitaire de la rubrique fait foi.
            const pu = r.majoration != null
              ? new Decimal(String(salarie.hourly_cost)).times(String(r.majoration))
              : new Decimal(String(r.montant_unitaire));
            await this.poserLigne(
              em, tenantId, employeeId, debut, r.id, heures.toNumber(), pu.toFixed(4), 'auto',
            );
          }
        }
      }

      await this.rafraichirEntete(em, employeeId, debut, true);
    });
    return this.releve(employeeId, mois);
  }

  /* ─────────── lignes saisies à la main ─────────── */

  ajouterLigne(employeeId: string, mois: string, input: LigneManuelleInput) {
    const tenantId = this.context.requireTenantId();
    const debut = this.premierJour(mois);
    return runInTenant(this.dataSource, tenantId, async (em) => {
      await this.assertModifiable(em, tenantId, employeeId, debut);
      const rubrique = (await em.query(
        `SELECT id, montant_unitaire FROM payroll_rubrique WHERE id = $1`, [input.rubriqueId],
      ))[0];
      if (!rubrique) throw new NotFoundException('Rubrique introuvable.');

      const pu = input.montantUnitaire != null
        ? String(input.montantUnitaire) : String(rubrique.montant_unitaire);
      const ligne = await this.poserLigne(
        em, tenantId, employeeId, debut, rubrique.id, Number(input.quantite), pu, 'manuel',
        input.chantierId ?? null, input.commentaire ?? null,
      );
      await this.rafraichirEntete(em, employeeId, debut, false);
      return ligne;
    });
  }

  modifierLigne(ligneId: string, patch: Partial<LigneManuelleInput>) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const existante = (await em.query(
        `SELECT employee_id, mois FROM payroll_line WHERE id = $1`, [ligneId],
      ))[0];
      if (!existante) throw new NotFoundException('Ligne introuvable.');
      await this.assertModifiable(em, tenantId, existante.employee_id, existante.mois);

      const rows = await em.query(
        `UPDATE payroll_line SET
           quantite = COALESCE($2, quantite),
           montant_unitaire = COALESCE($3, montant_unitaire),
           chantier_id = CASE WHEN $4::boolean THEN $5 ELSE chantier_id END,
           commentaire = CASE WHEN $6::boolean THEN $7 ELSE commentaire END,
           -- Une ligne retouchée devient manuelle : le prochain calcul ne doit pas l'effacer.
           origine = 'manuel',
           updated_at = now()
         WHERE id = $1 RETURNING *`,
        [
          ligneId,
          patch.quantite != null ? String(patch.quantite) : null,
          patch.montantUnitaire != null ? String(patch.montantUnitaire) : null,
          patch.chantierId !== undefined, patch.chantierId ?? null,
          patch.commentaire !== undefined, patch.commentaire ?? null,
        ],
      );
      const ligne = Array.isArray(rows[0]) ? rows[0][0] : rows[0];
      await em.query(
        `UPDATE payroll_line SET montant = ROUND(quantite * montant_unitaire, 2) WHERE id = $1`,
        [ligneId],
      );
      await this.rafraichirEntete(em, existante.employee_id, existante.mois, false);
      return ligne;
    });
  }

  supprimerLigne(ligneId: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const existante = (await em.query(
        `SELECT employee_id, mois FROM payroll_line WHERE id = $1`, [ligneId],
      ))[0];
      if (!existante) throw new NotFoundException('Ligne introuvable.');
      await this.assertModifiable(em, tenantId, existante.employee_id, existante.mois);
      await em.query(`DELETE FROM payroll_line WHERE id = $1`, [ligneId]);
      await this.rafraichirEntete(em, existante.employee_id, existante.mois, false);
      return { supprimee: true };
    });
  }

  /* ─────────── validation et signature ─────────── */

  async valider(employeeId: string, mois: string) {
    const tenantId = this.context.requireTenantId();
    const debut = this.premierJour(mois);
    const userId = this.context.getUserId() ?? null;
    await runInTenant(this.dataSource, tenantId, async (em) => {
      const entete = await this.enteteOuBrouillon(em, tenantId, employeeId, debut);
      if (entete.statut === 'signe') {
        throw new ConflictException('Ce relevé est signé : il ne peut plus être modifié.');
      }
      await this.rafraichirEntete(em, employeeId, debut, false);
      await em.query(
        `UPDATE payroll_releve SET statut = 'valide', valide_le = now(), valide_par = $3,
                                   updated_at = now()
          WHERE employee_id = $1 AND mois = $2::date`,
        [employeeId, debut, userId],
      );
    });
    return this.releve(employeeId, mois);
  }

  /**
   * Signature du relevé. Le nom porté sur le document est celui qui signe — comme sur le papier.
   * Un relevé se signe APRÈS validation : on n'atteste pas un document que personne n'a arrêté.
   */
  async signer(employeeId: string, mois: string, nom: string) {
    const tenantId = this.context.requireTenantId();
    const debut = this.premierJour(mois);
    if (!nom?.trim()) throw new BadRequestException('Le nom du signataire est requis.');
    await runInTenant(this.dataSource, tenantId, async (em) => {
      const entete = await this.enteteOuBrouillon(em, tenantId, employeeId, debut);
      if (entete.statut === 'brouillon') {
        throw new ConflictException('Validez le relevé avant de le faire signer.');
      }
      if (entete.statut === 'signe') {
        throw new ConflictException('Ce relevé est déjà signé.');
      }
      await em.query(
        `UPDATE payroll_releve SET statut = 'signe', signe_le = now(), signe_par = $3,
                                   updated_at = now()
          WHERE employee_id = $1 AND mois = $2::date`,
        [employeeId, debut, nom.trim()],
      );
    });
    return this.releve(employeeId, mois);
  }

  /** Réouverture — geste d'administrateur : un relevé signé ne se retouche pas en silence. */
  rouvrir(employeeId: string, mois: string, motif?: string | null) {
    const tenantId = this.context.requireTenantId();
    const debut = this.premierJour(mois);
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const rows = await em.query(
        `UPDATE payroll_releve
            SET statut = 'brouillon', signe_le = NULL, signe_par = NULL,
                valide_le = NULL, valide_par = NULL,
                commentaire = COALESCE($3, commentaire), updated_at = now()
          WHERE employee_id = $1 AND mois = $2::date
          RETURNING *`,
        [employeeId, debut, motif ?? null],
      );
      const entete = Array.isArray(rows[0]) ? rows[0][0] : rows[0];
      if (!entete) throw new NotFoundException('Aucun relevé pour ce mois.');
      return entete;
    });
  }

  /* ─────────── export ─────────── */

  /**
   * Export du mois pour la paye : une ligne par salarié et par rubrique, plus les heures.
   * Format CSV, séparateur point-virgule et virgule décimale — ce qu'attend un tableur français.
   */
  async exportCsv(mois: string): Promise<string> {
    const tenantId = this.context.requireTenantId();
    const debut = this.premierJour(mois);
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const lignes = await em.query(
        `SELECT e.code AS matricule, e.last_name, e.first_name, e.contract_type,
                COALESCE(r.statut, 'brouillon') AS statut,
                rb.code AS rubrique, rb.label AS rubrique_label, rb.unite,
                l.quantite, l.montant_unitaire, l.montant
           FROM payroll_line l
           JOIN employee e ON e.id = l.employee_id
           JOIN payroll_rubrique rb ON rb.id = l.rubrique_id
           LEFT JOIN payroll_releve r ON r.employee_id = l.employee_id AND r.mois = l.mois
          WHERE l.mois = $1::date
          ORDER BY e.last_name, e.first_name, rb.sort_order, rb.code`,
        [debut],
      );
      const heures = await em.query(
        `SELECT e.code AS matricule, e.last_name, e.first_name,
                SUM(t.hours)::numeric(10,2) AS heures,
                COUNT(DISTINCT t.work_date)::int AS jours
           FROM timesheet t JOIN employee e ON e.id = t.employee_id
          WHERE t.work_date >= $1::date AND t.work_date < ($1::date + INTERVAL '1 month')
          GROUP BY e.code, e.last_name, e.first_name
          ORDER BY e.last_name, e.first_name`,
        [debut],
      );

      const nb = (v: unknown) => String(v ?? '0').replace('.', ',');
      const champ = (v: unknown) => {
        const s = String(v ?? '');
        return s.includes(';') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const out: string[] = [
        'Matricule;Nom;Prénom;Contrat;Mois;Type;Code;Libellé;Unité;Quantité;PU;Montant;Statut',
      ];
      for (const h of heures) {
        out.push([
          champ(h.matricule), champ(h.last_name), champ(h.first_name), '', mois,
          'HEURES', 'H', 'Heures travaillées', 'heure', nb(h.heures), '', '', '',
        ].join(';'));
        out.push([
          champ(h.matricule), champ(h.last_name), champ(h.first_name), '', mois,
          'HEURES', 'J', 'Jours travaillés', 'jour', nb(h.jours), '', '', '',
        ].join(';'));
      }
      for (const l of lignes) {
        out.push([
          champ(l.matricule), champ(l.last_name), champ(l.first_name), champ(l.contract_type), mois,
          'RUBRIQUE', champ(l.rubrique), champ(l.rubrique_label), champ(l.unite),
          nb(l.quantite), nb(l.montant_unitaire), nb(l.montant), champ(l.statut),
        ].join(';'));
      }
      // BOM : sans lui, Excel lit les accents de travers.
      return `\uFEFF${out.join('\r\n')}\r\n`;
    });
  }

  /* ─────────── interne ─────────── */

  private verifierTranche(input: Partial<RubriqueInput>): void {
    if (input.seuilDebut != null && input.seuilFin != null
      && Number(input.seuilFin) <= Number(input.seuilDebut)) {
      throw new BadRequestException('La fin de tranche doit dépasser son début.');
    }
  }

  private premierJour(mois: string): string {
    if (!MOIS.test(mois ?? '')) {
      throw new BadRequestException('Mois attendu au format AAAA-MM.');
    }
    return `${mois}-01`;
  }

  /** L'en-tête existe dès qu'on regarde le mois : un relevé absent est un relevé brouillon. */
  private async enteteOuBrouillon(
    em: EntityManager, tenantId: string, employeeId: string, debut: string,
  ) {
    const existant = (await em.query(
      `SELECT * FROM payroll_releve WHERE employee_id = $1 AND mois = $2::date`,
      [employeeId, debut],
    ))[0];
    if (existant) return existant;
    const rows = await em.query(
      `INSERT INTO payroll_releve (tenant_id, employee_id, mois) VALUES ($1,$2,$3::date)
       RETURNING *`,
      [tenantId, employeeId, debut],
    );
    return rows[0];
  }

  private async assertModifiable(
    em: EntityManager, tenantId: string, employeeId: string, debut: string,
  ): Promise<void> {
    const entete = await this.enteteOuBrouillon(em, tenantId, employeeId, debut);
    if (entete.statut !== 'brouillon') {
      throw new ConflictException(
        entete.statut === 'signe'
          ? 'Ce relevé est signé : il ne peut plus être modifié.'
          : 'Ce relevé est validé : rouvrez-le pour le modifier.',
      );
    }
  }

  private async poserLigne(
    em: EntityManager, tenantId: string, employeeId: string, debut: string,
    rubriqueId: string, quantite: number, montantUnitaire: string,
    origine: 'auto' | 'manuel', chantierId: string | null = null, commentaire: string | null = null,
  ) {
    const montant = new Decimal(quantite).times(montantUnitaire).toFixed(2);
    const rows = await em.query(
      `INSERT INTO payroll_line
         (tenant_id, employee_id, mois, rubrique_id, chantier_id, quantite,
          montant_unitaire, montant, origine, commentaire)
       VALUES ($1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        tenantId, employeeId, debut, rubriqueId, chantierId, String(quantite),
        montantUnitaire, montant, origine, commentaire,
      ],
    );
    return rows[0];
  }

  /**
   * Heures au-delà du seuil, SEMAINE par semaine — c'est la règle des heures supplémentaires,
   * jamais un total mensuel. Une semaine à cheval sur deux mois compte ses heures entières pour
   * juger du dépassement, mais n'en attribue au mois que la part qui y a été travaillée : sinon
   * un lundi de fin de mois ferait basculer tout le dépassement du mois suivant.
   */
  private async heuresSupParSemaine(
    em: EntityManager, employeeId: string, debut: string,
  ): Promise<Array<{ heures: Decimal; partDuMois: Decimal }>> {
    const semaines = await em.query(
      `WITH semaine AS (
         SELECT date_trunc('week', t.work_date)::date AS lundi,
                SUM(t.hours)::numeric(10,2) AS heures,
                SUM(CASE WHEN t.work_date >= $2::date
                          AND t.work_date < ($2::date + INTERVAL '1 month')
                         THEN t.hours ELSE 0 END)::numeric(10,2) AS heures_du_mois
           FROM timesheet t
          WHERE t.employee_id = $1
            AND t.work_date >= (date_trunc('week', $2::date))::date
            AND t.work_date < (date_trunc('week', ($2::date + INTERVAL '1 month')) + INTERVAL '7 days')::date
          GROUP BY 1
       )
       SELECT lundi, heures, heures_du_mois FROM semaine WHERE heures_du_mois > 0 ORDER BY lundi`,
      [employeeId, debut],
    );
    return semaines.map((s: Record<string, unknown>) => {
      const heures = new Decimal(String(s.heures ?? 0));
      const duMois = new Decimal(String(s.heures_du_mois ?? 0));
      return {
        heures,
        partDuMois: heures.isZero() ? new Decimal(0) : duMois.div(heures),
      };
    });
  }

  private heuresDansLaTranche(
    semaines: Array<{ heures: Decimal; partDuMois: Decimal }>,
    rubrique: Record<string, unknown>,
  ): Decimal {
    const debut = new Decimal(String(rubrique.seuil_debut ?? 0));
    const fin = rubrique.seuil_fin != null ? new Decimal(String(rubrique.seuil_fin)) : null;
    let total = new Decimal(0);
    for (const s of semaines) {
      const plafond = fin && s.heures.greaterThan(fin) ? fin : s.heures;
      const dansLaTranche = plafond.minus(debut);
      if (dansLaTranche.greaterThan(0)) {
        total = total.plus(dansLaTranche.times(s.partDuMois));
      }
    }
    return new Decimal(total.toFixed(2));
  }

  /** Recale les totaux de l'en-tête sur ce que portent réellement pointages, absences et lignes. */
  private async rafraichirEntete(
    em: EntityManager, employeeId: string, debut: string, marquerCalcule: boolean,
  ): Promise<void> {
    await em.query(
      `UPDATE payroll_releve r SET
         heures_travaillees = COALESCE((
           SELECT SUM(t.hours) FROM timesheet t
            WHERE t.employee_id = r.employee_id
              AND t.work_date >= r.mois AND t.work_date < (r.mois + INTERVAL '1 month')), 0),
         jours_travailles = COALESCE((
           SELECT COUNT(DISTINCT t.work_date) FROM timesheet t
            WHERE t.employee_id = r.employee_id AND t.hours > 0
              AND t.work_date >= r.mois AND t.work_date < (r.mois + INTERVAL '1 month')), 0),
         heures_absence = COALESCE((
           SELECT SUM(a.hours) FROM absence a
            WHERE a.employee_id = r.employee_id
              AND a.work_date >= r.mois AND a.work_date < (r.mois + INTERVAL '1 month')), 0),
         montant_rubriques = COALESCE((
           SELECT SUM(l.montant) FROM payroll_line l
            WHERE l.employee_id = r.employee_id AND l.mois = r.mois), 0),
         calcule_le = CASE WHEN $3::boolean THEN now() ELSE r.calcule_le END,
         updated_at = now()
       WHERE r.employee_id = $1 AND r.mois = $2::date`,
      [employeeId, debut, marquerCalcule],
    );
  }
}

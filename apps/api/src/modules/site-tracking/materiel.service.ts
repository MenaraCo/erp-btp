import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import Decimal from 'decimal.js';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { runInTenant } from '../../core/tenancy/tenant-transaction';
import { NumberingService } from '../../core/numbering/numbering.service';

export type TypeMateriel = 'engin' | 'vehicule' | 'outillage' | 'autre';
export type Propriete = 'parc' | 'location';

export interface MaterielInput {
  label?: string;
  type?: TypeMateriel;
  propriete?: Propriete;
  supplierId?: string | null;
  marque?: string | null;
  modele?: string | null;
  immatriculation?: string | null;
  numeroSerie?: string | null;
  annee?: number | null;
  coutUnitaire?: string | number;
  uniteCout?: 'heure' | 'jour';
  codeAnalytiqueId?: string | null;
  dateAchat?: string | null;
  valeurAchat?: string | number | null;
  dateProchaineRevision?: string | null;
  dateControleTechnique?: string | null;
  dateAssurance?: string | null;
  actif?: boolean;
  commentaire?: string | null;
}

export interface AffectationInput {
  chantierId: string;
  dateDebut: string;
  dateFin: string;
  commentaire?: string | null;
}

export interface UtilisationInput {
  chantierId: string;
  date: string;
  quantite: string | number;
  coutUnitaire?: string | number | null;
  executionLineId?: string | null;
  codeAnalytiqueId?: string | null;
  commentaire?: string | null;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const TYPES: TypeMateriel[] = ['engin', 'vehicule', 'outillage', 'autre'];

/**
 * Parc matériel — fiches, affectation aux chantiers, utilisation réelle.
 *
 * Le matériel coûte au chantier ce qu'il y SERT, pas ce qu'il a coûté à l'achat : la fiche porte
 * donc un coût d'utilisation (à l'heure ou à la journée) et le relevé l'applique. Une pelle
 * immobilisée trois semaines sur un chantier sans y travailler ne doit pas lui être facturée.
 *
 * Deux temps, comme pour la main-d'œuvre : l'affectation réserve (engagé), le relevé constate
 * (réalisé). Et un engin ne peut pas être à deux endroits le même jour — le conflit se signale au
 * lieu de se découvrir sur le terrain, camion parti.
 */
@Injectable()
export class MaterielService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly context: TenantContext,
    private readonly numbering: NumberingService,
  ) {}

  /* ─────────── fiches ─────────── */

  liste(inclureInactifs = false) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, (em) =>
      em.query(
        `SELECT e.*, e.date_achat::text AS date_achat,
                e.date_prochaine_revision::text AS date_prochaine_revision,
                e.date_controle_technique::text AS date_controle_technique,
                e.date_assurance::text AS date_assurance,
                s.name AS fournisseur, ac.code AS code_analytique,
                -- Affectation en cours : la question qu'on se pose devant une liste de matériel,
                -- c'est « où est-il en ce moment ? ».
                (SELECT c.code FROM equipment_assignment a
                   JOIN chantier c ON c.id = a.chantier_id
                  WHERE a.equipment_id = e.id
                    AND CURRENT_DATE BETWEEN a.date_debut AND a.date_fin
                  ORDER BY a.date_debut DESC LIMIT 1) AS chantier_actuel
           FROM equipment e
           LEFT JOIN supplier s ON s.id = e.supplier_id
           LEFT JOIN analytical_code ac ON ac.id = e.code_analytique_id
          WHERE e.deleted_at IS NULL ${inclureInactifs ? '' : 'AND e.actif = true'}
          ORDER BY e.code`,
      ),
    );
  }

  creer(input: MaterielInput) {
    const tenantId = this.context.requireTenantId();
    const label = (input.label ?? '').trim();
    if (!label) throw new BadRequestException('La désignation du matériel est requise.');
    this.verifierType(input.type);
    const cout = new Decimal(input.coutUnitaire ?? 0);
    if (cout.isNegative()) throw new BadRequestException('Le coût d’utilisation ne peut pas être négatif.');

    return runInTenant(this.dataSource, tenantId, async (em) => {
      const code = await this.numbering.next(em, 'equipment');
      const rows = await em.query(
        `INSERT INTO equipment
           (tenant_id, code, label, type, propriete, supplier_id, marque, modele,
            immatriculation, numero_serie, annee, cout_unitaire, unite_cout, code_analytique_id,
            date_achat, valeur_achat, date_prochaine_revision, date_controle_technique,
            date_assurance, actif, commentaire)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
                 $15::date,$16,$17::date,$18::date,$19::date,$20,$21)
         RETURNING *, date_achat::text AS date_achat,
                   date_prochaine_revision::text AS date_prochaine_revision,
                   date_controle_technique::text AS date_controle_technique,
                   date_assurance::text AS date_assurance`,
        [
          tenantId, code, label, input.type ?? 'engin', input.propriete ?? 'parc',
          input.supplierId ?? null, texte(input.marque), texte(input.modele),
          texte(input.immatriculation), texte(input.numeroSerie), input.annee ?? null,
          cout.toFixed(4), input.uniteCout ?? 'jour', input.codeAnalytiqueId ?? null,
          input.dateAchat ?? null, input.valeurAchat ?? null,
          input.dateProchaineRevision ?? null, input.dateControleTechnique ?? null,
          input.dateAssurance ?? null, input.actif ?? true, texte(input.commentaire),
        ],
      );
      return rows[0];
    });
  }

  modifier(id: string, patch: MaterielInput) {
    const tenantId = this.context.requireTenantId();
    this.verifierType(patch.type);
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const actuel = (await em.query(
        `SELECT * FROM equipment WHERE id = $1 AND deleted_at IS NULL`, [id],
      ))[0];
      if (!actuel) throw new NotFoundException('Matériel introuvable.');

      const rows = await em.query(
        `UPDATE equipment SET
           label = COALESCE($2, label),
           type = COALESCE($3, type),
           propriete = COALESCE($4, propriete),
           supplier_id = CASE WHEN $5::boolean THEN $6 ELSE supplier_id END,
           marque = COALESCE($7, marque),
           modele = COALESCE($8, modele),
           immatriculation = COALESCE($9, immatriculation),
           numero_serie = COALESCE($10, numero_serie),
           annee = COALESCE($11, annee),
           cout_unitaire = COALESCE($12, cout_unitaire),
           unite_cout = COALESCE($13, unite_cout),
           code_analytique_id = CASE WHEN $14::boolean THEN $15 ELSE code_analytique_id END,
           date_achat = CASE WHEN $16::boolean THEN $17::date ELSE date_achat END,
           valeur_achat = COALESCE($18, valeur_achat),
           date_prochaine_revision = CASE WHEN $19::boolean THEN $20::date ELSE date_prochaine_revision END,
           date_controle_technique = CASE WHEN $21::boolean THEN $22::date ELSE date_controle_technique END,
           date_assurance = CASE WHEN $23::boolean THEN $24::date ELSE date_assurance END,
           actif = COALESCE($25, actif),
           commentaire = COALESCE($26, commentaire),
           updated_at = now()
         WHERE id = $1
         RETURNING *, date_achat::text AS date_achat,
                   date_prochaine_revision::text AS date_prochaine_revision,
                   date_controle_technique::text AS date_controle_technique,
                   date_assurance::text AS date_assurance`,
        [
          id, texte(patch.label), patch.type ?? null, patch.propriete ?? null,
          patch.supplierId !== undefined, patch.supplierId ?? null,
          texte(patch.marque), texte(patch.modele), texte(patch.immatriculation),
          texte(patch.numeroSerie), patch.annee ?? null,
          patch.coutUnitaire != null ? String(patch.coutUnitaire) : null,
          patch.uniteCout ?? null,
          patch.codeAnalytiqueId !== undefined, patch.codeAnalytiqueId ?? null,
          patch.dateAchat !== undefined, patch.dateAchat ?? null,
          patch.valeurAchat ?? null,
          patch.dateProchaineRevision !== undefined, patch.dateProchaineRevision ?? null,
          patch.dateControleTechnique !== undefined, patch.dateControleTechnique ?? null,
          patch.dateAssurance !== undefined, patch.dateAssurance ?? null,
          patch.actif ?? null, texte(patch.commentaire),
        ],
      );
      return Array.isArray(rows[0]) ? rows[0][0] : rows[0];
    });
  }

  /**
   * Retire un matériel. Suppression LOGIQUE dès qu'il a servi : ses heures composent le réalisé
   * d'un chantier, les effacer fausserait un résultat déjà publié.
   */
  supprimer(id: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const utilise = Number((await em.query(
        `SELECT COUNT(*)::int AS n FROM equipment_usage WHERE equipment_id = $1`, [id],
      ))[0]?.n ?? 0);
      if (utilise > 0) {
        await em.query(`UPDATE equipment SET actif = false, updated_at = now() WHERE id = $1`, [id]);
        return { supprime: false, desactive: true };
      }
      await em.query(`UPDATE equipment SET deleted_at = now() WHERE id = $1`, [id]);
      return { supprime: true, desactive: false };
    });
  }

  /* ─────────── affectations ─────────── */

  /** Affectations d'une période, tous engins — c'est le calendrier du parc. */
  affectations(debut: string, fin: string, equipmentId?: string | null, chantierId?: string | null) {
    const tenantId = this.context.requireTenantId();
    this.verifierPeriode(debut, fin);
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const params: unknown[] = [debut, fin];
      let filtre = '';
      if (equipmentId) { params.push(equipmentId); filtre += ` AND a.equipment_id = $${params.length}`; }
      if (chantierId) { params.push(chantierId); filtre += ` AND a.chantier_id = $${params.length}`; }
      return em.query(
        `SELECT a.id, a.equipment_id, a.chantier_id,
                a.date_debut::text AS date_debut, a.date_fin::text AS date_fin, a.commentaire,
                e.code AS materiel_code, e.label AS materiel, e.unite_cout, e.cout_unitaire,
                c.code AS chantier_code, c.name AS chantier_nom, c.color AS chantier_couleur
           FROM equipment_assignment a
           JOIN equipment e ON e.id = a.equipment_id
           JOIN chantier c ON c.id = a.chantier_id
          WHERE a.date_debut <= $2::date AND a.date_fin >= $1::date ${filtre}
          ORDER BY a.date_debut, e.code`,
        params,
      );
    });
  }

  affecter(equipmentId: string, input: AffectationInput) {
    const tenantId = this.context.requireTenantId();
    this.verifierPeriode(input.dateDebut, input.dateFin);
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const materiel = (await em.query(
        `SELECT id FROM equipment WHERE id = $1 AND deleted_at IS NULL`, [equipmentId],
      ))[0];
      if (!materiel) throw new NotFoundException('Matériel introuvable.');

      // Un engin ne peut pas être sur deux chantiers le même jour : on refuse plutôt que de
      // laisser deux conducteurs compter sur la même machine.
      const conflit = (await em.query(
        `SELECT a.id, c.code AS chantier_code, a.date_debut::text AS date_debut,
                a.date_fin::text AS date_fin
           FROM equipment_assignment a JOIN chantier c ON c.id = a.chantier_id
          WHERE a.equipment_id = $1 AND a.chantier_id <> $2
            AND a.date_debut <= $4::date AND a.date_fin >= $3::date
          LIMIT 1`,
        [equipmentId, input.chantierId, input.dateDebut, input.dateFin],
      ))[0];
      if (conflit) {
        throw new BadRequestException(
          `Déjà affecté au chantier ${conflit.chantier_code} du ${conflit.date_debut} au ${conflit.date_fin}.`,
        );
      }

      const rows = await em.query(
        `INSERT INTO equipment_assignment
           (tenant_id, equipment_id, chantier_id, date_debut, date_fin, commentaire)
         VALUES ($1,$2,$3,$4::date,$5::date,$6)
         RETURNING *, date_debut::text AS date_debut, date_fin::text AS date_fin`,
        [tenantId, equipmentId, input.chantierId, input.dateDebut, input.dateFin,
          texte(input.commentaire)],
      );
      return rows[0];
    });
  }

  retirerAffectation(id: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      await em.query(`DELETE FROM equipment_assignment WHERE id = $1`, [id]);
      return { supprime: true };
    });
  }

  /* ─────────── utilisation réelle ─────────── */

  /** Relevés d'un CHANTIER : ce que le matériel y a réellement coûté, jour par jour. */
  utilisationsChantier(chantierId: string, debut?: string | null, fin?: string | null) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, (em) => {
      const params: unknown[] = [chantierId];
      let periode = '';
      if (debut && ISO.test(debut)) { params.push(debut); periode += ` AND u.work_date >= $${params.length}`; }
      if (fin && ISO.test(fin)) { params.push(fin); periode += ` AND u.work_date <= $${params.length}`; }
      return em.query(
        `SELECT u.*, u.work_date::text AS work_date,
                e.code AS materiel_code, e.label AS materiel, e.unite_cout,
                el.designation AS ouvrage_label, ac.code AS code_analytique
           FROM equipment_usage u
           JOIN equipment e ON e.id = u.equipment_id
           LEFT JOIN execution_line el ON el.id = u.execution_line_id
           LEFT JOIN analytical_code ac ON ac.id = u.code_analytique_id
          WHERE u.chantier_id = $1 ${periode}
          ORDER BY u.work_date DESC, e.code`,
        params,
      );
    });
  }

  utilisations(equipmentId: string, debut?: string | null, fin?: string | null) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, (em) => {
      const params: unknown[] = [equipmentId];
      let periode = '';
      if (debut && ISO.test(debut)) { params.push(debut); periode += ` AND u.work_date >= $${params.length}`; }
      if (fin && ISO.test(fin)) { params.push(fin); periode += ` AND u.work_date <= $${params.length}`; }
      return em.query(
        `SELECT u.*, u.work_date::text AS work_date,
                c.code AS chantier_code, ac.code AS code_analytique
           FROM equipment_usage u
           JOIN chantier c ON c.id = u.chantier_id
           LEFT JOIN analytical_code ac ON ac.id = u.code_analytique_id
          WHERE u.equipment_id = $1 ${periode}
          ORDER BY u.work_date DESC`,
        params,
      );
    });
  }

  /**
   * Relève l'usage d'un jour. Le coût vient de la fiche — c'est lui qui garantit qu'une heure de
   * pelle vaut le même prix sur tous les chantiers — mais reste forçable ligne à ligne.
   */
  releverUtilisation(equipmentId: string, input: UtilisationInput) {
    const tenantId = this.context.requireTenantId();
    if (!ISO.test(input.date ?? '')) {
      throw new BadRequestException('Date attendue au format AAAA-MM-JJ.');
    }
    const quantite = new Decimal(input.quantite ?? 0);
    if (quantite.isNegative()) throw new BadRequestException('La quantité ne peut pas être négative.');

    return runInTenant(this.dataSource, tenantId, async (em) => {
      const materiel = (await em.query(
        `SELECT cout_unitaire, code_analytique_id FROM equipment
          WHERE id = $1 AND deleted_at IS NULL`, [equipmentId],
      ))[0];
      if (!materiel) throw new NotFoundException('Matériel introuvable.');

      const cout = input.coutUnitaire != null
        ? new Decimal(input.coutUnitaire) : new Decimal(String(materiel.cout_unitaire));
      const rows = await em.query(
        `INSERT INTO equipment_usage
           (tenant_id, equipment_id, chantier_id, execution_line_id, work_date, quantite,
            cout_unitaire, cout, code_analytique_id, commentaire)
         VALUES ($1,$2,$3,$4,$5::date,$6,$7,$8,$9,$10)
         RETURNING *, work_date::text AS work_date`,
        [
          tenantId, equipmentId, input.chantierId, input.executionLineId ?? null,
          input.date, quantite.toFixed(2), cout.toFixed(4),
          quantite.times(cout).toDecimalPlaces(2).toFixed(2),
          // Sans code sur la ligne, celui de la fiche s'applique : sinon la dépense tomberait
          // hors analytique et le résultat par code serait faux.
          input.codeAnalytiqueId ?? materiel.code_analytique_id ?? null,
          texte(input.commentaire),
        ],
      );
      return rows[0];
    });
  }

  supprimerUtilisation(id: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      await em.query(`DELETE FROM equipment_usage WHERE id = $1`, [id]);
      return { supprime: true };
    });
  }

  /* ─────────── conflits et entretien ─────────── */

  /** Engins réservés à deux endroits à la fois : la liste de travail du chef de parc. */
  conflits(debut: string, fin: string) {
    const tenantId = this.context.requireTenantId();
    this.verifierPeriode(debut, fin);
    return runInTenant(this.dataSource, tenantId, (em) =>
      em.query(
        `SELECT a.equipment_id, e.code AS materiel_code, e.label AS materiel,
                a.id AS affectation_a, ca.code AS chantier_a,
                b.id AS affectation_b, cb.code AS chantier_b,
                GREATEST(a.date_debut, b.date_debut)::text AS debut,
                LEAST(a.date_fin, b.date_fin)::text AS fin
           FROM equipment_assignment a
           JOIN equipment_assignment b
             ON b.equipment_id = a.equipment_id AND b.id > a.id
            AND b.date_debut <= a.date_fin AND b.date_fin >= a.date_debut
           JOIN equipment e ON e.id = a.equipment_id
           JOIN chantier ca ON ca.id = a.chantier_id
           JOIN chantier cb ON cb.id = b.chantier_id
          WHERE a.date_debut <= $2::date AND a.date_fin >= $1::date
          ORDER BY e.code`,
        [debut, fin],
      ),
    );
  }

  /**
   * Échéances d'entretien. Une révision ou un contrôle périmé cloue l'engin au dépôt : mieux vaut
   * le savoir un mois avant que le matin où il doit partir.
   */
  echeances(joursAvant = 30) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, (em) =>
      em.query(
        `SELECT id, code, label, type,
                date_prochaine_revision::text AS date_prochaine_revision,
                date_controle_technique::text AS date_controle_technique,
                date_assurance::text AS date_assurance,
                LEAST(
                  COALESCE(date_prochaine_revision, 'infinity'::date),
                  COALESCE(date_controle_technique, 'infinity'::date),
                  COALESCE(date_assurance, 'infinity'::date)
                )::text AS prochaine_echeance
           FROM equipment
          WHERE deleted_at IS NULL AND actif = true
            AND LEAST(
                  COALESCE(date_prochaine_revision, 'infinity'::date),
                  COALESCE(date_controle_technique, 'infinity'::date),
                  COALESCE(date_assurance, 'infinity'::date)
                ) <= CURRENT_DATE + ($1 || ' days')::interval
          ORDER BY prochaine_echeance`,
        [String(joursAvant)],
      ),
    );
  }

  /* ─────────── interne ─────────── */

  private verifierType(type?: TypeMateriel): void {
    if (type && !TYPES.includes(type)) {
      throw new BadRequestException(`Type de matériel inconnu (${TYPES.join(', ')}).`);
    }
  }

  private verifierPeriode(debut: string, fin: string): void {
    if (!ISO.test(debut ?? '') || !ISO.test(fin ?? '')) {
      throw new BadRequestException('Période attendue au format AAAA-MM-JJ.');
    }
    if (fin < debut) throw new BadRequestException('La fin ne peut pas précéder le début.');
  }
}

/** Chaîne nettoyée, ou null : une case vide ne vaut pas une chaîne vide en base. */
function texte(v: string | null | undefined): string | null {
  const s = (v ?? '').trim();
  return s === '' ? null : s;
}

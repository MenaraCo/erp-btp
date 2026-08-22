import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { runInTenant } from '../../core/tenancy/tenant-transaction';
import { normaliserLibelle } from '../../core/common/normalisation';

/* ------------------------------------------------------------------ types */

export interface UnitInput { abrev: string; label: string; sortOrder?: number }
export interface LotInput { code: string; label: string }
export interface FamilleInput { lotId: string; code: string; label: string; nature?: string }
export interface CodeInput {
  familleId: string;
  code: string;
  label: string;
  nature?: string;
  /** charge | frais_generaux | produit — typage à la manière des A.R.C. (charges ou produits). */
  categorie?: string;
  /** Les quantités de ce poste entrent-elles dans le décompte des heures de production ? */
  heuresProduction?: boolean;
}

export interface CompanyInfoInput {
  name?: string;
  legalForm?: string;
  address?: string;
  postalCode?: string;
  city?: string;
  phone?: string;
  email?: string;
  siret?: string;
  vatIntra?: string;
  rcs?: string;
  capital?: string;
}

export interface PreferencesInput {
  tauxFgDefault?: number;
  tauxBenDefault?: number;
  devisPrefix?: string;
  devisSeparator?: string;
  /** Inclure l'année dans le numéro de devis (DEV-2026-0001 vs DEV-0001). */
  devisNumeroAnnee?: boolean;
  /** Longueur de la séquence du numéro (0001 = 4). */
  devisNumeroDigits?: number;
  /** Modèle du mail d'envoi de devis (variables {CLIENT}, {DEVIS}, {MONTANT_TTC}…). */
  mailDevisObjet?: string;
  mailDevisCorps?: string;
  couleurPrincipale?: string;
  couleurAccent?: string;
  /** Mise en page des documents édités : classique, contemporain, compact ou bandeau. */
  modelePdf?: string;
  tauxTva?: number[];
  defaultTab?: string;
  nbDecimales?: number;
}

/* ---------------------------------------------------------------- service */

@Injectable()
export class ParamsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly context: TenantContext,
  ) {}

  /* ======================== UNITÉS ======================== */

  listUnits() {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, (em) =>
      em.query(`SELECT * FROM unit_mesure ORDER BY sort_order ASC, abrev ASC`),
    );
  }

  async createUnit(input: UnitInput) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      await this.assertPasDeDoublon(em, 'unit_mesure', 'abrev', input.abrev, input.label);
      const maxRow = await em.query(
        `SELECT COALESCE(MAX(sort_order),0) AS max FROM unit_mesure`,
      );
      const sortOrder = input.sortOrder ?? (Number(maxRow[0].max) + 10);
      const rows = await em.query(
        `INSERT INTO unit_mesure (tenant_id, abrev, label, sort_order)
         VALUES ($1,$2,$3,$4) RETURNING *`,
        [tenantId, input.abrev.toUpperCase(), input.label, sortOrder],
      );
      return rows[0];
    });
  }

  async updateUnit(id: string, input: Partial<UnitInput>) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      await this.assertExists(em, 'unit_mesure', id);
      await this.assertPasDeDoublon(em, 'unit_mesure', 'abrev', input.abrev, input.label, id);
      await em.query(
        `UPDATE unit_mesure SET
           abrev      = COALESCE($2, abrev),
           label      = COALESCE($3, label),
           sort_order = COALESCE($4, sort_order)
         WHERE id = $1`,
        [id, input.abrev?.toUpperCase() ?? null, input.label ?? null, input.sortOrder ?? null],
      );
      return (await em.query(`SELECT * FROM unit_mesure WHERE id = $1`, [id]))[0];
    });
  }

  async deleteUnit(id: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      await this.assertExists(em, 'unit_mesure', id);
      await em.query(`DELETE FROM unit_mesure WHERE id = $1`, [id]);
    });
  }

  async reorderUnits(ids: string[]) {
    const tenantId = this.context.requireTenantId();
    // Une mise à jour après l'autre : toutes ces requêtes passent par LA connexion de la
    // transaction, et `pg` ne sait pas en traiter deux de front sur le même socket.
    return runInTenant(this.dataSource, tenantId, async (em) => {
      for (const [idx, id] of ids.entries()) {
        await em.query(`UPDATE unit_mesure SET sort_order = $2 WHERE id = $1`, [id, idx + 1]);
      }
    });
  }

  /* ======================== LOTS ======================== */

  listLots() {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, (em) =>
      em.query(`SELECT id, code, label FROM analytical_lot ORDER BY code`),
    );
  }

  async createLot(input: LotInput) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      await this.assertPasDeDoublon(em, 'analytical_lot', 'code', input.code, input.label);
      // nature='material' par défaut : le lot est un lot de travaux, la nature réelle
      // est portée par la famille / le code analytique (migration 046).
      const rows = await em.query(
        `INSERT INTO analytical_lot (tenant_id, code, label, nature)
         VALUES ($1,$2,$3,'material') RETURNING id, code, label`,
        [tenantId, input.code, input.label],
      );
      return rows[0];
    });
  }

  async updateLot(id: string, input: Partial<LotInput>) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      await this.assertExists(em, 'analytical_lot', id);
      await this.assertPasDeDoublon(em, 'analytical_lot', 'code', input.code, input.label, id);
      await em.query(
        `UPDATE analytical_lot SET
           code  = COALESCE($2, code),
           label = COALESCE($3, label)
         WHERE id = $1`,
        [id, input.code ?? null, input.label ?? null],
      );
      return (await em.query(`SELECT id, code, label FROM analytical_lot WHERE id = $1`, [id]))[0];
    });
  }

  async deleteLot(id: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      await this.assertExists(em, 'analytical_lot', id);
      // Familles rattachées : elles deviendront orphelines (lot_id → NULL via ON DELETE SET NULL)
      const orphaned = await em.query(
        `SELECT count(*)::int AS n FROM analytical_famille WHERE lot_id = $1`,
        [id],
      );
      await em.query(`DELETE FROM analytical_lot WHERE id = $1`, [id]);
      return { deleted: true, orphanedFamilles: orphaned[0]?.n ?? 0 };
    });
  }

  /* ======================== FAMILLES ======================== */

  listFamilles() {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, (em) =>
      em.query(
        `SELECT f.id, f.code, f.label, f.lot_id, f.nature,
                l.code AS lot_code, l.label AS lot_label
         FROM analytical_famille f
         LEFT JOIN analytical_lot l ON l.id = f.lot_id
         ORDER BY (f.lot_id IS NULL) DESC, f.nature, l.code, f.code`,
      ),
    );
  }

  async createFamille(input: FamilleInput) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      await this.assertPasDeDoublon(em, 'analytical_famille', 'code', input.code, input.label);
      const rows = await em.query(
        `INSERT INTO analytical_famille (tenant_id, lot_id, code, label, nature)
         VALUES ($1,$2,$3,$4,COALESCE($5,'material'))
         RETURNING id, code, label, lot_id, nature`,
        [tenantId, input.lotId, input.code, input.label, input.nature ?? null],
      );
      return rows[0];
    });
  }

  async updateFamille(id: string, input: Partial<FamilleInput>) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      await this.assertExists(em, 'analytical_famille', id);
      await this.assertPasDeDoublon(em, 'analytical_famille', 'code', input.code, input.label, id);
      await em.query(
        `UPDATE analytical_famille SET
           lot_id = COALESCE($2, lot_id),
           code   = COALESCE($3, code),
           label  = COALESCE($4, label),
           nature = COALESCE($5, nature)
         WHERE id = $1`,
        [id, input.lotId ?? null, input.code ?? null, input.label ?? null, input.nature ?? null],
      );
      return (await em.query(`SELECT id, code, label, lot_id, nature FROM analytical_famille WHERE id = $1`, [id]))[0];
    });
  }

  async deleteFamille(id: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      await this.assertExists(em, 'analytical_famille', id);
      const orphaned = await em.query(
        `SELECT count(*)::int AS n FROM analytical_code WHERE famille_id = $1`,
        [id],
      );
      await em.query(`DELETE FROM analytical_famille WHERE id = $1`, [id]);
      return { deleted: true, orphanedCodes: orphaned[0]?.n ?? 0 };
    });
  }

  /* ======================== CODES ANALYTIQUES ======================== */

  listCodes() {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, (em) =>
      em.query(
        `SELECT c.id, c.code, c.label, c.famille_id, c.nature, c.categorie, c.heures_production,
                f.code AS famille_code, f.label AS famille_label,
                l.code AS lot_code
         FROM analytical_code c
         LEFT JOIN analytical_famille f ON f.id = c.famille_id
         LEFT JOIN analytical_lot l ON l.id = f.lot_id
         ORDER BY (c.famille_id IS NULL) DESC, c.nature, f.code, c.code`,
      ),
    );
  }

  async createCode(input: CodeInput) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      await this.assertPasDeDoublon(em, 'analytical_code', 'code', input.code, input.label);
      // Nature par défaut = celle de la famille parente si non fournie
      const rows = await em.query(
        `INSERT INTO analytical_code
           (tenant_id, famille_id, code, label, nature, categorie, heures_production)
         VALUES ($1,$2,$3,$4,
                 COALESCE($5, (SELECT nature FROM analytical_famille WHERE id = $2), 'material'),
                 COALESCE($6, 'charge'), COALESCE($7, false))
         RETURNING id, code, label, famille_id, nature, categorie, heures_production`,
        [tenantId, input.familleId, input.code, input.label, input.nature ?? null,
         input.categorie ?? null, input.heuresProduction ?? null],
      );
      return rows[0];
    });
  }

  async updateCode(id: string, input: Partial<CodeInput>) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      await this.assertExists(em, 'analytical_code', id);
      await this.assertPasDeDoublon(em, 'analytical_code', 'code', input.code, input.label, id);
      await em.query(
        `UPDATE analytical_code SET
           famille_id = COALESCE($2, famille_id),
           code       = COALESCE($3, code),
           label      = COALESCE($4, label),
           nature     = COALESCE($5, nature),
           categorie  = COALESCE($6, categorie),
           heures_production = COALESCE($7, heures_production)
         WHERE id = $1`,
        [id, input.familleId ?? null, input.code ?? null, input.label ?? null, input.nature ?? null,
         input.categorie ?? null, input.heuresProduction ?? null],
      );
      return (await em.query(
        `SELECT id, code, label, famille_id, nature, categorie, heures_production
           FROM analytical_code WHERE id = $1`,
        [id],
      ))[0];
    });
  }

  async deleteCode(id: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      await this.assertExists(em, 'analytical_code', id);
      await em.query(`DELETE FROM analytical_code WHERE id = $1`, [id]);
    });
  }

  /* ======================== ENTREPRISE ======================== */

  async getCompany() {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      // Auto-create default company if none exists yet (first access from Paramètres)
      await em.query(
        `INSERT INTO company (tenant_id, code, name)
         VALUES ($1, 'DEFAULT', 'Mon entreprise')
         ON CONFLICT (tenant_id, code) DO NOTHING`,
        [tenantId],
      );
      // On exclut logo_data (base64, potentiellement lourd) : il a ses propres endpoints.
      const rows = await em.query(
        `SELECT id, tenant_id, code, name, legal_form, siren, siret, vat_number, vat_intra,
                rcs, capital, address, postal_code, city, phone, email,
                logo_mime, (logo_data IS NOT NULL) AS has_logo, created_at, updated_at
           FROM company ORDER BY code ASC LIMIT 1`,
      );
      return rows[0] ?? null;
    });
  }

  /** Logo d'entreprise pour les éditions — renvoie le binaire décodé, ou null. */
  async getCompanyLogo(): Promise<{ data: Buffer; mime: string } | null> {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const rows = await em.query(
        `SELECT logo_data, logo_mime FROM company
          WHERE logo_data IS NOT NULL ORDER BY code ASC LIMIT 1`,
      );
      if (rows.length === 0) return null;
      return {
        data: Buffer.from(rows[0].logo_data, 'base64'),
        mime: rows[0].logo_mime ?? 'image/png',
      };
    });
  }

  /** Enregistre le logo (base64). PNG/JPEG uniquement, 1 Mo maximum. */
  async setCompanyLogo(id: string, data: string, mime: string) {
    const tenantId = this.context.requireTenantId();
    const clean = (data ?? '').replace(/^data:[^;]+;base64,/, '');
    if (!clean) {
      throw new BadRequestException('Image manquante.');
    }
    if (!['image/png', 'image/jpeg'].includes(mime)) {
      throw new BadRequestException('Format non supporté : utilisez un PNG ou un JPEG.');
    }
    // 4 caractères base64 = 3 octets ; on borne à 1 Mo pour rester raisonnable en base.
    if (Math.floor((clean.length * 3) / 4) > 1024 * 1024) {
      throw new BadRequestException('Logo trop volumineux (1 Mo maximum).');
    }
    return runInTenant(this.dataSource, tenantId, async (em) => {
      await this.assertExists(em, 'company', id);
      await em.query(
        `UPDATE company SET logo_data = $2, logo_mime = $3, updated_at = now() WHERE id = $1`,
        [id, clean, mime],
      );
      return { ok: true };
    });
  }

  async deleteCompanyLogo(id: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      await this.assertExists(em, 'company', id);
      await em.query(
        `UPDATE company SET logo_data = NULL, logo_mime = NULL, updated_at = now() WHERE id = $1`,
        [id],
      );
      return { ok: true };
    });
  }

  async updateCompany(id: string, input: CompanyInfoInput) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      await this.assertExists(em, 'company', id);
      await em.query(
        `UPDATE company SET
           name        = COALESCE($2, name),
           legal_form  = COALESCE($3, legal_form),
           address     = COALESCE($4, address),
           postal_code = COALESCE($5, postal_code),
           city        = COALESCE($6, city),
           phone       = COALESCE($7, phone),
           email       = COALESCE($8, email),
           siret       = COALESCE($9, siret),
           vat_intra   = COALESCE($10, vat_intra),
           rcs         = COALESCE($11, rcs),
           capital     = COALESCE($12, capital)
         WHERE id = $1`,
        [
          id,
          input.name ?? null, input.legalForm ?? null, input.address ?? null,
          input.postalCode ?? null, input.city ?? null, input.phone ?? null,
          input.email ?? null, input.siret ?? null, input.vatIntra ?? null,
          input.rcs ?? null, input.capital ?? null,
        ],
      );
      return (await em.query(`SELECT * FROM company WHERE id = $1`, [id]))[0];
    });
  }

  /* ======================== PRÉFÉRENCES ======================== */

  async getPreferences() {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      /* auto-create if missing (first access) */
      const company = await em.query(`SELECT id, tenant_id FROM company LIMIT 1`);
      if (company.length === 0) return null;
      const companyId = company[0].id;
      await em.query(
        `INSERT INTO company_preferences (tenant_id, company_id) VALUES ($1,$2) ON CONFLICT (company_id) DO NOTHING`,
        [tenantId, companyId],
      );
      const rows = await em.query(
        `SELECT p.*, c.name AS company_name, c.code AS company_code
         FROM company_preferences p JOIN company c ON c.id = p.company_id
         WHERE p.company_id = $1`,
        [companyId],
      );
      if (!rows[0]) return null;
      const row = rows[0];
      // taux_tva est jsonb — le driver pg le parse déjà, mais on s'assure que c'est bien un tableau
      if (typeof row.taux_tva === 'string') {
        try { row.taux_tva = JSON.parse(row.taux_tva); } catch { row.taux_tva = [0, 5.5, 10, 20]; }
      }
      if (!Array.isArray(row.taux_tva)) row.taux_tva = [0, 5.5, 10, 20];
      return row;
    });
  }

  async updatePreferences(input: PreferencesInput) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const company = await em.query(`SELECT id FROM company LIMIT 1`);
      if (company.length === 0) throw new NotFoundException('No company found');
      const companyId = company[0].id;
      await em.query(
        `INSERT INTO company_preferences (tenant_id, company_id) VALUES ($1,$2) ON CONFLICT (company_id) DO NOTHING`,
        [tenantId, companyId],
      );
      await em.query(
        `UPDATE company_preferences SET
           taux_fg_default    = COALESCE($2, taux_fg_default),
           taux_ben_default   = COALESCE($3, taux_ben_default),
           devis_prefix       = COALESCE($4, devis_prefix),
           devis_separator    = COALESCE($5, devis_separator),
           couleur_principale = COALESCE($6, couleur_principale),
           couleur_accent     = COALESCE($7, couleur_accent),
           taux_tva           = COALESCE($8::jsonb, taux_tva),
           default_tab        = COALESCE($9, default_tab),
           nb_decimales       = COALESCE($10::smallint, nb_decimales),
           devis_numero_annee = COALESCE($11::boolean, devis_numero_annee),
           devis_numero_digits= COALESCE($12::smallint, devis_numero_digits),
           mail_devis_objet   = COALESCE($13, mail_devis_objet),
           mail_devis_corps   = COALESCE($14, mail_devis_corps),
           modele_pdf         = COALESCE($15, modele_pdf),
           updated_at         = now()
         WHERE company_id = $1`,
        [
          companyId,
          input.tauxFgDefault ?? null,
          input.tauxBenDefault ?? null,
          input.devisPrefix ?? null,
          input.devisSeparator ?? null,
          input.couleurPrincipale ?? null,
          input.couleurAccent ?? null,
          input.tauxTva != null ? JSON.stringify(input.tauxTva) : null,
          input.defaultTab ?? null,
          input.nbDecimales ?? null,
          input.devisNumeroAnnee ?? null,
          input.devisNumeroDigits ?? null,
          input.mailDevisObjet ?? null,
          input.mailDevisCorps ?? null,
          input.modelePdf ?? null,
        ],
      );
      // Retourner le résultat dans la MÊME transaction (évite le deadlock de connexion)
      const updated = await em.query(
        `SELECT p.*, c.name AS company_name, c.code AS company_code
         FROM company_preferences p JOIN company c ON c.id = p.company_id
         WHERE p.company_id = $1`,
        [companyId],
      );
      const row = updated[0];
      if (row && typeof row.taux_tva === 'string') {
        try { row.taux_tva = JSON.parse(row.taux_tva); } catch { row.taux_tva = [0, 5.5, 10, 20]; }
      }
      return row ?? null;
    });
  }

  /* ======================== PRIVATE ======================== */


  /* ================== DOUBLONS DÉJÀ EN PLACE ================== */

  /**
   * Tables qui référencent chaque niveau du plan. La fusion doit toutes les réaffecter avant de
   * supprimer le doublon — en oublier une casserait une clé étrangère, ou pire, ferait disparaître
   * silencieusement des coûts de l'agrégation analytique.
   */
  private static readonly REFERENCES: Record<string, { table: string; refs: Array<[string, string]> }> = {
    lot: {
      table: 'analytical_lot',
      refs: [['analytical_famille', 'lot_id'], ['ouvrage', 'lot_id']],
    },
    famille: {
      table: 'analytical_famille',
      refs: [['analytical_code', 'famille_id']],
    },
    code: {
      table: 'analytical_code',
      refs: [
        ['resource', 'code_analytique_id'],
        ['nomenclature_resource', 'code_analytique_id'],
        ['purchase_order_line', 'code_analytique_id'],
        ['supplier_invoice', 'code_analytique_id'],
        ['timesheet', 'code_analytique_id'],
      ],
    },
  };

  /**
   * Entrées du plan qui désignent visiblement la même chose — même libellé une fois normalisé.
   *
   * La garde à l'écriture empêche d'en créer de nouveaux ; elle ne dit rien de ceux déjà en base,
   * hérités d'imports ou d'une époque sans contrôle. Ce relevé les met sous les yeux.
   */
  async listerDoublons() {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const groupes: Array<{
        type: string;
        libelle: string;
        entrees: Array<{ id: string; code: string; label: string; usages: number }>;
      }> = [];

      for (const [type, { table, refs }] of Object.entries(ParamsService.REFERENCES)) {
        const lignes: Array<{ id: string; code: string; label: string }> = await em.query(
          `SELECT id, code, label FROM ${table} ORDER BY code`,
        );
        const parLibelle = new Map<string, typeof lignes>();
        for (const l of lignes) {
          const cle = normaliserLibelle(l.label);
          if (!cle) continue;
          const liste = parLibelle.get(cle);
          if (liste) liste.push(l);
          else parLibelle.set(cle, [l]);
        }
        for (const [cle, liste] of parLibelle) {
          if (liste.length < 2) continue;
          // Le nombre d'usages guide le choix du survivant : on garde celui qui porte le plus.
          const entrees = [];
          for (const e of liste) {
            let usages = 0;
            for (const [t, col] of refs) {
              const [r] = await em.query(`SELECT count(*)::int AS n FROM ${t} WHERE ${col} = $1`, [e.id]);
              usages += r.n;
            }
            entrees.push({ ...e, usages });
          }
          groupes.push({ type, libelle: cle, entrees });
        }
      }
      return groupes;
    });
  }

  /**
   * Fusionne un doublon dans l'entrée à conserver : tout ce qui pointait sur le doublon pointe
   * désormais sur le survivant, puis le doublon disparaît.
   *
   * Une seule transaction : une réaffectation à moitié faite laisserait des coûts orphelins, et
   * l'agrégation analytique s'en trouverait fausse sans que rien ne le signale.
   */
  async fusionnerDoublon(type: string, gardeId: string, supprimeId: string) {
    const conf = ParamsService.REFERENCES[type];
    if (!conf) throw new BadRequestException(`Type de référentiel inconnu : « ${type} ».`);
    if (gardeId === supprimeId) {
      throw new BadRequestException('Choisissez deux entrées différentes.');
    }
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      await this.assertExists(em, conf.table, gardeId);
      await this.assertExists(em, conf.table, supprimeId);

      let reaffectes = 0;
      for (const [t, col] of conf.refs) {
        const r = await em.query(
          `UPDATE ${t} SET ${col} = $1 WHERE ${col} = $2`,
          [gardeId, supprimeId],
        );
        reaffectes += r[1] ?? 0;
      }
      await em.query(`DELETE FROM ${conf.table} WHERE id = $1`, [supprimeId]);
      return { reaffectes };
    });
  }

  /**
   * Barrage aux doublons du plan analytique.
   *
   * Le plan est UNE référence partagée, éditable depuis l'étude de prix comme depuis le chantier.
   * Deux personnes qui ne se voient pas y créent tôt ou tard la même chose sous deux codes —
   * « COLLE » chez le deviseur, « Colle carrelage » chez le conducteur — et l'agrégation
   * analytique se met à compter la même dépense sur deux lignes.
   *
   * On refuse donc le code déjà pris (message clair plutôt qu'une erreur SQL brute) ET le libellé
   * déjà employé une fois normalisé. `idExclu` laisse une fiche se renommer elle-même.
   */
  private async assertPasDeDoublon(
    em: EntityManager,
    table: string,
    colonneCode: 'code' | 'abrev',
    valeurCode: string | null | undefined,
    libelle: string | null | undefined,
    idExclu?: string,
  ): Promise<void> {
    const existantes: Array<{ id: string; code: string; label: string }> = await em.query(
      `SELECT id, ${colonneCode} AS code, label FROM ${table}`,
    );
    const autres = existantes.filter((e) => e.id !== idExclu);

    // MODIFICATION : on ne contrôle que ce qui CHANGE. Sans cela, rééditer une fiche pour un
    // détail (sa catégorie, sa famille) échouait parce que son propre libellé ressemblait à celui
    // d'une autre entrée — « Frais généraux / Part Propre » contre « Frais généraux — part propre ».
    // Le doublon reste refusé quand on renomme VERS un libellé déjà pris.
    if (idExclu) {
      const courant = existantes.find((e) => e.id === idExclu);
      if (courant) {
        if ((courant.code ?? '').trim().toLowerCase() === (valeurCode ?? '').trim().toLowerCase()) {
          valeurCode = null;
        }
        if (normaliserLibelle(courant.label) === normaliserLibelle(libelle)) libelle = null;
      }
    }

    const code = (valeurCode ?? '').trim().toLowerCase();
    if (code) {
      const collision = autres.find((e) => (e.code ?? '').trim().toLowerCase() === code);
      if (collision) {
        throw new ConflictException(
          `Le code « ${collision.code} » est déjà utilisé par « ${collision.label} ».`,
        );
      }
    }

    const libelleNorm = normaliserLibelle(libelle);
    if (libelleNorm) {
      const collision = autres.find((e) => normaliserLibelle(e.label) === libelleNorm);
      if (collision) {
        throw new ConflictException(
          `« ${collision.label} » (${collision.code}) désigne déjà cela. `
          + `Reprenez cette entrée plutôt que d'en créer une seconde.`,
        );
      }
    }
  }

  private async assertExists(em: any, table: string, id: string): Promise<void> {
    const rows = await em.query(`SELECT id FROM ${table} WHERE id = $1`, [id]);
    if (rows.length === 0) throw new NotFoundException(`${table} "${id}" not found`);
  }

  /* ==================== LISTES DE VALEURS ====================
     Listes déroulantes paramétrables par société (conditions de paiement, nature des travaux,
     lots traités…) : une table générique, un `list_type` par liste. */

  private assertListType(t: string): void {
    if (!COMPANY_LIST_TYPES.includes(t)) {
      throw new BadRequestException('Type de liste inconnu.');
    }
  }

  listItems(listType: string) {
    this.assertListType(listType);
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, (em) =>
      em.query(
        `SELECT id, label, sort_order FROM company_list_item
          WHERE list_type = $1 AND deleted_at IS NULL
          ORDER BY sort_order ASC, label ASC`,
        [listType],
      ),
    );
  }

  async createItem(listType: string, label: string) {
    this.assertListType(listType);
    if (!label?.trim()) throw new BadRequestException('Le libellé est obligatoire.');
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const [{ next }] = await em.query(
        `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM company_list_item
          WHERE list_type = $1 AND deleted_at IS NULL`,
        [listType],
      );
      const [row] = await em.query(
        `INSERT INTO company_list_item (tenant_id, list_type, label, sort_order)
         VALUES ($1, $2, $3, $4) RETURNING id, label, sort_order`,
        [tenantId, listType, label.trim(), next],
      );
      return row;
    });
  }

  async updateItem(id: string, label: string) {
    if (!label?.trim()) throw new BadRequestException('Le libellé est obligatoire.');
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      // UPDATE puis SELECT : em.query(UPDATE … RETURNING) renvoie [rows, count], pas la ligne.
      await em.query(
        `UPDATE company_list_item SET label = $2, updated_at = now()
          WHERE id = $1 AND deleted_at IS NULL`,
        [id, label.trim()],
      );
      const rows = await em.query(
        `SELECT id, label, sort_order FROM company_list_item WHERE id = $1 AND deleted_at IS NULL`,
        [id],
      );
      if (rows.length === 0) throw new NotFoundException('Valeur introuvable.');
      return rows[0];
    });
  }

  async deleteItem(id: string): Promise<{ deleted: true }> {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      await em.query(
        `UPDATE company_list_item SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL`,
        [id],
      );
      return { deleted: true as const };
    });
  }
}

/** Les listes de valeurs paramétrables (une table générique, un type par liste). */
export const COMPANY_LIST_TYPES = ['payment_term', 'work_nature', 'work_lot'];

import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { runInTenant } from '../../core/tenancy/tenant-transaction';

/* ------------------------------------------------------------------ types */

export interface UnitInput { abrev: string; label: string; sortOrder?: number }
export interface LotInput { nature: string; code: string; label: string }
export interface FamilleInput { lotId: string; code: string; label: string }
export interface CodeInput { familleId: string; code: string; label: string }

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
  couleurPrincipale?: string;
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
    return runInTenant(this.dataSource, tenantId, (em) =>
      Promise.all(
        ids.map((id, idx) =>
          em.query(`UPDATE unit_mesure SET sort_order = $2 WHERE id = $1`, [id, idx + 1]),
        ),
      ),
    );
  }

  /* ======================== LOTS ======================== */

  listLots() {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, (em) =>
      em.query(`SELECT * FROM analytical_lot ORDER BY nature, code`),
    );
  }

  async createLot(input: LotInput) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const rows = await em.query(
        `INSERT INTO analytical_lot (tenant_id, nature, code, label)
         VALUES ($1,$2,$3,$4) RETURNING *`,
        [tenantId, input.nature, input.code, input.label],
      );
      return rows[0];
    });
  }

  async updateLot(id: string, input: Partial<LotInput>) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      await this.assertExists(em, 'analytical_lot', id);
      await em.query(
        `UPDATE analytical_lot SET
           code   = COALESCE($2, code),
           label  = COALESCE($3, label),
           nature = COALESCE($4, nature)
         WHERE id = $1`,
        [id, input.code ?? null, input.label ?? null, input.nature ?? null],
      );
      return (await em.query(`SELECT * FROM analytical_lot WHERE id = $1`, [id]))[0];
    });
  }

  async deleteLot(id: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      await this.assertExists(em, 'analytical_lot', id);
      await em.query(`DELETE FROM analytical_lot WHERE id = $1`, [id]);
    });
  }

  /* ======================== FAMILLES ======================== */

  listFamilles() {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, (em) =>
      em.query(
        `SELECT f.*, l.nature, l.code AS lot_code, l.label AS lot_label
         FROM analytical_famille f
         JOIN analytical_lot l ON l.id = f.lot_id
         ORDER BY l.nature, l.code, f.code`,
      ),
    );
  }

  async createFamille(input: FamilleInput) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const rows = await em.query(
        `INSERT INTO analytical_famille (tenant_id, lot_id, code, label)
         VALUES ($1,$2,$3,$4) RETURNING *`,
        [tenantId, input.lotId, input.code, input.label],
      );
      return rows[0];
    });
  }

  async updateFamille(id: string, input: Partial<FamilleInput>) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      await this.assertExists(em, 'analytical_famille', id);
      await em.query(
        `UPDATE analytical_famille SET
           lot_id = COALESCE($2, lot_id),
           code   = COALESCE($3, code),
           label  = COALESCE($4, label)
         WHERE id = $1`,
        [id, input.lotId ?? null, input.code ?? null, input.label ?? null],
      );
      return (await em.query(`SELECT * FROM analytical_famille WHERE id = $1`, [id]))[0];
    });
  }

  async deleteFamille(id: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      await this.assertExists(em, 'analytical_famille', id);
      await em.query(`DELETE FROM analytical_famille WHERE id = $1`, [id]);
    });
  }

  /* ======================== CODES ANALYTIQUES ======================== */

  listCodes() {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, (em) =>
      em.query(
        `SELECT c.*, f.code AS famille_code, f.label AS famille_label,
                l.nature, l.code AS lot_code
         FROM analytical_code c
         JOIN analytical_famille f ON f.id = c.famille_id
         JOIN analytical_lot l ON l.id = f.lot_id
         ORDER BY l.nature, l.code, f.code, c.code`,
      ),
    );
  }

  async createCode(input: CodeInput) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const rows = await em.query(
        `INSERT INTO analytical_code (tenant_id, famille_id, code, label)
         VALUES ($1,$2,$3,$4) RETURNING *`,
        [tenantId, input.familleId, input.code, input.label],
      );
      return rows[0];
    });
  }

  async updateCode(id: string, input: Partial<CodeInput>) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      await this.assertExists(em, 'analytical_code', id);
      await em.query(
        `UPDATE analytical_code SET
           famille_id = COALESCE($2, famille_id),
           code       = COALESCE($3, code),
           label      = COALESCE($4, label)
         WHERE id = $1`,
        [id, input.familleId ?? null, input.code ?? null, input.label ?? null],
      );
      return (await em.query(`SELECT * FROM analytical_code WHERE id = $1`, [id]))[0];
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
      const rows = await em.query(`SELECT * FROM company ORDER BY code ASC LIMIT 1`);
      return rows[0] ?? null;
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
           taux_tva           = COALESCE($7, taux_tva),
           default_tab        = COALESCE($8, default_tab),
           nb_decimales       = COALESCE($9, nb_decimales),
           updated_at         = now()
         WHERE company_id = $1`,
        [
          companyId,
          input.tauxFgDefault ?? null,
          input.tauxBenDefault ?? null,
          input.devisPrefix ?? null,
          input.devisSeparator ?? null,
          input.couleurPrincipale ?? null,
          input.tauxTva != null ? JSON.stringify(input.tauxTva) : null,
          input.defaultTab ?? null,
          input.nbDecimales ?? null,
        ],
      );
      return this.getPreferences();
    });
  }

  /* ======================== PRIVATE ======================== */

  private async assertExists(em: any, table: string, id: string): Promise<void> {
    const rows = await em.query(`SELECT id FROM ${table} WHERE id = $1`, [id]);
    if (rows.length === 0) throw new NotFoundException(`${table} "${id}" not found`);
  }
}

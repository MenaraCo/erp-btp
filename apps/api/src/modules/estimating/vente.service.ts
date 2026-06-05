import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import Decimal from 'decimal.js';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { runInTenant } from '../../core/tenancy/tenant-transaction';
import {
  CalcComponent,
  CalcOuvrage,
  NATURES,
  Nature,
  NatureBreakdown,
  computeNatureBreakdownMap,
  zeroBreakdown,
} from './ouvrage-calc';
import {
  FraisAnnexe,
  FraisType,
  NatureSaleRate,
  SaleCoefficients,
  VenteItemInput,
  VenteResult,
  computeFeuilleDeVente,
} from './vente-calc';

export interface SaleSheetInput {
  byNature: Record<Nature, { tauxFg: number | string; tauxBenefice: number | string }>;
  remise?: { type: FraisType; valeur: number | string } | null;
  tvaRate?: number | string;
}

export interface FraisAnnexeInput {
  designation: string;
  type: FraisType;
  valeur: number | string;
  sortOrder?: number;
}

const ZERO_RATE: NatureSaleRate = { tauxFg: '0', tauxBenefice: '0' };

const DEFAULT_COEFFS: SaleCoefficients = {
  byNature: {
    labor: ZERO_RATE,
    material: ZERO_RATE,
    equipment: ZERO_RATE,
    subcontract: ZERO_RATE,
  },
  fraisAnnexes: [],
  remise: null,
  tvaRate: '0.20',
};

@Injectable()
export class VenteService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly context: TenantContext,
  ) {}

  /** Upserts the sale coefficients (FG/Bénéfice per nature), remise and TVA of a version. */
  setSaleSheet(versionId: string, input: SaleSheetInput) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      await this.assertVersion(em, versionId);
      const coefficients = JSON.stringify(this.normalizeByNature(input.byNature));
      const remiseType = input.remise?.type ?? 'pct';
      const remiseValeur = input.remise?.valeur ?? 0;
      return (
        await em.query(
          `INSERT INTO sale_sheet
             (tenant_id, devis_version_id, coefficients, tva_rate, remise_type, remise_valeur)
           VALUES ($1, $2, $3::jsonb, $4, $5, $6)
           ON CONFLICT (devis_version_id)
           DO UPDATE SET coefficients = EXCLUDED.coefficients,
                         tva_rate = EXCLUDED.tva_rate,
                         remise_type = EXCLUDED.remise_type,
                         remise_valeur = EXCLUDED.remise_valeur,
                         updated_at = now()
           RETURNING *`,
          [
            tenantId,
            versionId,
            coefficients,
            String(input.tvaRate ?? 0.2),
            remiseType,
            String(remiseValeur),
          ],
        )
      )[0];
    });
  }

  /** Replaces the frais annexes list of a version. */
  setFraisAnnexes(versionId: string, frais: FraisAnnexeInput[]) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      await this.assertVersion(em, versionId);
      await em.query(`DELETE FROM devis_frais_annexe WHERE devis_version_id = $1`, [versionId]);
      for (let i = 0; i < frais.length; i++) {
        const f = frais[i];
        await em.query(
          `INSERT INTO devis_frais_annexe
             (tenant_id, devis_version_id, designation, type, valeur, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [tenantId, versionId, f.designation, f.type, String(f.valeur ?? 0), f.sortOrder ?? i],
        );
      }
      return em.query(
        `SELECT * FROM devis_frais_annexe WHERE devis_version_id = $1 ORDER BY sort_order ASC`,
        [versionId],
      );
    });
  }

  /** Forces (or releases) the unit sale price of a single devis line. */
  setLinePv(lineId: string, puVente: number | string | null, force: boolean) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const rows = await em.query(
        `UPDATE devis_line
            SET pu_vente = $1, pu_vente_force = $2, updated_at = now()
          WHERE id = $3 RETURNING id`,
        [puVente != null ? String(puVente) : null, force, lineId],
      );
      if (rows.length === 0) {
        throw new NotFoundException(`Unknown devis line "${lineId}"`);
      }
      return rows[0];
    });
  }

  /** Returns the stored feuille de vente config (coefficients, remise, TVA, frais) for prefill. */
  getConfig(versionId: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      await this.assertVersion(em, versionId);
      const fraisAnnexes = await em.query(
        `SELECT designation, type, valeur FROM devis_frais_annexe
          WHERE devis_version_id = $1 ORDER BY sort_order ASC`,
        [versionId],
      );
      const rows = await em.query(
        `SELECT coefficients, tva_rate, remise_type, remise_valeur
           FROM sale_sheet WHERE devis_version_id = $1`,
        [versionId],
      );
      if (rows.length === 0) {
        return { configured: false, byNature: null, remise: null, tvaRate: null, fraisAnnexes };
      }
      const c = rows[0];
      const byNature = {} as Record<Nature, NatureSaleRate>;
      for (const n of NATURES) {
        const r = c.coefficients?.[n] ?? {};
        byNature[n] = { tauxFg: String(r.tauxFg ?? 0), tauxBenefice: String(r.tauxBenefice ?? 0) };
      }
      return {
        configured: true,
        byNature,
        remise: { type: c.remise_type as FraisType, valeur: String(c.remise_valeur) },
        tvaRate: String(c.tva_rate),
        fraisAnnexes,
      };
    });
  }

  /** Computes the feuille de vente of a version (rules #2 and #3). */
  computeForVersion(versionId: string): Promise<VenteResult> {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      await this.assertVersion(em, versionId);

      const coeffs = await this.loadCoefficients(em, versionId);
      const breakdowns = await this.loadOuvrageBreakdowns(em);
      const items = await this.buildItems(em, versionId, breakdowns);

      return computeFeuilleDeVente(items, coeffs);
    });
  }

  private async assertVersion(em: EntityManager, versionId: string): Promise<void> {
    const version = await em.query(`SELECT id FROM devis_version WHERE id = $1`, [versionId]);
    if (version.length === 0) {
      throw new NotFoundException(`Unknown version "${versionId}"`);
    }
  }

  private normalizeByNature(
    byNature: SaleSheetInput['byNature'],
  ): Record<Nature, NatureSaleRate> {
    if (!byNature) {
      throw new BadRequestException('byNature coefficients are required');
    }
    const out = {} as Record<Nature, NatureSaleRate>;
    for (const n of NATURES) {
      const r = byNature[n] ?? ZERO_RATE;
      out[n] = { tauxFg: String(r.tauxFg ?? 0), tauxBenefice: String(r.tauxBenefice ?? 0) };
    }
    return out;
  }

  /**
   * Builds one vente item per priceable leaf line (type ouvrage/ressource without a priceable
   * child, to avoid double counting). Déboursé comes from the ouvrage breakdown when the line
   * references a library ouvrage, otherwise from pu × quantity on the line's manual nature
   * (resource nature as fallback). A forced unit sale price (pu_vente_force) becomes forcedPv.
   */
  private async buildItems(
    em: EntityManager,
    versionId: string,
    breakdowns: Map<string, NatureBreakdown>,
  ): Promise<VenteItemInput[]> {
    const lines: Array<{
      id: string;
      parent_line_id: string | null;
      type: string;
      source_ouvrage_id: string | null;
      source_resource_id: string | null;
      nature: Nature | null;
      resource_nature: Nature | null;
      quantity: string | null;
      pu: string | null;
      pu_vente: string | null;
      pu_vente_force: boolean;
      vendable: boolean;
    }> = await em.query(
      `SELECT dl.id, dl.parent_line_id, dl.type, dl.source_ouvrage_id, dl.source_resource_id,
              dl.nature, r.nature AS resource_nature,
              dl.quantity, dl.pu, dl.pu_vente, dl.pu_vente_force, dl.vendable
         FROM devis_line dl
         LEFT JOIN resource r ON r.id = dl.source_resource_id
        WHERE dl.devis_version_id = $1`,
      [versionId],
    );

    // Parents that hold a priceable child are containers, not priced themselves.
    const priceableParents = new Set<string>();
    for (const l of lines) {
      if ((l.type === 'ouvrage' || l.type === 'ressource') && l.parent_line_id) {
        priceableParents.add(l.parent_line_id);
      }
    }

    const items: VenteItemInput[] = [];
    for (const l of lines) {
      if (l.type !== 'ouvrage' && l.type !== 'ressource') {
        continue;
      }
      if (priceableParents.has(l.id)) {
        continue; // container line is its priceable children's sum
      }
      const qty = new Decimal(l.quantity ?? 0);
      const debourseByNature: Partial<Record<Nature, string>> = {};

      if (l.type === 'ouvrage' && l.source_ouvrage_id) {
        const unit = breakdowns.get(l.source_ouvrage_id) ?? zeroBreakdown();
        for (const n of NATURES) {
          debourseByNature[n] = unit[n].times(qty).toString();
        }
      } else {
        const nature: Nature = l.nature ?? l.resource_nature ?? 'material';
        debourseByNature[nature] = new Decimal(l.pu ?? 0).times(qty).toString();
      }

      const forcedPv =
        l.pu_vente_force && l.pu_vente != null
          ? new Decimal(l.pu_vente).times(qty).toString()
          : null;

      items.push({ id: l.id, vendable: l.vendable, debourseByNature, forcedPv });
    }
    return items;
  }

  private async loadCoefficients(
    em: EntityManager,
    versionId: string,
  ): Promise<SaleCoefficients> {
    const fraisRows = await em.query(
      `SELECT designation, type, valeur FROM devis_frais_annexe
        WHERE devis_version_id = $1 ORDER BY sort_order ASC`,
      [versionId],
    );
    const fraisAnnexes: FraisAnnexe[] = fraisRows.map(
      (f: { designation: string; type: FraisType; valeur: string }) => ({
        designation: f.designation,
        type: f.type,
        valeur: f.valeur,
      }),
    );

    const rows = await em.query(
      `SELECT coefficients, tva_rate, remise_type, remise_valeur
         FROM sale_sheet WHERE devis_version_id = $1`,
      [versionId],
    );
    if (rows.length === 0) {
      return { ...DEFAULT_COEFFS, fraisAnnexes };
    }
    const c = rows[0];
    const byNature = {} as Record<Nature, NatureSaleRate>;
    for (const n of NATURES) {
      const r = c.coefficients?.[n] ?? {};
      byNature[n] = {
        tauxFg: String(r.tauxFg ?? 0),
        tauxBenefice: String(r.tauxBenefice ?? 0),
      };
    }
    const remiseValeur = new Decimal(c.remise_valeur ?? 0);
    return {
      byNature,
      fraisAnnexes,
      remise: remiseValeur.isZero()
        ? null
        : { type: c.remise_type as FraisType, valeur: String(c.remise_valeur) },
      tvaRate: String(c.tva_rate),
    };
  }

  private async loadOuvrageBreakdowns(
    em: EntityManager,
  ): Promise<Map<string, NatureBreakdown>> {
    const ouvrages = await em.query(`SELECT id FROM ouvrage`);
    const components = await em.query(
      `SELECT oc.parent_ouvrage_id, oc.kind, oc.quantity, oc.rate,
              oc.child_ouvrage_id, r.unit_cost, r.nature
         FROM ouvrage_component oc
         LEFT JOIN resource r ON r.id = oc.child_resource_id`,
    );
    const map = new Map<string, CalcOuvrage>();
    for (const o of ouvrages) {
      map.set(o.id, { id: o.id, components: [] });
    }
    for (const c of components) {
      const parent = map.get(c.parent_ouvrage_id);
      if (!parent) {
        continue;
      }
      const component: CalcComponent = { kind: c.kind };
      if (c.kind === 'resource') {
        component.quantity = c.quantity ?? 0;
        component.unitCost = c.unit_cost ?? 0;
        component.nature = c.nature ?? 'material';
      } else if (c.kind === 'sub_ouvrage') {
        component.quantity = c.quantity ?? 0;
        component.childOuvrageId = c.child_ouvrage_id;
      } else {
        component.rate = c.rate ?? 0;
      }
      parent.components.push(component);
    }
    return computeNatureBreakdownMap(map);
  }
}

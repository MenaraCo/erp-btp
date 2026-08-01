import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import Decimal from 'decimal.js';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { runInTenant } from '../../core/tenancy/tenant-transaction';
import { returningRows } from '../../core/database/returning.util';
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
  SectionKind,
  VenteItemInput,
  VenteResult,
  computeFeuilleDeVente,
} from './vente-calc';

export interface StTypeInput {
  /** identifiant stable du type au sein du devis (slug ou uuid) */
  id: string;
  code?: string | null;
  label: string;
  tauxFg: number | string;
  tauxBenefice: number | string;
}

export interface SaleSheetInput {
  byNature: Record<Nature, { tauxFg: number | string; tauxBenefice: number | string }>;
  /** Types de sous-traitance définis POUR CE DEVIS (chacun ses FG/bénéfice). */
  stTypes?: StTypeInput[];
  /** Arrondi commercial du PV de ligne : pas (0 = aucun) et sens. */
  arrondi?: { pas: number | string; mode?: 'proche' | 'sup' | 'inf' } | null;
  /** PV total imposé (hors frais annexes et remise) ; null = pas d'imposition. */
  pvImpose?: number | string | null;
  /** Frais annexes : poste séparé sur le devis, ou noyés dans les prix unitaires. */
  fraisMode?: 'separe' | 'inclus';
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
      const stTypes = JSON.stringify(
        (input.stTypes ?? []).map((t) => ({
          id: t.id,
          code: t.code ?? null,
          label: t.label,
          tauxFg: String(t.tauxFg ?? 0),
          tauxBenefice: String(t.tauxBenefice ?? 0),
        })),
      );
      const remiseType = input.remise?.type ?? 'pct';
      const remiseValeur = input.remise?.valeur ?? 0;
      return (
        await em.query(
          `INSERT INTO sale_sheet
             (tenant_id, devis_version_id, coefficients, st_types, tva_rate, remise_type,
              remise_valeur, arrondi_pas, arrondi_mode, pv_impose, frais_mode)
           VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7, $8, $9, $10, $11)
           ON CONFLICT (devis_version_id)
           DO UPDATE SET coefficients = EXCLUDED.coefficients,
                         st_types = EXCLUDED.st_types,
                         tva_rate = EXCLUDED.tva_rate,
                         remise_type = EXCLUDED.remise_type,
                         remise_valeur = EXCLUDED.remise_valeur,
                         arrondi_pas = EXCLUDED.arrondi_pas,
                         arrondi_mode = EXCLUDED.arrondi_mode,
                         pv_impose = EXCLUDED.pv_impose,
                         frais_mode = EXCLUDED.frais_mode,
                         updated_at = now()
           RETURNING *`,
          [
            tenantId,
            versionId,
            coefficients,
            stTypes,
            String(input.tvaRate ?? 0.2),
            remiseType,
            String(remiseValeur),
            String(input.arrondi?.pas ?? 0),
            input.arrondi?.mode ?? 'proche',
            input.pvImpose != null && String(input.pvImpose) !== '' ? String(input.pvImpose) : null,
            input.fraisMode ?? 'separe',
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
      const rows = returningRows<{ id: string }>(
        await em.query(
          `UPDATE devis_line
            SET pu_vente = $1, pu_vente_force = $2, updated_at = now()
          WHERE id = $3 RETURNING id`,
          [puVente != null ? String(puVente) : null, force, lineId],
        ),
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
        `SELECT coefficients, st_types, tva_rate, remise_type, remise_valeur,
                arrondi_pas, arrondi_mode, pv_impose, frais_mode
           FROM sale_sheet WHERE devis_version_id = $1`,
        [versionId],
      );
      if (rows.length === 0) {
        return {
          configured: false, byNature: null, stTypes: [], remise: null, tvaRate: null,
          arrondi: null, pvImpose: null, fraisMode: 'separe', fraisAnnexes,
        };
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
        stTypes: c.st_types ?? [],
        arrondi: { pas: String(c.arrondi_pas ?? 0), mode: c.arrondi_mode ?? 'proche' },
        pvImpose: c.pv_impose != null ? String(c.pv_impose) : null,
        fraisMode: c.frais_mode ?? 'separe',
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
   * Builds the priced items of a version. An OUVRAGE line is the priced unit: its déboursé comes
   * from its editable copied children (ressource lines) when present (M.4), otherwise from the
   * live library breakdown. A RESSOURCE line is priced only when standalone (not a child of an
   * ouvrage — those are the ouvrage's sous-détail). Effective quantity of a child = ouvrage qty ×
   * line qty × (1 + perte%). A forced unit sale price (pu_vente_force) becomes forcedPv.
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
      st_type_id: string | null;
      ventilation_base: 'propre' | 'st' | 'all' | null;
      quantity: string | null;
      pu: string | null;
      perte: string | null;
      pu_vente: string | null;
      pu_vente_force: boolean;
      vendable: boolean;
      section_type: 'option' | 'variante' | null;
    }> = await em.query(
      `SELECT dl.id, dl.parent_line_id, dl.type, dl.source_ouvrage_id, dl.source_resource_id,
              dl.nature, r.nature AS resource_nature, dl.st_type_id, dl.ventilation_base,
              dl.quantity, dl.pu, dl.perte, dl.pu_vente, dl.pu_vente_force, dl.vendable, dl.section_type
         FROM devis_line dl
         LEFT JOIN resource r ON r.id = dl.source_resource_id
        WHERE dl.devis_version_id = $1`,
      [versionId],
    );

    const byId = new Map(lines.map((l) => [l.id, l]));
    // Include both ressource AND ouvrage children of ouvrages in sous-détail map.
    const childrenByParent = new Map<string, typeof lines>();
    for (const l of lines) {
      if (!l.parent_line_id) continue;
      const parent = byId.get(l.parent_line_id);
      if (parent?.type === 'ouvrage' && (l.type === 'ressource' || l.type === 'ouvrage')) {
        const arr = childrenByParent.get(l.parent_line_id) ?? [];
        arr.push(l);
        childrenByParent.set(l.parent_line_id, arr);
      }
    }

    // Compute unit nature breakdown (debours per 1 unit) for a sub-ouvrage — memoised.
    const unitBreakdownCache = new Map<string, Partial<Record<Nature, Decimal>>>();
    const computeUnitBreakdown = (l: (typeof lines)[number]): Partial<Record<Nature, Decimal>> => {
      const cached = unitBreakdownCache.get(l.id);
      if (cached) return cached;
      const result: Partial<Record<Nature, Decimal>> = {};
      for (const c of childrenByParent.get(l.id) ?? []) {
        const childFactor = new Decimal(c.quantity ?? 0).times(
          new Decimal(1).plus(new Decimal(c.perte ?? 0).dividedBy(100)),
        );
        if (c.type === 'ressource') {
          const n: Nature = c.nature ?? c.resource_nature ?? 'material';
          result[n] = (result[n] ?? new Decimal(0)).plus(new Decimal(c.pu ?? 0).times(childFactor));
        } else if (c.type === 'ouvrage') {
          const sub = computeUnitBreakdown(c);
          for (const n of NATURES) {
            if (sub[n]) result[n] = (result[n] ?? new Decimal(0)).plus(sub[n]!.times(childFactor));
          }
        }
      }
      unitBreakdownCache.set(l.id, result);
      return result;
    };

    // A line's section (option/variante) is inherited from the nearest ancestor that carries one.
    const resolveSection = (start: (typeof lines)[number]): SectionKind => {
      let cur: (typeof lines)[number] | undefined = start;
      while (cur) {
        if (cur.section_type) {
          return cur.section_type;
        }
        cur = cur.parent_line_id ? byId.get(cur.parent_line_id) : undefined;
      }
      return 'main';
    };

    const addNature = (
      bucket: Partial<Record<Nature, string>>,
      nature: Nature,
      amount: Decimal,
    ) => {
      bucket[nature] = new Decimal(bucket[nature] ?? 0).plus(amount).toString();
    };
    // Sous-traitance TYPÉE : le déboursé part dans son propre seau (taux du type), sinon il
    // reste dans la nature « subcontract » (repli sur les taux de la nature).
    const addSt = (
      bucket: Partial<Record<string, string>>,
      typeId: string,
      amount: Decimal,
    ) => {
      bucket[typeId] = new Decimal(bucket[typeId] ?? 0).plus(amount).toString();
    };
    const routeDebourse = (
      byNature: Partial<Record<Nature, string>>,
      bySt: Partial<Record<string, string>>,
      line: { nature: Nature | null; resource_nature: Nature | null; st_type_id: string | null },
      nature: Nature,
      amount: Decimal,
    ) => {
      if (nature === 'subcontract' && line.st_type_id) {
        addSt(bySt, line.st_type_id, amount);
      } else {
        addNature(byNature, nature, amount);
      }
    };
    const effQty = (l: (typeof lines)[number], ouvrageQty: Decimal) =>
      ouvrageQty
        .times(new Decimal(l.quantity ?? 0))
        .times(new Decimal(1).plus(new Decimal(l.perte ?? 0).dividedBy(100)));

    const items: VenteItemInput[] = [];
    for (const l of lines) {
      // Children of an ouvrage (ressource or sub-ouvrage) are sous-détail — priced via their parent.
      const parent = l.parent_line_id ? byId.get(l.parent_line_id) : undefined;
      if ((l.type === 'ressource' || l.type === 'ouvrage') && parent?.type === 'ouvrage') {
        continue;
      }
      if (l.type !== 'ouvrage' && l.type !== 'ressource') {
        continue;
      }
      const qty = new Decimal(l.quantity ?? 0);
      const debourseByNature: Partial<Record<Nature, string>> = {};
      const debourseBySt: Partial<Record<string, string>> = {};

      if (l.type === 'ouvrage') {
        const children = childrenByParent.get(l.id) ?? [];
        if (children.length > 0) {
          // déboursé agrégé depuis le sous-détail copié & éditable
          for (const c of children) {
            if (c.type === 'ressource') {
              const nature: Nature = c.nature ?? c.resource_nature ?? 'material';
              routeDebourse(debourseByNature, debourseBySt, c, nature,
                new Decimal(c.pu ?? 0).times(effQty(c, qty)));
            } else if (c.type === 'ouvrage') {
              // sub-ouvrage : contribution = unit_breakdown × parent_qty × child_qty × (1+perte)
              const sub = computeUnitBreakdown(c);
              for (const n of NATURES) {
                if (sub[n]) addNature(debourseByNature, n, sub[n]!.times(effQty(c, qty)));
              }
            }
          }
        } else if (l.source_ouvrage_id) {
          const unit = breakdowns.get(l.source_ouvrage_id) ?? zeroBreakdown();
          for (const n of NATURES) {
            debourseByNature[n] = unit[n].times(qty).toString();
          }
        }
      } else {
        // ressource autonome (sous un titre) : pu × qty × (1+perte)
        const nature: Nature = l.nature ?? l.resource_nature ?? 'material';
        routeDebourse(debourseByNature, debourseBySt, l, nature,
          new Decimal(l.pu ?? 0).times(effQty(l, new Decimal(1))));
      }

      const forcedPv =
        l.pu_vente_force && l.pu_vente != null
          ? new Decimal(l.pu_vente).times(qty).toString()
          : null;

      items.push({
        id: l.id,
        vendable: l.vendable,
        debourseByNature,
        debourseBySt,
        ventilationBase: l.ventilation_base ?? undefined,
        forcedPv,
        section: resolveSection(l),
      });
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
      `SELECT coefficients, st_types, tva_rate, remise_type, remise_valeur,
              arrondi_pas, arrondi_mode, pv_impose, frais_mode
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
    // Taux propres à chaque type de sous-traitance déclaré sur CE devis.
    const stRates = Object.fromEntries(
      (c.st_types ?? []).map((t: { id: string; tauxFg?: string; tauxBenefice?: string }) => [
        t.id,
        { tauxFg: String(t.tauxFg ?? 0), tauxBenefice: String(t.tauxBenefice ?? 0) },
      ]),
    ) as Record<string, NatureSaleRate>;
    const remiseValeur = new Decimal(c.remise_valeur ?? 0);
    return {
      byNature,
      stRates,
      arrondi:
        c.arrondi_pas != null && Number(c.arrondi_pas) > 0
          ? { pas: String(c.arrondi_pas), mode: (c.arrondi_mode ?? 'proche') as 'proche' | 'sup' | 'inf' }
          : null,
      pvImpose: c.pv_impose != null ? String(c.pv_impose) : null,
      fraisMode: (c.frais_mode ?? 'separe') as 'separe' | 'inclus',
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

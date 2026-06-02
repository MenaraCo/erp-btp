import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import Decimal from 'decimal.js';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { runInTenant } from '../../core/tenancy/tenant-transaction';
import {
  CalcComponent,
  CalcOuvrage,
  NATURES,
  NatureBreakdown,
  computeNatureBreakdownMap,
  zeroBreakdown,
} from './ouvrage-calc';
import {
  SaleCoefficients,
  VenteItemInput,
  VenteResult,
  computeFeuilleDeVente,
} from './vente-calc';

export interface SaleSheetInput {
  byNature: { labor: number | string; material: number | string; equipment: number | string; subcontract: number | string };
  fraisCoefficient?: number | string;
  tvaRate?: number | string;
}

const DEFAULT_COEFFS: SaleCoefficients = {
  byNature: { labor: '1', material: '1', equipment: '1', subcontract: '1' },
  fraisCoefficient: '1',
  tvaRate: '0.20',
};

@Injectable()
export class VenteService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly context: TenantContext,
  ) {}

  /** Upserts the sale coefficients of a version. */
  setSaleSheet(versionId: string, input: SaleSheetInput) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const version = await em.query(`SELECT id FROM affaire_version WHERE id = $1`, [versionId]);
      if (version.length === 0) {
        throw new NotFoundException(`Unknown version "${versionId}"`);
      }
      const coefficients = JSON.stringify({
        labor: String(input.byNature.labor),
        material: String(input.byNature.material),
        equipment: String(input.byNature.equipment),
        subcontract: String(input.byNature.subcontract),
      });
      return (
        await em.query(
          `INSERT INTO sale_sheet (tenant_id, affaire_version_id, coefficients, frais_coefficient, tva_rate)
           VALUES ($1, $2, $3::jsonb, $4, $5)
           ON CONFLICT (affaire_version_id)
           DO UPDATE SET coefficients = EXCLUDED.coefficients,
                         frais_coefficient = EXCLUDED.frais_coefficient,
                         tva_rate = EXCLUDED.tva_rate, updated_at = now()
           RETURNING *`,
          [
            tenantId,
            versionId,
            coefficients,
            String(input.fraisCoefficient ?? 1),
            String(input.tvaRate ?? 0.2),
          ],
        )
      )[0];
    });
  }

  /** Computes the feuille de vente of a version (rules #2 and #3). */
  computeForVersion(versionId: string): Promise<VenteResult> {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const version = await em.query(`SELECT id FROM affaire_version WHERE id = $1`, [versionId]);
      if (version.length === 0) {
        throw new NotFoundException(`Unknown version "${versionId}"`);
      }

      const coeffs = await this.loadCoefficients(em, versionId);
      const breakdowns = await this.loadOuvrageBreakdowns(em);

      const lines = await em.query(
        `SELECT id, source_ouvrage_id, quantity, pu, vendable
           FROM devis_line
          WHERE affaire_version_id = $1 AND type = 'ouvrage' AND source_ouvrage_id IS NOT NULL`,
        [versionId],
      );

      const items: VenteItemInput[] = lines.map(
        (l: {
          id: string;
          source_ouvrage_id: string;
          quantity: string | null;
          pu: string | null;
          vendable: boolean;
        }) => {
          const unit = breakdowns.get(l.source_ouvrage_id) ?? zeroBreakdown();
          const qty = new Decimal(l.quantity ?? 0);
          const debourseByNature: Record<string, string> = {};
          for (const n of NATURES) {
            debourseByNature[n] = unit[n].times(qty).toString();
          }
          const forcedPv = l.pu != null ? new Decimal(l.pu).times(qty).toString() : null;
          return { id: l.id, vendable: l.vendable, debourseByNature, forcedPv };
        },
      );

      return computeFeuilleDeVente(items, coeffs);
    });
  }

  private async loadCoefficients(
    em: EntityManager,
    versionId: string,
  ): Promise<SaleCoefficients> {
    const rows = await em.query(
      `SELECT coefficients, frais_coefficient, tva_rate FROM sale_sheet WHERE affaire_version_id = $1`,
      [versionId],
    );
    if (rows.length === 0) {
      return DEFAULT_COEFFS;
    }
    const c = rows[0];
    return {
      byNature: c.coefficients,
      fraisCoefficient: String(c.frais_coefficient),
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

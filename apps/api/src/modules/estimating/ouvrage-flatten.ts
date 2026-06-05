import Decimal from 'decimal.js';
import { Nature } from './ouvrage-calc';

/**
 * Pure flatten of a library ouvrage into its resource leaves (cahier des charges §5.2, M.4).
 *
 * When an ouvrage is dropped into a devis, its sous-détail is COPIED into editable child lines,
 * decoupled from the library. This expands the ouvrage recursively to resource leaves, preserving
 * each resource's nature and unit cost; percentage components are snapshotted as one extra line
 * (their amount, pro rata the non-percentage base). Quantities are expressed per 1 unit of the
 * root ouvrage. Decimal arithmetic only.
 */
export interface RawComponent {
  kind: 'resource' | 'sub_ouvrage' | 'percentage';
  quantity?: Decimal.Value;
  rate?: Decimal.Value;
  childOuvrageId?: string | null;
  resourceId?: string | null;
  code?: string | null;
  designation?: string;
  nature?: Nature;
  unit?: string | null;
  unitCost?: Decimal.Value;
}

export interface RawOuvrage {
  id: string;
  components: RawComponent[];
}

export interface FlatComponent {
  resourceId: string | null;
  code: string | null;
  designation: string;
  nature: Nature;
  unit: string | null;
  /** déboursé unitaire de la ressource */
  unitCost: string;
  /** quantité par unité d'ouvrage racine (le "ratio") */
  qtyPerUnit: string;
}

export class CycleDetectedError extends Error {
  constructor(public readonly ouvrageId: string) {
    super(`Cycle detected in ouvrage composition at "${ouvrageId}"`);
    this.name = 'CycleDetectedError';
  }
}

interface InternalFlat {
  resourceId: string | null;
  code: string | null;
  designation: string;
  nature: Nature;
  unit: string | null;
  unitCost: Decimal;
  qtyPerUnit: Decimal;
}

function flattenInternal(
  rootId: string,
  byId: Map<string, RawOuvrage>,
  visiting: Set<string>,
): InternalFlat[] {
  if (visiting.has(rootId)) {
    throw new CycleDetectedError(rootId);
  }
  const ouvrage = byId.get(rootId);
  if (!ouvrage) {
    return [];
  }
  visiting.add(rootId);

  const out: InternalFlat[] = [];
  let base = new Decimal(0); // déboursé unitaire des composants non-pourcentage
  let rateTotal = new Decimal(0);

  for (const c of ouvrage.components) {
    if (c.kind === 'resource') {
      const qty = new Decimal(c.quantity ?? 0);
      const cost = new Decimal(c.unitCost ?? 0);
      out.push({
        resourceId: c.resourceId ?? null,
        code: c.code ?? null,
        designation: c.designation ?? 'Ressource',
        nature: c.nature ?? 'material',
        unit: c.unit ?? null,
        unitCost: cost,
        qtyPerUnit: qty,
      });
      base = base.plus(qty.times(cost));
    } else if (c.kind === 'sub_ouvrage' && c.childOuvrageId) {
      const qty = new Decimal(c.quantity ?? 0);
      const childFlat = flattenInternal(c.childOuvrageId, byId, new Set(visiting));
      for (const cf of childFlat) {
        out.push({ ...cf, qtyPerUnit: cf.qtyPerUnit.times(qty) });
        base = base.plus(qty.times(cf.qtyPerUnit).times(cf.unitCost));
      }
    } else if (c.kind === 'percentage') {
      rateTotal = rateTotal.plus(new Decimal(c.rate ?? 0));
    }
  }

  if (rateTotal.greaterThan(0) && base.greaterThan(0)) {
    out.push({
      resourceId: null,
      code: null,
      designation: `Frais (${rateTotal.times(100).toString()} %)`,
      nature: 'material',
      unit: null,
      unitCost: base.times(rateTotal),
      qtyPerUnit: new Decimal(1),
    });
  }

  visiting.delete(rootId);
  return out;
}

export function flattenOuvrageToResources(
  rootId: string,
  ouvragesById: Map<string, RawOuvrage>,
): FlatComponent[] {
  return flattenInternal(rootId, ouvragesById, new Set()).map((f) => ({
    resourceId: f.resourceId,
    code: f.code,
    designation: f.designation,
    nature: f.nature,
    unit: f.unit,
    unitCost: f.unitCost.toString(),
    qtyPerUnit: f.qtyPerUnit.toString(),
  }));
}

import Decimal from 'decimal.js';
import { AnalyticalNature } from '../analytical/analytical-plan.config';

/**
 * Pure ascending aggregation along the analytical axis (cahier des charges §5.8):
 * ressource/famille → lot → nature → total. This helper only SUMS metrics up the tree; the
 * derived indicators (écart, EAC, marge prévisionnelle…) are computed by the formula engine
 * (B.2). Keeping summation isolated and pure makes both independently testable.
 */

/** A metric is any named cost measure carried by a row (budget, engagé, réalisé…). */
export type Metrics = Record<string, string | number>;

export interface AnalyticalPlanFamille {
  id: string;
  code: string;
  label: string;
}
export interface AnalyticalPlanLot {
  id: string;
  code: string;
  label: string;
  familles: AnalyticalPlanFamille[];
}
export interface AnalyticalPlanNode {
  nature: AnalyticalNature;
  label: string;
  lots: AnalyticalPlanLot[];
}

/** A cost measure attributed to a famille (or only to a nature when famille is unknown). */
export interface MeasureRow {
  familleId?: string | null;
  nature: AnalyticalNature;
  metrics: Metrics;
}

export interface AggregatedFamille {
  id: string;
  code: string;
  label: string;
  metrics: Record<string, string>;
}
export interface AggregatedLot {
  id: string;
  code: string;
  label: string;
  metrics: Record<string, string>;
  familles: AggregatedFamille[];
}
export interface AggregatedNature {
  nature: AnalyticalNature;
  label: string;
  metrics: Record<string, string>;
  /** measures attributed to this nature but to no known famille (engagé/réalisé not yet imputed) */
  unallocated: Record<string, string>;
  lots: AggregatedLot[];
}
export interface AnalyticalAggregate {
  natures: AggregatedNature[];
  total: Record<string, string>;
}

type Acc = Map<string, Decimal>;

function addInto(acc: Acc, metrics: Metrics): void {
  for (const [key, value] of Object.entries(metrics)) {
    acc.set(key, (acc.get(key) ?? new Decimal(0)).plus(new Decimal(value)));
  }
}

function mergeInto(acc: Acc, other: Acc): void {
  for (const [key, value] of other) {
    acc.set(key, (acc.get(key) ?? new Decimal(0)).plus(value));
  }
}

/** Renders an accumulator to plain strings; every metric key seen anywhere is present. */
function render(acc: Acc, keys: Set<string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of keys) {
    out[key] = (acc.get(key) ?? new Decimal(0)).toString();
  }
  return out;
}

export function aggregateAnalytical(
  plan: AnalyticalPlanNode[],
  rows: MeasureRow[],
  knownMetrics: string[] = [],
): AnalyticalAggregate {
  // Every metric key to expose (zero-filled) on all nodes: the caller's declared vocabulary plus
  // any key actually seen in the rows. Declaring it lets empty data still render 0s.
  const metricKeys = new Set<string>(knownMetrics);
  for (const r of rows) {
    for (const k of Object.keys(r.metrics)) metricKeys.add(k);
  }

  // Index measures by famille, and per-nature unallocated buckets.
  const byFamille = new Map<string, Acc>();
  const unallocatedByNature = new Map<AnalyticalNature, Acc>();
  const knownFamilleNatures = new Map<string, AnalyticalNature>();
  for (const node of plan) {
    for (const lot of node.lots) {
      for (const fam of lot.familles) knownFamilleNatures.set(fam.id, node.nature);
    }
  }

  for (const row of rows) {
    const isKnown = row.familleId != null && knownFamilleNatures.has(row.familleId);
    if (isKnown) {
      const acc = byFamille.get(row.familleId!) ?? new Map();
      addInto(acc, row.metrics);
      byFamille.set(row.familleId!, acc);
    } else {
      const acc = unallocatedByNature.get(row.nature) ?? new Map();
      addInto(acc, row.metrics);
      unallocatedByNature.set(row.nature, acc);
    }
  }

  const total: Acc = new Map();
  const natures: AggregatedNature[] = plan.map((node) => {
    const natureAcc: Acc = new Map();
    const lots: AggregatedLot[] = node.lots.map((lot) => {
      const lotAcc: Acc = new Map();
      const familles: AggregatedFamille[] = lot.familles.map((fam) => {
        const famAcc = byFamille.get(fam.id) ?? new Map();
        mergeInto(lotAcc, famAcc);
        return { id: fam.id, code: fam.code, label: fam.label, metrics: render(famAcc, metricKeys) };
      });
      mergeInto(natureAcc, lotAcc);
      return { id: lot.id, code: lot.code, label: lot.label, metrics: render(lotAcc, metricKeys), familles };
    });
    const unallocated = unallocatedByNature.get(node.nature) ?? new Map();
    mergeInto(natureAcc, unallocated);
    mergeInto(total, natureAcc);
    return {
      nature: node.nature,
      label: node.label,
      metrics: render(natureAcc, metricKeys),
      unallocated: render(unallocated, metricKeys),
      lots,
    };
  });

  return { natures, total: render(total, metricKeys) };
}

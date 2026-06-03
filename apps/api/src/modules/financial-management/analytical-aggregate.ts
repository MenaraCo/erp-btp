import Decimal from 'decimal.js';
import { AnalyticalNature } from '../analytical/analytical-plan.config';

/**
 * Pure ascending aggregation along the analytical axis (cahier des charges §5.8):
 * code analytique → famille → lot → nature → total. This helper only SUMS metrics up the tree;
 * derived indicators (écart, EAC, marge…) are computed by the formula engine (B.2). Keeping
 * summation isolated and pure makes both independently testable.
 */

export type Metrics = Record<string, string | number>;

export interface AnalyticalPlanCode {
  id: string;
  code: string;
  label: string;
}
export interface AnalyticalPlanFamille {
  id: string;
  code: string;
  label: string;
  codes: AnalyticalPlanCode[];
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

/** A cost measure attributed to a code analytique (or only to a nature when the code is unknown). */
export interface MeasureRow {
  codeId?: string | null;
  nature: AnalyticalNature;
  metrics: Metrics;
}

interface Rendered {
  metrics: Record<string, string>;
}
export interface AggregatedCode extends Rendered {
  id: string;
  code: string;
  label: string;
}
export interface AggregatedFamille extends Rendered {
  id: string;
  code: string;
  label: string;
  codes: AggregatedCode[];
}
export interface AggregatedLot extends Rendered {
  id: string;
  code: string;
  label: string;
  familles: AggregatedFamille[];
}
export interface AggregatedNature extends Rendered {
  nature: AnalyticalNature;
  label: string;
  /** measures attributed to this nature but to no known code analytique */
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
  for (const [key, value] of other) acc.set(key, (acc.get(key) ?? new Decimal(0)).plus(value));
}
function render(acc: Acc, keys: Set<string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of keys) out[key] = (acc.get(key) ?? new Decimal(0)).toString();
  return out;
}

export function aggregateAnalytical(
  plan: AnalyticalPlanNode[],
  rows: MeasureRow[],
  knownMetrics: string[] = [],
): AnalyticalAggregate {
  const metricKeys = new Set<string>(knownMetrics);
  for (const r of rows) for (const k of Object.keys(r.metrics)) metricKeys.add(k);

  const knownCodes = new Set<string>();
  for (const n of plan) for (const l of n.lots) for (const f of l.familles) for (const c of f.codes) knownCodes.add(c.id);

  const byCode = new Map<string, Acc>();
  const unallocatedByNature = new Map<AnalyticalNature, Acc>();
  for (const row of rows) {
    if (row.codeId != null && knownCodes.has(row.codeId)) {
      const acc = byCode.get(row.codeId) ?? new Map();
      addInto(acc, row.metrics);
      byCode.set(row.codeId, acc);
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
        const famAcc: Acc = new Map();
        const codes: AggregatedCode[] = fam.codes.map((code) => {
          const codeAcc = byCode.get(code.id) ?? new Map();
          mergeInto(famAcc, codeAcc);
          return { id: code.id, code: code.code, label: code.label, metrics: render(codeAcc, metricKeys) };
        });
        mergeInto(lotAcc, famAcc);
        return { id: fam.id, code: fam.code, label: fam.label, metrics: render(famAcc, metricKeys), codes };
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

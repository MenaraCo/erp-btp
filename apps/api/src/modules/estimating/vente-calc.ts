import Decimal from 'decimal.js';
import { Nature, NATURES, NatureBreakdown, zeroBreakdown } from './ouvrage-calc';

/**
 * Pure feuille de vente engine (cahier des charges §5.2, rules #2 and #3).
 *
 * Cascade (per nature, then aggregated):
 *   déboursé_nature → ×(1 + FG%)       = prix de revient_nature
 *                   → ×(1 + Bénéfice%) = prix de vente_nature
 * FG (frais généraux) and Bénéfice are configured separately per nature, so the prix de revient
 * is a distinct, traceable intermediate — this is what makes marge brute (PV − déboursé) and
 * marge nette (PV − prix de revient) two different KPIs.
 *
 * Rule #2 — déboursé → prix de vente: each nature's déboursé runs the cascade; the applied
 * FG/Bénéfice are returned for traceability. A forced PV is honoured but flagged (forced=true)
 * with the computed PV kept as reference.
 *
 * Rule #3 — ventilation: the déboursé of non-vendable items (titres / frais de chantier) is
 * spread over vendable items pro rata their déboursé. The ventilated amount keeps its nature, so
 * it runs the same per-nature cascade. Ventilation conserves the total déboursé.
 *
 * On top of the lines: frais annexes (named list, % of PV hors frais or fixed amount) are added,
 * then a global remise (% or fixed) is subtracted, then TVA is applied.
 */
export const PV_SCALE = 2;
const COEFF_SCALE = 4;

export type FraisType = 'pct' | 'fixe';

export interface NatureSaleRate {
  /** frais généraux, as a percentage (e.g. '10' = 10%) */
  tauxFg: Decimal.Value;
  /** bénéfice, as a percentage (e.g. '15' = 15%) */
  tauxBenefice: Decimal.Value;
}

export interface FraisAnnexe {
  designation: string;
  type: FraisType;
  /** pct: percentage of PV hors frais (e.g. '2' = 2%); fixe: absolute amount */
  valeur: Decimal.Value;
}

export interface Remise {
  type: FraisType;
  /** pct: percentage of PV devis (e.g. '5' = 5%); fixe: absolute amount */
  valeur: Decimal.Value;
}

export type SectionKind = 'main' | 'option' | 'variante';
export type VentilationBase = 'propre' | 'st' | 'all';
export type ArrondiMode = 'proche' | 'sup' | 'inf';

/** Arrondi commercial du PV de ligne : pas (0.01, 1, 5, 10…) et sens. */
export interface ArrondiRule {
  pas: Decimal.Value;
  mode?: ArrondiMode;
}

export interface VenteItemInput {
  id: string;
  debourseByNature?: Partial<Record<Nature, Decimal.Value>>;
  /**
   * Déboursé de sous-traitance ventilé par TYPE de ST (types définis par devis, ex. « moyens »,
   * « compétence »). Chaque type porte ses propres FG/bénéfice. Une ligne de ST sans type
   * reste dans debourseByNature.subcontract et suit les taux de la nature.
   */
  debourseBySt?: Partial<Record<string, Decimal.Value>>;
  vendable: boolean;
  /**
   * Base de ventilation d'une ligne de FRAIS (non vendable), à la manière d'ONAYA :
   *  - 'propre' : les frais ne pèsent que sur la part propre (MO / matériaux / matériel)
   *  - 'st'     : ils ne pèsent que sur la sous-traitance
   *  - 'all'    : sur l'ensemble du déboursé (défaut, comportement historique)
   * Si la base choisie est absente du devis, on retombe sur l'ensemble : aucun frais perdu.
   */
  ventilationBase?: VentilationBase;
  /** explicit PV override (memorised, line-level "pv forcé") */
  forcedPv?: Decimal.Value | null;
  /** option/variante are priced but excluded from the contract total; default 'main' */
  section?: SectionKind;
}

export interface SaleCoefficients {
  byNature: Record<Nature, NatureSaleRate>;
  /** Taux propres à chaque TYPE de sous-traitance (clé = id du type, défini par devis). */
  stRates?: Record<string, NatureSaleRate>;
  fraisAnnexes?: FraisAnnexe[];
  remise?: Remise | null;
  /**
   * Traitement des frais annexes :
   *  - 'separe' (défaut) : poste distinct ajouté après les lignes, visible sur le devis ;
   *  - 'inclus'          : montant NOYÉ dans les PV de ligne (au prorata), donc invisible
   *                        pour le client. Le total HT est identique dans les deux cas.
   */
  fraisMode?: 'separe' | 'inclus';
  /** Arrondi appliqué au PV CALCULÉ de chaque ligne (un PV forcé reste tel quel). */
  arrondi?: ArrondiRule | null;
  /**
   * PV total imposé (hors frais annexes et remise). Les lignes NON forcées sont ajustées au
   * prorata pour atteindre ce total ; les lignes au PV forcé sont conservées telles quelles.
   */
  pvImpose?: Decimal.Value | null;
  tvaRate: Decimal.Value;
}

export interface VenteItemResult {
  id: string;
  /** déboursé of the line, ventilated frais included */
  debourse: string;
  ventilatedFrais: string;
  /** déboursé × (1 + FG) per nature, aggregated */
  revient: string;
  pvComputed: string;
  pv: string;
  forced: boolean;
  margeBrute: string;
  margeNette: string;
  section: SectionKind;
  appliedRates: Record<Nature, { fg: string; benefice: string }>;
  /** Déboursé de la ligne ventilé par nature (la sous-traitance agrège tous les types de ST). */
  debourseByNature: Record<Nature, string>;
  /** Déboursé ventilé par type de sous-traitance (vide si le devis n'en définit pas). */
  debourseBySt?: Record<string, string>;
  /** Taux appliqués à chaque type de ST, pour traçabilité. */
  appliedStRates?: Record<string, { fg: string; benefice: string }>;
}

export interface VenteResult {
  items: VenteItemResult[];
  totalDebourse: string;
  totalRevient: string;
  /** Σ des PV de ligne (forcés ou calculés), avant frais annexes & remise */
  pvHorsFrais: string;
  fraisAnnexes: string;
  /** Montant des frais noyés dans les PV de ligne (mode « inclus »), pour traçabilité. */
  fraisAnnexesIntegres?: string;
  pvDevis: string;
  remise: string;
  /** PV net = pvDevis − remise ; base de la TVA (nom conservé pour compat) */
  totalPvHt: string;
  margeBrute: string;
  margeNette: string;
  coeffGlobalReel: string;
  /** true si un PV imposé a pu être appliqué */
  pvImposeApplied?: boolean;
  /** coefficient d'ajustement appliqué aux lignes non forcées pour atteindre le PV imposé */
  coeffAjustement?: string;
  /** PV des options (hors total principal) */
  optionsPvHt: string;
  /** PV des variantes (hors total principal) */
  variantesPvHt: string;
  tva: string;
  totalTtc: string;
}

function round2(value: Decimal): Decimal {
  return value.toDecimalPlaces(PV_SCALE, Decimal.ROUND_HALF_UP);
}

function toBreakdown(input: Partial<Record<Nature, Decimal.Value>> | undefined): NatureBreakdown {
  const b = zeroBreakdown();
  for (const n of NATURES) {
    if (input?.[n] != null) {
      b[n] = new Decimal(input[n] as Decimal.Value);
    }
  }
  return b;
}

function sum(b: NatureBreakdown): Decimal {
  return NATURES.reduce((acc, n) => acc.plus(b[n]), new Decimal(0));
}

/**
 * Déboursé de sous-traitance par type. Un type absent du paramétrage du devis retombe sur les
 * taux de la nature « subcontract » : on ne perd jamais de déboursé (règle #3).
 */
type StBreakdown = Record<string, Decimal>;

function toStBreakdown(input: Partial<Record<string, Decimal.Value>> | undefined): StBreakdown {
  const b: StBreakdown = {};
  for (const [k, v] of Object.entries(input ?? {})) {
    if (v != null) {
      b[k] = new Decimal(v as Decimal.Value);
    }
  }
  return b;
}

function sumSt(b: StBreakdown): Decimal {
  return Object.values(b).reduce((acc, v) => acc.plus(v), new Decimal(0));
}

/** Taux applicables à un type de ST, avec repli sur la nature « sous-traitance ». */
function stRateOf(coeffs: SaleCoefficients, typeId: string): NatureSaleRate {
  return coeffs.stRates?.[typeId] ?? coeffs.byNature.subcontract ?? { tauxFg: 0, tauxBenefice: 0 };
}

/** Arrondit une valeur au pas demandé (0 ou absent = pas d'arrondi). */
function applyArrondi(value: Decimal, rule: ArrondiRule | null | undefined): Decimal {
  if (!rule) return value;
  const pas = new Decimal(rule.pas ?? 0);
  if (pas.lessThanOrEqualTo(0)) return value;
  const q = value.dividedBy(pas);
  const rounded =
    rule.mode === 'sup' ? q.ceil() : rule.mode === 'inf' ? q.floor() : q.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  return rounded.times(pas);
}

/** Frais annexes amount: pct items apply to the PV hors frais, fixe items are added as-is. */
function computeFraisAnnexes(frais: FraisAnnexe[], pvHorsFrais: Decimal): Decimal {
  return frais.reduce((acc, f) => {
    const v = new Decimal(f.valeur);
    return acc.plus(f.type === 'pct' ? pvHorsFrais.times(v).dividedBy(100) : v);
  }, new Decimal(0));
}

/** Remise amount: pct applies to the PV devis, fixe is the amount itself. */
function computeRemise(remise: Remise | null | undefined, pvDevis: Decimal): Decimal {
  if (!remise) {
    return new Decimal(0);
  }
  const v = new Decimal(remise.valeur);
  return remise.type === 'pct' ? pvDevis.times(v).dividedBy(100) : v;
}

/** Prices one item from its effective déboursé breakdown (ventilation already folded in). */
function priceItem(
  input: VenteItemInput,
  effBreakdown: NatureBreakdown,
  effSt: StBreakdown,
  ownDebourse: Decimal,
  coeffs: SaleCoefficients,
  section: SectionKind,
): VenteItemResult {
  let debourse = new Decimal(0);
  let revient = new Decimal(0);
  let pvComputed = new Decimal(0);
  const appliedRates = {} as Record<Nature, { fg: string; benefice: string }>;
  const appliedStRates: Record<string, { fg: string; benefice: string }> = {};

  const applyRate = (eff: Decimal, rate: NatureSaleRate) => {
    const fg = new Decimal(rate.tauxFg);
    const ben = new Decimal(rate.tauxBenefice);
    const revientN = eff.times(new Decimal(1).plus(fg.dividedBy(100)));
    const pvN = revientN.times(new Decimal(1).plus(ben.dividedBy(100)));
    debourse = debourse.plus(eff);
    revient = revient.plus(revientN);
    pvComputed = pvComputed.plus(pvN);
    return { fg: fg.toString(), benefice: ben.toString() };
  };

  for (const n of NATURES) {
    const rate = coeffs.byNature[n] ?? { tauxFg: 0, tauxBenefice: 0 };
    appliedRates[n] = applyRate(effBreakdown[n], rate);
  }
  // Chaque type de sous-traitance suit SES propres taux (repli sur la nature « subcontract »).
  for (const [typeId, eff] of Object.entries(effSt)) {
    appliedStRates[typeId] = applyRate(eff, stRateOf(coeffs, typeId));
  }

  const ventilatedFrais = debourse.minus(ownDebourse);
  pvComputed = round2(pvComputed);
  const forced = input.forcedPv != null;
  // Un PV forcé est une décision explicite : on ne lui applique pas l'arrondi commercial.
  const pv = forced
    ? round2(new Decimal(input.forcedPv as Decimal.Value))
    : round2(applyArrondi(pvComputed, coeffs.arrondi));

  const stTotal = sumSt(effSt);
  return {
    id: input.id,
    debourse: round2(debourse).toString(),
    ventilatedFrais: round2(ventilatedFrais).toString(),
    revient: round2(revient).toString(),
    pvComputed: pvComputed.toString(),
    pv: pv.toString(),
    forced,
    margeBrute: round2(pv.minus(debourse)).toString(),
    margeNette: round2(pv.minus(revient)).toString(),
    section,
    appliedRates,
    // La ligne « sous-traitance » agrège les types de ST : les consommateurs existants
    // (récap déboursé, synthèse par ouvrage) restent justes sans changement.
    debourseByNature: Object.fromEntries(
      NATURES.map((n) => [
        n,
        round2(n === 'subcontract' ? effBreakdown[n].plus(stTotal) : effBreakdown[n]).toString(),
      ]),
    ) as Record<Nature, string>,
    debourseBySt: Object.fromEntries(
      Object.entries(effSt).map(([k, v]) => [k, round2(v).toString()]),
    ),
    appliedStRates,
  };
}

export function computeFeuilleDeVente(
  items: VenteItemInput[],
  coeffs: SaleCoefficients,
): VenteResult {
  const tvaRate = new Decimal(coeffs.tvaRate);

  const prepared = items.map((it) => ({
    input: it,
    breakdown: toBreakdown(it.debourseByNature),
    st: toStBreakdown(it.debourseBySt),
    section: it.section ?? 'main',
  }));

  // Only "main" items count in the contract total and in frais ventilation.
  const main = prepared.filter((p) => p.section === 'main');
  const extras = prepared.filter((p) => p.section !== 'main');
  const vendable = main.filter((p) => p.input.vendable);

  // « Part propre » = MO + matériaux + matériel ; « ST » = sous-traitance (nature + types).
  const PROPRE: Nature[] = ['labor', 'material', 'equipment'];
  const basePropre = (p: (typeof prepared)[number]) =>
    PROPRE.reduce((acc, n) => acc.plus(p.breakdown[n]), new Decimal(0));
  const baseSt = (p: (typeof prepared)[number]) =>
    p.breakdown.subcontract.plus(sumSt(p.st));
  const baseOf = (p: (typeof prepared)[number], b: VentilationBase) =>
    b === 'propre' ? basePropre(p) : b === 'st' ? baseSt(p) : basePropre(p).plus(baseSt(p));

  // Frais (lignes non vendables) regroupés PAR BASE de ventilation : chaque groupe se répartit
  // sur sa propre assiette (part propre / ST / tout), au prorata à l'intérieur de celle-ci.
  const BASES: VentilationBase[] = ['propre', 'st', 'all'];
  const fraisGroups = new Map<
    VentilationBase,
    { byNature: NatureBreakdown; bySt: StBreakdown; total: Decimal }
  >();
  for (const b of BASES) {
    fraisGroups.set(b, { byNature: zeroBreakdown(), bySt: {}, total: new Decimal(0) });
  }
  for (const p of main) {
    if (p.input.vendable) continue;
    const b = p.input.ventilationBase ?? 'all';
    const g = fraisGroups.get(b)!;
    for (const n of NATURES) {
      g.byNature[n] = g.byNature[n].plus(p.breakdown[n]);
    }
    // Les frais de sous-traitance restent rattachés à LEUR type : la part ventilée sera
    // margée aux taux de ce type, pas à ceux de la nature générique.
    for (const [k, v] of Object.entries(p.st)) {
      g.bySt[k] = (g.bySt[k] ?? new Decimal(0)).plus(v);
    }
    g.total = g.total.plus(sum(p.breakdown)).plus(sumSt(p.st));
  }

  // Assiette de chaque base ; si elle est vide (ex. frais « ST » mais aucune sous-traitance
  // vendable), on retombe sur l'assiette totale pour ne perdre aucun frais.
  const denomOf = new Map<VentilationBase, { denom: Decimal; effective: VentilationBase }>();
  const denomAll = vendable.reduce((acc, p) => acc.plus(baseOf(p, 'all')), new Decimal(0));
  for (const b of BASES) {
    const d = vendable.reduce((acc, p) => acc.plus(baseOf(p, b)), new Decimal(0));
    denomOf.set(b, d.isZero() ? { denom: denomAll, effective: 'all' } : { denom: d, effective: b });
  }

  const fraisTotal = BASES.reduce((acc, b) => acc.plus(fraisGroups.get(b)!.total), new Decimal(0));
  const vendableDebourseTotal = denomAll;

  const results: VenteItemResult[] = [];
  let totalDebourse = new Decimal(0);
  let totalRevient = new Decimal(0);
  let pvHorsFrais = new Decimal(0);

  for (const p of vendable) {
    const ownDebourse = sum(p.breakdown).plus(sumSt(p.st));
    const eff = zeroBreakdown();
    for (const n of NATURES) {
      eff[n] = p.breakdown[n];
    }
    const effSt: StBreakdown = { ...p.st };
    // Chaque groupe de frais se répartit au prorata de la part de CETTE ligne dans son assiette.
    for (const b of BASES) {
      const g = fraisGroups.get(b)!;
      if (g.total.isZero()) continue;
      const { denom, effective } = denomOf.get(b)!;
      if (denom.isZero()) continue;
      const share = baseOf(p, effective).dividedBy(denom);
      if (share.isZero()) continue;
      for (const n of NATURES) {
        eff[n] = eff[n].plus(g.byNature[n].times(share));
      }
      for (const [k, v] of Object.entries(g.bySt)) {
        effSt[k] = (effSt[k] ?? new Decimal(0)).plus(v.times(share));
      }
    }
    const r = priceItem(p.input, eff, effSt, ownDebourse, coeffs, 'main');
    results.push(r);
    totalDebourse = totalDebourse.plus(r.debourse);
    totalRevient = totalRevient.plus(r.revient);
    pvHorsFrais = pvHorsFrais.plus(r.pv);
  }

  // Options / variantes : priced standalone (no ventilation), excluded from the contract total.
  let optionsPvHt = new Decimal(0);
  let variantesPvHt = new Decimal(0);
  for (const p of extras) {
    const own = sum(p.breakdown).plus(sumSt(p.st));
    const r = priceItem(p.input, p.breakdown, p.st, own, coeffs, p.section);
    results.push(r);
    if (p.section === 'option') {
      optionsPvHt = optionsPvHt.plus(r.pv);
    } else {
      variantesPvHt = variantesPvHt.plus(r.pv);
    }
  }

  pvHorsFrais = round2(pvHorsFrais);

  // ── PV imposé : on ajuste au prorata les lignes NON forcées pour atteindre le total voulu.
  // Les lignes au PV forcé sont des décisions explicites : elles restent intactes et le
  // solde est absorbé par les autres. Déboursé et prix de revient ne bougent pas.
  let pvImposeApplied = false;
  let coeffAjustement = '1';
  const target = coeffs.pvImpose != null ? new Decimal(coeffs.pvImpose) : null;
  if (target != null) {
    const mainResults = results.filter((r) => r.section === 'main');
    const forcedTotal = mainResults
      .filter((r) => r.forced)
      .reduce((acc, r) => acc.plus(new Decimal(r.pv)), new Decimal(0));
    const freeResults = mainResults.filter((r) => !r.forced);
    const freeTotal = freeResults.reduce((acc, r) => acc.plus(new Decimal(r.pv)), new Decimal(0));
    const remaining = target.minus(forcedTotal);
    if (!freeTotal.isZero()) {
      const k = remaining.dividedBy(freeTotal);
      coeffAjustement = k.toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toString();
      let running = new Decimal(0);
      freeResults.forEach((r, i) => {
        // La dernière ligne absorbe le résidu d'arrondi : le total colle exactement à la cible.
        const raw = new Decimal(r.pv).times(k);
        const pv = i === freeResults.length - 1 ? remaining.minus(running) : round2(raw);
        running = running.plus(pv);
        const debourse = new Decimal(r.debourse);
        const revient = new Decimal(r.revient);
        r.pv = round2(pv).toString();
        r.margeBrute = round2(pv.minus(debourse)).toString();
        r.margeNette = round2(pv.minus(revient)).toString();
      });
      pvHorsFrais = round2(target);
      pvImposeApplied = true;
    }
  }

  let fraisAnnexesMt = round2(computeFraisAnnexes(coeffs.fraisAnnexes ?? [], pvHorsFrais));
  let fraisIntegres = new Decimal(0);

  // Mode « noyé » : les frais annexes sont dilués dans les PV de ligne au prorata, de sorte que
  // le client ne voit aucun poste de frais — seuls les prix unitaires augmentent. Les lignes au
  // PV forcé sont préservées (décision explicite) et les autres absorbent le montant.
  if (coeffs.fraisMode === 'inclus' && !fraisAnnexesMt.isZero()) {
    const mainResults = results.filter((r) => r.section === 'main');
    const free = mainResults.filter((r) => !r.forced);
    const target = free.length > 0 ? free : mainResults;
    const base = target.reduce((acc, r) => acc.plus(new Decimal(r.pv)), new Decimal(0));
    if (!base.isZero()) {
      let running = new Decimal(0);
      target.forEach((r, i) => {
        const share = new Decimal(r.pv).dividedBy(base).times(fraisAnnexesMt);
        // La dernière ligne absorbe le résidu : la somme colle exactement au montant des frais.
        const add = i === target.length - 1 ? fraisAnnexesMt.minus(running) : round2(share);
        running = running.plus(add);
        const pv = new Decimal(r.pv).plus(add);
        r.pv = round2(pv).toString();
        r.margeBrute = round2(pv.minus(new Decimal(r.debourse))).toString();
        r.margeNette = round2(pv.minus(new Decimal(r.revient))).toString();
      });
      pvHorsFrais = round2(pvHorsFrais.plus(fraisAnnexesMt));
      fraisIntegres = fraisAnnexesMt;
      fraisAnnexesMt = new Decimal(0);
    }
  }

  const pvDevis = pvHorsFrais.plus(fraisAnnexesMt);
  const remiseMt = round2(computeRemise(coeffs.remise, pvDevis));
  const pvNet = pvDevis.minus(remiseMt);

  const tva = round2(pvNet.times(tvaRate));
  const totalTtc = pvNet.plus(tva);
  const coeffGlobalReel = totalDebourse.isZero()
    ? new Decimal(0)
    : pvHorsFrais.dividedBy(totalDebourse).toDecimalPlaces(COEFF_SCALE, Decimal.ROUND_HALF_UP);

  return {
    items: results,
    totalDebourse: round2(totalDebourse).toString(),
    totalRevient: round2(totalRevient).toString(),
    pvHorsFrais: pvHorsFrais.toString(),
    fraisAnnexes: fraisAnnexesMt.toString(),
    fraisAnnexesIntegres: fraisIntegres.toString(),
    pvDevis: round2(pvDevis).toString(),
    remise: remiseMt.toString(),
    totalPvHt: round2(pvNet).toString(),
    margeBrute: round2(pvNet.minus(totalDebourse)).toString(),
    margeNette: round2(pvNet.minus(totalRevient)).toString(),
    coeffGlobalReel: coeffGlobalReel.toString(),
    pvImposeApplied,
    coeffAjustement,
    optionsPvHt: round2(optionsPvHt).toString(),
    variantesPvHt: round2(variantesPvHt).toString(),
    tva: tva.toString(),
    totalTtc: round2(totalTtc).toString(),
  };
}

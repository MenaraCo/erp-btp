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
  /**
   * Traitement de CE poste :
   *  - 'separe' : ligne visible sur le devis, sous SON PROPRE intitulé ;
   *  - 'inclus' : montant noyé dans les prix unitaires, invisible pour le client.
   * À défaut, on retombe sur le mode par défaut du devis (SaleCoefficients.fraisMode).
   */
  mode?: 'separe' | 'inclus';
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
  /**
   * Déboursé ventilé par TYPE DE DÉBOURSÉ paramétrable (référentiel société ou type propre au
   * devis) : « ST Moyens », « Location », « Intérim »… Chaque type porte ses propres FG/bénéfice
   * et se rattache à une nature de base, qui recevra le déboursé dans les récapitulatifs.
   * Successeur de `debourseBySt`, qui reste accepté pour les devis déjà chiffrés.
   */
  debourseByType?: Partial<Record<string, Decimal.Value>>;
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
  /** Taux propres à chaque TYPE de sous-traitance (ancien nom, conservé pour l'existant). */
  stRates?: Record<string, NatureSaleRate>;
  /** Taux propres à chaque type de déboursé (clé = id du type). Successeur de `stRates`. */
  typeRates?: Record<string, NatureSaleRate>;
  /**
   * Nature de base de chaque type : elle décide où le déboursé du type est agrégé (récapitulatifs,
   * budgets de chantier, axe analytique) et sert de repli quand le type n'a pas de taux propres.
   * Type inconnu ici → sous-traitance, comportement d'origine des types de ST.
   */
  typeBaseNature?: Record<string, Nature>;
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
  /** Montant de frais généraux porté par la ligne, par nature — repris en frais de chantier. */
  fgByNature?: Record<Nature, string>;
  /** Idem par type de sous-traitance. */
  fgBySt?: Record<string, string>;
}

export interface FraisChantier {
  fgByNature: Record<Nature, string>;
  /** FG par type de sous-traitance (clé = identifiant du type dans le devis). */
  fgBySt: Record<string, string>;
  /** Tous les postes de frais annexes, NOYÉS COMME SÉPARÉS : le chantier les supporte tous. */
  postes: { designation: string; montant: string; mode: 'inclus' | 'separe' }[];
  total: string;
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
  /**
   * Postes de frais SÉPARÉS, un par un et dans l'ordre de saisie — jamais regroupés :
   * l'édition doit reprendre l'intitulé de chaque poste.
   */
  fraisDetail?: { designation: string; montant: string }[];
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
  /**
   * Frais de chantier repris à l'exécution : frais généraux (par nature et par type de
   * sous-traitance) + postes de frais annexes. Le suivi de chantier en fait son budget de frais,
   * sans quoi le chantier démarrerait avec un budget amputé de tout ce qui n'est pas déboursé
   * direct. Le bénéfice en est exclu : ce n'est pas un coût.
   */
  fraisChantier?: FraisChantier;
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

/** Nature de base d'un type de déboursé (repli historique : la sous-traitance). */
function baseNatureOf(coeffs: SaleCoefficients, typeId: string): Nature {
  return coeffs.typeBaseNature?.[typeId] ?? 'subcontract';
}

/** Taux applicables à un type, avec repli sur les taux de sa nature de rattachement. */
function stRateOf(coeffs: SaleCoefficients, typeId: string): NatureSaleRate {
  return (
    coeffs.typeRates?.[typeId] ??
    coeffs.stRates?.[typeId] ??
    coeffs.byNature[baseNatureOf(coeffs, typeId)] ?? { tauxFg: 0, tauxBenefice: 0 }
  );
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

/** Montant d'un poste : un pourcentage porte TOUJOURS sur le PV hors frais. */
function montantFrais(f: FraisAnnexe, pvHorsFrais: Decimal): Decimal {
  const v = new Decimal(f.valeur);
  return f.type === 'pct' ? pvHorsFrais.times(v).dividedBy(100) : v;
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

  // Montant de FG porté par la ligne, seau par seau : c'est lui que le chantier reprendra en
  // frais de chantier (le bénéfice, lui, n'est pas un coût et n'a rien à y faire).
  const fgByNature = {} as Record<Nature, string>;
  const fgBySt: Record<string, string> = {};

  const applyRate = (eff: Decimal, rate: NatureSaleRate) => {
    const fg = new Decimal(rate.tauxFg);
    const ben = new Decimal(rate.tauxBenefice);
    const revientN = eff.times(new Decimal(1).plus(fg.dividedBy(100)));
    const pvN = revientN.times(new Decimal(1).plus(ben.dividedBy(100)));
    debourse = debourse.plus(eff);
    revient = revient.plus(revientN);
    pvComputed = pvComputed.plus(pvN);
    return { fg: fg.toString(), benefice: ben.toString(), montantFg: revientN.minus(eff) };
  };

  for (const n of NATURES) {
    const rate = coeffs.byNature[n] ?? { tauxFg: 0, tauxBenefice: 0 };
    const applied = applyRate(effBreakdown[n], rate);
    appliedRates[n] = { fg: applied.fg, benefice: applied.benefice };
    fgByNature[n] = round2(applied.montantFg).toString();
  }
  // Chaque type de sous-traitance suit SES propres taux (repli sur la nature « subcontract »).
  for (const [typeId, eff] of Object.entries(effSt)) {
    const applied = applyRate(eff, stRateOf(coeffs, typeId));
    appliedStRates[typeId] = { fg: applied.fg, benefice: applied.benefice };
    fgBySt[typeId] = round2(applied.montantFg).toString();
  }

  const ventilatedFrais = debourse.minus(ownDebourse);
  pvComputed = round2(pvComputed);
  const forced = input.forcedPv != null;
  // Un PV forcé est une décision explicite : on ne lui applique pas l'arrondi commercial.
  const pv = forced
    ? round2(new Decimal(input.forcedPv as Decimal.Value))
    : round2(applyArrondi(pvComputed, coeffs.arrondi));

  // Chaque type verse son déboursé dans sa nature de rattachement : c'est cette nature que
  // lisent les récapitulatifs, les budgets de chantier et l'axe analytique.
  const stByNature = zeroBreakdown();
  for (const [typeId, v] of Object.entries(effSt)) {
    const n = baseNatureOf(coeffs, typeId);
    stByNature[n] = stByNature[n].plus(v);
  }
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
      NATURES.map((n) => [n, round2(effBreakdown[n].plus(stByNature[n])).toString()]),
    ) as Record<Nature, string>,
    debourseBySt: Object.fromEntries(
      Object.entries(effSt).map(([k, v]) => [k, round2(v).toString()]),
    ),
    appliedStRates,
    fgByNature,
    fgBySt,
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
    st: toStBreakdown({ ...(it.debourseBySt ?? {}), ...(it.debourseByType ?? {}) }),
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

  // Chaque poste suit SON mode (à défaut, le mode par défaut du devis). Les pourcentages
  // portent tous sur le même PV hors frais, avant toute dilution : le résultat ne dépend
  // donc pas de l'ordre de saisie des postes.
  const baseHorsFrais = pvHorsFrais;
  const fraisDetail: { designation: string; montant: string }[] = [];
  const fraisPostes: FraisChantier['postes'] = [];
  let fraisAnnexesMt = new Decimal(0);
  let fraisAIntegrer = new Decimal(0);
  for (const f of coeffs.fraisAnnexes ?? []) {
    const mt = round2(montantFrais(f, baseHorsFrais));
    const mode = (f.mode ?? coeffs.fraisMode ?? 'separe') as 'inclus' | 'separe';
    // Noyé ou séparé ne regarde que l'ÉDITION du devis : le chantier supporte le poste dans
    // les deux cas, il doit donc figurer au budget de frais quel que soit le mode.
    fraisPostes.push({ designation: f.designation, montant: mt.toString(), mode });
    if (mode === 'inclus') {
      fraisAIntegrer = fraisAIntegrer.plus(mt);
    } else {
      fraisAnnexesMt = fraisAnnexesMt.plus(mt);
      fraisDetail.push({ designation: f.designation, montant: mt.toString() });
    }
  }
  let fraisIntegres = new Decimal(0);

  // Postes « noyés » : dilués dans les PV de ligne au prorata, de sorte que le client ne voie
  // aucun poste — seuls les prix unitaires augmentent. Les lignes au PV forcé sont préservées
  // (décision explicite) et les autres absorbent le montant.
  if (!fraisAIntegrer.isZero()) {
    const fraisAnnexesMtIncl = fraisAIntegrer;
    const mainResults = results.filter((r) => r.section === 'main');
    const free = mainResults.filter((r) => !r.forced);
    const target = free.length > 0 ? free : mainResults;
    const base = target.reduce((acc, r) => acc.plus(new Decimal(r.pv)), new Decimal(0));
    if (!base.isZero()) {
      let running = new Decimal(0);
      target.forEach((r, i) => {
        const share = new Decimal(r.pv).dividedBy(base).times(fraisAnnexesMtIncl);
        // La dernière ligne absorbe le résidu : la somme colle exactement au montant des frais.
        const add = i === target.length - 1 ? fraisAnnexesMtIncl.minus(running) : round2(share);
        running = running.plus(add);
        const pv = new Decimal(r.pv).plus(add);
        r.pv = round2(pv).toString();
        r.margeBrute = round2(pv.minus(new Decimal(r.debourse))).toString();
        r.margeNette = round2(pv.minus(new Decimal(r.revient))).toString();
      });
      pvHorsFrais = round2(pvHorsFrais.plus(fraisAnnexesMtIncl));
      fraisIntegres = fraisAnnexesMtIncl;
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

  // Frais de chantier : FG de toutes les lignes du tronc commun (options et variantes exclues,
  // elles ne sont pas commandées) + tous les postes de frais annexes.
  const fgByNature = zeroBreakdown();
  const fgBySt: Record<string, Decimal> = {};
  for (const r of results) {
    if (r.section !== 'main') continue;
    for (const n of NATURES) {
      fgByNature[n] = fgByNature[n].plus(new Decimal(r.fgByNature?.[n] ?? 0));
    }
    for (const [k, v] of Object.entries(r.fgBySt ?? {})) {
      fgBySt[k] = (fgBySt[k] ?? new Decimal(0)).plus(new Decimal(v));
    }
  }
  const fgTotal = NATURES.reduce((acc, n) => acc.plus(fgByNature[n]), new Decimal(0)).plus(
    Object.values(fgBySt).reduce((acc, v) => acc.plus(v), new Decimal(0)),
  );
  const postesTotal = fraisPostes.reduce((acc, p) => acc.plus(new Decimal(p.montant)), new Decimal(0));
  const fraisChantier: FraisChantier = {
    fgByNature: Object.fromEntries(
      NATURES.map((n) => [n, round2(fgByNature[n]).toString()]),
    ) as Record<Nature, string>,
    fgBySt: Object.fromEntries(Object.entries(fgBySt).map(([k, v]) => [k, round2(v).toString()])),
    postes: fraisPostes,
    total: round2(fgTotal.plus(postesTotal)).toString(),
  };

  return {
    items: results,
    fraisChantier,
    totalDebourse: round2(totalDebourse).toString(),
    totalRevient: round2(totalRevient).toString(),
    pvHorsFrais: pvHorsFrais.toString(),
    fraisAnnexes: fraisAnnexesMt.toString(),
    fraisAnnexesIntegres: fraisIntegres.toString(),
    fraisDetail,
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

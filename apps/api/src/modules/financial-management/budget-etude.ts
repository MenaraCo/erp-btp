import Decimal from 'decimal.js';
import { EntityManager } from 'typeorm';
import { CalcComponent, CalcOuvrage } from '../estimating/ouvrage-calc';
import { computeBucketBreakdownMap } from '../estimating/bucket-breakdown';

/** Clé de regroupement d'une ressource sans code analytique : « non réparti » de sa nature. */
export const UNALLOC_PREFIX = '__unalloc__:';

/** Ce sur quoi on veut voir le budget d'étude : le code analytique, ou la ressource elle-même. */
export type CleBudget = 'code' | 'ressource';

/**
 * Ce qu'on additionne : des euros (quantité × prix) ou des QUANTITÉS (les heures du budget de
 * main-d'œuvre). Le même parcours d'arbre sert aux deux — un sous-ouvrage multiplie ses quantités
 * comme il multiplie ses montants —, il suffit de compter chaque ressource pour 1 au lieu de son
 * prix. Deux calculs séparés finiraient par diverger d'une décimale, et le budget d'heures ne
 * correspondrait plus à celui d'euros.
 */
export type MesureBudget = 'montant' | 'quantite';

export interface BudgetEtude {
  /** bucket → montant. Bucket = id du code analytique (ou de la ressource), sinon `__unalloc__:nature`. */
  parBucket: Map<string, Decimal>;
  /** Total des lignes non vendables (frais de chantier repris du devis). */
  fraisChantier: Decimal;
  /**
   * Le même total, mais DÉTAILLÉ par bucket.
   *
   * Un frais annexe (compte prorata, heures d'insertion…) se ventile comme n'importe quelle
   * dépense : une fois son code analytique renseigné, il doit apparaître sous ce code. L'agréger
   * en un seul bloc anonyme faisait disparaître la ventilation que le conducteur venait de faire.
   */
  fraisParBucket: Map<string, Decimal>;
}

interface CompRow {
  execution_line_id: string;
  kind: string;
  child_line_id: string | null;
  quantite_objectif: string | null;
  rate: string | null;
  nature: string | null;
  unit_cost_objectif: string | null;
  code_id: string | null;
  resource_id: string | null;
}
interface LineRow {
  id: string;
  parent_line_id: string | null;
  vendable: boolean;
  quantite_objectif: string | null;
}

/**
 * Budget d'étude d'exécution = quantités objectif × prix objectif, remontées jusqu'aux ouvrages
 * de tête. C'est le budget CALCULÉ : il ne se saisit pas, il découle de l'étude.
 *
 * Le même calcul sert deux lectures — par code analytique (le tableau de bord) et par ressource
 * (le ripage, qui déplace du budget d'une ressource vers une autre). Une seule fonction pour les
 * deux : deux implémentations finiraient par diverger d'un centime, et le total ne tomberait plus.
 */
export async function budgetEtude(
  em: EntityManager,
  chantierId: string,
  cle: CleBudget = 'code',
  mesure: MesureBudget = 'montant',
): Promise<BudgetEtude> {
  const lines: LineRow[] = await em.query(
    `SELECT id, parent_line_id, vendable, quantite_objectif
       FROM execution_line WHERE chantier_id = $1`,
    [chantierId],
  );
  // Code analytique = celui de la nomenclature DE CHANTIER (copiée au transfert), jamais celui de
  // la bibliothèque d'étude : les deux catalogues vivent séparément (§5.5).
  const comps: CompRow[] = await em.query(
    `SELECT ec.execution_line_id, ec.kind, ec.child_line_id, ec.quantite_objectif, ec.rate,
            n.nature, n.unit_cost_objectif, n.code_analytique_id AS code_id, n.id AS resource_id
       FROM execution_component ec
       JOIN execution_line el ON el.id = ec.execution_line_id
       LEFT JOIN nomenclature_resource n ON n.id = ec.nomenclature_resource_id
      WHERE el.chantier_id = $1`,
    [chantierId],
  );

  const map = new Map<string, CalcOuvrage>();
  for (const l of lines) map.set(l.id, { id: l.id, components: [] });
  for (const c of comps) {
    const parent = map.get(c.execution_line_id);
    if (!parent) continue;
    const comp: CalcComponent = {
      kind: c.kind === 'sub_line' ? 'sub_ouvrage' : c.kind === 'resource' ? 'resource' : 'percentage',
    };
    if (c.kind === 'resource') {
      comp.quantity = c.quantite_objectif ?? 0;
      comp.unitCost = mesure === 'quantite' ? 1 : c.unit_cost_objectif ?? 0;
      const defaut = `${UNALLOC_PREFIX}${c.nature ?? 'material'}`;
      comp.bucket = cle === 'ressource' ? c.resource_id ?? defaut : c.code_id ?? defaut;
    } else if (c.kind === 'sub_line') {
      comp.quantity = c.quantite_objectif ?? 0;
      comp.childOuvrageId = c.child_line_id ?? undefined;
    } else {
      comp.rate = c.rate ?? 0;
    }
    parent.components.push(comp);
  }

  const breakdown = computeBucketBreakdownMap(map);
  const parBucket = new Map<string, Decimal>();
  const fraisParBucket = new Map<string, Decimal>();
  let fraisChantier = new Decimal(0);

  const cumule = (cible: Map<string, Decimal>, bucket: string, montant: Decimal) => {
    cible.set(bucket, (cible.get(bucket) ?? new Decimal(0)).plus(montant));
  };

  for (const l of lines) {
    if (l.parent_line_id) continue; // le budget se lit sur les ouvrages de tête
    const unit = breakdown.get(l.id) ?? {};
    const qty = new Decimal(l.quantite_objectif ?? 0);
    const cible = l.vendable ? parBucket : fraisParBucket;
    for (const [bucket, value] of Object.entries(unit)) {
      const montant = value.times(qty);
      cumule(cible, bucket, montant);
      if (!l.vendable) fraisChantier = fraisChantier.plus(montant);
    }
  }

  return { parBucket, fraisChantier, fraisParBucket };
}

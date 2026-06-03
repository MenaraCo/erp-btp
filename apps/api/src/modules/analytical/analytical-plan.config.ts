/**
 * "Plan modèle" — the canonical analytical plan template (cahier des charges §5.8).
 *
 * Duplicated into a tenant's own rows at setup (and, later, per société at company creation).
 * Application code never hard-codes a lot/famille; it reads the tenant's duplicated plan. This
 * template is only the starting point a tenant then tailors.
 *
 * Hierarchy: nature (fixed) → lot → famille. The estimating resource carries the analytical code
 * and attaches to a famille, so its position nature → lot → famille drives automatic imputation.
 */

export const ANALYTICAL_NATURES = ['material', 'equipment', 'subcontract', 'labor'] as const;
export type AnalyticalNature = (typeof ANALYTICAL_NATURES)[number];

export const NATURE_LABELS: Record<AnalyticalNature, string> = {
  material: 'Matériaux',
  equipment: 'Matériel',
  subcontract: 'Sous-traitance',
  labor: "Main d'œuvre",
};

export interface FamilleTemplate {
  code: string;
  label: string;
}

export interface LotTemplate {
  code: string;
  label: string;
  nature: AnalyticalNature;
  familles: FamilleTemplate[];
}

/**
 * Starter plan: a handful of lots/familles per nature. Codes are illustrative société analytical
 * codes; a tenant renames/extends them. Resources later point at a famille and carry their own
 * analytical code (e.g. COLLE = 280).
 */
export const ANALYTICAL_PLAN_TEMPLATE: LotTemplate[] = [
  {
    code: 'MAT-GO',
    label: 'Gros œuvre',
    nature: 'material',
    familles: [
      { code: 'MAT-GO-BET', label: 'Bétons' },
      { code: 'MAT-GO-ACI', label: 'Aciers' },
      { code: 'MAT-GO-COF', label: 'Coffrage' },
    ],
  },
  {
    code: 'MAT-SOL',
    label: 'Sols durs',
    nature: 'material',
    familles: [
      { code: 'MAT-SOL-COL', label: 'Colles' },
      { code: 'MAT-SOL-CAR', label: 'Carrelage' },
    ],
  },
  {
    code: 'MAT-ETA',
    label: 'Étanchéité',
    nature: 'material',
    familles: [
      { code: 'MAT-ETA-MEM', label: 'Membranes' },
      { code: 'MAT-ETA-RES', label: 'Résines' },
    ],
  },
  {
    code: 'EQP-ENG',
    label: 'Engins & matériel',
    nature: 'equipment',
    familles: [
      { code: 'EQP-ENG-LOC', label: 'Location engins' },
      { code: 'EQP-ENG-PET', label: 'Petit matériel' },
    ],
  },
  {
    code: 'STR-GEN',
    label: 'Sous-traitance générale',
    nature: 'subcontract',
    familles: [
      { code: 'STR-GEN-ETA', label: 'Sous-traitance étanchéité' },
      { code: 'STR-GEN-ELE', label: 'Sous-traitance électricité' },
    ],
  },
  {
    code: 'MO-PROD',
    label: 'Main d’œuvre production',
    nature: 'labor',
    familles: [
      { code: 'MO-PROD-MAC', label: 'Maçons' },
      { code: 'MO-PROD-CAR', label: 'Carreleurs' },
      { code: 'MO-PROD-PEI', label: 'Peintres' },
    ],
  },
];

/**
 * "Plan modèle" — the canonical analytical plan template (cahier des charges §5.8).
 *
 * Duplicated into a tenant's own rows at setup (and, later, per société at company creation).
 * Application code never hard-codes a level; it reads the tenant's duplicated plan. This template
 * is only the starting point a tenant then tailors.
 *
 * Hierarchy (5 levels): nature (fixed) → lot → famille → CODE ANALYTIQUE (n° société, ex. COLLE=280)
 * → ressource. A resource attaches to exactly one code analytique and inherits famille→lot→nature.
 */

export const ANALYTICAL_NATURES = ['material', 'equipment', 'subcontract', 'labor'] as const;
export type AnalyticalNature = (typeof ANALYTICAL_NATURES)[number];

export const NATURE_LABELS: Record<AnalyticalNature, string> = {
  material: 'Matériaux',
  equipment: 'Matériel',
  subcontract: 'Sous-traitance',
  labor: "Main d'œuvre",
};

export interface CodeTemplate {
  /** Numéro de code analytique propre à la société (ex. 280). */
  code: string;
  label: string;
}
export interface FamilleTemplate {
  code: string;
  label: string;
  codes: CodeTemplate[];
}
export interface LotTemplate {
  code: string;
  label: string;
  nature: AnalyticalNature;
  familles: FamilleTemplate[];
}

/** Starter plan : lots / familles / codes analytiques par nature. Numéros illustratifs. */
export const ANALYTICAL_PLAN_TEMPLATE: LotTemplate[] = [
  {
    code: 'MAT-GO',
    label: 'Gros œuvre',
    nature: 'material',
    familles: [
      { code: 'MAT-GO-BET', label: 'Bétons', codes: [{ code: '200', label: 'Béton prêt à l’emploi' }] },
      { code: 'MAT-GO-ACI', label: 'Aciers', codes: [{ code: '210', label: 'Armatures acier' }] },
      { code: 'MAT-GO-COF', label: 'Coffrage', codes: [{ code: '300', label: 'Banches / coffrage' }] },
    ],
  },
  {
    code: 'MAT-SOL',
    label: 'Sols durs',
    nature: 'material',
    familles: [
      { code: 'MAT-SOL-COL', label: 'Colles', codes: [{ code: '280', label: 'Colle' }] },
      { code: 'MAT-SOL-CAR', label: 'Carrelage', codes: [{ code: '290', label: 'Carrelage' }] },
    ],
  },
  {
    code: 'MAT-ETA',
    label: 'Étanchéité',
    nature: 'material',
    familles: [
      { code: 'MAT-ETA-MEM', label: 'Membranes', codes: [{ code: '320', label: 'Membranes étanchéité' }] },
      { code: 'MAT-ETA-RES', label: 'Résines', codes: [{ code: '330', label: 'Résines' }] },
    ],
  },
  {
    code: 'EQP-ENG',
    label: 'Engins & matériel',
    nature: 'equipment',
    familles: [
      { code: 'EQP-ENG-LOC', label: 'Location engins', codes: [{ code: '600', label: 'Location engins' }] },
      { code: 'EQP-ENG-PET', label: 'Petit matériel', codes: [{ code: '610', label: 'Petit matériel' }] },
    ],
  },
  {
    code: 'STR-GEN',
    label: 'Sous-traitance générale',
    nature: 'subcontract',
    familles: [
      { code: 'STR-GEN-ETA', label: 'Sous-traitance étanchéité', codes: [{ code: '700', label: 'ST étanchéité' }] },
      { code: 'STR-GEN-ELE', label: 'Sous-traitance électricité', codes: [{ code: '710', label: 'ST électricité' }] },
    ],
  },
  {
    code: 'MO-PROD',
    label: 'Main d’œuvre production',
    nature: 'labor',
    familles: [
      { code: 'MO-PROD-MAC', label: 'Maçons', codes: [{ code: '500', label: 'MO maçonnerie' }] },
      { code: 'MO-PROD-CAR', label: 'Carreleurs', codes: [{ code: '510', label: 'MO carrelage' }] },
      { code: 'MO-PROD-PEI', label: 'Peintres', codes: [{ code: '520', label: 'MO peinture' }] },
    ],
  },
];

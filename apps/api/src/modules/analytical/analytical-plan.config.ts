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

/**
 * Catégorie d'un code analytique (l'« A.R.C. » d'Onaya, typée charges ou produits).
 *
 * Les quatre NATURES ci-dessus décrivent une dépense ; elles ne savent pas dire « recette ». Un
 * budget de chantier qui n'affiche que des charges ne répond jamais à la question qui compte —
 * est-ce qu'on gagne de l'argent ? D'où trois catégories, et donc trois blocs de lecture :
 * charges d'exploitation, frais généraux (présentés à part : ils ne se pilotent pas comme un
 * poste de chantier) et produits, positifs (le marché) comme négatifs (prorata, retenue de
 * garantie).
 */
export const CATEGORIES_ANALYTIQUES = ['charge', 'frais_generaux', 'produit'] as const;
export type CategorieAnalytique = (typeof CATEGORIES_ANALYTIQUES)[number];

export const CATEGORIE_LABELS: Record<CategorieAnalytique, string> = {
  charge: 'Charges',
  frais_generaux: 'Frais généraux',
  produit: 'Produits',
};

/** Section d'un lot : une nature de charge, ou l'une des deux sections hors exploitation. */
export type SectionAnalytique = AnalyticalNature | 'frais_generaux' | 'produit';

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
  /** Défaut : `charge`. */
  categorie?: CategorieAnalytique;
}
export interface FamilleTemplate {
  code: string;
  label: string;
  codes: CodeTemplate[];
}
export interface LotTemplate {
  code: string;
  label: string;
  nature: SectionAnalytique;
  familles: FamilleTemplate[];
  /** Catégorie appliquée par défaut aux codes du lot. */
  categorie?: CategorieAnalytique;
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
    // Les frais généraux ont leur propre section : ils pèsent sur le résultat sans être un poste
    // de chantier qu'on pilote ouvrage par ouvrage.
    code: 'FG',
    label: 'Frais généraux',
    nature: 'frais_generaux',
    categorie: 'frais_generaux',
    familles: [
      {
        code: 'FG-GEN',
        label: 'Frais généraux',
        codes: [
          { code: '900', label: 'Frais généraux — part propre' },
          { code: '910', label: 'Frais généraux — sous-traitance' },
        ],
      },
    ],
  },
  {
    // Les produits : le marché, ses avenants, et ce qui les grève (prorata, retenue de garantie,
    // saisis en NÉGATIF). Sans eux, aucun résultat de chantier n'est calculable.
    code: 'PROD',
    label: 'Produits',
    nature: 'produit',
    categorie: 'produit',
    familles: [
      {
        code: 'PROD-TRV',
        label: 'Recettes de travaux',
        codes: [
          { code: '800', label: 'Recettes travaux (marché)' },
          { code: '810', label: 'Travaux supplémentaires / avenants' },
          { code: '860', label: 'Compte prorata' },
          { code: '870', label: 'Retenue de garantie' },
        ],
      },
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

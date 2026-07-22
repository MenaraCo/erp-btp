/**
 * Canonical commercial catalogue — the single source of truth, seeded into the database.
 *
 * The mapping module -> capabilities and pack -> modules lives here (and in the DB after
 * seeding), never as hard-coded checks in business logic. Application code always tests a
 * capability key (e.g. 'estimating.bid'), never a module or pack name (cahier des charges §3.1).
 */

export interface CapabilityDef {
  key: string;
  label: string;
}

export interface ModuleDef {
  code: string;
  label: string;
  isAddon: boolean;
  /** capability keys unlocked by this module (must exist in CAPABILITIES) */
  capabilities: string[];
  /**
   * Indicative price €HT per seat and per month (cahier des charges §3.2). `0` = included in
   * the Socle (never billed separately), `null` = "sur devis" (enterprise). All prices are
   * config-driven here — never hard-coded in business logic — and can move to a DB column later.
   */
  priceMonthly: number | null;
  /** Short marketing description shown in the subscription console. */
  description?: string;
  /**
   * Add-ons only : palier minimum requis pour pouvoir souscrire cet add-on (1 = Essentiel …
   * 4 = Pro Max). `undefined` = pas de contrainte (modules inclus dans les paliers).
   * Ex. l'Assistance IA exige au moins Pro Chantier.
   */
  minTierLevel?: number;
}

export interface PackDef {
  code: string;
  label: string;
  /** Rang du palier (1 = entrée de gamme). Plus il est élevé, plus le pack contient. */
  tierLevel: number;
  /** Prix €HT par siège et par mois du palier (valeur de départ, éditable en base). */
  priceMonthly: number;
  discountPct: number;
  /** module codes bundled by this pack (must exist in MODULES) */
  modules: string[];
  description?: string;
}

export interface QuotaDef {
  key: string;
  label: string;
  unit: string;
}

export const CAPABILITIES: CapabilityDef[] = [
  { key: 'einvoicing.facturx', label: 'Émission Factur-X' },
  { key: 'directory', label: 'Référentiel clients / fournisseurs' },
  { key: 'estimating.bid', label: 'Chiffrage et devis' },
  { key: 'estimating.advanced', label: 'Bibliothèques et fonctions avancées de chiffrage' },
  { key: 'invoicing.situations', label: 'Situations de travaux' },
  { key: 'invoicing.dgd', label: 'Décompte général définitif' },
  { key: 'site_tracking.budget', label: 'Budgets de chantier' },
  { key: 'site_tracking.timesheet', label: 'Pointages' },
  { key: 'purchasing', label: 'Chaîne des achats' },
  { key: 'stock', label: 'Stocks' },
  { key: 'equipment', label: 'Parc matériel' },
  { key: 'bim', label: 'BIM / IFC' },
  { key: 'ai_assist', label: 'Assistance IA' },
  { key: 'api_access', label: 'API et connecteurs' },
  { key: 'multi_company', label: 'Multi-société' },
  { key: 'sso', label: 'Authentification SSO' },
  { key: 'financial.dashboard', label: 'Gestion financière — tableaux de bord' },
  { key: 'financial.forecast', label: 'Gestion financière — prévisions (EAC, marge)' },
  { key: 'financial.alerts', label: 'Gestion financière — alertes' },
  { key: 'financial.portfolio', label: 'Gestion financière — portefeuille Direction' },
];

export const MODULES: ModuleDef[] = [
  {
    code: 'core',
    label: 'Socle',
    isAddon: false,
    capabilities: ['einvoicing.facturx', 'directory'],
    priceMonthly: 0,
    description:
      'Comptes, RBAC, référentiel clients/fournisseurs, e-facturation Factur-X. Inclus dès le premier module.',
  },
  {
    code: 'estimating',
    label: 'Études de prix',
    isAddon: false,
    capabilities: ['estimating.bid', 'estimating.advanced'],
    priceMonthly: 39,
    description:
      'Chiffrage, sous-détails, feuille de vente et coefficients, devis d’appel d’offre, versioning.',
  },
  {
    code: 'invoicing',
    label: 'Facturation',
    isAddon: false,
    capabilities: ['invoicing.situations', 'invoicing.dgd'],
    priceMonthly: 29,
    description:
      'Devis client, factures, situations de travaux, avenants, DGD, retenue de garantie.',
  },
  {
    code: 'site_tracking',
    label: 'Suivi de chantiers',
    isAddon: false,
    capabilities: ['site_tracking.budget', 'site_tracking.timesheet', 'purchasing'],
    priceMonthly: 49,
    description:
      'Budgets chantier, pointages terrain, chaîne des achats, résultats analytiques.',
  },
  {
    code: 'stock_equipment',
    label: 'Stocks & Parc matériel',
    isAddon: true,
    capabilities: ['stock', 'equipment'],
    priceMonthly: 19,
    description: 'Valorisation des stocks, mouvements, parc matériel et locations.',
    minTierLevel: 3,
  },
  {
    code: 'bim',
    label: 'BIM / IFC',
    isAddon: true,
    capabilities: ['bim'],
    priceMonthly: null,
    description: 'Import de maquette numérique et métré semi-automatique. Sur devis.',
    minTierLevel: 2,
  },
  {
    code: 'ai',
    label: 'Assistance IA',
    isAddon: true,
    capabilities: ['ai_assist'],
    priceMonthly: null,
    description: 'Suggestion de prix, détection d’oublis, pré-remplissage de métré. Sur devis.',
    minTierLevel: 3,
  },
  {
    code: 'api',
    label: 'API & connecteurs',
    isAddon: true,
    capabilities: ['api_access'],
    priceMonthly: null,
    description: 'API REST/GraphQL, connecteurs comptabilité/paie, export FEC. Sur devis.',
    minTierLevel: 2,
  },
  {
    code: 'enterprise',
    label: 'Entreprise (multi-société, SSO)',
    isAddon: true,
    capabilities: ['multi_company', 'sso'],
    priceMonthly: null,
    description: 'Multi-société, SSO, SLA. Offre entreprise sur devis.',
    minTierLevel: 4,
  },
  {
    code: 'financial_management',
    label: 'Gestion financière',
    isAddon: false,
    capabilities: [
      'financial.dashboard',
      'financial.forecast',
      'financial.alerts',
      'financial.portfolio',
    ],
    priceMonthly: 59,
    description:
      'Contrôle de gestion prédictif : budget avancé, écart au stade, EAC, marge prévisionnelle, alertes.',
  },
];

/**
 * L'offre est vendue en **paliers** (du plus simple au plus complet), chacun ajoutant un maillon
 * de la chaîne métier : chiffrer → facturer → suivre le chantier → piloter la marge. Les add-ons
 * restent à la carte, souscrits **par-dessus** un palier et soumis à un palier minimum.
 *
 * Les prix ici sont les valeurs de départ : après le premier seed, la base fait foi et l'éditeur
 * les modifie depuis le back-office (le cahier interdit les prix codés en dur).
 */
export const PACKS: PackDef[] = [
  {
    code: 'essentiel',
    label: 'Essentiel',
    tierLevel: 1,
    priceMonthly: 39,
    discountPct: 0,
    modules: ['core', 'estimating'],
    description: 'Chiffrez et éditez vos devis : bibliothèques, sous-détails, feuille de vente.',
  },
  {
    code: 'pro',
    label: 'Pro',
    tierLevel: 2,
    priceMonthly: 59,
    discountPct: 0,
    modules: ['core', 'estimating', 'invoicing'],
    description: 'Le cycle complet devis → facture : situations de travaux, avenants, DGD.',
  },
  {
    code: 'pro_chantier',
    label: 'Pro Chantier',
    tierLevel: 3,
    priceMonthly: 89,
    discountPct: 0,
    modules: ['core', 'estimating', 'invoicing', 'site_tracking'],
    description: 'Pilotez l’exécution : budgets de chantier, pointages terrain, chaîne des achats.',
  },
  {
    code: 'pro_max',
    label: 'Pro Max',
    tierLevel: 4,
    priceMonthly: 129,
    discountPct: 0,
    modules: ['core', 'estimating', 'invoicing', 'site_tracking', 'financial_management'],
    description:
      'Contrôle de gestion prédictif : écart au stade, prévision à terminaison, marge finale.',
  },
];

/** Rang du palier le plus élevé — utile pour valider un `minTierLevel`. */
export const MAX_TIER_LEVEL = Math.max(...PACKS.map((p) => p.tierLevel));

export const QUOTAS: QuotaDef[] = [
  { key: 'max_active_projects', label: 'Affaires/chantiers actifs', unit: 'count' },
  { key: 'storage_gb', label: 'Stockage de documents', unit: 'gb' },
  { key: 'api_rate_limit', label: 'Limite d’appels API', unit: 'req_per_min' },
];

/**
 * Catalogue des modules de l'application — source UNIQUE du menu de démarrage (les tuiles) et de
 * la barre latérale (les fonctions du module où l'on se trouve).
 *
 * Les deux se déduisent d'ici : une fonction ajoutée à un module apparaît du même coup dans sa
 * barre latérale, sans qu'on ait à la déclarer deux fois et sans risquer qu'elles divergent.
 *
 * `capabilities` liste les capacités qui OUVRENT le module : il suffit d'en tenir une. Une tuile
 * dont aucune n'est ouverte s'affiche grisée et mène à l'écran Abonnement — jamais à un 403.
 * `always: true` marque ce qui n'appartient à aucune souscription (référentiel, configuration).
 */
export interface ModuleFeature {
  href: string;
  label: string;
  /** Sous-entrée : indentée sous la précédente. */
  level?: number;
}

export interface AppModule {
  /** Segment d'URL identifiant le module ; sert aussi de clé de rattachement d'une page. */
  key: string;
  label: string;
  /** Phrase courte sur la tuile — ce que le module sert à faire. */
  tagline: string;
  /** Où mène la tuile. */
  home: string;
  /** Préfixes d'URL appartenant au module (pour retrouver le module depuis la page courante). */
  match: string[];
  capabilities?: string[];
  /** Vrai pour les modules hors souscription : jamais grisés. */
  always?: boolean;
  /**
   * Module parent, pour ce qui appartient à un espace plus large. Les Achats et la Gestion du
   * personnel sont des métiers du CHANTIER : ils ont leur espace propre (on ne travaille pas ses
   * commandes chantier par chantier), mais ils n'ont pas à encombrer le menu de démarrage à côté
   * de l'Étude de prix. Ils s'ouvrent donc depuis l'espace Chantier.
   */
  parent?: string;
  features: ModuleFeature[];
}

/**
 * Libellés commerciaux des modules du CATALOGUE (ceux qui se souscrivent et portent des jetons).
 * Distincts des tuiles de navigation ci-dessous : on ne montre jamais un code technique
 * (`estimating`, `core`…) à un client — c'est du jargon de développeur, pas du français.
 */
export const MODULE_LABELS: Record<string, string> = {
  core: 'Socle',
  estimating: 'Études de prix',
  invoicing: 'Facturation',
  site_tracking: 'Suivi de chantiers',
  financial_management: 'Gestion financière',
  stock_equipment: 'Stocks & Parc matériel',
  bim: 'BIM / IFC',
  ai: 'Assistance IA',
  api: 'API & connecteurs',
  enterprise: 'Entreprise (multi-société, SSO)',
};

/** Libellé lisible d'un module ; à défaut le code, pour ne jamais afficher une case vide. */
export function moduleLabel(code: string): string {
  return MODULE_LABELS[code] ?? code;
}

/**
 * Sous-menu CONTEXTUEL : ce qui s'ouvre quand on travaille DANS un chantier ou un marché.
 *
 * Ces écrans étaient des boutons alignés en haut de la page — on ne voyait donc plus où l'on se
 * trouvait, et il fallait revenir en arrière pour changer de vue. Ils descendent dans la barre
 * latérale, à la manière d'Onaya : le menu de gauche porte la navigation, la page ne porte que le
 * travail en cours.
 */
export interface ContextGroup {
  /** Titre de la section dans la barre latérale. */
  title: string;
  features: ModuleFeature[];
}

export function contextualGroups(pathname: string): ContextGroup[] {
  // Chantier ouvert : chaque entrée est un écran à part entière.
  const chantier = /^\/chantiers\/([^/]+)/.exec(pathname);
  if (chantier && !['bibliotheque', 'parametres'].includes(chantier[1])) {
    const id = chantier[1];
    // Les heures forment un métier à part : on les regroupe plutôt que de les mêler au reste.
    return [
      {
        title: 'Chantier ouvert',
        features: [
          { href: `/chantiers/${id}`, label: 'Fiche chantier' },
          { href: `/chantiers/${id}/structure`, label: 'Structure & budget' },
          { href: `/chantiers/${id}/achats`, label: 'Achats' },
          { href: `/chantiers/${id}/avancement`, label: 'Avancement' },
          { href: `/chantiers/${id}/mensuel`, label: 'Gestion mensuelle' },
          { href: `/chantiers/${id}/pilotage`, label: 'Pilotage' },
        ],
      },
      {
        title: 'Main d’œuvre',
        features: [
          { href: `/chantiers/${id}/calendrier`, label: 'Calendrier des heures' },
          { href: `/chantiers/${id}/pointages`, label: 'Pointages (détail)' },
          { href: `/chantiers/${id}/controle-heures`, label: 'Contrôle des heures' },
        ],
      },
    ];
  }

  // Marché ouvert : la fiche est une seule page ; les entrées mènent à ses sections.
  const marche = /^\/invoicing\/([^/]+)/.exec(pathname);
  if (marche) {
    const id = marche[1];
    return [
      {
        title: 'Marché ouvert',
        features: [
          { href: `/invoicing/${id}?vue=situations`, label: 'Situations' },
          { href: `/invoicing/${id}?vue=avenants`, label: 'Avenants' },
          { href: `/invoicing/${id}?vue=dgd`, label: 'DGD' },
        ],
      },
    ];
  }
  return [];
}

/** Capacités qui ouvrent l'acceptation de commande : facturer OU suivre des chantiers. */
export const ACCEPTANCE_CAPABILITIES = ['invoicing.situations', 'site_tracking.budget'];

export const MODULES: AppModule[] = [
  {
    key: 'estimating',
    label: 'Étude de prix',
    tagline: 'Affaires, devis, bibliothèque et feuille de vente',
    home: '/estimating/tableau-de-bord',
    match: ['/estimating'],
    capabilities: ['estimating.bid'],
    features: [
      { href: '/estimating/tableau-de-bord', label: 'Tableau de bord' },
      { href: '/estimating/planning', label: 'Planning des études' },
      { href: '/estimating', label: 'Affaires' },
      { href: '/estimating/devis', label: 'Devis' },
      { href: '/estimating/bibliotheque', label: 'Bibliothèque' },
      { href: '/estimating/bibliotheque/ouvrages', label: 'Ouvrages', level: 1 },
      { href: '/estimating/bibliotheque/ressources', label: 'Ressources', level: 1 },
      { href: '/estimating/bibliotheque/transfert', label: 'Transfert chantier', level: 1 },
      { href: '/estimating/imports', label: 'Imports' },
      { href: '/estimating/parametres', label: 'Paramètres' },
    ],
  },
  {
    key: 'acceptation',
    label: 'Acceptation de commande',
    tagline: 'Le passage du devis gagné au chantier et à sa facturation',
    home: '/acceptation',
    match: ['/acceptation'],
    capabilities: ACCEPTANCE_CAPABILITIES,
    features: [{ href: '/acceptation', label: 'Acceptation de commande' }],
  },
  {
    key: 'chantiers',
    label: 'Chantier',
    tagline: 'Chantiers, achats, personnel, matériel et stocks',
    home: '/chantier',
    match: ['/chantier', '/chantiers'],
    capabilities: ['site_tracking.budget', 'site_tracking.timesheet'],
    features: [
      { href: '/chantiers', label: 'Chantiers' },
      { href: '/chantiers/bibliotheque', label: 'Bibliothèque chantier' },
      { href: '/chantiers/parametres', label: 'Paramètres' },
    ],
  },
  {
    key: 'invoicing',
    label: 'Facturation',
    tagline: 'Situations de travaux, avenants, DGD et factures',
    home: '/invoicing',
    match: ['/invoicing'],
    capabilities: ['invoicing.situations', 'invoicing.dgd'],
    features: [{ href: '/invoicing', label: 'Facturation' }],
  },
  {
    key: 'direction',
    label: 'Direction',
    tagline: 'Portefeuille de chantiers, marges et alertes',
    home: '/direction',
    match: ['/direction'],
    capabilities: ['financial.portfolio', 'financial.dashboard'],
    features: [{ href: '/direction', label: 'Portefeuille' }],
  },
  {
    key: 'achats',
    parent: 'chantiers',
    label: 'Achats',
    tagline: 'Commandes, réceptions et factures fournisseur, tous chantiers confondus',
    home: '/achats',
    match: ['/achats'],
    capabilities: ['purchasing'],
    features: [
      { href: '/achats', label: 'Commandes' },
      { href: '/achats/receptions', label: 'Réceptions' },
      { href: '/achats/factures', label: 'Factures fournisseur' },
    ],
  },
  {
    key: 'personnel',
    parent: 'chantiers',
    label: 'Gestion du personnel',
    tagline: 'Salariés, heures, planning, congés et absences, tous chantiers confondus',
    home: '/personnel',
    match: ['/personnel'],
    capabilities: ['site_tracking.timesheet'],
    features: [
      { href: '/personnel', label: 'Occupation' },
      { href: '/personnel/planning', label: 'Planning semaine' },
      { href: '/personnel/absences', label: 'Congés & absences' },
      { href: '/personnel/conflits', label: 'Conflits' },
      { href: '/personnel/salaries', label: 'Salariés' },
    ],
  },
  {
    key: 'referentiel',
    label: 'Référentiel',
    tagline: 'Clients et fournisseurs, communs à tous les modules',
    home: '/clients',
    match: ['/clients', '/suppliers'],
    always: true,
    features: [
      { href: '/clients', label: 'Clients' },
      { href: '/suppliers', label: 'Fournisseurs' },
    ],
  },
  {
    key: 'configuration',
    label: 'Configuration',
    tagline: 'Identité de la société, utilisateurs et abonnement',
    home: '/params',
    match: ['/params', '/users', '/abonnement'],
    always: true,
    features: [
      { href: '/params', label: 'Paramètres' },
      { href: '/users', label: 'Utilisateurs' },
      { href: '/abonnement', label: 'Abonnement' },
    ],
  },
];

/**
 * Module auquel appartient une URL. Le préfixe le PLUS LONG gagne : sans cela `/clients` et
 * `/chantiers` se disputeraient les pages, et une sous-page se rattacherait au mauvais module.
 */
/** Modules du menu de démarrage : ceux qui ne vivent pas dans l'espace d'un autre. */
export function modulesRacine(): AppModule[] {
  return MODULES.filter((m) => !m.parent);
}

/** Sous-modules d'un espace (Achats et Personnel sous Chantier). */
export function sousModules(key: string): AppModule[] {
  return MODULES.filter((m) => m.parent === key);
}

/** Où mène la sortie d'un module : son espace parent, sinon le menu de démarrage. */
export function sortieDuModule(m: AppModule | null): string {
  if (!m?.parent) return '/';
  return MODULES.find((x) => x.key === m.parent)?.home ?? '/';
}

export function moduleForPath(pathname: string): AppModule | null {
  let best: AppModule | null = null;
  let bestLen = -1;
  for (const m of MODULES) {
    for (const prefix of m.match) {
      const hit = pathname === prefix || pathname.startsWith(`${prefix}/`);
      if (hit && prefix.length > bestLen) {
        best = m;
        bestLen = prefix.length;
      }
    }
  }
  return best;
}

/** Un module est ouvert si l'utilisateur tient l'une de ses capacités (ou s'il est hors offre). */
export function moduleIsOpen(m: AppModule, has: (cap: string) => boolean): boolean {
  if (m.always) return true;
  return (m.capabilities ?? []).some(has);
}

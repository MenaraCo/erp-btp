/**
 * RBAC catalogue. Permissions are a GLOBAL, config-driven list (like capabilities), seeded
 * into the database. System roles are per-tenant templates provisioned at onboarding.
 *
 * RBAC (what a user is allowed to do) is ORTHOGONAL to entitlements (has the tenant bought the
 * module + does the user hold a seat). A sensitive endpoint may carry both @RequiresCapability
 * and @RequiresPermission — both must pass.
 */

export interface PermissionDef {
  key: string;
  label: string;
}

export interface SystemRoleDef {
  code: string;
  label: string;
  /** permission keys granted (must exist in PERMISSIONS) */
  permissions: string[];
}

export const PERMISSIONS: PermissionDef[] = [
  { key: 'rbac.role.manage', label: 'Gérer les rôles' },
  { key: 'rbac.user_role.assign', label: 'Affecter des rôles aux utilisateurs' },
  { key: 'entitlements.seat.assign', label: 'Affecter des jetons' },
  { key: 'subscription.manage', label: 'Gérer la souscription' },
  { key: 'directory.read', label: 'Consulter le référentiel' },
  { key: 'directory.write', label: 'Modifier le référentiel' },
  // Deux droits SÉPARÉS de `directory.write`, pour que chaque société décide de son organisation :
  // proposer une fiche n'est pas la valider, et valider n'oblige pas à pouvoir tout modifier.
  { key: 'directory.propose', label: 'Proposer une fiche au référentiel (à valider)' },
  { key: 'directory.validate', label: 'Valider une fiche proposée au référentiel' },
  { key: 'estimating.devis.read', label: 'Consulter les devis' },
  { key: 'estimating.devis.write', label: 'Modifier les devis' },
  { key: 'invoicing.read', label: 'Consulter la facturation' },
  { key: 'invoicing.write', label: 'Gérer la facturation (marchés, situations, factures)' },
  { key: 'site_tracking.read', label: 'Consulter le suivi de chantiers' },
  { key: 'site_tracking.write', label: 'Gérer le suivi de chantiers (chantiers, budgets, pointages, achats)' },
  { key: 'financial.read', label: 'Consulter la gestion financière' },
  { key: 'financial.write', label: 'Paramétrer la gestion financière (formules, avancement)' },
];

const ALL_PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);

export const SYSTEM_ROLES: SystemRoleDef[] = [
  { code: 'admin', label: 'Administrateur', permissions: ALL_PERMISSION_KEYS },
  {
    code: 'estimator',
    label: 'Deviseur',
    // Le deviseur TIENT le référentiel : c'est lui qui ouvre les fiches clients et fournisseurs
    // pendant l'étude. Sans `directory.write`, il devait réclamer chaque client à un administrateur.
    permissions: [
      'directory.read',
      'directory.write',
      'estimating.devis.read',
      'estimating.devis.write',
    ],
  },
  {
    code: 'conducteur',
    label: 'Conducteur de travaux',
    // Il vit sur le chantier : il consulte l'étude, mène l'exécution, et PROPOSE les fournisseurs
    // qu'il découvre en cours de route — sans pouvoir retoucher le référentiel de l'entreprise.
    permissions: [
      'directory.read',
      'directory.propose',
      'estimating.devis.read',
      'invoicing.read',
      'site_tracking.read',
      'site_tracking.write',
    ],
  },
  {
    /**
     * Rôle SATELLITE : il ne se suffit pas à lui-même, il se cumule.
     *
     * Qui valide les fiches proposées ne se décrète pas depuis le logiciel — selon la société ce
     * sera le directeur, la secrétaire, le président, le deviseur ou le conducteur. L'administrateur
     * pose donc ce rôle sur la personne de son choix, par-dessus son rôle principal.
     */
    code: 'referentiel_valideur',
    label: 'Validation du référentiel',
    permissions: ['directory.read', 'directory.validate'],
  },
  /**
   * Direction : voir toute la société, ne rien pouvoir casser.
   *
   * Sans lui, surveiller l'ensemble imposait d'être Administrateur — donc de pouvoir aussi tout
   * modifier, distribuer les rôles et engager l'abonnement. Un dirigeant n'a pas à porter ce
   * pouvoir pour lire un tableau de bord. Ce rôle ouvre la LECTURE de bout en bout (référentiel,
   * devis, facturation, chantiers, financier) et rien d'autre : pas une écriture, pas une
   * administration. C'est lui qui donne accès à l'écran Direction (`financial.read`).
   *
   * Les jetons restent l'autre verrou : le rôle ne montre que les modules souscrits ET affectés.
   */
  {
    code: 'direction',
    label: 'Direction (lecture)',
    permissions: [
      'directory.read',
      'estimating.devis.read',
      'invoicing.read',
      'site_tracking.read',
      'financial.read',
    ],
  },
  {
    code: 'viewer',
    label: 'Lecture seule',
    permissions: ['directory.read', 'estimating.devis.read'],
  },
];

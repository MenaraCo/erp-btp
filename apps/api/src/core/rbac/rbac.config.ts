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
    permissions: ['directory.read', 'estimating.devis.read', 'estimating.devis.write'],
  },
  {
    code: 'viewer',
    label: 'Lecture seule',
    permissions: ['directory.read', 'estimating.devis.read'],
  },
];

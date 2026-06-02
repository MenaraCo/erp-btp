# ERP BTP

ERP SaaS multi-tenant pour les entreprises du BTP. Voir [`CAHIER_DES_CHARGES.md`](./CAHIER_DES_CHARGES.md) (le *quoi*) et [`CLAUDE.md`](./CLAUDE.md) (le *comment*).

## Stack

- **Backend** : NestJS + TypeORM (`apps/api`)
- **Base** : PostgreSQL (isolation multi-tenant par `tenant_id` + Row-Level Security)
- **Frontend** : Next.js + React (`apps/web`, à venir)
- **Partagé** : `packages/contracts`
- **Monorepo** : pnpm workspaces

## Prérequis

- Node.js >= 20
- pnpm 11 (via `corepack`, ou `~/.local/bin/pnpm`)
- PostgreSQL — **aucune installation système requise** : `pnpm db:local` lance un PostgreSQL
  embarqué (binaire dans `node_modules`, données dans `apps/api/.pgdata`). Docker reste une
  alternative (`pnpm db:up`) si tu le préfères.

## Démarrage

```bash
cp .env.example .env          # ajuster si besoin
pnpm install

# PostgreSQL local, au choix :
pnpm db:local                 # embarqué, sans Docker (laisser tourner dans un terminal)
# ou : pnpm db:up             # via Docker

pnpm migrate                  # applique les migrations
pnpm seed                     # catalogue (modules/capacités/packs) + permissions
pnpm seed:demo                # jeu de démo : tenant "demo", biblio + affaire chiffrée
pnpm dev                      # API sur http://localhost:3001 ; GET /health
```

Le jeu de démo crée un tenant `demo` (login `admin@demo.test` / `demo1234`) avec une bibliothèque
réaliste, des ouvrages composés et une affaire chiffrée complète (devis + métré + feuille de vente).

## Scripts

| Commande | Effet |
|---|---|
| `pnpm dev` | API en mode watch |
| `pnpm build` | Build de tous les packages |
| `pnpm test` | Tests unitaires |
| `pnpm test:e2e` | Tests end-to-end |
| `pnpm migrate` | Applique les migrations |
| `pnpm seed` | Seed catalogue + permissions (global) |
| `pnpm seed:demo` | Jeu de démonstration (tenant `demo`) |
| `pnpm migrate:revert` | Annule la dernière migration |

## Multi-tenant (RLS)

Isolation stricte par `tenant_id` + **Row-Level Security** PostgreSQL. Le tenant courant est
résolu par sous-domaine (`acme.localhost`) ou par header `X-Tenant-Id`, stocké dans un contexte
de requête, puis injecté en base via `set_config('app.current_tenant', …)` dans une transaction.
La connexion runtime utilise un **rôle applicatif non-privilégié** (`erp_app`, `NOBYPASSRLS`)
pour que la RLS s'applique réellement ; les migrations tournent avec le rôle propriétaire.

## État de construction

- **Phase 0.1** — socle infra (monorepo, API NestJS, Docker/embedded Postgres, CI). ✅
- **Phase 0.2** — multi-tenant + RLS + tests d'isolation. ✅
- **Phase 0.3** — catalogue modules / capacités / packs (config + seed). ✅
- **Phase 0.4** — garde `@RequiresCapability` + jetons + quotas. ✅
- **Phase 0.5** — cycle de vie des souscriptions (essai 30 j). ✅
- **Phase 0.6** — RBAC (rôles / permissions). ✅
- **Phase 0.7** — authentification (mot de passe + JWT + MFA TOTP). ✅
- **Phase 0.8** — référentiel + data-grid + recherche universelle. ✅ — **socle Phase 0 terminé**
- **Phase 1** — Études de prix. ✅ — **module cœur terminé**
  - 1.1 bibliothèques & ressources · 1.2 ouvrages composés + **recalcul ascendant** (règle #1) ·
    1.3 corps de devis hiérarchique + métré · 1.4 **feuille de vente** (coefficients + ventilation,
    règles #2/#3) · 1.5 workflow d'affaire (règle #7) · 1.6 PDF · seed de démo.
- **Phase 2** — Acceptation + Facturation. ✅ — **module terminé**
  - 2.1 acceptation (affaire gagnée → marché) · 2.2 **situations à l'avancement** (règle #6) ·
    2.3 avenants (recodification -AVn, règle #4) · 2.4 DGD · 2.5 sociétés + factures (chrono figé) ·
    2.6 **conformité** (module dédié versionné : Factur-X CII XML + PDF, statuts e-facture, TVA, Chorus Pro stub).
- **Phase 3** — Suivi de chantiers (budgets, pointages, achats, analytique). ⏳

Souscription : **deux parcours indépendants** (essai 30 j `trialing` **ou** souscription directe
`active`) — cf. `POST /subscription/trial` et `POST /subscription/direct`.

Référentiel `client` / `supplier` (RLS) avec data-grid réutilisable (pagination / tri / filtre,
colonnes de tri sur liste blanche) et recherche universelle extensible par providers. Les
endpoints du référentiel portent **les deux gardes** (`@RequiresCapability('directory')` +
`@RequiresPermission('directory.read|write')`).

Authentification first-party **sans dépendance externe** : mot de passe (scrypt), token d'accès
HS256 et MFA TOTP (RFC 6238) via `node:crypto`. Le **token vérifié** porte le contexte
tenant + utilisateur (`Authorization: Bearer …`) ; à défaut, repli dev par `X-Tenant-Id` /
`X-User-Id`. `JWT_SECRET` obligatoire en production. Conçu pour brancher un OIDC plus tard.

**Deux axes d'autorisation orthogonaux** : `@RequiresCapability` (commercial : module acheté +
jeton) et `@RequiresPermission` (organisationnel : le rôle de l'utilisateur l'autorise). Un
endpoint sensible peut porter les deux — les deux gardes doivent passer. Permissions = catalogue
global seedé ; rôles tenant-scopés et cumulables (`role` / `role_permission` / `user_role`, RLS).

La souscription (`subscription` / `module_subscription`) est la source de vérité ; elle est
**projetée** sur les tables d'enforcement (`tenant_module` / `tenant_quota`) lues par la garde.
L'essai de 30 jours ouvre tous les modules ; à l'échéance non convertie, les modules passent en
**lecture seule** (jamais de suppression de données). CB non exigée par défaut
(`TRIAL_REQUIRES_PAYMENT_METHOD`, flag de config).

Le catalogue commercial (modules, capacités, packs, quotas) est piloté par configuration
([catalog.config.ts](apps/api/src/core/catalog/catalog.config.ts)) et chargé en base via
`pnpm seed` (idempotent). Le code teste toujours une **capacité** (`estimating.bid`…),
jamais un nom de module ou de pack.

## Gating (capacités + jetons + quotas)

Tout endpoint sensible porte `@RequiresCapability('…')`. La garde globale
([capability.guard.ts](apps/api/src/core/entitlements/capability.guard.ts)) vérifie, pour le
tenant + l'utilisateur courants : (a) qu'un module débloquant cette capacité est **actif**
(`tenant_module`) et (b) que l'utilisateur détient un **jeton** (`seat_assignment`, affectés ≤
achetés). Les **quotas** (`tenant_quota` / `usage_counter`) se vérifient via `QuotaService`
avant chaque création. Le backend est la seule source de vérité ; le frontend ne décide jamais.

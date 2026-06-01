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
pnpm dev                      # API sur http://localhost:3001 ; GET /health
```

## Scripts

| Commande | Effet |
|---|---|
| `pnpm dev` | API en mode watch |
| `pnpm build` | Build de tous les packages |
| `pnpm test` | Tests unitaires |
| `pnpm test:e2e` | Tests end-to-end |
| `pnpm migrate` | Applique les migrations |
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
- **Phase 0.5** — cycle de vie des souscriptions (essai 30 j). ⏳

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

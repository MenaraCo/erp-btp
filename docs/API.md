# API — endpoints exposés

> Généré à partir des contrôleurs. Chaque endpoint (sauf `/health`) exige un **tenant** résolu
> par le middleware : token `Authorization: Bearer <jwt>` (source de vérité) **ou**, en dev,
> en-tête `X-Tenant-Id` (+ `X-User-Id`) / sous-domaine `slug.localhost`.
>
> Les endpoints métier portent **deux gardes** : une **capacité** (module acheté + jeton de
> l'utilisateur) et une **permission** RBAC (rôle). Les deux doivent passer.

## Socle

| Méthode | Route | Capacité | Permission | Notes |
|---|---|---|---|---|
| GET | `/health` | — | — | Public (aucun tenant requis) |
| POST | `/auth/login` | — | — | `{ email, password, totp? }` → `{ accessToken }` |
| POST | `/auth/mfa/enable` | — | — | Authentifié (token) → `{ secret }` (TOTP) |

## Référentiel (capacité `directory`)

| Méthode | Route | Permission | Notes |
|---|---|---|---|
| POST | `/clients` | `directory.write` | Crée un client |
| GET | `/clients` | `directory.read` | Data-grid : `?page&pageSize&sort&dir&search` |
| POST | `/suppliers` | `directory.write` | Crée un fournisseur |
| GET | `/suppliers` | `directory.read` | Data-grid |
| GET | `/search?q=` | `directory.read` | Recherche universelle (clients, fournisseurs, biblio, ressources) |

## Études de prix (capacité `estimating.bid`)

| Méthode | Route | Permission | Notes |
|---|---|---|---|
| POST | `/libraries` | `estimating.devis.write` | Crée une bibliothèque |
| GET | `/libraries` | `estimating.devis.read` | Data-grid |
| POST | `/libraries/:libraryId/resources` | `estimating.devis.write` | Crée une ressource (`nature` MO/matériaux/matériel/sous-traitance) |
| GET | `/libraries/:libraryId/resources` | `estimating.devis.read` | Data-grid |
| PATCH | `/libraries/:libraryId/resources/:resourceId` | `estimating.devis.write` | Change le déboursé → **recalcul ascendant** |
| POST | `/libraries/:libraryId/ouvrages` | `estimating.devis.write` | Crée un ouvrage composé |
| GET | `/libraries/:libraryId/ouvrages` | `estimating.devis.read` | Data-grid (avec déboursé) |
| GET | `/ouvrages/:id` | `estimating.devis.read` | Ouvrage + déboursé calculé |
| POST | `/ouvrages/:id/components` | `estimating.devis.write` | Ajoute un composant (ressource/sous-ouvrage/%) → recalcul ; cycle → 400 |
| POST | `/affaires` | `estimating.devis.write` | Crée une affaire (+ version 1) |
| GET | `/affaires` | `estimating.devis.read` | Data-grid |
| POST | `/affaires/:affaireId/versions` | `estimating.devis.write` | Nouvelle version |
| POST | `/versions/:versionId/lines` | `estimating.devis.write` | Ligne de devis (titre/sous-titre/ouvrage/ressource) |
| GET | `/versions/:versionId/lines` | `estimating.devis.read` | Arbre du corps de devis |
| PUT | `/versions/:versionId/variables/:name` | `estimating.devis.write` | Variable de métré → recalcul des formules |
| PUT | `/versions/:versionId/sale-sheet` | `estimating.devis.write` | Coefficients de la feuille de vente |
| GET | `/versions/:versionId/sale-sheet` | `estimating.devis.read` | Calcul feuille de vente (PV, ventilation, TVA/TTC) |
| GET | `/versions/:versionId/devis.pdf` | `estimating.devis.read` | PDF du devis (`application/pdf`) |
| POST | `/affaires/:affaireId/transition` | `estimating.devis.write` | Workflow (`{ to }`) ; transition interdite → 409 |
| GET | `/affaires/:affaireId/transfer-check` | `estimating.devis.read` | Transférable ? + alertes |

## Facturation (capacité `invoicing.situations`)

| Méthode | Route | Permission | Notes |
|---|---|---|---|
| POST | `/affaires/:affaireId/transfer` | `invoicing.write` | Transfère une affaire **Gagnée** → marché ; non gagnée/déjà transférée → 409 |
| GET | `/marches` | `invoicing.read` | Liste des marchés |
| GET | `/marches/:marcheId` | `invoicing.read` | Marché + lignes valorisées |

---

*À venir (Phase 2) : situations à l'avancement, avenants, DGD, factures, Factur-X.*

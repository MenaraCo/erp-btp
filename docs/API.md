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
| PATCH | `/clients/:id` | `directory.write` | Modifie un client ; inconnu → 404 |
| DELETE | `/clients/:id` | `directory.write` | Suppression douce (soft delete) ; inconnu → 404 |
| POST | `/suppliers` | `directory.write` | Crée un fournisseur |
| GET | `/suppliers` | `directory.read` | Data-grid |
| PATCH | `/suppliers/:id` | `directory.write` | Modifie un fournisseur ; inconnu → 404 |
| DELETE | `/suppliers/:id` | `directory.write` | Suppression douce ; inconnu → 404 |
| GET | `/search?q=` | `directory.read` | Recherche universelle (clients, fournisseurs, biblio, ressources) |

## Études de prix (capacité `estimating.bid`)

| Méthode | Route | Permission | Notes |
|---|---|---|---|
| POST | `/libraries` | `estimating.devis.write` | Crée une bibliothèque |
| GET | `/libraries` | `estimating.devis.read` | Data-grid |
| POST | `/libraries/:libraryId/resources` | `estimating.devis.write` | Crée une ressource (`nature` MO/matériaux/matériel/sous-traitance ; `familleAnalytiqueId` optionnel) |
| GET | `/libraries/:libraryId/resources` | `estimating.devis.read` | Data-grid |
| PATCH | `/libraries/:libraryId/resources/:resourceId` | `estimating.devis.write` | Change le déboursé → **recalcul ascendant** |
| PUT | `/libraries/:libraryId/resources/:resourceId/famille` | `estimating.devis.write` | Classe la ressource sur une famille analytique (§5.8) ; famille inconnue → 404 |
| POST | `/libraries/:libraryId/ouvrages` | `estimating.devis.write` | Crée un ouvrage composé |
| GET | `/libraries/:libraryId/ouvrages` | `estimating.devis.read` | Data-grid (avec déboursé) |
| GET | `/ouvrages/:id` | `estimating.devis.read` | Ouvrage + déboursé calculé |
| POST | `/ouvrages/:id/components` | `estimating.devis.write` | Ajoute un composant (ressource/sous-ouvrage/%) → recalcul ; cycle → 400 |
| POST | `/affaires` | `estimating.devis.write` | Crée une affaire (+ version 1) |
| GET | `/affaires` | `estimating.devis.read` | Data-grid |
| GET | `/affaires/:affaireId` | `estimating.devis.read` | Affaire + ses versions (détail devis) |
| POST | `/affaires/:affaireId/versions` | `estimating.devis.write` | Nouvelle version |
| POST | `/versions/:versionId/lines` | `estimating.devis.write` | Ligne de devis (titre/sous-titre/ouvrage/ressource) |
| GET | `/versions/:versionId/lines` | `estimating.devis.read` | Arbre du corps de devis |
| PUT | `/versions/:versionId/variables/:name` | `estimating.devis.write` | Variable de métré → recalcul des formules |
| PUT | `/versions/:versionId/sale-sheet` | `estimating.devis.write` | Coefficients de la feuille de vente |
| GET | `/versions/:versionId/sale-sheet` | `estimating.devis.read` | Calcul feuille de vente (PV, ventilation, TVA/TTC) |
| GET | `/versions/:versionId/devis.pdf` | `estimating.devis.read` | PDF du devis (`application/pdf`) |
| POST | `/affaires/:affaireId/transition` | `estimating.devis.write` | Workflow (`{ to }`) ; transition interdite → 409 |
| GET | `/affaires/:affaireId/transfer-check` | `estimating.devis.read` | Transférable ? + alertes |

## Gestion financière — tableau de bord analytique (capacité `financial.dashboard`)

| Méthode | Route | Permission | Notes |
|---|---|---|---|
| GET | `/chantiers/:chantierId/analytical-results` | `financial.read` | Budget/engagé/réalisé agrégés sur l'axe analytique nature→lot→famille (§5.8) ; seau « Non réparti » par nature + branche « Frais de chantier » ; totaux réconciliés |
| GET | `/chantiers/:chantierId/forecast` | `financial.read` (cap. `financial.forecast`) | **Prévisionnel / vue Conducteur (B.3)** : assemble les 4 axes + avancement + paramètres versionnés → indicateurs (budget avancé, écart au stade, EAC, marge prévisionnelle €/%, alertes) |

## Acceptation / Suivi de chantiers — Chantier 1→N Marché

L'acceptation d'une affaire gagnée crée un **marché** rattaché à un **chantier** (nouveau ou existant). Un chantier agrège plusieurs marchés ; les coûts s'agrègent au chantier (§5.4/5.5).

| Méthode | Route | Permission | Notes |
|---|---|---|---|
| POST | `/chantiers` | `site_tracking.write` | Crée un chantier vide (unité d'agrégation) `{ code, name }` ; code dupliqué → 409 |
| POST | `/affaires/:affaireId/accept` | `invoicing.write` | **Acceptation unifiée (§5.4)** : crée UN marché sur un chantier (nouveau ou existant via corps `{ chantierId }`) portant **à la fois** la chaîne de facturation (lignes de marché) **et** l'étude d'exécution ; double acceptation d'une version → 409 |
| GET | `/chantiers/:chantierId/marches` | `site_tracking.read` | Liste des marchés agrégés par le chantier |

## Plan analytique (capacité `estimating.bid`)

Axe analytique nature → lot → famille → ressource (cahier des charges §5.8). La ressource du chiffrage **est** le code analytique.

| Méthode | Route | Permission | Notes |
|---|---|---|---|
| GET | `/analytical/plan` | `estimating.devis.read` | Arbre dépliable nature → lot → famille ; duplique le plan modèle à la 1ʳᵉ lecture |
| POST | `/analytical/lots` | `estimating.devis.write` | Ajoute un lot sous une nature ; code déjà pris → 409 |
| POST | `/analytical/familles` | `estimating.devis.write` | Ajoute une famille sous un lot ; code déjà pris → 409 |
| POST | `/analytical/codes` | `estimating.devis.write` | Ajoute un code analytique (n° société) sous une famille ; code déjà pris → 409 |

### Imputation analytique de l'engagé / réalisé

Les lignes de commande (engagé) et les factures fournisseurs (réalisé) acceptent un `familleAnalytiqueId` optionnel pour l'imputation sur l'axe analytique (§5.8) ; famille inconnue → 404. Sans famille, le montant tombe dans le seau « Non réparti » de sa nature.

| Méthode | Route | Notes |
|---|---|---|
| POST | `/purchase-orders/:orderId/lines` | `familleAnalytiqueId` optionnel (engagé) |
| POST | `/purchase-orders/:orderId/invoices` | `familleAnalytiqueId` optionnel (réalisé) |

## Facturation (capacité `invoicing.situations`)

| Méthode | Route | Permission | Notes |
|---|---|---|---|
| GET | `/marches` | `invoicing.read` | Liste des marchés (acceptation via `POST /affaires/:id/accept`, voir ci-dessus) |
| GET | `/marches/:marcheId` | `invoicing.read` | Marché + lignes valorisées |

---

*À venir (Phase 2) : situations à l'avancement, avenants, DGD, factures, Factur-X.*

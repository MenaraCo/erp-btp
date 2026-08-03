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
| GET | `/me/capabilities` | — | — | Capacités ouvertes à l'utilisateur (module actif + jeton) + modules actifs ; alimente le menu, qui masque une entrée non souscrite au lieu de la laisser mener à un 403 |
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

### Types de déboursé (référentiel société)

| Méthode | Route | Permission | Description |
| --- | --- | --- | --- |
| GET | `/debourse-types?devisVersionId=` | `estimating.devis.read` | Types utilisables : ceux de la société, plus ceux du devis quand il est précisé. Les 4 types de base (MO, M, MAT, ST) sont créés à la première lecture |
| POST | `/debourse-types` | `estimating.devis.write` | Crée un type `{ code, label, baseNature, devisVersionId? }`. `devisVersionId` renseigné = type propre à ce devis. Code déjà pris dans le périmètre → 409 ; nature de rattachement hors des 4 natures → 400 |
| PUT | `/debourse-types/:id` | `estimating.devis.write` | Modifie code / intitulé / nature de rattachement |
| POST | `/debourse-types/:id/promote` | `estimating.devis.write` | Remonte un type de devis au référentiel société |
| DELETE | `/debourse-types/:id` | `estimating.devis.write` | Supprime un type |

## Études de prix (capacité `estimating.bid`)

| Méthode | Route | Permission | Notes |
|---|---|---|---|
| POST | `/libraries` | `estimating.devis.write` | Crée une bibliothèque |
| GET | `/libraries` | `estimating.devis.read` | Data-grid |
| POST | `/libraries/:libraryId/resources` | `estimating.devis.write` | Crée une ressource (`nature` ; `codeProduit` unique société ; `codeAnalytiqueId` optionnel ; `debourseTypeId` = type de déboursé, il porte les % FG et bénéfice du chiffrage et fixe la nature) |
| GET | `/libraries/:libraryId/resources` | `estimating.devis.read` | Data-grid |
| PATCH | `/libraries/:libraryId/resources/:resourceId` | `estimating.devis.write` | Change le déboursé → **recalcul ascendant** |
| PUT | `/libraries/:libraryId/resources/:resourceId/code-analytique` | `estimating.devis.write` | Rattache la ressource à un code analytique (§5.8) ; code inconnu → 404 |
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
| PUT | `/versions/:versionId/sale-sheet` | `estimating.devis.write` | Coefficients de la feuille de vente. Accepte `types: [{ typeId, tauxFg, tauxBenefice }]` — les 4 natures de base en sont déduites (type de base de la nature, sinon premier type qui s'y rattache). `byNature` reste accepté seul pour les appels historiques |
| GET | `/versions/:versionId/sale-sheet` | `estimating.devis.read` | Calcul feuille de vente (PV, ventilation, TVA/TTC) |
| GET | `/versions/:versionId/sale-sheet/config` | `estimating.devis.read` | Paramétrage mémorisé : natures, `types` (types de déboursé utilisables ici, avec leurs taux sur CE devis), arrondi, PV imposé, remise, TVA, frais annexes. Un devis chiffré avant les types paramétrables retombe sur les taux de la nature de rattachement — ouvrir puis enregistrer ne perd rien |
| GET | `/versions/:versionId/devis.pdf` | `estimating.devis.read` | PDF du devis (`application/pdf`) |
| POST | `/affaires/:affaireId/transition` | `estimating.devis.write` | Workflow (`{ to }`) ; transition interdite → 409 |
| GET | `/affaires/:affaireId/transfer-check` | `estimating.devis.read` | Transférable ? + alertes |

## Gestion financière — tableau de bord analytique (capacité `financial.dashboard`)

| Méthode | Route | Permission | Notes |
|---|---|---|---|
| GET | `/chantiers/:chantierId/analytical-results` | `financial.read` | Budget/engagé/réalisé agrégés sur l'axe analytique nature→lot→famille→code (§5.8). Ce qui n'a **aucun code analytique** va dans la branche **`999 — À ventiler`** (hors des natures, avec la liste des ressources à ventiler), les frais de chantier dans leur branche dédiée ; totaux réconciliés |
| GET | `/chantiers/:chantierId/forecast` | `financial.read` (cap. `financial.forecast`) | **Prévisionnel / vue Conducteur (B.3)** : assemble les 4 axes + avancement + paramètres versionnés → indicateurs (budget avancé, écart au stade, EAC, marge prévisionnelle €/%, alertes) |

## Acceptation de commande — la charnière étude → exécution

Un devis **gagné** ne devient exécutable que par l'acceptation de commande : elle crée UN **marché** rattaché à un **chantier** (nouveau ou existant), avec ses lignes de facturation ET son étude d'exécution, dans **une seule transaction**. Un chantier agrège plusieurs marchés ; les coûts s'agrègent au chantier (§5.4/5.5).

Ces routes s'ouvrent avec **`invoicing.situations` OU `site_tracking.budget`** (garde `@RequiresAnyCapability`) : l'outil n'a d'intérêt que si l'on facture ou si l'on suit des chantiers.

| Méthode | Route | Permission | Notes |
|---|---|---|---|
| GET | `/acceptance/pending` | `invoicing.read` | File d'attente : devis gagnés dont la dernière version n'a pas encore de marché, au **montant de vente** (feuille de vente) |
| GET | `/acceptance/accepted` | `invoicing.read` | Commandes acceptées : marché + chantier + devis d'origine |
| GET | `/acceptance/devis/:devisId` | `invoicing.read` | Fiche d'acceptation : client, montants (déboursé/HT/TVA/TTC), **options et variantes** chiffrées une par une (pour information, hors commande), chantiers existants, alertes (`acceptable: false` si bloquante) |
| POST | `/devis/:devisId/accept` | `invoicing.write` | Accepte la commande. Le chantier hérite du **déboursé** ET des **frais de chantier** du devis (frais généraux par nature et par type de ST, chaque poste de frais annexes — noyé comme séparé), réunis dans une ligne d'exécution non vendable « Frais de chantier » budgétée en `site_overhead`. Corps `{ chantierId? }` : rattache à un chantier existant, sinon en crée un. Options et variantes restent **hors commande** (elles s'arbitrent dans le devis). Devis non gagné → 409 ; version déjà acceptée → 409 |
| POST | `/chantiers` | `site_tracking.write` | Crée un chantier vide (unité d'agrégation) `{ code, name }` ; code dupliqué → 409 |
| GET | `/chantiers/:chantierId/marches` | `site_tracking.read` | Liste des marchés agrégés par le chantier |

## Plan analytique (capacité `estimating.bid`)

Axe analytique à 5 niveaux : nature → lot → famille → **code analytique** → ressource (cahier des charges §5.8). Un code analytique (n° société, ex. COLLE=280) regroupe plusieurs ressources.

| Méthode | Route | Permission | Notes |
|---|---|---|---|
| GET | `/analytical/plan` | `estimating.devis.read` | Arbre dépliable nature → lot → famille → code analytique ; duplique le plan modèle à la 1ʳᵉ lecture |
| POST | `/analytical/lots` | `estimating.devis.write` | Ajoute un lot sous une nature ; code déjà pris → 409 |
| POST | `/analytical/familles` | `estimating.devis.write` | Ajoute une famille sous un lot ; code déjà pris → 409 |
| POST | `/analytical/codes` | `estimating.devis.write` | Ajoute un code analytique (n° société) sous une famille ; code déjà pris → 409 |

### Imputation analytique de l'engagé / réalisé

Les lignes de commande (engagé) et les factures fournisseurs (réalisé) acceptent un `codeAnalytiqueId` optionnel pour l'imputation sur l'axe analytique (§5.8) ; code inconnu → 404. Sans code, le montant tombe dans le seau « Non réparti » de sa nature.

| Méthode | Route | Notes |
|---|---|---|
| POST | `/purchase-orders/:orderId/lines` | `codeAnalytiqueId` optionnel (engagé) |
| POST | `/purchase-orders/:orderId/invoices` | `codeAnalytiqueId` optionnel (réalisé) |

## Facturation (capacité `invoicing.situations`)

| Méthode | Route | Permission | Notes |
|---|---|---|---|
| GET | `/marches` | `invoicing.read` | Liste des marchés (acceptation via `POST /affaires/:id/accept`, voir ci-dessus) |
| GET | `/marches/:marcheId` | `invoicing.read` | Marché + lignes valorisées |

---

*À venir (Phase 2) : situations à l'avancement, avenants, DGD, factures, Factur-X.*

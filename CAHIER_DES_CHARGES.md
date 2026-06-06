# Master-Prompt — Construction d'un ERP BTP moderne

> **Mode d'emploi.** Ce document est un prompt de construction destiné à un agent de codage IA (Claude Code, Cursor, etc.) ou à une équipe de développement. Il décrit *quoi* construire et *avec quelle logique métier*, sans imposer le moindre code existant. Le périmètre fonctionnel s'inspire des grands logiciels de gestion BTP du marché, mais l'implémentation, l'ergonomie et la stack sont neuves et libres. Lisez la section « Vision & différenciation » avant de coder : l'objectif n'est pas de cloner l'existant, mais de faire mieux.

---

## 1. Contexte et objectif

Construire un **ERP SaaS multi-tenant pour les entreprises du Bâtiment et des Travaux Publics**, couvrant la chaîne complète : de l'étude de prix (chiffrage) jusqu'au décompte général définitif (DGD), en passant par l'acceptation de commande, le suivi de chantier et la facturation.

Cible : artisans, PME et ETI du BTP (gros œuvre, second œuvre, finitions, travaux publics, espaces verts), répondant à des marchés publics et privés.

Livrable : une application web responsive (desktop + mobile), avec API publique, prête pour la conformité française (facturation électronique, marchés publics).

---

## 2. Vision produit & différenciation

L'app doit **dépasser les ERP BTP historiques** sur ces axes. Chaque point est un objectif de conception, pas une option :

1. **100 % cloud-native, full-web** — aucun client lourd Windows à installer. Accès navigateur + app mobile. Multi-tenant dès le premier commit.
2. **Conformité e-facturation native** — Factur-X / Chorus Pro / plateformes agréées (réforme française 2026-2027) intégrés au cœur, pas en option payante.
3. **BIM/IFC natif** — import de maquette numérique et métré semi-automatique intégrés, sans dépendre d'un partenaire tiers.
4. **Mobile-first pour le terrain** — pointages, photos de chantier, bons de réception, avancement saisis depuis le téléphone, mode hors-ligne avec synchronisation.
5. **Temps réel** — tableaux de bord de marge et de trésorerie recalculés en direct, pas de batch nocturne.
6. **API-first** — toute fonction exposée via API REST/GraphQL documentée (OpenAPI). Connecteurs comptabilité/paie ouverts.
7. **Assistance IA** — suggestion de prix sur la bibliothèque, détection d'oublis dans un chiffrage, pré-remplissage de métré depuis un DPGF/DQE, génération de mémoire technique.
8. **UX moderne** — recherche universelle type moteur de recherche sur chaque écran, grilles de saisie performantes, raccourcis clavier, undo/redo.

---

## 3. Modèle SaaS, abonnements et droits d'accès

L'application est commercialisée en **SaaS multi-tenant** selon un **modèle modulaire** (et non par paliers linéaires). Une entreprise du bâtiment achète les **modules métier** dont chaque service a besoin : le bureau d'études chiffre des appels d'offres sans payer le suivi de chantier ; le service travaux prend le suivi budgétaire + les situations + la facturation. Les modules sont **licenciés au siège, par module** (modèle « jetons » : un deviseur n'a pas le même jeton qu'un conducteur de travaux). Des **packs métier** servent de façade commerciale simple ; les modules à la carte permettent l'ajustement fin. Un **essai gratuit de 30 jours donne accès à tous les modules**.

### 3.1 Principe d'architecture (non négociable)

**Ne jamais coder en dur un test de palier, de pack ou de module** (`if (pack === "Travaux")`) dans la logique métier. Utiliser un système de **droits/capacités (entitlements)** piloté par configuration :

- Une souscription = un **ensemble de modules actifs**, chacun assorti d'un nombre de **jetons (sièges)** achetés.
- Chaque **module** débloque un ensemble de **capacités** (feature flags). Le code teste des capacités (`estimating.bid`, `estimating.advanced`, `invoicing.situations`, `invoicing.dgd`, `site_tracking.budget`, `site_tracking.timesheet`, `purchasing`, `stock`, `equipment`, `bim`, `ai_assist`, `api_access`, `multi_company`, `sso`…), **jamais** un nom de module ou de pack.
- Le mapping module → capacités, et pack → modules, est **stocké en configuration/base**, modifiable sans redéploiement.

Conséquence importante : que l'offre soit présentée en paliers, en modules ou en packs n'est qu'un **découpage de packaging** par-dessus le même moteur de capacités. Changer le packaging, les prix ou la composition d'un pack ne touche aucune ligne de code métier.

### 3.2 L'offre

**Socle (obligatoire, inclus dès le 1er module)** — plateforme de base : comptes et utilisateurs, **RBAC**, référentiel clients/fournisseurs, **bibliothèque de prix partagée**, tableau de bord, et **e-facturation Factur-X** (incluse partout : obligation légale, pas un argument premium).

**Modules métier** (licenciés au siège, jetons assignables **par module**) :

| Module | Pour qui | Contenu | Indicatif /siège/mois¹ |
|---|---|---|---|
| **Études de prix** | Bureau d'études, deviseurs | Chiffrage, sous-détails, feuille de vente + coefficients, **devis d'appel d'offre**, workflow, versioning, bibliothèques avancées | ~39 € |
| **Facturation** | ADV, comptabilité | Devis client, factures, **situations de travaux**, avenants, **DGD**, retenue de garantie, révision de prix | ~29 € |
| **Suivi de chantiers** | Conducteurs de travaux | **Budgets chantier**, pointages (mobile terrain), chaîne des achats, résultats analytiques | ~49 € |

**Options à la carte (add-ons)** : **Contrôle de gestion chantier** (module différenciant premium — analytique prédictif, voir 5.8 ; ~/siège, positionnement haut à valider), Stocks & Parc matériel (~19 €/siège), BIM/IFC (forfait), Assistance IA (forfait ou /siège), API & connecteurs comptabilité/paie + export FEC (forfait), Multi-société / SSO / SLA (offre entreprise **sur devis**).

**Packs métier (bundles remisés — porte d'entrée commerciale)** :
- **Pack Bureau d'études** = Socle + Études de prix.
- **Pack Travaux** = Socle + Suivi de chantiers + Facturation (+ accès lecture aux études).
- **Pack Entreprise complète** = tous les modules, remise volume.

¹ Prix HT, hypothèses de départ à valider. Tous les montants, compositions de packs et remises sont **pilotés par configuration** (jamais codés en dur). Prévoir mensuel / annuel (~2 mois offerts), codes promo, remise volume, proratisation.

**Exemples chiffrés** (à titre de validation du modèle) :
- *Bureau d'études, 2 deviseurs* : Socle + Études de prix × 2 ≈ **78 €/mois**. Aucun coût de suivi de chantier inutile.
- *Service travaux, 4 conducteurs* : Socle + Suivi de chantiers × 4 + Facturation × 4 ≈ **312 €/mois**, avec accès lecture aux études.

### 3.3 Deux parcours d'entrée indépendants : essai OU souscription directe

**Règle fondamentale : l'essai n'est PAS un prérequis de l'abonnement.** L'inscription offre **deux portes parallèles**, présentées côte à côte (« Essayer gratuitement 30 jours » / « Choisir mon abonnement »). Un client convaincu doit pouvoir payer immédiatement sans passer par l'essai. Ne jamais coder le parcours comme « inscription → essai obligatoire → conversion » : ce serait fermer la souscription directe.

**Porte 1 — Essai gratuit 30 jours**
- À l'inscription par cette porte, créer une **souscription au statut `trialing`** donnant accès à **tous les modules**, avec un volant de jetons généreux mais borné (anti-abus). `trial_ends_at = now + 30 jours`.
- **Carte bancaire non exigée** — comportement piloté par le flag de configuration `trial_requires_payment_method` (défaut `false`), modifiable sans redéploiement et testable en A/B.
- À l'échéance sans souscription payante : **ne jamais supprimer les données.** Les modules non souscrits passent en **lecture seule** (consultation/export possibles), avec invitation à activer le module concerné (upsell ciblé).
- Notifications de fin d'essai (J-7, J-1, J0).

**Porte 2 — Souscription directe (sans essai)**
- L'utilisateur choisit ses packs/modules et son nombre de jetons, renseigne son paiement, et la souscription est créée **directement au statut `active`**, **sans jamais passer par `trialing`**. Il démarre immédiatement en client payant.

**Conversion en cours d'essai** : un utilisateur en `trialing` peut souscrire **à tout moment** (avant la fin des 30 jours) ; la souscription passe de `trialing` à `active`. Les deux portes restent ouvertes en permanence.

**Écran d'abonnement permanent** : l'interface de choix/gestion d'abonnement (packs, modules, jetons, facturation) est accessible en continu depuis les paramètres, quel que soit l'état de la souscription.

### 3.4 Cycle de vie de la souscription

Entité `Subscription` (par tenant) : statut `trialing | active | past_due | paused | canceled`, plus `trial_ends_at`, `current_period_end`, `cancel_at_period_end`, identifiants prestataire. Elle agrège des lignes **par module** (`ModuleSubscription` : module, jetons achetés, période). Une souscription peut être créée **soit en `trialing`** (porte 1), **soit directement en `active`** (porte 2) — `trialing` n'est pas un passage obligé.

- **Ajout d'un module / de jetons** : effet immédiat, **proratisation** de la période en cours.
- **Retrait d'un module / réduction de jetons** : effet en fin de période ; le module retiré passe en **lecture seule** (pas de suppression). Si des jetons assignés dépassent les jetons restants, bloquer la création de nouvelles affectations jusqu'à régularisation.
- **Échec de paiement** : statut `past_due`, relance (dunning) automatisée, période de grâce, puis restriction.
- **Résiliation** : accès jusqu'à `current_period_end`, puis lecture seule + **export des données garanti**.

### 3.5 Application des droits (enforcement)

Quatre couches, toutes nécessaires :

1. **Backend — garde de capacité** : un decorator unique `@RequiresCapability('site_tracking.budget')` sur chaque endpoint/action sensible, qui vérifie (a) que le module correspondant est actif pour le tenant **et** (b) que l'utilisateur courant détient un **jeton assigné** pour ce module. C'est la **source de vérité** ; le frontend ne fait jamais foi.
2. **Backend — jetons & quotas** : un utilisateur ne peut ouvrir un module que si un jeton de ce module lui est **affecté** (écran d'administration d'affectation des jetons, comme dans l'ERP de référence). Le nombre de jetons affectés ne peut dépasser le nombre acheté. Vérifier aussi les quotas (`max_active_projects`, `storage_gb`, `api_rate_limit`) **avant** création.
3. **Frontend — UI consciente des droits** : récupérer la liste des modules actifs + jetons de l'utilisateur une fois (et la mettre en cache), puis **afficher les modules non souscrits avec un cadenas + appel à l'activation** plutôt que de les masquer (découvrabilité, conversion). Jamais de sécurité côté frontend.
4. **Facturation (provider)** : intégrer un prestataire de facturation récurrente (type Stripe Billing ou équivalent) — un **prix par module et par siège**, plus les add-ons, checkout, portail client, et **webhooks** (`subscription.updated/deleted`, `invoice.payment_failed`) synchronisant `Subscription` / `ModuleSubscription`. Le paiement par carte se fait **sur la page sécurisée du prestataire**, jamais en saisissant les données bancaires dans l'app.

### 3.6 Modèle de données SaaS (à ajouter au cœur)

- `Module` (code, libellé, actif) — ex. `estimating`, `invoicing`, `site_tracking`, add-ons.
- `Capability` (clé, libellé) + `ModuleCapability` (module → capacités) — **piloté par config**.
- `Pack` (code, libellé, remise) + `PackModule` (pack → modules) — bundles commerciaux, optionnels et reconfigurables.
- `Subscription` (tenant_id, statut, trial_ends_at, current_period_end, cancel_at_period_end, provider_customer_id, provider_subscription_id).
- `ModuleSubscription` (subscription_id, module_code, jetons_achetés, période, prix_unitaire) — une ligne par module souscrit.
- `SeatAssignment` / **Jeton** (module_code, user_id) — affectation d'un jeton de module à un utilisateur ; contrainte : `count(assignments par module) ≤ jetons_achetés`.
- `UsageCounter` (tenant_id, métrique, valeur courante) — comparaison aux quotas en temps réel.

### 3.7 Interfaces de gestion — DEUX écrans distincts (à construire en fin de Phase 1)

Le moteur d'abonnement (3.1–3.6) doit être doublé de **deux interfaces visibles**, à ne pas confondre :

**A. Espace abonnement client** (dans l'app ERP, accessible depuis les paramètres du tenant, réservé aux rôles administrateurs du client) :
- Voir l'**état de la souscription** : essai en cours (jours restants) ou abonnement actif, modules souscrits, factures.
- **Choisir / modifier** son pack ou ses modules et le **nombre de jetons** par module ; déclencher le paiement.
- **Affecter les jetons aux utilisateurs** : écran d'attribution « quel utilisateur a accès à quel module » (équivalent de l'affectation des jetons de l'ERP de référence), avec le compteur jetons affectés / achetés.
- Le **paiement** s'effectue par **redirection vers la page sécurisée du prestataire** (Stripe ou équivalent) puis retour ; aucune donnée bancaire saisie dans l'app. Accès au **portail client** du prestataire (factures, moyen de paiement).

**B. Back-office éditeur** (console de la plateforme, réservée à l'éditeur — toi — séparée de l'app cliente) :
- **Piloter le catalogue commercial** : modules, capacités, packs, prix, quotas, remises — le tout **piloté par configuration**.
- **Vue de tous les tenants/abonnés** : statut (essai, actif, impayé, résilié), modules souscrits, jetons, revenus, dates d'échéance ; classement des essais arrivant à terme.
- Indicateurs de gestion (MRR, taux de conversion essai→payant, churn), gestion des codes promo, intervention support (prolonger un essai, ajuster une souscription).
- Accès strictement réservé à l'éditeur (séparation forte des droits) ; ne jamais exposer ce back-office aux clients.

> Priorité de construction : ces deux écrans arrivent **en fin de Phase 1**, quand un premier produit est vendable. Ne pas les bâtir avant d'avoir un module exploitable à vendre.

---

## 4. Stack technique imposée

- **Backend** : TypeScript + **NestJS** (ou C#/.NET si l'équipe est .NET — choisir UN langage typé robuste et s'y tenir). Architecture modulaire en bounded contexts.
- **Base de données** : **PostgreSQL** (relationnel pour les données ERP + colonnes `JSONB` pour les attributs métier variables). Une base par environnement, isolation des tenants par `tenant_id` + Row-Level Security.
- **Frontend** : **React + Next.js** + TypeScript. Librairie de data-grid performante (AG Grid ou TanStack Table) — les écrans sont des tableaux denses. State serveur via TanStack Query.
- **Mobile** : React Native (partage de logique avec le web) ou PWA si le budget est serré.
- **Auth** : OAuth2/OIDC, multi-tenant, MFA. RBAC fin (voir module Administration).
- **Fichiers/documents** : stockage objet (S3-compatible). Génération PDF côté serveur.
- **Infra** : conteneurisé (Docker), CI/CD, migrations versionnées.

**Contrainte d'architecture** : découper le domaine en modules indépendants communiquant par interfaces/événements — `estimating` (étude de prix), `order-acceptance` (acceptation), `site-tracking` (suivi chantier), `invoicing` (facturation), `admin`. La cohérence des données circule par la chaîne **devis → marché → situations → DGD**.

---

## 5. Modèle de données (cœur métier)

C'est la partie la plus importante : le modèle métier *est* l'avantage concurrentiel. Modélisez-le avec soin.

### 5.1 Bibliothèques et ressources

- **Bibliothèque d'étude de prix** : catalogue de référence pour le chiffrage (multi-bibliothèques par tenant). Peut être convertie depuis une affaire ou importée (listing, format type BatiPrix). **Distincte de la nomenclature de chantier** (voir 5.5) : aucun lien automatique entre les deux — la seule circulation de données est la copie effectuée au premier transfert (voir 5.4).
- **Ressource** : article élémentaire. Champs obligatoires : **`code_produit` (unique par ressource)**, `libellé`, `type` (matériaux/main d'œuvre/matériel/sous-traitance), **`unité d'emploi`** (depuis le référentiel Unités, ex. KG, M2, H), `prix unitaire déboursé`. Champs achat : **PU public** (prix d'achat à l'unité d'achat, ex. 1 sac de 25 kg), **unité d'achat** (depuis le référentiel Unités), **coeff de conversion** (ex. 1 sac = 25 KG → déboursé = PU public ÷ 25), **distributeur** (FK vers fournisseurs), référence distributeur, conditionnement. Chaque ressource est rattachée à **exactement une famille** (→ lot → nature) et un **code analytique** (voir 5.8). Une ressource MO porte un rendement/temps. **Toutes les listes déroulantes de la fiche ressource proviennent des référentiels paramétrables** (Unités, Familles, Codes, Fournisseurs) — aucune valeur codée en dur.
- **Élément composé / Ouvrage** : composition récursive de ressources et de sous-ouvrages, chacun avec une **quantité**. Son coût (déboursé sec) est **calculé automatiquement** par agrégation des composants. C'est l'entité reine — modélisez-la en arbre récursif avec recalcul ascendant.
- **Élément en pourcentage** : ligne dont le montant est un % d'une assiette (frais, aléas).
- **Étude type** : modèle de devis pré-rempli réutilisable.

### 5.2 Étude de prix (affaire)

- **Affaire → Devis → Version** *(implémenté)* : une **affaire** (pivot commercial) regroupe **plusieurs devis** (ex. Lot 1 Peinture, Lot 2 Sols, avenant). **Tous les devis d'une affaire partagent le même client et le même lieu d'exécution** (hérités, non saisissables au niveau devis). L'affaire porte : `code`, `client`, `MOA`, **lieu d'exécution structuré** (objet : adresse/CP/ville/pays, +coordonnées — pour enrichissement IA), **budget objectif**, **responsable**, notes. Chaque **devis** porte : numéro, désignation, type (principal/lot/avenant), **statut workflow** (open→…→gagné/perdu) et gère plusieurs **versions** (versioning). Le **statut de l'affaire est DÉRIVÉ** de ses devis : `en cours` / **`gagnée partiellement`** (une partie des devis gagnés) / `gagnée` (tous) / `perdue`. **C'est le devis (pas l'affaire) qui est transféré en marché** à l'acceptation. Modèle : `Affaire` 1→N `Devis` 1→N `Version` ; agrégation des KPI (déboursé, revient, PV, marges) au niveau affaire.
- **Corps du devis & montage in-place** : arbre hiérarchique de lignes typées — **Titre → Sous-titre → Ouvrage → Ressource** (profondeur libre). Chaque ligne : code, désignation, unité, quantité (métré), PU. **Montage sur place** : chaque section porte des actions inline (+ Sous-titre / + Ouvrage [copie le sous-détail] / + Ligne / + Texte libre), sous-totaux par niveau, suppression en cascade.
- **Sous-détail d'ouvrage copié & modifiable** *(implémenté)* : poser un ouvrage de bibliothèque **copie ses composants** en lignes ressource enfants **éditables** (ratio/quantité, perte, PU, nature), **découplées de la bibliothèque** (instantané). Le conducteur ajuste le sous-détail pour CE devis sans impacter la bibliothèque.
- **Options & variantes** *(implémenté)* : un titre/sous-titre peut être marqué **option** ou **variante** (propagé à ses descendants) ; ces lignes sont **valorisées mais exclues** du total contractuel, des marges, de la ventilation et du marché — présentées à part (PV propre).
- **Métré** : quantité calculable par **formule** avec **variables globales** (ex. surface, linéaire réutilisés) et « métré temps ».
- **Déboursé / sous-détail** : décomposition du coût de revient d'un ouvrage (les ressources qui le composent). Distinguer **déboursé sec** (coût direct).
- **Titre non vendable / frais de chantier** : coûts d'installation et frais de chantier non facturés en ligne directe, à **ventiler** ensuite sur les ouvrages vendables.
- **Feuille de vente** *(implémentée)* : passe du **déboursé** au **prix de vente** par une **cascade paramétrée par nature** — `déboursé × (1 + FG %) = prix de revient`, puis `× (1 + Bénéfice %) = prix de vente`, où **FG (frais généraux) et Bénéfice sont réglés séparément pour chacune des 4 natures** (main d'œuvre / matériaux / matériel / sous-traitance). Expose le **prix de revient** comme palier distinct et deux marges — **marge brute** (PV − déboursé) et **marge nette** (PV − prix de revient) — plus le **coefficient global réel**. Gère la **ventilation des titres non vendables** (frais de chantier répartis au prorata du déboursé, **nature conservée**), les **frais annexes** (liste de postes nommés, en % du PV hors frais ou montant fixe), une **remise globale** (% ou fixe), la **TVA**, et le **forçage du PV ligne à ligne** (PV saisi à la main, **mémorisé et tracé**, sans recalcul des autres lignes). **Toutes les lignes vendables sont valorisées** (ouvrage de bibliothèque via son sous-détail, ou ligne manuelle via son PU sur une **nature saisie à la main**). **Le calcul vit côté serveur** (jamais dans l'écran) ; un endpoint dédié renvoie la **config stockée** (coefficients, remise, TVA, frais) pour préremplir l'écran. Écran organisé en **3 onglets** (Étude de prix / Coefficients & frais / Devis client) avec synthèse KPI permanente. Lignes Nota / Pour mémoire / Non compris.
- **TVA** multi-taux, gestion par société (multi-société dans un même tenant).

### 5.3 Workflow du devis (machine à états)

Le workflow vit **au niveau du devis** (pas de l'affaire). Machine à états explicite *(implémentée)* :

`Ouvert/Planifié → Étude en cours → Coefficients proposés → Coefficients validés → Envoyé → {Gagné | Perdu | Relancé | Révision}`

Seul un **devis Gagné** peut être transféré en chantier/facturation (cf. module Acceptation). Le **statut de l'affaire en découle** (dérivé : en cours / gagnée partiellement / gagnée / perdue).

### 5.4 Acceptation de commande (le pont)

Transfert d'un **devis gagné** (et non de l'affaire entière) vers l'aval, en **5 étapes** : choix du devis → destination → options → traitement des prix unitaires → budgétisation. **Chaque transfert crée un MARCHÉ** (un contrat) rattaché à un **chantier** — nouveau ou **existant**. Un chantier peut donc recevoir **plusieurs marchés** (voir 5.5). Les options/variantes du devis sont **exclues** du marché.

- Vers **Suivi de chantiers** : rattache le marché à un chantier (création d'un nouveau chantier, ou sélection d'un chantier existant), avec son **étude d'exécution** (issue du déboursé) et son **budget de vente** (montant du devis) qui **s'ajoutent à l'agrégat du chantier**. Possibilité de transférer le détail des frais généraux. **Initialisation de la nomenclature de chantier par copie** : au transfert, les **ressources, ouvrages et leur rattachement analytique** (famille, code analytique) du devis sont **copiés** dans la nomenclature du chantier. Cette copie est un instantané : ensuite, bibliothèque d'étude et nomenclature de chantier évoluent **indépendamment** (aucune synchronisation).
- Vers **Facturation** : crée la **chaîne de facturation propre au marché** (devis détaillé ou global → situations → factures).
- **Trois gestes distincts à ne pas confondre** :
  - **Marché initial** sur un **nouveau** chantier.
  - **Nouveau marché sur un chantier existant** : un autre lot gagné est rattaché au même chantier ; il a sa **propre chaîne de facturation** et son budget s'ajoute à l'agrégat de suivi.
  - **Avenant d'un marché existant** : modifie/étend la facturation d'un marché déjà transféré (rattachement à sa chaîne de situations).
- **Recodification automatique** des éléments lors des avenants : suffixe (ex. `-AV1`) pour préserver les prix initiaux et éviter les collisions de codes.
- Forme de l'étude d'exécution paramétrable : par ouvrage du devis, par titre de 1er niveau, hiérarchie complète du déboursé, déboursé complet, ou titres seuls.

### 5.5 Suivi de chantiers

- **Chantier** : `code`, l'unité de **suivi financier agrégé**. Un chantier **contient un ou plusieurs marchés** (1 → N). C'est au niveau du chantier que s'agrègent tous les coûts (achats, heures, factures fournisseurs) — **un seul tableau de bord pour tous les lots/marchés**.
- **Marché** : un contrat issu d'un devis gagné, rattaché à un chantier. Porte son **étude d'exécution**, son **budget**, son **montant de vente** (+ avenants), et sa **chaîne de facturation propre**. Exemple : un même chantier avec 3 marchés Peinture / Sols durs / Sols souples chiffrés et gagnés séparément.
- **Nomenclature de chantier** : catalogue de ressources/ouvrages **propre au chantier**, **séparé de la bibliothèque d'étude de prix**. Initialisé par copie au premier transfert (voir 5.4), puis **indépendant** : le conducteur de travaux peut y **ajouter des ressources propres au chantier** (apparues en exécution) sans impacter la bibliothèque d'étude, et inversement — **aucune communication automatique** entre les deux. Toute ressource ajoutée en chantier doit néanmoins être **rattachée à un code analytique** du plan analytique de la société (référence partagée) pour s'agréger correctement dans le tableau de bord.
- **Budgets** : initial, prévisionnel, fonction de l'avancement, budget d'approvisionnement lié à l'étude d'exécution ; au niveau marché **et** agrégés au chantier. Budgets manuels possibles.
- **Main d'œuvre** : **pointages** (salarié/équipe, heures, date, chantier, ventilation par ouvrage et par matériel), contrôle, synthèse, régularisation, procédure mensuelle. Imputés au chantier, classés par l'axe analytique (donc ventilables par lot).
- **Chaîne des achats** : `Demande de prix → Bon de commande → Bon de livraison → Facture`, avec **réservation sur stock**, rapprochement des factures, extinction des suggestions. Saisie en **grille deux parties**, traitement et duplication des bons. Coûts imputés au chantier + classification analytique (ventilables par lot, et optionnellement attribuables à un marché précis).
- **Stocks** : valorisation, mouvements, réservations, états (stock arrêté, historiques).
- **Parc matériel** : affectation, heures matériel, abonnements/locations.
- **Résultats / analytique** : résultats par chantier (tous marchés) **et** par marché, intégration analytique, **export comptabilité** (journaux paramétrables, chronos).

**Modèle de données** : `Chantier` (1) → (N) `Marché`. Le `Marché` (1) → (N) `Situation` / `Facture` / `Avenant` / `DGD`. Les lignes de coût (pointage, ligne d'achat, facture fournisseur) référencent le `Chantier` (+ leur ressource = code analytique) et, optionnellement, un `Marché`.

### 5.6 Facturation

- **Une chaîne de facturation par marché** : chaque marché d'un chantier a ses propres devis, situations, factures, avenants et DGD (ce sont des contrats distincts). Un chantier à 3 marchés produit donc 3 séries de situations et de factures indépendantes.
- **Devis** : importable depuis un **DQE/DPGF** (formats d'échange marchés publics).
- **Situation de travaux** (facturation à l'avancement, par marché) : corps (lignes avec **% d'avancement**), **pied TTC** et **pied NAP**, **retenue de garantie**, **révision/actualisation de prix**, déduction des situations précédentes, situations intermédiaires.
- **Avenants** : par nouvelle série de situations ou par intégration du devis avenant sur une situation en cours.
- **DGD** (Décompte Général Définitif) : généré à partir de la dernière situation **du marché**.
- **Facture** : générée depuis une situation. Numérotation par **chrono** paramétrable, par société. TVA/TPF.
- **Conformité e-facturation** : émission Factur-X, transmission Chorus Pro (public) et plateformes agréées (réforme FR), cycle de vie des statuts de facture.

### 5.7 Administration (transverse)

- **Tenants / sociétés**, **environnements**, bases multiples.
- **Utilisateurs** : création, profils, fusion, réinitialisation MDP (par admin uniquement).
- **Licences / jetons** : affectation de droits modulaires par utilisateur ou par application.
- **Rôles (RBAC)** : autorisations fines par module et par environnement (ex. opérateur de saisie MO, acheteur avec/sans création fournisseur, métreur avec/sans coefficients, administrateur des bibliothèques, planificateur…). Rôles cumulables. Droits sur bases, modules et centres de coûts.
- **Prédispositions** : récupérer la configuration d'un utilisateur (grilles, mises en page, paramètres) et la diffuser aux autres.

#### 5.7.1 Menu Paramètres société *(implémenté en Phase 1)*

Menu **Administration → Paramètres** accessible à tout administrateur, sans gate de capacité (configuration transversale). 6 onglets :

- **Entreprise** : infos légales (nom, forme juridique, adresse, code postal, ville, téléphone, email, SIRET, N° TVA intracommunautaire, RCS, capital social). Données utilisées dans les en-têtes PDF.
- **Familles** : référentiel des familles de ressources (code, désignation, lot parent). CRUD complet + cascade vers codes analytiques.
- **Codes analytiques** : référentiel des codes analytiques (code, désignation, famille parent). 4 niveaux : nature → lot → famille → code analytique → ressource. CRUD complet.
- **Lots** : référentiel des lots du plan analytique (nature, code, désignation), regroupés par nature (MO / Matériaux / Matériel / Sous-traitance). CRUD complet.
- **Unités** : référentiel des unités de mesure (abréviation, désignation), réordonnables. Proposées dans tous les sélecteurs de l'app (ressources, ouvrages, lignes de devis).
- **Préférences** :
  - **Taux TVA disponibles** : liste de taux paramétrables (chips), proposés dans le sélecteur TVA de chaque devis. TVA 0% = autoliquidation.
  - **Taux par défaut FG / Bénéfice** : pré-remplis à la création d'un devis, modifiables par devis. Saisis en % (ex. 25, pas 0.25). Formule PV = Débours × (1 + FG%) × (1 + Bénéfice%).
  - **Onglet devis par défaut** : onglet ouvert automatiquement à l'ouverture d'un devis existant (Étude de prix / Coefficients & frais / Devis client / Aperçu PDF).
  - **Affichage des décimales** : choix 2 / 3 / 4 chiffres après la virgule dans les tableaux et montants. Les calculs se font toujours en 4 décimales (moteur). Les PDF s'arrêtent toujours à 2.
  - **Numérotation des devis** : préfixe (ex. DEV) + séparateur (ex. -).
  - **Deux couleurs paramétrables** avec aperçu live (CSS vars appliquées immédiatement) :
    - `couleur_principale` (`--primary`) : sidebar, en-têtes de section, titres — navy `#1a3a5c` par défaut.
    - `couleur_accent` (`--accent`) : boutons, codes analytiques, badges actifs — orange `#e8550a` par défaut.

**Règles d'affichage des nombres** : ne jamais afficher de décimales inutiles (25 et non 25.00 ; 25.5 si ≠ 00). Ne jamais forcer une virgule dans un champ de saisie — l'opérateur la saisit s'il en a besoin.

**Responsable de l'affaire** : saisi dans chaque affaire individuellement (pas une préférence globale), il apparaît sur les PDFs de cette affaire.

### 5.8 Contrôle de gestion chantier — MODULE DIFFÉRENCIANT (analytique prédictif)

**C'est l'élément différenciant principal de l'ERP.** Là où la plupart des ERP BTP se limitent à *budget initial / dépenses réalisées / factures fournisseurs*, ce module fournit une **vision prédictive en temps réel** répondant à une seule question : **« Quelle sera la marge réelle du chantier à sa clôture ? »** — et il doit permettre de détecter les dérives **plusieurs semaines ou mois avant la fin** des travaux. Aucun traitement nocturne : tous les indicateurs sont **recalculés en temps réel**.

**Bounded context dédié et indépendant : `control-management`.** Il *consomme* les données des autres modules (étude de prix, pointages, achats, factures, situations) et *produit* des KPI, prévisions, alertes et analyses. Le moteur analytique est **centralisé** ; **les calculs ne sont jamais codés dans les écrans**, et **toutes les formules sont paramétrables et versionnées**.

#### Modèle économique du chantier — 4 axes

1. **Vente** : `Vente totale = Marché initial + Avenants` (intégrer travaux supplémentaires et travaux supprimés). Un chantier pouvant porter **plusieurs marchés**, la vente du chantier = **somme des ventes de ses marchés** (chacun avec ses avenants) ; la marge se lit au niveau **chantier (agrégé)** et **par marché**.
2. **Budget** (issu de l'étude de prix) : découpé par **nature** (main d'œuvre, matériaux, matériel, sous-traitance, frais de chantier) et conservé à **tous les niveaux** (chantier global → titre → sous-titre → ouvrage → ressource).
3. **Engagé** : montants commandés mais pas forcément facturés (bon de commande fournisseur, sous-traitance commandée, location réservée). `Engagé = Σ commandes validées non annulées`, comptabilisé **dès la validation de la commande**.
4. **Réalisé** : coûts réellement consommés (factures fournisseurs, heures pointées, matériel consommé, sous-traitance facturée). `Réalisé = Σ coûts comptabilisés`.

#### Indicateurs (toutes formules paramétrables et versionnées)

- **Budget avancé** (concept fondamental) : budget théorique qui *devrait* être consommé compte tenu de l'avancement réel. `Budget avancé = Budget initial × % d'avancement`.
- **Crédit débloqué** : part du budget rendue consommable par l'avancement, par nature. Ex. `Crédit débloqué MO = Budget MO × % avancement MO`. Comparé au réalisé et à l'engagé.
- **Écart au stade** (indicateur principal) : `Écart au stade = Budget avancé − (Réalisé + Engagé)`. Positif = avance financière ; négatif = **dérive**.
- **Reste à engager** : `Budget initial − Engagé` (anticipe les besoins futurs).
- **Reste à dépenser** : `Budget prévisionnel final − Réalisé` (calculé automatiquement).
- **Prévision à terminaison (EAC, *Estimate At Completion*)** — indicateur stratégique, **moteur multi-méthodes paramétrable** :
  - Méthode 1 : `EAC = Réalisé + Reste à dépenser`.
  - Méthode 2 : `EAC = Budget initial / CPI`, avec `CPI = Budget avancé / Réalisé`.
- **Marge prévisionnelle finale** : `Marge prévisionnelle = Vente totale − EAC`. Afficher en **montant ET en pourcentage**.

#### Axes d'analyse — DEUX dimensions à croiser

Le module distingue **deux axes** d'analyse, disponibles séparément et croisables :

**1. Axe structurel** (« où dans le devis/chantier ») : chantier global → titre → sous-titre → ouvrage → ressource.

**2. Axe analytique** (« quel type de dépense ») — hiérarchie **paramétrable par société** : **nature → lot → famille → code analytique → ressource**.
- **Nature** (niveau 1) : Matériaux, Matériel, Sous-traitant, Main d'œuvre.
- **Lot** / corps d'état (niveau 2) : `SOLS DURS`, `SOLS SOUPLES`, `PEINTURES`, `GROS-ŒUVRE`…
- **Famille** (niveau 3) : `COLLES`, `ÉTANCHÉITÉ`, `ENDUITS`, `COFFRAGE`, `BOIS`…
- **Code analytique** (niveau 4) : poste de coût avec **numéro propre à la société**. Ex. `COLLE = 280`, `CARRELAGE = 290`, `BANCHES = 300`. **Un code analytique regroupe plusieurs ressources.**
- **Ressource** (sous le code analytique) : article concret avec **`code_produit` unique** (ex. « Colle C2 Bostik 25 kg »). Une ressource appartient à **un seul** code analytique.

> **Relation clé : code analytique (1) → ressources (N)**, et une ressource → **un seul** code analytique. Une ligne de coût référence une **ressource** (par son code produit) ; elle hérite donc automatiquement de son code analytique, puis famille → lot → nature. Pas de double imputation à ressaisir.

Tous les indicateurs (budget, budget avancé, engagé, réalisé, écart, prévision, marge) sont disponibles et **affichés à CHAQUE niveau** des deux axes — **jamais seulement au total chantier**. Le tableau de bord analytique se présente en **menus dépliables niveau par niveau** : nature → (déplier) lot → (déplier) famille → (déplier) **code analytique** (4ᵉ niveau), avec possibilité de descendre jusqu'aux **ressources** individuelles sous un code. Agrégation ascendante : ressource → code analytique → famille → lot → nature → chantier.

**Imputation analytique** : chaque ligne génératrice de coût (ressource du budget d'étude, **ligne de commande** = engagé, **facture** = réalisé, **pointage** = MO) référence une **ressource** (code produit), donc hérite automatiquement de tout son chemin analytique (code analytique → famille → lot → nature).

**Modèle de données analytique** (par société, avec **plan modèle dupliqué** à la création d'une société) : `Nature`, `LotAnalytique` (→ nature), `FamilleAnalytique` (→ lot), `CodeAnalytique` (numéro société, libellé, → famille), `Ressource` (**`code_produit` unique**, libellé, unité, déboursé, → **un seul** `CodeAnalytique`). **Nesting strict** : ressource → 1 code analytique → 1 famille → 1 lot → 1 nature ; et un code analytique regroupe **N** ressources. C'est cette même entité `Ressource` qui sert dans les bibliothèques d'étude de prix (section 5.1).

#### Gestion mensuelle et temporalité (M / M-1 / CUMUL)

Le contrôle de gestion est **mensuel** : les mouvements sont rattachés à un **mois**, et chaque mois fait l'objet d'un **enregistrement / clôture de période** par chantier (un enregistrement par mois). Cette clôture **fige un instantané** de l'état du chantier en fin de mois (avancement, engagé cumulé, réalisé cumulé, EAC, marge prévisionnelle) et conserve les **flux du mois** (engagé du mois, réalisé du mois). C'est ce qui alimente les comparaisons M-1 et les courbes de pilotage.

**Présentation à 3 colonnes temporelles — règle d'affichage généralisée.** Pour **chaque indicateur** et **à chaque niveau analytique** (nature → lot → famille → code analytique → ressource), le tableau de bord affiche toujours :
- **Mois M** : les mouvements du mois en cours.
- **Mois M-1** : les mouvements du mois précédent.
- **CUMUL** : le cumul depuis le début des mouvements (au stade).

Les indicateurs de **flux** (engagé, réalisé, avancement de la période) se lisent par mois ; les indicateurs **cumulés/au stade** (budget avancé, écart au stade, EAC, marge prévisionnelle) se lisent en colonne CUMUL, avec leur variation M / M-1 pour visualiser la tendance. Chaque ligne de coût (engagé, réalisé, pointage) porte donc son **mois de rattachement**.

**Modèle de données (temporel)** : `PériodeMensuelle` / `ClôtureMensuelle` (chantier, mois, instantané des cumuls + flux du mois, statut ouverte/clôturée) ; toute ligne de mouvement porte un champ `mois` (ou date rattachée à une période). Les agrégats M / M-1 / CUMUL se calculent en filtrant/​cumulant par période — **en temps réel**, jamais en batch nocturne.

#### Tableaux de bord

- **Vue Direction** — portefeuille de chantiers, colonnes : vente, budget, réalisé, engagé, budget avancé, prévision fin de chantier, marge finale prévisionnelle, taux de marge. **Classement automatique des chantiers à risque.** Chaque montant déclinable en M / M-1 / CUMUL.
- **Vue Conducteur de travaux** — détail d'un chantier, widgets : budget, réalisé, engagé, budget avancé, écart, prévision fin de chantier. **Tableau analytique en menus dépliables niveau par niveau : nature → lot → famille → code analytique**, avec les indicateurs affichés **à chaque niveau** (jamais uniquement le total chantier) et **sur les trois colonnes Mois M / Mois M-1 / CUMUL**, descente possible jusqu'aux **ressources** sous un code. Croisable avec l'axe structurel (par titre/ouvrage) et par marché.

#### Alertes automatiques

Déclencher quand : écart au stade < −5 % ; marge prévisionnelle < marge cible ; dépassement de budget par nature (MO, matériaux, matériel, sous-traitance). Seuils **paramétrables**.

#### Courbes de pilotage

Tracer simultanément les courbes **budget avancé / réalisé / engagé / prévision** pour visualiser immédiatement les dérives.

#### Capacités & packaging

Capacités `cost_control.dashboard`, `cost_control.forecast`, `cost_control.alerts`, `cost_control.portfolio`. Le module dépend des données de l'Étude de prix (budget), du Suivi de chantiers (pointages, achats) et de la Facturation (vente/situations) ; le proposer comme **module premium** (fort argument de différenciation — justifie un positionnement tarifaire haut). À ajouter à l'offre (section 3.2) et aux packs concernés.

---

## 6. Règles métier critiques (à ne pas rater)

Ces règles font la valeur d'un ERP BTP. Testez-les unitairement.

1. **Recalcul ascendant des ouvrages** : modifier le PU d'une ressource recalcule instantanément le déboursé de tous les ouvrages qui l'utilisent, puis les titres, puis le total — en temps réel dans l'UI.
2. **Déboursé → vente par coefficients** *(implémentée, testée)* : la feuille de vente applique une **cascade par nature** — `déboursé × (1 + FG %) = prix de revient`, puis `× (1 + Bénéfice %) = prix de vente`, FG et Bénéfice réglés **séparément par nature** ; elle expose le **prix de revient** et distingue **marge brute** (PV − déboursé) de **marge nette** (PV − prix de revient). Le prix de vente n'est jamais saisi en dur sans traçabilité des coefficients appliqués (sauf **forçage explicite du PV par ligne**, mémorisé et tracé). Calcul **côté serveur**, jamais dans l'écran.
3. **Ventilation des frais de chantier** : les titres non vendables se répartissent sur les ouvrages vendables selon une clé (au prorata du déboursé, par titre, etc.).
4. **Gestion des prix sur avenant** : par défaut, recodifier (suffixe) pour figer les prix initiaux ; option « conserver le prix de la nomenclature » vs « reprendre le prix du devis ».
5. **Cohérence devis ↔ exécution ↔ facturation** : conserver une codification cohérente des ouvrages tout au long de la chaîne pour permettre le rapprochement (option de recodification à l'image de l'étude de prix).
6. **Situation à l'avancement** : montant d'une situation = Σ(quantité marché × PU × % avancement) − situations antérieures ; gérer retenue de garantie, révision de prix, pénalités, comptes prorata.
7. **Workflow bloquant** : une affaire non « Gagnée » ne se transfère pas sans confirmation ; alerter (non bloquant) si déboursé nul ou affaire déjà transférée.
8. **Multi-tenant strict** : aucune requête ne doit pouvoir lire les données d'un autre tenant. RLS + tests d'isolation.
9. **Contrôle de gestion — moteur analytique centralisé** (module différenciant, voir 5.8) : tous les indicateurs (`budget avancé`, `engagé`, `réalisé`, `écart au stade`, `EAC`, `marge prévisionnelle`) sont recalculés **en temps réel**, **jamais en traitement nocturne**. Les **formules sont paramétrables et versionnées**, et **calculées dans le moteur `control-management`, jamais dans les écrans**. L'**engagé** est comptabilisé **dès la validation d'une commande** (pas à la facturation). Tester unitairement chaque formule (budget avancé, écart au stade, EAC méthodes 1 et 2, marge prévisionnelle) avec jeux de valeurs connus.
10. **Chantier ≠ marché** : un **chantier** (unité de suivi financier) peut contenir **plusieurs marchés** (un par devis gagné). Les **coûts** (achats, heures, factures fournisseurs) s'**agrègent au chantier** (un seul tableau de bord, ventilable par lot via l'axe analytique) ; la **facturation est séparée par marché** (situations, factures et DGD propres à chaque contrat). Ne jamais coder « 1 devis = 1 chantier = 1 marché ».

---

## 7. Conformité réglementaire France (différenciateur majeur)

- **Facturation électronique** : Factur-X (PDF/A-3 + XML CII), cycle de vie des statuts, e-reporting. Préparer l'intégration aux plateformes agréées / PPF selon le calendrier en vigueur — **vérifier les dates et obligations à jour avant la mise en production** (le calendrier de la réforme a évolué plusieurs fois).
- **Marchés publics** : Chorus Pro (dépôt de situations, DGD, factures), import DPGF/DQE, formats d'échange.
- **TVA** : multi-taux, autoliquidation sous-traitance BTP, TVA sur encaissements/débits.
- **Comptabilité** : export FEC, journaux paramétrables, liaison vers logiciels comptables courants.

> ⚠️ Le périmètre réglementaire évolue. Le code doit isoler les règles fiscales/légales dans un module dédié et versionné, pas les disperser dans la logique métier.

---

## 8. Plan de construction par phases

Ne pas tout construire d'un coup. Ordre recommandé :

**Phase 0 — Socle** : multi-tenant, auth/RBAC, **système d'entitlements (capacités + quotas) et cycle de vie de souscription avec essai 30 j** (section 3), modèle de données de base, CI/CD, data-grid réutilisable, recherche universelle. La garde d'autorisation par capacité doit exister avant tout module métier, pour que chaque fonctionnalité naisse déjà « gatée ». L'intégration du prestataire de facturation récurrente (checkout, portail, webhooks) peut être branchée en fin de phase 1.

**Phase 1 — Études de prix (MVP du cœur)** : bibliothèques + ressources enrichies (fiche complète avec référentiels paramétrables, coeff conversion, distributeur), ouvrages composés avec recalcul, corps de devis hiérarchique, métré simple, déboursé/sous-détails, feuille de vente + coefficients, workflow d'affaire, édition PDF du devis. **Module Paramètres société** (§ 5.7.1). *C'est le module qui vend le produit — soignez-le.* **En fin de phase** (premier produit vendable) : les **deux interfaces d'abonnement/licences** (espace client + back-office éditeur, section 3.7) et le branchement au prestataire de paiement.

**Phase 2 — Acceptation + Facturation** : transfert affaire gagnée → devis facturation, situations de travaux à l'avancement, avenants, DGD, génération de factures, Factur-X.

**Phase 3 — Suivi de chantiers + Contrôle de gestion (le différenciateur)** : exécution — budgets, pointages (mobile), chaîne des achats, résultats analytiques, export compta. Puis le **moteur `control-management`** (section 5.8) : modèle économique à 4 axes (vente/budget/engagé/réalisé), indicateurs prédictifs (budget avancé, écart au stade, EAC, marge prévisionnelle), tableaux de bord Direction et Conducteur, alertes et courbes de pilotage. *C'est le cœur de l'outil et l'argument de différenciation — construire d'abord les briques d'exécution qui alimentent le moteur, puis le moteur analytique centralisé et paramétrable. Soigner les tests de formules.*

**Phase 4 — Avancé** : stocks, parc matériel, BIM/IFC, assistance IA, connecteurs comptabilité/paie, app mobile complète hors-ligne.

Chaque phase doit être livrable et testée de bout en bout avant la suivante.

---

## 9. Instructions pour l'agent de développement

- Commence par générer l'**architecture des dossiers** (un module par bounded context) et le **schéma de base de données** (migrations) avant tout code métier.
- Modélise d'abord l'**ouvrage composé récursif** et son **recalcul** — écris les tests avant l'implémentation.
- Pour chaque module, livre : entités → repository → services métier → API documentée (OpenAPI) → écrans React.
- Propose une **seed de démonstration** : une bibliothèque réaliste, une affaire chiffrée complète, un chantier transféré, une première situation.
- Documente les **règles métier** de la section 6 sous forme de tests unitaires nommés explicitement.
- Chaque endpoint ou action liée à une fonctionnalité de palier doit porter sa **garde de capacité** dès sa création ; ne jamais tester un nom de palier en dur (cf. section 3.1). Ajoute des tests d'accès (autorisé / refusé / quota dépassé) pour les fonctions gatées.
- Pose des questions si une règle métier est ambiguë plutôt que de deviner ; ne réimplémente pas une règle fiscale sans l'isoler dans le module conformité.
- N'utilise aucun code, aucune marque ni aucun actif appartenant à un éditeur existant ; conçois une UX et une nomenclature propres.

---

## 10. Glossaire métier BTP

| Terme | Définition |
|---|---|
| **Déboursé sec** | Coût direct d'un ouvrage (MO + matériaux + matériel + sous-traitance), hors frais généraux et marge. |
| **Ouvrage** | Prestation élémentaire vendable, composée de ressources et/ou sous-ouvrages. |
| **Sous-détail de prix** | Décomposition du coût d'un ouvrage en ses ressources. |
| **Métré** | Quantité de travaux mesurée/calculée pour chaque ouvrage. |
| **Feuille de vente** | Outil de passage du déboursé au prix de vente par coefficients. |
| **Titre non vendable** | Frais de chantier/installation à ventiler, non facturés directement. |
| **DPGF / DQE** | Décomposition du Prix Global et Forfaitaire / Détail Quantitatif Estimatif (pièces de marché). |
| **Situation de travaux** | Facturation périodique à l'avancement des travaux réalisés. |
| **Retenue de garantie** | Part retenue sur chaque situation, libérée après réception. |
| **DGD** | Décompte Général Définitif : solde final du marché. |
| **NAP** | Net À Payer. |
| **Avenant** | Modification du marché initial (travaux supplémentaires/modificatifs). |
| **Chantier** | Unité de suivi financier agrégé (le site). Contient un ou plusieurs marchés ; un seul tableau de bord de coûts pour tous. |
| **Marché** | Contrat issu d'un devis gagné, rattaché à un chantier. Porte son budget, sa vente et sa chaîne de facturation propre (situations, factures, DGD). |
| **Nomenclature** | Catalogue de ressources propre à un chantier, distinct de la bibliothèque d'étude de prix. |
| **Bibliothèque / nomenclature (séparation)** | Bibliothèque d'étude (chiffrage) et nomenclature de chantier (exécution) sont séparées ; reliées seulement par une copie au premier transfert, puis indépendantes. |
| **Pointage** | Saisie des heures de main d'œuvre par salarié et par chantier. |
| **Engagé** | Montants commandés mais pas forcément facturés ; comptés dès la validation de la commande. |
| **Réalisé** | Coûts réellement consommés (factures, heures pointées, sous-traitance facturée…). |
| **Budget avancé** | Budget théorique qui devrait être consommé vu l'avancement : Budget initial × % avancement. |
| **Crédit débloqué** | Part du budget rendue consommable par l'avancement, par nature de coût. |
| **Écart au stade** | Budget avancé − (Réalisé + Engagé). Négatif = dérive. |
| **Reste à engager** | Budget initial − Engagé. |
| **Reste à dépenser** | Budget prévisionnel final − Réalisé. |
| **EAC** | *Estimate At Completion* : prévision du coût total à la clôture du chantier. |
| **CPI** | *Cost Performance Index* : Budget avancé / Réalisé ; mesure l'efficience des coûts. |
| **Marge prévisionnelle finale** | Vente totale − EAC, en montant et en pourcentage. |
| **Plan analytique** | Référentiel de ventilation des coûts, paramétrable par société : nature → lot → famille → code analytique → ressource. |
| **Lot (analytique)** | Corps d'état regroupant des familles (ex. SOLS DURS, GROS-ŒUVRE, PEINTURES). Niveau 2. |
| **Famille analytique** | Regroupement de codes analytiques (ex. COLLES, COFFRAGE, BOIS). Niveau 3. |
| **Code analytique** | Poste de coût avec numéro propre à la société (ex. COLLE = 280). Niveau 4 ; regroupe plusieurs ressources. |
| **Ressource** | Article concret avec un `code_produit` unique (ex. une colle d'une marque précise) ; appartient à un seul code analytique. |
| **Imputation analytique** | Une ligne de coût référence une ressource ; elle hérite alors de tout son chemin : code analytique → famille → lot → nature. |
| **Période mensuelle / clôture** | Enregistrement mensuel par chantier figeant l'instantané des cumuls et les flux du mois ; base des comparaisons et de l'historique. |
| **M / M-1 / CUMUL** | Présentation de chaque indicateur sur trois colonnes : mois en cours, mois précédent, cumul depuis le début des mouvements. |

---

*Fin du master-prompt. Adaptez le périmètre des phases à vos priorités commerciales : commencer par Études de prix + Facturation couvre déjà la majorité de la valeur perçue.*

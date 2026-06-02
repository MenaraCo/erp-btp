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

- **Bibliothèque** : catalogue réutilisable (multi-bibliothèques par tenant). Peut être convertie depuis une affaire, importée (listing, format type BatiPrix), mise à jour depuis une nomenclature de chantier.
- **Ressource** : brique élémentaire. Champs : `code`, `libellé`, `unité`, `prix unitaire (déboursé)`, `nature`. **Natures** : main d'œuvre (MO), matériaux, matériel, sous-traitance. Une ressource MO porte un rendement/temps.
- **Élément composé / Ouvrage** : composition récursive de ressources et de sous-ouvrages, chacun avec une **quantité**. Son coût (déboursé sec) est **calculé automatiquement** par agrégation des composants. C'est l'entité reine — modélisez-la en arbre récursif avec recalcul ascendant.
- **Élément en pourcentage** : ligne dont le montant est un % d'une assiette (frais, aléas).
- **Étude type** : modèle de devis pré-rempli réutilisable.

### 5.2 Étude de prix (affaire)

- **Affaire / Étude** : `code`, `client`, `architecte/MOA`, dates, **statut workflow**, **version**. Une affaire gère plusieurs **versions** (versioning).
- **Corps du devis** : arbre hiérarchique de lignes typées — **Titre → Sous-titre → Ouvrage → Ressource** (profondeur libre). Chaque ligne : code, désignation, unité, quantité (métré), PU.
- **Métré** : quantité calculable par **formule** avec **variables globales** (ex. surface, linéaire réutilisés) et « métré temps ».
- **Déboursé / sous-détail** : décomposition du coût de revient d'un ouvrage (les ressources qui le composent). Distinguer **déboursé sec** (coût direct).
- **Titre non vendable / frais de chantier** : coûts d'installation et frais de chantier non facturés en ligne directe, à **ventiler** ensuite sur les ouvrages vendables.
- **Feuille de vente** : passe du **déboursé** au **prix de vente** par application de **coefficients** par nature (frais généraux, bénéfice, aléas, frais financiers…). Gère la **ventilation des titres non vendables**, l'arrondi global et par PU, les **montants annexes** (forfait, remise/majoration), les lignes Nota / Pour mémoire / Non compris.
- **TVA** multi-taux, gestion par société (multi-société dans un même tenant).

### 5.3 Workflow de l'affaire (machine à états)

Implémentez une machine à états explicite :

`Ouverte/Planifiée → Étude en cours → Coefficients proposés → Coefficients validés → Envoyée → {Gagnée | Perdue | Relancée | Révision}`

Seule une affaire **Gagnée** peut être transférée en chantier/facturation (cf. module Acceptation).

### 5.4 Acceptation de commande (le pont)

Transfert d'une affaire gagnée vers l'aval, en **5 étapes** : choix de l'affaire → destination → options → traitement des prix unitaires → budgétisation.

- Vers **Suivi de chantiers** : crée un chantier contenant une **étude d'exécution** (issue du déboursé) + un **budget de vente** (montant du devis), pour établir le budget du chantier. Possibilité de transférer le détail des frais généraux.
- Vers **Facturation** : transfère le devis client (détaillé ou global) pour produire situations et factures.
- Gère le **marché initial** et les **avenants** (rattachement au chantier/facture existants).
- **Recodification automatique** des éléments lors des avenants : appliquer un suffixe (ex. `-AV1`) pour préserver les prix initiaux et éviter les collisions de codes quand une même ressource a un prix différent dans l'avenant.
- Forme de l'étude d'exécution paramétrable : par ouvrage du devis, par titre de 1er niveau, hiérarchie complète du déboursé, déboursé complet, ou titres seuls.

### 5.5 Suivi de chantiers

- **Chantier** : `code`, budgets, étude d'exécution, **nomenclature** (catalogue de ressources propre au chantier).
- **Budgets** : initial, prévisionnel (période à venir), fonction de l'avancement, budget d'approvisionnement lié à l'étude d'exécution. Budgets manuels possibles.
- **Main d'œuvre** : **pointages** (salarié/équipe, heures, date, chantier, ventilation par ouvrage et par matériel), contrôle, synthèse, régularisation, procédure mensuelle.
- **Chaîne des achats** : `Demande de prix → Bon de commande → Bon de livraison → Facture`, avec **réservation sur stock**, vérification/rapprochement des factures, extinction des suggestions. Saisie en **grille deux parties** (en-tête + détail), traitement et duplication des bons.
- **Stocks** : valorisation, mouvements, réservations, états (stock arrêté, historiques).
- **Parc matériel** : affectation, heures matériel, gestion des abonnements/locations.
- **Résultats / analytique** : éditions de résultats par chantier, intégration analytique, **export comptabilité** (journaux paramétrables, chronos).

### 5.6 Facturation

- **Devis** : importable depuis un **DQE/DPGF** (formats d'échange marchés publics).
- **Situation de travaux** (facturation à l'avancement) : corps (lignes avec **% d'avancement**), **pied TTC** et **pied NAP** (net à payer), **retenue de garantie**, **révision/actualisation de prix**, déduction des situations précédentes, situations intermédiaires.
- **Avenants** : par nouvelle série de situations ou par intégration du devis avenant sur une situation en cours.
- **DGD** (Décompte Général Définitif) : généré à partir de la dernière situation.
- **Facture** : générée depuis une situation. Numérotation par **chrono** paramétrable, par société. TVA/TPF.
- **Conformité e-facturation** : émission Factur-X, transmission Chorus Pro (public) et plateformes agréées (réforme FR), cycle de vie des statuts de facture.

### 5.7 Administration (transverse)

- **Tenants / sociétés**, **environnements**, bases multiples.
- **Utilisateurs** : création, profils, fusion, réinitialisation MDP (par admin uniquement).
- **Licences / jetons** : affectation de droits modulaires par utilisateur ou par application.
- **Rôles (RBAC)** : autorisations fines par module et par environnement (ex. opérateur de saisie MO, acheteur avec/sans création fournisseur, métreur avec/sans coefficients, administrateur des bibliothèques, planificateur…). Rôles cumulables. Droits sur bases, modules et centres de coûts.
- **Prédispositions** : récupérer la configuration d'un utilisateur (grilles, mises en page, paramètres) et la diffuser aux autres.

### 5.8 Contrôle de gestion chantier — MODULE DIFFÉRENCIANT (analytique prédictif)

**C'est l'élément différenciant principal de l'ERP.** Là où la plupart des ERP BTP se limitent à *budget initial / dépenses réalisées / factures fournisseurs*, ce module fournit une **vision prédictive en temps réel** répondant à une seule question : **« Quelle sera la marge réelle du chantier à sa clôture ? »** — et il doit permettre de détecter les dérives **plusieurs semaines ou mois avant la fin** des travaux. Aucun traitement nocturne : tous les indicateurs sont **recalculés en temps réel**.

**Bounded context dédié et indépendant : `control-management`.** Il *consomme* les données des autres modules (étude de prix, pointages, achats, factures, situations) et *produit* des KPI, prévisions, alertes et analyses. Le moteur analytique est **centralisé** ; **les calculs ne sont jamais codés dans les écrans**, et **toutes les formules sont paramétrables et versionnées**.

#### Modèle économique du chantier — 4 axes

1. **Vente** : `Vente totale = Marché initial + Avenants` (intégrer travaux supplémentaires et travaux supprimés).
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

#### Axes d'analyse

Tous les indicateurs disponibles à chaque niveau : **chantier global, lot, titre, sous-titre, ouvrage, ressource, nature de coût**. Chaque **nature** (MO, matériaux, matériel, sous-traitance, frais de chantier) porte son propre jeu : budget, budget avancé, engagé, réalisé, prévision, écart.

#### Tableaux de bord

- **Vue Direction** — portefeuille de chantiers, colonnes : vente, budget, réalisé, engagé, budget avancé, prévision fin de chantier, marge finale prévisionnelle, taux de marge. **Classement automatique des chantiers à risque.**
- **Vue Conducteur de travaux** — détail d'un chantier, widgets : budget, réalisé, engagé, budget avancé, écart, prévision fin de chantier.

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
2. **Déboursé → vente par coefficients** : la feuille de vente applique des coefficients par nature ; le prix de vente n'est jamais saisi en dur sans traçabilité du coefficient appliqué (sauf forçage explicite du PV avec mémorisation).
3. **Ventilation des frais de chantier** : les titres non vendables se répartissent sur les ouvrages vendables selon une clé (au prorata du déboursé, par titre, etc.).
4. **Gestion des prix sur avenant** : par défaut, recodifier (suffixe) pour figer les prix initiaux ; option « conserver le prix de la nomenclature » vs « reprendre le prix du devis ».
5. **Cohérence devis ↔ exécution ↔ facturation** : conserver une codification cohérente des ouvrages tout au long de la chaîne pour permettre le rapprochement (option de recodification à l'image de l'étude de prix).
6. **Situation à l'avancement** : montant d'une situation = Σ(quantité marché × PU × % avancement) − situations antérieures ; gérer retenue de garantie, révision de prix, pénalités, comptes prorata.
7. **Workflow bloquant** : une affaire non « Gagnée » ne se transfère pas sans confirmation ; alerter (non bloquant) si déboursé nul ou affaire déjà transférée.
8. **Multi-tenant strict** : aucune requête ne doit pouvoir lire les données d'un autre tenant. RLS + tests d'isolation.
9. **Contrôle de gestion — moteur analytique centralisé** (module différenciant, voir 5.8) : tous les indicateurs (`budget avancé`, `engagé`, `réalisé`, `écart au stade`, `EAC`, `marge prévisionnelle`) sont recalculés **en temps réel**, **jamais en traitement nocturne**. Les **formules sont paramétrables et versionnées**, et **calculées dans le moteur `control-management`, jamais dans les écrans**. L'**engagé** est comptabilisé **dès la validation d'une commande** (pas à la facturation). Tester unitairement chaque formule (budget avancé, écart au stade, EAC méthodes 1 et 2, marge prévisionnelle) avec jeux de valeurs connus.

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

**Phase 1 — Études de prix (MVP du cœur)** : bibliothèques + ressources, ouvrages composés avec recalcul, corps de devis hiérarchique, métré simple, déboursé/sous-détails, feuille de vente + coefficients, workflow d'affaire, édition PDF du devis. *C'est le module qui vend le produit — soignez-le.*

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
| **Nomenclature** | Catalogue des ressources propre à un chantier. |
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

---

*Fin du master-prompt. Adaptez le périmètre des phases à vos priorités commerciales : commencer par Études de prix + Facturation couvre déjà la majorité de la valeur perçue.*

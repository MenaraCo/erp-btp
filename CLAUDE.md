# CLAUDE.md — Projet ERP BTP

> Ce fichier est lu automatiquement par Claude Code à chaque session. Il définit **comment travailler** sur ce projet. Le **quoi construire** est dans le cahier des charges complet : **`CAHIER_DES_CHARGES.md`** (à la racine du dépôt). **Lis ce cahier des charges avant toute action.**

---

## Le projet en une phrase

ERP **SaaS multi-tenant** pour les entreprises du **BTP**, couvrant la chaîne **étude de prix → acceptation de commande → suivi de chantier → facturation (situations + DGD)**, commercialisé en **modèle modulaire** (modules métier licenciés au siège, jetons par module).

---

## Contraintes techniques non négociables (rappel — détail dans le cahier des charges)

- **Stack** : backend TypeScript + NestJS, base **PostgreSQL**, frontend React + Next.js + TypeScript. Un seul langage backend, pas de mélange.
- **Multi-tenant strict** : isolation par `tenant_id` + Row-Level Security. Aucune requête ne doit pouvoir lire les données d'un autre tenant.
- **Droits = capacités par module** : le code teste des **capacités** (`estimating.bid`, `invoicing.situations`, `site_tracking.budget`…), **jamais** un nom de module, de pack ou de palier en dur. Mapping module → capacités piloté par configuration.
- **Essai et souscription = deux parcours indépendants** : l'essai 30 j (statut `trialing`) n'est **pas** un prérequis de l'abonnement. L'inscription propose deux portes parallèles — « Essayer gratuitement » (crée une souscription `trialing`) **et** « Choisir mon abonnement » (crée une souscription directement `active`, avec paiement, sans passer par `trialing`). Ne jamais coder « inscription → essai obligatoire → conversion ».
- **Deux interfaces d'abonnement/licences distinctes** (voir 3.7 du cahier des charges), à construire en **fin de Phase 1** : (A) **espace abonnement client** dans l'app (choix pack/modules, jetons, affectation des jetons aux utilisateurs, paiement par **redirection vers le prestataire**, jamais de CB saisie dans l'app) ; (B) **back-office éditeur** séparé (catalogue/prix, vue de tous les abonnés, MRR/conversion/churn), réservé à l'éditeur, jamais exposé aux clients.
- **Jetons par module** : un utilisateur n'accède à un module que si un **jeton de ce module** lui est affecté ; jetons affectés ≤ jetons achetés.
- **Sécurité** : aucun secret en dur, aucun stockage navigateur pour des données sensibles, paiements via le prestataire (jamais de saisie de CB dans l'app).
- **Conformité** : règles fiscales/légales (TVA, Factur-X, Chorus Pro) **isolées dans un module conformité dédié et versionné**, jamais dispersées dans la logique métier.
- **Chantier ≠ marché** : un **chantier** (suivi financier agrégé) contient **plusieurs marchés** (un par devis gagné — ex. lots Peinture / Sols durs / Sols souples). Les **coûts s'agrègent au chantier** (un seul tableau de bord, ventilable par lot via l'analytique) ; la **facturation est séparée par marché** (situations/factures/DGD propres). Modèle : `Chantier` 1→N `Marché` ; `Marché` 1→N `Situation`/`Facture`. Ne jamais coder « 1 devis = 1 chantier = 1 marché ».
- **Bibliothèque d'étude ≠ nomenclature de chantier** : deux catalogues **séparés**. La nomenclature de chantier est **initialisée par une copie** (ressources, ouvrages, rattachement famille/code analytique) au **premier transfert** du devis, puis **évolue indépendamment** — **aucune synchronisation** automatique. Le conducteur peut ajouter des ressources propres au chantier (rattachées à un code analytique de la société). Le **plan analytique** (nature→lot→famille→code) reste, lui, une **référence partagée au niveau société**.
- **Contrôle de gestion = moteur analytique centralisé** (module différenciant, voir 5.8 du cahier des charges) : bounded context dédié `control-management`, indépendant. Il consomme les données des autres modules (étude de prix, pointages, achats, factures, situations) et produit KPI/prévisions/alertes. **Calculs en temps réel, jamais en traitement nocturne. Formules paramétrables et versionnées. Jamais de calcul codé dans les écrans.** L'engagé est compté dès la validation de la commande. **Analyse sur deux axes** : structurel (chantier→titre→ouvrage→ressource) ET analytique paramétrable par société : **nature → lot → famille → code analytique → ressource**. Un **code analytique** (ex. COLLE=280) **regroupe plusieurs ressources** ; une **ressource** a un **`code_produit` unique** et **un seul** code analytique. Le tableau de bord financier n'est **jamais seulement global** : menus dépliables avec indicateurs **affichés à chaque niveau**, jusqu'au code analytique (niveau 4) puis ressources. Agrégation ascendante ressource → code analytique → famille → lot → nature → chantier. **Gestion mensuelle** : mouvements rattachés à un mois, **un enregistrement/clôture par mois** ; chaque indicateur s'affiche **toujours sur 3 colonnes : Mois M / Mois M-1 / CUMUL** (depuis le début), à chaque niveau analytique.

---

## Protocole de travail (IMPORTANT)

1. **Travailler par phase.** Suivre le plan de construction (section « Plan de construction par phases » du cahier des charges). Ne **jamais** tout construire d'un coup.
2. **Plan avant code.** Avant de démarrer une nouvelle phase ou un nouveau module, proposer un **plan court** (arborescence des dossiers, entités, endpoints) et **attendre ma validation explicite** avant d'écrire du code.
3. **Petits incréments.** Avancer par petits lots livrables et testables. Après chaque incrément qui fonctionne, **proposer un message de commit Git**.
4. **Tests d'abord pour les règles métier critiques.** Écrire les tests des règles de la section « Règles métier critiques » du cahier des charges **avant** leur implémentation (notamment le recalcul ascendant des ouvrages composés et le passage déboursé → vente).
5. **Demander en cas d'ambiguïté.** Si une règle métier n'est pas claire, poser la question plutôt que deviner.
6. **Gating systématique.** Chaque endpoint/action lié à un module porte sa **garde de capacité + vérification de jeton** dès sa création, avec des tests d'accès (autorisé / refusé / quota dépassé).
7. **Pas de destruction de données.** Jamais de suppression de données utilisateur ni de migration destructive sans confirmation explicite.
8. **Interface web navigable tôt.** Une interface web (dossier `apps/web`, React + Next.js) doit exister et être lançable en local **dès la fin de la Phase 0** : page de connexion, mise en page avec menu de navigation des modules, tableau de bord d'accueil, branchés sur l'API d'authentification. Ne pas construire le backend pendant des semaines sans aucun écran cliquable. Chaque phase ultérieure ajoute ses écrans à ce cadre. Le propriétaire du projet n'est pas développeur : fournir à chaque jalon une explication simple de **comment lancer et voir l'app** dans le navigateur.
9. **Tranches verticales — jamais de backend isolé.** Chaque fonctionnalité est livrée **de bout en bout dans le même incrément** : API **+ écran utilisable** branché dessus (liste, boutons « Nouveau… », formulaire création/édition, suppression, rafraîchissement de la liste). Ne jamais livrer des semaines de backend sans écran exploitable. Le propriétaire doit pouvoir tester chaque fonction **par des boutons**, jamais par des appels d'API. Règle de priorité quand des écrans manquent : rendre l'existant utilisable (Clients, Fournisseurs, Chantiers, Devis…) **avant** d'ajouter de nouvelles fonctions backend.

---

## Définition de « terminé » pour une tâche

Une tâche n'est terminée que si : le code fonctionne **et** les tests passent **et** la migration de schéma est écrite (si le schéma a changé) **et** l'API est documentée (OpenAPI) **et** un message de commit est proposé.

---

## Ordre de construction (résumé)

- **Phase 0 — Socle** : multi-tenant, auth/RBAC, système de modules + capacités + jetons, cycle de souscription (essai 30 j, **CB non exigée** mais via flag de config), data-grid réutilisable, recherche universelle, CI/CD. La garde de capacité doit exister **avant** tout module métier. **Livrable obligatoire de fin de phase : une interface web minimale navigable** (connexion + menu des modules + tableau de bord) lançable en local, pour que le propriétaire voie l'app vivre dès le départ.
- **Phase 1 — Module Études de prix** (le cœur qui vend le produit) : bibliothèques + ressources, **ouvrages composés avec recalcul ascendant**, corps de devis hiérarchique, métré, déboursé/sous-détails, **feuille de vente** (voir ci-dessous), workflow d'affaire, édition PDF, devis d'appel d'offre.
  - **Feuille de vente ✅ (juin 2026)** : cascade **FG % + Bénéfice % par nature** (MO / matériaux / matériel / sous-traitance) → expose prix de revient, **marge brute** (PV − déboursé) et **marge nette** (PV − prix de revient). Frais annexes (liste %, fixe), remise globale (% ou fixe), TVA. Forçage du PV **ligne à ligne** (tracé, non recalculé). Toutes les lignes valorisées (ouvrage bibliothèque + ligne manuelle sur nature saisie). Calcul **côté serveur** (`vente-calc.ts` + `VenteService`). Endpoint `GET …/sale-sheet/config` pour préremplissage du formulaire. Écran en **3 onglets** : Étude de prix (déboursé) / Coefficients & frais / Devis client (PV forcé par ligne). Migration réversible `034`.
  - **Restructuration affaire → devis + montage ✅ (juin 2026, inspiré de l'app MENARA)** : modèle **`affaire` (client + lieu uniques) 1→N `devis` 1→N `devis_version`** (renommée depuis affaire_version). **Workflow et acceptation PAR DEVIS** ; **statut affaire DÉRIVÉ** (en cours / gagnée partiellement / gagnée / perdue). Affaire enrichie (lieu structuré jsonb, budget, responsable) + **KPI agrégés par devis**. **Options/variantes** (`section_type`, hors total). **Sous-détail d'ouvrage copié & modifiable** dans le devis (découplé de la biblio, pur `ouvrage-flatten.ts`). **Montage in-place** (web `Montage.tsx` : boutons + Sous-titre/+ Ouvrage/+ Ligne/+ Texte par section, sous-totaux, V/O, édition composants). **Charte graphique navy globale** (`globals.css`, règle tous modules). Migrations réversibles `035–039`. **~100 unit + ~132 e2e verts.** Différé : drag&drop/indent, options/variantes dans le PDF.
  - Branche : `feat/feuille-vente-fg-benefice` (~15 commits). **À merger dans `main`.**
- **Phase 2 — Acceptation + Facturation** : transfert affaire gagnée → devis, situations de travaux, avenants, DGD, génération de factures, Factur-X.
- **Phase 3 — Suivi de chantiers + Contrôle de gestion (le différenciateur)** : exécution (budgets, pointages mobile, achats, analytique, export compta), puis le moteur `control-management` — modèle économique à 4 axes (vente/budget/engagé/réalisé), indicateurs prédictifs (budget avancé, écart au stade, EAC, marge prévisionnelle), tableaux de bord Direction + Conducteur, alertes, courbes de pilotage. **Cœur de l'outil : construire d'abord les briques d'exécution qui alimentent le moteur, puis le moteur analytique centralisé et paramétrable, avec tests de formules soignés.**
- **Phase 4 — Avancé** : stocks, parc matériel, BIM/IFC, assistance IA, connecteurs, mobile hors-ligne.

Chaque phase doit être livrable et testée de bout en bout avant la suivante.

---

## Direction de design (UI) — à appliquer une fois les écrans fonctionnels

Style cible : **moderne et épuré, type SaaS récent** — clair, aéré, professionnel. Priorité absolue : **d'abord des écrans fonctionnels** (boutons, formulaires, listes qui marchent), **le style ensuite**, jamais l'inverse. Un écran brut mais utilisable vaut mieux qu'un bel écran inerte.

Principes quand on habille l'interface :
- **Beaucoup d'espace blanc**, mise en page aérée, hiérarchie visuelle claire (titres, sous-titres, corps).
- **Palette sobre** : fond clair, gris neutres pour les surfaces, **une seule couleur d'accent** pour les actions principales (boutons, liens actifs). Réserver le rouge/orange aux alertes et dérives (cohérent avec le contrôle de gestion).
- **Typographie** : une police sans-serif moderne et lisible (ex. Inter, ou la police système), tailles cohérentes, bon interlignage.
- **Composants cohérents** : mêmes styles de boutons, champs, tableaux et cartes partout (créer un petit système de composants réutilisables plutôt que styliser au cas par cas).
- **Data-grids lisibles** : les écrans sont denses (DPGF, métrés, situations, tableaux analytiques) — lignes alternées discrètes, colonnes alignées (montants à droite), états de survol, tri/filtre clairs.
- **Tableaux de bord du contrôle de gestion** : cartes d'indicateurs (KPI) nettes, courbes lisibles, codes couleur sobres pour positif/négatif.
- Éviter l'aspect « générique IA » : pas de dégradés violets clichés, pas de surcharge ; rester net, calme et crédible pour un usage professionnel quotidien.
- Accessibilité de base : contrastes suffisants, tailles de clic confortables, responsive (utilisable aussi sur tablette pour le terrain).

---

## Conventions

- **Code en anglais**, **domaine métier en français** : les noms métier (`devis`, `ouvrage`, `deboursé`, `situation`, `avenant`, `dgd`, `metre`) restent en français car ils n'ont pas d'équivalent fidèle — voir le glossaire du cahier des charges.
- **Commits conventionnels** (`feat:`, `fix:`, `test:`, `chore:`…).
- **Migrations versionnées**, réversibles autant que possible.
- **Tests** : nommer explicitement les tests de règles métier (ex. `recalcul_ouvrage_compose_quand_prix_ressource_change`).

---

## Ce qu'il NE faut PAS faire

- Pas de réécriture massive non demandée du code existant.
- Pas d'ajout de dépendances lourdes sans justification courte.
- Pas de raccourci sur l'isolation multi-tenant ou le gating, « quitte à corriger plus tard ».
- Pas de réimplémentation d'une règle fiscale hors du module conformité.
- Aucun actif (code, marque, libellés) repris d'un éditeur existant : UX et nomenclature propres.

---

## Pour démarrer la toute première session

Colle-moi cette instruction :

> « Lis `CAHIER_DES_CHARGES.md` et `CLAUDE.md`. Ne code rien pour l'instant. Résume-moi en quelques lignes ta compréhension du projet, puis propose l'**arborescence des dossiers** et le **schéma de base de données de la Phase 0** (multi-tenant, auth/RBAC, modules + capacités + jetons, souscriptions). On validera ensemble avant d'écrire la moindre ligne de code. »

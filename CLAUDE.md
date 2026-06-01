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
- **Jetons par module** : un utilisateur n'accède à un module que si un **jeton de ce module** lui est affecté ; jetons affectés ≤ jetons achetés.
- **Sécurité** : aucun secret en dur, aucun stockage navigateur pour des données sensibles, paiements via le prestataire (jamais de saisie de CB dans l'app).
- **Conformité** : règles fiscales/légales (TVA, Factur-X, Chorus Pro) **isolées dans un module conformité dédié et versionné**, jamais dispersées dans la logique métier.

---

## Protocole de travail (IMPORTANT)

1. **Travailler par phase.** Suivre le plan de construction (section « Plan de construction par phases » du cahier des charges). Ne **jamais** tout construire d'un coup.
2. **Plan avant code.** Avant de démarrer une nouvelle phase ou un nouveau module, proposer un **plan court** (arborescence des dossiers, entités, endpoints) et **attendre ma validation explicite** avant d'écrire du code.
3. **Petits incréments.** Avancer par petits lots livrables et testables. Après chaque incrément qui fonctionne, **proposer un message de commit Git**.
4. **Tests d'abord pour les règles métier critiques.** Écrire les tests des règles de la section « Règles métier critiques » du cahier des charges **avant** leur implémentation (notamment le recalcul ascendant des ouvrages composés et le passage déboursé → vente).
5. **Demander en cas d'ambiguïté.** Si une règle métier n'est pas claire, poser la question plutôt que deviner.
6. **Gating systématique.** Chaque endpoint/action lié à un module porte sa **garde de capacité + vérification de jeton** dès sa création, avec des tests d'accès (autorisé / refusé / quota dépassé).
7. **Pas de destruction de données.** Jamais de suppression de données utilisateur ni de migration destructive sans confirmation explicite.

---

## Définition de « terminé » pour une tâche

Une tâche n'est terminée que si : le code fonctionne **et** les tests passent **et** la migration de schéma est écrite (si le schéma a changé) **et** l'API est documentée (OpenAPI) **et** un message de commit est proposé.

---

## Ordre de construction (résumé)

- **Phase 0 — Socle** : multi-tenant, auth/RBAC, système de modules + capacités + jetons, cycle de souscription (essai 30 j, **CB non exigée** mais via flag de config), data-grid réutilisable, recherche universelle, CI/CD. La garde de capacité doit exister **avant** tout module métier.
- **Phase 1 — Module Études de prix** (le cœur qui vend le produit) : bibliothèques + ressources, **ouvrages composés avec recalcul ascendant**, corps de devis hiérarchique, métré, déboursé/sous-détails, feuille de vente + coefficients, workflow d'affaire, édition PDF, devis d'appel d'offre.
- **Phase 2 — Acceptation + Facturation** : transfert affaire gagnée → devis, situations de travaux, avenants, DGD, génération de factures, Factur-X.
- **Phase 3 — Suivi de chantiers** : budgets, pointages (mobile), achats, résultats analytiques, export compta.
- **Phase 4 — Avancé** : stocks, parc matériel, BIM/IFC, assistance IA, connecteurs, mobile hors-ligne.

Chaque phase doit être livrable et testée de bout en bout avant la suivante.

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

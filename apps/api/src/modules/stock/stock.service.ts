import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import Decimal from 'decimal.js';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { runInTenant } from '../../core/tenancy/tenant-transaction';

export interface DepotInput {
  code: string;
  label: string;
  type?: 'principal' | 'chantier';
  chantierId?: string | null;
}
export interface ArticleInput {
  code: string;
  label: string;
  unit?: string | null;
  resourceId?: string | null;
  codeAnalytiqueId?: string | null;
  seuilAlerte?: string | number | null;
}
export interface EntreeInput {
  articleId: string;
  depotId: string;
  quantite: string | number;
  pu: string | number;
  date?: string;
  purchaseOrderId?: string | null;
  commentaire?: string | null;
}
export interface SortieInput {
  articleId: string;
  depotId: string;
  quantite: string | number;
  date?: string;
  chantierId?: string | null;
  codeAnalytiqueId?: string | null;
  executionLineId?: string | null;
  commentaire?: string | null;
}
export interface TransfertInput {
  articleId: string;
  depotId: string;
  depotCibleId: string;
  quantite: string | number;
  date?: string;
  commentaire?: string | null;
}

/**
 * Gestion des stocks : ce que l'entreprise possède déjà, et ce qu'il en coûte au chantier.
 *
 * Trois règles gouvernent tout le module :
 *
 * 1. **Le sens vient du type, jamais du signe.** Une quantité est toujours positive ; c'est
 *    « entrée », « sortie » ou « transfert » qui dit ce qu'elle fait. Un signe négatif égaré dans
 *    une saisie ne peut donc pas transformer une sortie en entrée.
 *
 * 2. **Le prix moyen pondéré se recalcule à l'ENTRÉE, jamais à la sortie.** Sortir ne change pas
 *    la valeur unitaire de ce qui reste : c'est ce qui permet à un chantier de savoir ce qu'il
 *    paie avant même de servir.
 *
 * 3. **Une sortie vers un chantier est une dépense réelle**, imputée à son code analytique. Sans
 *    cela, le magasin absorberait silencieusement des coûts que personne ne verrait passer.
 */
@Injectable()
export class StockService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly context: TenantContext,
  ) {}

  /* ─────────── dépôts ─────────── */

  listDepots() {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, (em) =>
      em.query(
        `SELECT d.id, d.code, d.label, d.type, d.chantier_id, d.actif,
                c.code AS chantier_code, c.name AS chantier_nom
           FROM stock_depot d
           LEFT JOIN chantier c ON c.id = d.chantier_id
          ORDER BY d.type, d.code`,
      ));
  }

  creerDepot(input: DepotInput) {
    const tenantId = this.context.requireTenantId();
    if (!input.code?.trim() || !input.label?.trim()) {
      throw new BadRequestException('Le code et le libellé du dépôt sont obligatoires.');
    }
    const type = input.type ?? 'principal';
    if (type === 'chantier' && !input.chantierId) {
      throw new BadRequestException('Un dépôt de chantier doit désigner son chantier.');
    }
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const [row] = await em.query(
        `INSERT INTO stock_depot (tenant_id, code, label, type, chantier_id)
         VALUES (current_tenant(), $1, $2, $3, $4)
         RETURNING id, code, label, type, chantier_id`,
        [input.code.trim(), input.label.trim(), type, type === 'chantier' ? input.chantierId : null],
      );
      return row;
    });
  }

  /* ─────────── articles ─────────── */

  creerArticle(input: ArticleInput) {
    const tenantId = this.context.requireTenantId();
    if (!input.code?.trim() || !input.label?.trim()) {
      throw new BadRequestException('Le code et le libellé de l’article sont obligatoires.');
    }
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const [row] = await em.query(
        `INSERT INTO stock_article
           (tenant_id, resource_id, code, label, unit, code_analytique_id, seuil_alerte)
         VALUES (current_tenant(), $1, $2, $3, $4, $5, $6)
         RETURNING id, code, label, unit, pmp, code_analytique_id, seuil_alerte`,
        [
          input.resourceId ?? null, input.code.trim(), input.label.trim(), input.unit ?? null,
          input.codeAnalytiqueId ?? null, input.seuilAlerte ?? null,
        ],
      );
      return row;
    });
  }

  majArticle(articleId: string, input: Partial<ArticleInput>) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      await this.article(em, articleId);
      await em.query(
        `UPDATE stock_article SET
           label = COALESCE($2, label), unit = COALESCE($3, unit),
           code_analytique_id = COALESCE($4, code_analytique_id),
           seuil_alerte = COALESCE($5, seuil_alerte), updated_at = now()
         WHERE id = $1`,
        [
          articleId, input.label ?? null, input.unit ?? null,
          input.codeAnalytiqueId ?? null, input.seuilAlerte ?? null,
        ],
      );
      return (await em.query(`SELECT * FROM stock_article WHERE id = $1`, [articleId]))[0];
    });
  }

  /**
   * L'état du stock : par article et par dépôt, ce qui reste et ce que ça vaut.
   *
   * Le solde se DÉDUIT des mouvements plutôt que d'être stocké dans une colonne : une quantité
   * mémorisée finit toujours par diverger de son historique, et c'est l'historique qui fait foi.
   */
  etat(depotId?: string | null) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, (em) =>
      em.query(
        // Chaque mouvement est ramené à une ligne SIGNÉE par dépôt ; un transfert en produit deux,
        // une de chaque côté. Le solde n'est alors qu'une somme — impossible à désynchroniser.
        `WITH mvt AS (
           SELECT article_id, depot_id,
                  CASE WHEN type IN ('entree', 'inventaire') THEN quantite ELSE -quantite END AS q
             FROM stock_mouvement
            UNION ALL
           SELECT article_id, depot_cible_id, quantite
             FROM stock_mouvement WHERE type = 'transfert' AND depot_cible_id IS NOT NULL
         )
         SELECT a.id AS article_id, a.code, a.label, a.unit, a.pmp::numeric(14,4) AS pmp,
                a.seuil_alerte::numeric(14,3) AS seuil_alerte,
                d.id AS depot_id, d.code AS depot_code, d.label AS depot_label, d.type AS depot_type,
                ac.code AS code_analytique,
                SUM(mvt.q)::numeric(16,3) AS quantite,
                (SUM(mvt.q) * a.pmp)::numeric(16,2) AS valeur,
                (a.seuil_alerte IS NOT NULL AND SUM(mvt.q) < a.seuil_alerte) AS sous_le_seuil
           FROM mvt
           JOIN stock_article a ON a.id = mvt.article_id
           JOIN stock_depot d ON d.id = mvt.depot_id
           LEFT JOIN analytical_code ac ON ac.id = a.code_analytique_id
          WHERE ($1::uuid IS NULL OR d.id = $1)
          GROUP BY a.id, a.code, a.label, a.unit, a.pmp, a.seuil_alerte,
                   d.id, d.code, d.label, d.type, ac.code
         HAVING SUM(mvt.q) <> 0
          ORDER BY d.code, a.code`,
        [depotId ?? null],
      ));
  }

  /** Journal des mouvements d'un article ou d'un dépôt : d'où vient chaque unité, où elle va. */
  mouvements(filtre: { articleId?: string | null; depotId?: string | null; chantierId?: string | null }) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, (em) =>
      em.query(
        `SELECT m.id, m.type, m.date::text AS date, m.quantite::numeric(16,3) AS quantite,
                m.pu::numeric(14,4) AS pu, m.montant::numeric(16,2) AS montant, m.commentaire,
                m.created_at,
                a.code AS article_code, a.label AS article_label, a.unit,
                d.code AS depot_code, dc.code AS depot_cible_code,
                c.code AS chantier_code, ac.code AS code_analytique,
                COALESCE(u.full_name, u.email) AS auteur
           FROM stock_mouvement m
           JOIN stock_article a ON a.id = m.article_id
           JOIN stock_depot d ON d.id = m.depot_id
           LEFT JOIN stock_depot dc ON dc.id = m.depot_cible_id
           LEFT JOIN chantier c ON c.id = m.chantier_id
           LEFT JOIN analytical_code ac ON ac.id = m.code_analytique_id
           LEFT JOIN user_account u ON u.id = m.actor_user_id
          WHERE ($1::uuid IS NULL OR m.article_id = $1)
            AND ($2::uuid IS NULL OR m.depot_id = $2 OR m.depot_cible_id = $2)
            AND ($3::uuid IS NULL OR m.chantier_id = $3)
          ORDER BY m.date DESC, m.created_at DESC
          LIMIT 500`,
        [filtre.articleId ?? null, filtre.depotId ?? null, filtre.chantierId ?? null],
      ));
  }

  /**
   * Entrée en stock : la seule opération qui change le prix moyen pondéré.
   *
   * PMP = (valeur du stock avant + valeur entrée) / (quantité avant + quantité entrée). Le stock
   * déjà là est donc revalorisé — c'est le principe même de la moyenne pondérée, et c'est ce qui
   * évite qu'un même article sorte à trois prix différents selon le lot d'où il vient.
   */
  entree(input: EntreeInput) {
    const tenantId = this.context.requireTenantId();
    const userId = this.context.getUserId() ?? null;
    const quantite = new Decimal(input.quantite ?? 0);
    const pu = new Decimal(input.pu ?? 0);
    if (!quantite.isPositive() || quantite.isZero()) {
      throw new BadRequestException('La quantité entrée doit être positive.');
    }
    if (pu.isNegative()) throw new BadRequestException('Le prix unitaire ne peut pas être négatif.');

    return runInTenant(this.dataSource, tenantId, async (em) => {
      const article = await this.article(em, input.articleId);
      await this.depot(em, input.depotId);

      const quantiteAvant = await this.quantiteTotale(em, input.articleId);
      const pmpAvant = new Decimal(article.pmp ?? 0);
      const valeurAvant = quantiteAvant.times(pmpAvant);
      const nouvelleQuantite = quantiteAvant.plus(quantite);
      const pmp = nouvelleQuantite.isZero()
        ? pu
        : valeurAvant.plus(quantite.times(pu)).dividedBy(nouvelleQuantite);

      const [row] = await em.query(
        `INSERT INTO stock_mouvement
           (tenant_id, article_id, depot_id, type, date, quantite, pu, montant,
            purchase_order_id, commentaire, actor_user_id)
         VALUES (current_tenant(), $1, $2, 'entree', COALESCE($3::date, CURRENT_DATE), $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          input.articleId, input.depotId, input.date ?? null, quantite.toFixed(3), pu.toFixed(4),
          quantite.times(pu).toFixed(2), input.purchaseOrderId ?? null, input.commentaire ?? null, userId,
        ],
      );
      await em.query(
        `UPDATE stock_article SET pmp = $2, updated_at = now() WHERE id = $1`,
        [input.articleId, pmp.toDecimalPlaces(4).toString()],
      );
      return { id: row.id, pmp: pmp.toFixed(4), quantite: nouvelleQuantite.toFixed(3) };
    });
  }

  /**
   * Sortie vers un chantier (ou consommation interne) au prix moyen pondéré.
   *
   * Refusée si le dépôt n'a pas la quantité : servir un chantier avec du stock qu'on n'a pas crée
   * une valeur négative que rien ne rattrape ensuite.
   */
  sortie(input: SortieInput) {
    const tenantId = this.context.requireTenantId();
    const userId = this.context.getUserId() ?? null;
    const quantite = new Decimal(input.quantite ?? 0);
    if (!quantite.isPositive() || quantite.isZero()) {
      throw new BadRequestException('La quantité sortie doit être positive.');
    }
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const article = await this.article(em, input.articleId);
      await this.depot(em, input.depotId);

      const disponible = await this.quantiteDepot(em, input.articleId, input.depotId);
      if (quantite.greaterThan(disponible)) {
        throw new BadRequestException(
          `Stock insuffisant : ${disponible.toFixed(3)} ${article.unit ?? ''} disponibles dans ce dépôt.`,
        );
      }
      // Le code analytique de l'article sert par défaut : une sortie non imputée deviendrait une
      // dépense de chantier que le tableau de bord ne saurait ranger nulle part.
      const codeAnalytiqueId = input.codeAnalytiqueId ?? article.code_analytique_id ?? null;
      const pmp = new Decimal(article.pmp ?? 0);

      const [row] = await em.query(
        `INSERT INTO stock_mouvement
           (tenant_id, article_id, depot_id, type, date, quantite, pu, montant,
            chantier_id, code_analytique_id, execution_line_id, commentaire, actor_user_id)
         VALUES (current_tenant(), $1, $2, 'sortie', COALESCE($3::date, CURRENT_DATE), $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id`,
        [
          input.articleId, input.depotId, input.date ?? null, quantite.toFixed(3), pmp.toFixed(4),
          quantite.times(pmp).toFixed(2), input.chantierId ?? null, codeAnalytiqueId,
          input.executionLineId ?? null, input.commentaire ?? null, userId,
        ],
      );
      return { id: row.id, montant: quantite.times(pmp).toFixed(2) };
    });
  }

  /** Transfert entre dépôts : la valeur ne bouge pas, seule l'adresse change. */
  transfert(input: TransfertInput) {
    const tenantId = this.context.requireTenantId();
    const userId = this.context.getUserId() ?? null;
    const quantite = new Decimal(input.quantite ?? 0);
    if (!quantite.isPositive() || quantite.isZero()) {
      throw new BadRequestException('La quantité transférée doit être positive.');
    }
    if (input.depotId === input.depotCibleId) {
      throw new BadRequestException('Le dépôt d’origine et celui d’arrivée sont les mêmes.');
    }
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const article = await this.article(em, input.articleId);
      await this.depot(em, input.depotId);
      await this.depot(em, input.depotCibleId);

      const disponible = await this.quantiteDepot(em, input.articleId, input.depotId);
      if (quantite.greaterThan(disponible)) {
        throw new BadRequestException(
          `Stock insuffisant au départ : ${disponible.toFixed(3)} ${article.unit ?? ''} disponibles.`,
        );
      }
      const pmp = new Decimal(article.pmp ?? 0);
      const [row] = await em.query(
        `INSERT INTO stock_mouvement
           (tenant_id, article_id, depot_id, depot_cible_id, type, date, quantite, pu, montant,
            commentaire, actor_user_id)
         VALUES (current_tenant(), $1, $2, $3, 'transfert', COALESCE($4::date, CURRENT_DATE), $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          input.articleId, input.depotId, input.depotCibleId, input.date ?? null,
          quantite.toFixed(3), pmp.toFixed(4), quantite.times(pmp).toFixed(2),
          input.commentaire ?? null, userId,
        ],
      );
      return { id: row.id };
    });
  }

  /* ─────────── interne ─────────── */

  private async article(em: EntityManager, articleId: string) {
    const [row] = await em.query(`SELECT * FROM stock_article WHERE id = $1`, [articleId]);
    if (!row) throw new NotFoundException('Article de stock introuvable.');
    return row as { id: string; unit: string | null; pmp: string; code_analytique_id: string | null };
  }

  private async depot(em: EntityManager, depotId: string) {
    const [row] = await em.query(`SELECT id FROM stock_depot WHERE id = $1`, [depotId]);
    if (!row) throw new NotFoundException('Dépôt introuvable.');
    return row as { id: string };
  }

  /** Quantité d'un article, tous dépôts confondus : la base du prix moyen pondéré. */
  private async quantiteTotale(em: EntityManager, articleId: string): Promise<Decimal> {
    const [row] = await em.query(
      `SELECT COALESCE(SUM(CASE
                WHEN type IN ('entree', 'inventaire') THEN quantite
                WHEN type = 'sortie' THEN -quantite
                ELSE 0 END), 0)::numeric(16,3) AS q
         FROM stock_mouvement WHERE article_id = $1`,
      [articleId],
    );
    return new Decimal(row?.q ?? 0);
  }

  /** Quantité d'un article DANS un dépôt : les transferts comptent des deux côtés. */
  private async quantiteDepot(em: EntityManager, articleId: string, depotId: string): Promise<Decimal> {
    const [row] = await em.query(
      `SELECT COALESCE(SUM(CASE
                WHEN type IN ('entree', 'inventaire') AND depot_id = $2 THEN quantite
                WHEN type = 'sortie' AND depot_id = $2 THEN -quantite
                WHEN type = 'transfert' AND depot_id = $2 THEN -quantite
                WHEN type = 'transfert' AND depot_cible_id = $2 THEN quantite
                ELSE 0 END), 0)::numeric(16,3) AS q
         FROM stock_mouvement WHERE article_id = $1`,
      [articleId, depotId],
    );
    return new Decimal(row?.q ?? 0);
  }
}

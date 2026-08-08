import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { runInTenant } from '../../core/tenancy/tenant-transaction';
import {
  DataGridQuery,
  PaginatedResult,
  paginate,
} from '../../core/common/data-grid/data-grid';
import { LibraryEntity } from './entities/library.entity';
import { ResourceEntity, ResourceNature } from './entities/resource.entity';
import { OuvragesService } from './ouvrages.service';

export interface LibraryInput {
  code: string;
  name: string;
  description?: string | null;
  /** Module propriétaire du catalogue ; « etude » par défaut. */
  scope?: 'etude' | 'chantier';
}

/** Coercition numérique sûre : accepte virgule ou point, renvoie une chaîne numérique ou un défaut. */
function numOr(v: string | number | null | undefined, def: string): string {
  if (v === null || v === undefined || v === '') return def;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? String(n) : def;
}
function numOrNull(v: string | number | null | undefined): string | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? String(n) : null;
}

/** Traduit une erreur Postgres en exception métier française (sinon relaie l'erreur). */
function translateDbError(e: unknown, code?: string): unknown {
  const err = e as { code?: string; driverError?: { code?: string } };
  const pgCode = err?.code ?? err?.driverError?.code;
  if (pgCode === '23505') {
    return new ConflictException(
      `Le code « ${code ?? ''} » existe déjà dans cette bibliothèque. Choisissez un code unique.`,
    );
  }
  return e instanceof Error ? e : new BadRequestException('Enregistrement impossible.');
}

export interface ResourceInput {
  code: string;
  label: string;
  unit: string;
  nature: ResourceNature;
  unitCost: string | number;
  output?: string | number | null;
  /** Code produit unique société (défaut = `code`). */
  codeProduit?: string | null;
  /** Rattachement optionnel à un code analytique du plan (cahier §5.8). */
  codeAnalytiqueId?: string | null;
  /** Type de déboursé de l'entreprise (porte les % FG et bénéfice du chiffrage). */
  debourseTypeId?: string | null;
  /** Champs d'achat (pour le Calcul Appro). */
  prixPublic?: string | number | null;
  uniteAchat?: string | null;
  coeffConversion?: string | number | null;
  supplierId?: string | null;
  refFournisseur?: string | null;
  conditionnement?: string | null;
}

@Injectable()
export class LibrariesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly context: TenantContext,
    private readonly ouvrages: OuvragesService,
  ) {}

  /** Updates a resource's déboursé unitaire and recomputes every dependent ouvrage (rule #1). */
  async updateResourceCost(
    libraryId: string,
    resourceId: string,
    unitCost: string | number,
  ): Promise<ResourceEntity> {
    const tenantId = this.context.requireTenantId();
    const updated = await runInTenant(this.dataSource, tenantId, async (em) => {
      const existing = await em.query(
        `SELECT id FROM resource WHERE id = $1 AND library_id = $2`,
        [resourceId, libraryId],
      );
      if (existing.length === 0) {
        throw new NotFoundException(`Unknown resource "${resourceId}"`);
      }
      await em.query(`UPDATE resource SET unit_cost = $1, updated_at = now() WHERE id = $2`, [
        String(unitCost),
        resourceId,
      ]);
      return (await em.query(`SELECT * FROM resource WHERE id = $1`, [resourceId]))[0];
    });
    await this.ouvrages.recomputeTenant();
    return updated;
  }

  createLibrary(input: LibraryInput): Promise<LibraryEntity> {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, (em) =>
      em.getRepository(LibraryEntity).save(
        em.getRepository(LibraryEntity).create({ ...input, tenantId }),
      ),
    );
  }

  /**
   * `scope` filtre par module propriétaire. Sans lui on retombe sur « etude » : les écrans de
   * chiffrage existants ne doivent jamais voir apparaître les catalogues du chantier.
   */
  listLibraries(
    query: DataGridQuery,
    scope: 'etude' | 'chantier' = 'etude',
  ): Promise<PaginatedResult<LibraryEntity>> {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, (em) =>
      paginate(
        em.getRepository(LibraryEntity).createQueryBuilder('p').where('p.scope = :scope', { scope }),
        query, {
        alias: 'p',
        sortable: ['code', 'name', 'createdAt'],
        searchable: ['code', 'name'],
        defaultSort: 'code',
      }),
    );
  }

  createResource(libraryId: string, input: ResourceInput): Promise<ResourceEntity> {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const library = await em.getRepository(LibraryEntity).findOne({
        where: { id: libraryId },
      });
      if (!library) {
        throw new NotFoundException(`Unknown library "${libraryId}"`);
      }
      if (input.codeAnalytiqueId != null) {
        await this.assertCodeAnalytiqueExists(em, input.codeAnalytiqueId);
      }
      const repo = em.getRepository(ResourceEntity);
      try {
        return await repo.save(
          repo.create({
            tenantId,
            libraryId,
            code: input.code,
            label: input.label,
            unit: input.unit,
            nature: input.nature,
            unitCost: numOr(input.unitCost, '0'),
            output: input.output == null ? null : numOrNull(input.output),
            codeProduit: input.codeProduit ?? input.code,
            codeAnalytiqueId: input.codeAnalytiqueId ?? null,
            debourseTypeId: input.debourseTypeId ?? null,
            prixPublic: numOrNull(input.prixPublic),
            uniteAchat: input.uniteAchat ?? null,
            coeffConversion: numOr(input.coeffConversion, '1'),
            supplierId: input.supplierId ?? null,
            refFournisseur: input.refFournisseur ?? null,
            conditionnement: input.conditionnement ?? null,
          }),
        );
      } catch (e) {
        throw translateDbError(e, input.code);
      }
    });
  }

  /** Full update of a resource (fiche ressource complète). Recomputes dependent ouvrages. */
  async updateResource(
    libraryId: string,
    resourceId: string,
    input: Partial<ResourceInput>,
  ): Promise<ResourceEntity> {
    const tenantId = this.context.requireTenantId();
    const updated = await runInTenant(this.dataSource, tenantId, async (em) => {
      const existing = await em.query(
        `SELECT id FROM resource WHERE id = $1 AND library_id = $2`,
        [resourceId, libraryId],
      );
      if (existing.length === 0) {
        throw new NotFoundException(`Unknown resource "${resourceId}"`);
      }
      if (input.codeAnalytiqueId != null) {
        await this.assertCodeAnalytiqueExists(em, input.codeAnalytiqueId);
      }
      try {
        await em.query(
        `UPDATE resource SET
           code               = COALESCE($2, code),
           label              = COALESCE($3, label),
           unit               = COALESCE($4, unit),
           nature             = COALESCE($5, nature),
           unit_cost          = COALESCE($6, unit_cost),
           code_produit       = COALESCE($7, code_produit),
           code_analytique_id = $8,
           prix_public        = $9,
           unite_achat        = $10,
           coeff_conversion   = COALESCE($11, coeff_conversion),
           supplier_id        = $12,
           ref_fournisseur    = $13,
           conditionnement    = $14,
           debourse_type_id   = CASE WHEN $15 = '__KEEP__' THEN debourse_type_id
                                     ELSE NULLIF($15, '')::uuid END,
           updated_at         = now()
         WHERE id = $1`,
        [
          resourceId,
          input.code ?? null,
          input.label ?? null,
          input.unit ?? null,
          input.nature ?? null,
          input.unitCost == null ? null : numOr(input.unitCost, '0'),
          input.codeProduit ?? null,
          input.codeAnalytiqueId ?? null,
          numOrNull(input.prixPublic),
          input.uniteAchat ?? null,
          input.coeffConversion == null ? null : numOr(input.coeffConversion, '1'),
          input.supplierId ?? null,
          input.refFournisseur ?? null,
          input.conditionnement ?? null,
          input.debourseTypeId === undefined ? '__KEEP__' : (input.debourseTypeId ?? ''),
        ],
        );
      } catch (e) {
        throw translateDbError(e, input.code);
      }
      return (await em.query(`SELECT * FROM resource WHERE id = $1`, [resourceId]))[0];
    });
    await this.ouvrages.recomputeTenant();
    return updated;
  }

  /** Supprime une ressource. Bloque si elle compose un ouvrage (FK), message FR. */
  async deleteResource(libraryId: string, resourceId: string): Promise<{ deleted: true }> {
    const tenantId = this.context.requireTenantId();
    await runInTenant(this.dataSource, tenantId, async (em) => {
      const existing = await em.query(
        `SELECT id FROM resource WHERE id = $1 AND library_id = $2`,
        [resourceId, libraryId],
      );
      if (existing.length === 0) {
        throw new NotFoundException('Ressource introuvable.');
      }
      // Bloque la suppression si la ressource est utilisée dans un ouvrage
      const used = await em.query(
        `SELECT 1 FROM ouvrage_component WHERE child_resource_id = $1 LIMIT 1`,
        [resourceId],
      );
      if (used.length > 0) {
        throw new ConflictException(
          'Cette ressource est utilisée dans un ou plusieurs ouvrages. Retirez-la de ces ouvrages avant de la supprimer.',
        );
      }
      await em.query(`DELETE FROM resource WHERE id = $1`, [resourceId]);
    });
    await this.ouvrages.recomputeTenant();
    return { deleted: true };
  }

  /** Classifies a resource onto a code analytique of the analytical plan (cahier §5.8). */
  async classifyResource(
    libraryId: string,
    resourceId: string,
    codeAnalytiqueId: string,
  ): Promise<ResourceEntity> {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const existing = await em.query(
        `SELECT id FROM resource WHERE id = $1 AND library_id = $2`,
        [resourceId, libraryId],
      );
      if (existing.length === 0) {
        throw new NotFoundException(`Unknown resource "${resourceId}"`);
      }
      await this.assertCodeAnalytiqueExists(em, codeAnalytiqueId);
      await em.query(
        `UPDATE resource SET code_analytique_id = $1, updated_at = now() WHERE id = $2`,
        [codeAnalytiqueId, resourceId],
      );
      return (await em.query(`SELECT * FROM resource WHERE id = $1`, [resourceId]))[0];
    });
  }

  private async assertCodeAnalytiqueExists(em: EntityManager, codeId: string): Promise<void> {
    const rows = await em.query(`SELECT id FROM analytical_code WHERE id = $1`, [codeId]);
    if (rows.length === 0) {
      throw new NotFoundException(`Unknown code analytique "${codeId}"`);
    }
  }

  /**
   * Liste paginée des ressources avec colonnes jointes (famille, code analytique, distributeur).
   * Tri serveur sur toutes les colonnes affichées (whitelist), recherche, filtre nature.
   */
  async listResources(
    libraryId: string,
    query: DataGridQuery & { nature?: string },
  ): Promise<PaginatedResult<Record<string, unknown>>> {
    const tenantId = this.context.requireTenantId();
    // Whitelist tri : clé front → expression SQL (anti-injection)
    const SORT: Record<string, string> = {
      code: 'r.code', label: 'r.label', unit: 'r.unit', nature: 'r.nature',
      unitCost: 'r.unit_cost', prixPublic: 'r.prix_public', uniteAchat: 'r.unite_achat',
      coeffConversion: 'r.coeff_conversion', familleCode: 'fam.code',
      codeAnalytiqueCode: 'ca.code', supplierName: 's.name', createdAt: 'r.created_at',
    };
    const sortCol = SORT[query.sort ?? ''] ?? 'r.code';
    const dir = String(query.dir ?? '').toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(5000, Math.max(1, Number(query.pageSize) || 50));
    const search = query.search?.trim();

    const q = query as DataGridQuery & { nature?: string; lotId?: string; familleId?: string };
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const params: unknown[] = [libraryId];
      let where = 'r.library_id = $1';
      if (q.nature) {
        params.push(q.nature);
        where += ` AND r.nature = $${params.length}`;
      }
      if (q.familleId) {
        params.push(q.familleId);
        where += ` AND ca.famille_id = $${params.length}`;
      }
      if (q.lotId) {
        params.push(q.lotId);
        where += ` AND fam.lot_id = $${params.length}`;
      }
      if (search) {
        params.push(`%${search}%`);
        where += ` AND (r.code ILIKE $${params.length} OR r.label ILIKE $${params.length})`;
      }
      // Jointures partagées (nécessaires aux filtres lot/famille) pour count + select
      const joins = `
        LEFT JOIN analytical_code ca ON ca.id = r.code_analytique_id
        LEFT JOIN analytical_famille fam ON fam.id = ca.famille_id`;

      const totalRows = await em.query(
        `SELECT count(*)::int AS n FROM resource r ${joins} WHERE ${where}`,
        params,
      );
      const total = totalRows[0]?.n ?? 0;

      const offset = (page - 1) * pageSize;
      const rows = await em.query(
        `SELECT r.id, r.code, r.label, r.unit, r.nature,
                r.unit_cost AS "unitCost", r.prix_public AS "prixPublic",
                r.unite_achat AS "uniteAchat", r.coeff_conversion AS "coeffConversion",
                r.code_produit AS "codeProduit", r.code_analytique_id AS "codeAnalytiqueId",
                r.supplier_id AS "supplierId", r.ref_fournisseur AS "refFournisseur",
                r.conditionnement, r.debourse_type_id AS "debourseTypeId",
                dt.code AS "debourseTypeCode",
                ca.code AS "codeAnalytiqueCode", ca.label AS "codeAnalytiqueLabel",
                fam.code AS "familleCode", fam.label AS "familleLabel",
                s.name AS "supplierName"
         FROM resource r
         LEFT JOIN analytical_code ca ON ca.id = r.code_analytique_id
         LEFT JOIN analytical_famille fam ON fam.id = ca.famille_id
         LEFT JOIN supplier s ON s.id = r.supplier_id
         LEFT JOIN debourse_type dt ON dt.id = r.debourse_type_id
         WHERE ${where}
         ORDER BY ${sortCol} ${dir} NULLS LAST, r.code ASC
         LIMIT ${pageSize} OFFSET ${offset}`,
        params,
      );
      return { rows, total, page, pageSize };
    });
  }

  async getResource(libraryId: string, resourceId: string): Promise<Record<string, unknown>> {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const rows = await em.query(
        `SELECT r.id, r.code, r.label, r.unit, r.nature,
                r.unit_cost AS "unitCost", r.prix_public AS "prixPublic",
                r.unite_achat AS "uniteAchat", r.coeff_conversion AS "coeffConversion",
                r.code_produit AS "codeProduit", r.code_analytique_id AS "codeAnalytiqueId",
                r.supplier_id AS "supplierId", r.ref_fournisseur AS "refFournisseur",
                r.conditionnement, r.debourse_type_id AS "debourseTypeId"
         FROM resource r
         WHERE r.id = $1 AND r.library_id = $2`,
        [resourceId, libraryId],
      );
      if (!rows[0]) throw new NotFoundException(`Unknown resource "${resourceId}"`);
      return rows[0];
    });
  }
}

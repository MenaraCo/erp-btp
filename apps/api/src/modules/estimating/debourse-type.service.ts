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
import { NATURES, Nature } from './ouvrage-calc';

export interface DebourseTypeInput {
  code: string;
  label: string;
  baseNature: Nature;
  /** Renseigné : type propre à ce devis. Absent : type de la société, offert à tous les devis. */
  devisVersionId?: string | null;
}

export interface DebourseType {
  id: string;
  code: string;
  label: string;
  baseNature: Nature;
  builtin: boolean;
  devisVersionId: string | null;
  sortOrder: number;
}

/** Les quatre types livrés d'office, aux codes usuels du métier — renommables comme les autres. */
const BUILTINS: Array<{ code: string; label: string; baseNature: Nature }> = [
  { code: 'MO', label: "Main d'œuvre", baseNature: 'labor' },
  { code: 'M', label: 'Matériaux', baseNature: 'material' },
  { code: 'MAT', label: 'Matériel', baseNature: 'equipment' },
  { code: 'ST', label: 'Sous-traitance', baseNature: 'subcontract' },
];

interface Row {
  id: string;
  code: string;
  label: string;
  base_nature: Nature;
  builtin: boolean;
  devis_version_id: string | null;
  sort_order: number;
}

/**
 * Référentiel des types de déboursé (cahier §5.2). L'entreprise définit ses propres postes de
 * coût — « ST Moyens », « Location », « Intérim »… — avec leur code, leur intitulé et leurs taux.
 *
 * Chaque type se RATTACHE à l'une des quatre natures de base : c'est elle qui alimente les budgets
 * de chantier, l'axe analytique et les exports comptables. Le paramétrage est donc libre côté
 * chiffrage sans jamais rompre la chaîne de gestion en aval.
 */
@Injectable()
export class DebourseTypeService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly context: TenantContext,
  ) {}

  private toDto(r: Row): DebourseType {
    return {
      id: r.id,
      code: r.code,
      label: r.label,
      baseNature: r.base_nature,
      builtin: r.builtin,
      devisVersionId: r.devis_version_id,
      sortOrder: r.sort_order,
    };
  }

  /**
   * Sème les types de base quand la société n'en a AUCUN (première utilisation). Public : la
   * feuille de vente s'appuie sur ces types et doit pouvoir les garantir dans SA transaction.
   */
  async ensureInTx(em: EntityManager, tenantId: string): Promise<void> {
    const existing = await em.query(`SELECT 1 FROM debourse_type LIMIT 1`);
    if (existing.length > 0) return;
    let ord = 0;
    for (const b of BUILTINS) {
      await em.query(
        `INSERT INTO debourse_type (tenant_id, code, label, base_nature, builtin, sort_order)
         VALUES ($1,$2,$3,$4,true,$5)`,
        [tenantId, b.code, b.label, b.baseNature, ord++],
      );
    }
  }

  /**
   * Types utilisables : ceux de la société, et — si un devis est précisé — ses types propres.
   * Un devis voit donc le référentiel plus ses propres ajouts, jamais ceux d'un autre devis.
   */
  list(devisVersionId?: string | null): Promise<DebourseType[]> {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      await this.ensureInTx(em, tenantId);
      const rows: Row[] = await em.query(
        `SELECT id, code, label, base_nature, builtin, devis_version_id, sort_order
           FROM debourse_type
          WHERE devis_version_id IS NULL OR devis_version_id = $1
          ORDER BY devis_version_id NULLS FIRST, sort_order, code`,
        [devisVersionId ?? null],
      );
      return rows.map((r) => this.toDto(r));
    });
  }

  private assertNature(nature: string): asserts nature is Nature {
    if (!NATURES.includes(nature as Nature)) {
      throw new BadRequestException(
        `Nature de rattachement inconnue « ${nature} » : attendu ${NATURES.join(', ')}.`,
      );
    }
  }

  create(input: DebourseTypeInput): Promise<DebourseType> {
    const tenantId = this.context.requireTenantId();
    const code = (input?.code ?? '').trim();
    const label = (input?.label ?? '').trim();
    if (!code || !label) {
      throw new BadRequestException('Le code et l’intitulé sont obligatoires.');
    }
    this.assertNature(input?.baseNature as string);
    return runInTenant(this.dataSource, tenantId, async (em) => {
      await this.ensureInTx(em, tenantId);
      await this.assertCodeFree(em, code, input.devisVersionId ?? null, null);
      const [next] = await em.query(
        `SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM debourse_type`,
      );
      const [row]: Row[] = await em.query(
        `INSERT INTO debourse_type (tenant_id, devis_version_id, code, label, base_nature, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [tenantId, input.devisVersionId ?? null, code, label, input.baseNature, next.n],
      );
      return this.toDto(row);
    });
  }

  /** Le code doit rester unique dans son périmètre : la société, ou le devis qui le porte. */
  private async assertCodeFree(
    em: EntityManager,
    code: string,
    devisVersionId: string | null,
    exceptId: string | null,
  ): Promise<void> {
    const clash = await em.query(
      `SELECT id FROM debourse_type
        WHERE code = $1
          AND devis_version_id IS NOT DISTINCT FROM $2
          AND ($3::uuid IS NULL OR id <> $3)
        LIMIT 1`,
      [code, devisVersionId, exceptId],
    );
    if (clash.length > 0) {
      throw new ConflictException(
        `Le code « ${code} » est déjà utilisé${devisVersionId ? ' dans ce devis' : ''}.`,
      );
    }
  }

  update(id: string, patch: Partial<DebourseTypeInput>): Promise<DebourseType> {
    const tenantId = this.context.requireTenantId();
    if (patch?.baseNature !== undefined) {
      this.assertNature(patch.baseNature as string);
    }
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const current = await this.requireType(em, id);
      const code = patch?.code !== undefined ? patch.code.trim() : current.code;
      const label = patch?.label !== undefined ? patch.label.trim() : current.label;
      if (!code || !label) {
        throw new BadRequestException('Le code et l’intitulé sont obligatoires.');
      }
      if (code !== current.code) {
        await this.assertCodeFree(em, code, current.devis_version_id, id);
      }
      // TypeORM renvoie [lignes, nombre] sur un UPDATE ... RETURNING : on prend la 1re ligne.
      const [rows]: [Row[], number] = await em.query(
        `UPDATE debourse_type
            SET code = $1, label = $2, base_nature = $3, updated_at = now()
          WHERE id = $4 RETURNING *`,
        [code, label, patch?.baseNature ?? current.base_nature, id],
      );
      return this.toDto(rows[0]);
    });
  }

  /**
   * Remonte un type de devis au référentiel société : il devient disponible pour tous les devis.
   * Son code doit alors être libre au niveau société.
   */
  promote(id: string): Promise<DebourseType> {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const current = await this.requireType(em, id);
      if (current.devis_version_id === null) {
        return this.toDto(current); // déjà au référentiel : rien à faire
      }
      await this.assertCodeFree(em, current.code, null, id);
      const [rows]: [Row[], number] = await em.query(
        `UPDATE debourse_type SET devis_version_id = NULL, updated_at = now()
          WHERE id = $1 RETURNING *`,
        [id],
      );
      return this.toDto(rows[0]);
    });
  }

  remove(id: string): Promise<{ deleted: true }> {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      await this.requireType(em, id);
      await em.query(`DELETE FROM debourse_type WHERE id = $1`, [id]);
      return { deleted: true as const };
    });
  }

  private async requireType(em: EntityManager, id: string): Promise<Row> {
    const [row]: Row[] = await em.query(`SELECT * FROM debourse_type WHERE id = $1`, [id]);
    if (!row) {
      throw new NotFoundException(`Type de déboursé introuvable (${id}).`);
    }
    return row;
  }
}

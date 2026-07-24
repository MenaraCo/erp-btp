import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { runInTenant } from '../../core/tenancy/tenant-transaction';

export interface AdvancementInput {
  /** null/absent = global advancement */
  nature?: string | null;
  /** fraction 0..1 */
  pct: string | number;
  source?: 'manual' | 'situations';
}

/**
 * Chantier advancement input (cahier des charges §5.8). Manual entries (global and/or per
 * nature), or derived from situations. The latest snapshot per (nature) is the current value;
 * the engine uses the per-nature pct when present, else the global one.
 */
@Injectable()
export class AdvancementService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly context: TenantContext,
  ) {}

  record(chantierId: string, input: AdvancementInput) {
    const tenantId = this.context.requireTenantId();
    const pct = Number(input.pct);
    if (!(pct >= 0 && pct <= 1)) {
      throw new BadRequestException('pct must be a fraction between 0 and 1');
    }
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const c = await em.query(`SELECT id FROM chantier WHERE id = $1`, [chantierId]);
      if (c.length === 0) {
        throw new NotFoundException(`Unknown chantier "${chantierId}"`);
      }
      return (
        await em.query(
          `INSERT INTO chantier_advancement (tenant_id, chantier_id, nature, pct, source)
           VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [tenantId, chantierId, input.nature ?? null, String(pct), input.source ?? 'manual'],
        )
      )[0];
    });
  }

  /** Latest advancement per nature (+ global) for a chantier. */
  current(chantierId: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const rows = await em.query(
        `SELECT DISTINCT ON (nature) nature, pct, source, recorded_at
           FROM chantier_advancement WHERE chantier_id = $1
          ORDER BY nature, recorded_at DESC`,
        [chantierId],
      );
      const global = rows.find((r: { nature: string | null }) => r.nature === null) ?? null;
      const byNature = rows.filter((r: { nature: string | null }) => r.nature !== null);
      return { global, byNature };
    });
  }

  /* ───────── Avancement ouvrage par ouvrage (cahier §5.8) ───────── */

  /** Enregistre l'avancement d'un ouvrage (ligne d'exécution). */
  recordLine(chantierId: string, executionLineId: string, pct: string | number) {
    const tenantId = this.context.requireTenantId();
    const p = Number(pct);
    if (!(p >= 0 && p <= 1)) {
      throw new BadRequestException('pct must be a fraction between 0 and 1');
    }
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const line = await em.query(
        `SELECT id FROM execution_line WHERE id = $1 AND chantier_id = $2`,
        [executionLineId, chantierId],
      );
      if (line.length === 0) {
        throw new NotFoundException(`Unknown execution line "${executionLineId}"`);
      }
      await em.query(
        `INSERT INTO execution_line_advancement (tenant_id, chantier_id, execution_line_id, pct, source)
         VALUES ($1, $2, $3, $4, 'manual')`,
        [tenantId, chantierId, executionLineId, String(p)],
      );
      return this.currentLines(chantierId);
    });
  }

  /**
   * Applique un avancement à un ensemble d'ouvrages en une fois : à tout le chantier (global),
   * ou au sous-arbre d'une ligne (par titre / section / ouvrage). Un enregistrement par ligne.
   */
  applyToLines(chantierId: string, input: { pct: string | number; parentLineId?: string | null; marcheId?: string | null }) {
    const tenantId = this.context.requireTenantId();
    const p = Number(input.pct);
    if (!(p >= 0 && p <= 1)) {
      throw new BadRequestException('pct must be a fraction between 0 and 1');
    }
    return runInTenant(this.dataSource, tenantId, async (em) => {
      // Cibles = lignes budgétées (parent_line_id IS NULL) du périmètre demandé.
      const targets = await em.query(
        `SELECT id FROM execution_line
          WHERE chantier_id = $1 AND parent_line_id IS NULL
            AND ($2::uuid IS NULL OR marche_id = $2)
            AND ($3::uuid IS NULL OR id = $3)`,
        [chantierId, input.marcheId ?? null, input.parentLineId ?? null],
      );
      for (const t of targets) {
        await em.query(
          `INSERT INTO execution_line_advancement (tenant_id, chantier_id, execution_line_id, pct, source)
           VALUES ($1, $2, $3, $4, 'bulk')`,
          [tenantId, chantierId, t.id, String(p)],
        );
      }
      return this.currentLines(chantierId);
    });
  }

  /** Dernier avancement par ligne d'exécution (les lignes budgétées). */
  currentLines(chantierId: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const rows = await em.query(
        `SELECT DISTINCT ON (execution_line_id) execution_line_id, pct, recorded_at
           FROM execution_line_advancement WHERE chantier_id = $1
          ORDER BY execution_line_id, recorded_at DESC`,
        [chantierId],
      );
      return rows as Array<{ execution_line_id: string; pct: string; recorded_at: Date }>;
    });
  }

  /**
   * Avancement global EFFECTIF consommé par le moteur : moyenne des avancements de ligne pondérée
   * par le budget objectif de chaque ligne (= Σ budget avancé ligne / budget total). Repli sur
   * l'avancement global saisi s'il n'existe aucun avancement de ligne. Renvoie une fraction 0..1.
   */
  async effectiveGlobalPct(chantierId: string): Promise<string> {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const lineRows = await em.query(
        `WITH latest AS (
           SELECT DISTINCT ON (execution_line_id) execution_line_id, pct
             FROM execution_line_advancement WHERE chantier_id = $1
            ORDER BY execution_line_id, recorded_at DESC
         )
         SELECT la.pct, COALESCE(b.montant, 0) AS budget
           FROM latest la
           LEFT JOIN (
             SELECT execution_line_id, SUM(montant_objectif) AS montant
               FROM execution_line_budget GROUP BY execution_line_id
           ) b ON b.execution_line_id = la.execution_line_id`,
        [chantierId],
      );
      if (lineRows.length > 0) {
        let weighted = 0;
        let total = 0;
        for (const r of lineRows) {
          const budget = Number(r.budget);
          weighted += Number(r.pct) * budget;
          total += budget;
        }
        // Précision élevée : le moteur multiplie budget × avancement ; un arrondi trop court de
        // l'avancement perdrait des centimes sur le budget avancé.
        if (total > 0) return (weighted / total).toFixed(10);
        const avg = lineRows.reduce((a: number, r: { pct: string }) => a + Number(r.pct), 0) / lineRows.length;
        return avg.toFixed(10);
      }
      // Repli : avancement global saisi (table chantier_advancement).
      const g = await em.query(
        `SELECT pct FROM chantier_advancement WHERE chantier_id = $1 AND nature IS NULL
          ORDER BY recorded_at DESC LIMIT 1`,
        [chantierId],
      );
      return g.length > 0 ? String(g[0].pct) : '0';
    });
  }
}

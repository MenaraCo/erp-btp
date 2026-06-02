import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { runInTenant } from '../../core/tenancy/tenant-transaction';
import { computeSituation, SituationLineInput } from './situation-calc';

export interface SituationInput {
  lines: Array<{ marcheLineId: string; pctAvancement: string | number }>;
  retenueRate?: string | number;
  revisionCoefficient?: string | number;
  tvaRate?: string | number;
}

@Injectable()
export class SituationsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly context: TenantContext,
  ) {}

  createSituation(marcheId: string, input: SituationInput) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const marche = await em.query(`SELECT id FROM marche WHERE id = $1`, [marcheId]);
      if (marche.length === 0) {
        throw new NotFoundException(`Unknown marché "${marcheId}"`);
      }

      const marcheLines = await em.query(
        `SELECT id, quantite, pu FROM marche_line WHERE marche_id = $1 ORDER BY sort_order ASC`,
        [marcheId],
      );

      const prev = await em.query(
        `SELECT numero, cumul_ht FROM situation WHERE marche_id = $1 ORDER BY numero DESC LIMIT 1`,
        [marcheId],
      );
      const previousCumulHt = prev.length > 0 ? String(prev[0].cumul_ht) : '0';
      const numero = prev.length > 0 ? Number(prev[0].numero) + 1 : 1;

      const retenueRate = input.retenueRate ?? '0.05';
      const revisionCoefficient = input.revisionCoefficient ?? '1';
      const tvaRate = input.tvaRate ?? '0.20';

      const pctByLine = new Map(
        (input.lines ?? []).map((l) => [l.marcheLineId, String(l.pctAvancement)]),
      );
      const engineLines: SituationLineInput[] = marcheLines.map(
        (ml: { id: string; quantite: string; pu: string }) => ({
          marcheLineId: ml.id,
          quantite: ml.quantite,
          pu: ml.pu,
          pctAvancement: pctByLine.get(ml.id) ?? '0',
        }),
      );

      const result = computeSituation(engineLines, {
        previousCumulHt,
        retenueRate,
        revisionCoefficient,
        tvaRate,
      });

      const situation = (
        await em.query(
          `INSERT INTO situation
             (tenant_id, marche_id, numero, revision_coefficient, retenue_rate, tva_rate,
              cumul_ht, montant_periode_ht, tva, ttc, retenue_garantie, nap)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
          [
            tenantId,
            marcheId,
            numero,
            String(revisionCoefficient),
            String(retenueRate),
            String(tvaRate),
            result.cumulHt,
            result.montantPeriodeHt,
            result.tva,
            result.ttc,
            result.retenueGarantie,
            result.nap,
          ],
        )
      )[0];

      const cumulByLine = new Map(result.lines.map((l) => [l.marcheLineId, l.cumulHt]));
      for (const ml of marcheLines) {
        await em.query(
          `INSERT INTO situation_line
             (tenant_id, situation_id, marche_line_id, quantite, pu, pct_avancement, cumul_ht)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            tenantId,
            situation.id,
            ml.id,
            ml.quantite,
            ml.pu,
            pctByLine.get(ml.id) ?? '0',
            cumulByLine.get(ml.id) ?? '0',
          ],
        );
      }

      return situation;
    });
  }

  listSituations(marcheId: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, (em) =>
      em.query(`SELECT * FROM situation WHERE marche_id = $1 ORDER BY numero ASC`, [marcheId]),
    );
  }

  getSituation(situationId: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const situation = await em.query(`SELECT * FROM situation WHERE id = $1`, [situationId]);
      if (situation.length === 0) {
        throw new NotFoundException(`Unknown situation "${situationId}"`);
      }
      const lines = await em.query(
        `SELECT * FROM situation_line WHERE situation_id = $1`,
        [situationId],
      );
      return { situation: situation[0], lines };
    });
  }
}

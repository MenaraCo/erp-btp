import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { runInTenant } from '../../core/tenancy/tenant-transaction';
import { computeDgd } from './dgd-calc';

@Injectable()
export class DgdService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly context: TenantContext,
  ) {}

  /** Generates (or regenerates) the DGD of a marché from its last situation. */
  generate(marcheId: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const marche = await em.query(`SELECT total_ht FROM marche WHERE id = $1`, [marcheId]);
      if (marche.length === 0) {
        throw new NotFoundException(`Unknown marché "${marcheId}"`);
      }

      const last = await em.query(
        `SELECT id, cumul_ht, tva_rate FROM situation WHERE marche_id = $1 ORDER BY numero DESC LIMIT 1`,
        [marcheId],
      );
      if (last.length === 0) {
        throw new BadRequestException('A DGD requires at least one situation.');
      }

      const agg = (
        await em.query(
          `SELECT COALESCE(SUM(retenue_garantie), 0) AS retenue, COALESCE(SUM(nap), 0) AS nap
             FROM situation WHERE marche_id = $1`,
          [marcheId],
        )
      )[0];

      const result = computeDgd({
        montantMarcheHt: String(marche[0].total_ht),
        travauxCumulHt: String(last[0].cumul_ht),
        tvaRate: String(last[0].tva_rate),
        retenueGarantieTotale: String(agg.retenue),
        dejaRegleNap: String(agg.nap),
      });

      return (
        await em.query(
          `INSERT INTO dgd
             (tenant_id, marche_id, based_on_situation_id, montant_marche_ht, travaux_cumul_ht,
              tva, ttc, retenue_garantie_totale, deja_regle_nap, solde_nap)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           ON CONFLICT (marche_id) DO UPDATE SET
             based_on_situation_id = EXCLUDED.based_on_situation_id,
             montant_marche_ht = EXCLUDED.montant_marche_ht,
             travaux_cumul_ht = EXCLUDED.travaux_cumul_ht,
             tva = EXCLUDED.tva, ttc = EXCLUDED.ttc,
             retenue_garantie_totale = EXCLUDED.retenue_garantie_totale,
             deja_regle_nap = EXCLUDED.deja_regle_nap, solde_nap = EXCLUDED.solde_nap,
             updated_at = now()
           RETURNING *`,
          [
            tenantId,
            marcheId,
            last[0].id,
            result.montantMarcheHt,
            result.travauxCumulHt,
            result.tva,
            result.ttc,
            result.retenueGarantieTotale,
            result.dejaRegleNap,
            result.soldeNap,
          ],
        )
      )[0];
    });
  }

  get(marcheId: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const rows = await em.query(`SELECT * FROM dgd WHERE marche_id = $1`, [marcheId]);
      if (rows.length === 0) {
        throw new NotFoundException(`No DGD for marché "${marcheId}"`);
      }
      return rows[0];
    });
  }
}

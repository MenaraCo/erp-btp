import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import Decimal from 'decimal.js';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { runInTenant } from '../../core/tenancy/tenant-transaction';
import { recodifyForAvenant } from './avenant-codify';

export interface AvenantLineInput {
  code?: string | null;
  designation: string;
  unit?: string | null;
  quantite: string | number;
  pu?: string | number;
  /** When set, base the line on an existing marché line (code + optional price). */
  sourceMarcheLineId?: string;
  /** With sourceMarcheLineId: reuse the marché line PU instead of the provided one. */
  keepMarchePrice?: boolean;
}

export interface AvenantInput {
  label?: string;
  lines: AvenantLineInput[];
}

@Injectable()
export class AvenantService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly context: TenantContext,
  ) {}

  createAvenant(marcheId: string, input: AvenantInput) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const marche = await em.query(`SELECT id FROM marche WHERE id = $1 FOR UPDATE`, [marcheId]);
      if (marche.length === 0) {
        throw new NotFoundException(`Unknown marché "${marcheId}"`);
      }

      const numero =
        Number(
          (
            await em.query(
              `SELECT COALESCE(MAX(numero), 0) + 1 AS n FROM avenant WHERE marche_id = $1`,
              [marcheId],
            )
          )[0].n,
        );

      const avenant = (
        await em.query(
          `INSERT INTO avenant (tenant_id, marche_id, numero, label) VALUES ($1, $2, $3, $4) RETURNING id`,
          [tenantId, marcheId, numero, input.label ?? `Avenant ${numero}`],
        )
      )[0];

      let total = new Decimal(0);
      let sortOrder = 0;
      for (const line of input.lines ?? []) {
        let baseCode = line.code ?? null;
        let pu = new Decimal(line.pu ?? 0);

        if (line.sourceMarcheLineId) {
          const src = await em.query(
            `SELECT code, pu FROM marche_line WHERE id = $1 AND marche_id = $2`,
            [line.sourceMarcheLineId, marcheId],
          );
          if (src.length === 0) {
            throw new NotFoundException(`Unknown marché line "${line.sourceMarcheLineId}"`);
          }
          baseCode = baseCode ?? src[0].code;
          if (line.keepMarchePrice) {
            pu = new Decimal(src[0].pu);
          }
        }

        const quantite = new Decimal(line.quantite ?? 0);
        const montant = pu.times(quantite).toDecimalPlaces(2);
        total = total.plus(montant);

        await em.query(
          `INSERT INTO marche_line
             (tenant_id, marche_id, avenant_id, code, designation, unit, quantite, pu, montant_ht, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            tenantId,
            marcheId,
            avenant.id,
            recodifyForAvenant(baseCode, numero),
            line.designation,
            line.unit ?? null,
            quantite.toString(),
            pu.toString(),
            montant.toString(),
            sortOrder++,
          ],
        );
      }

      await em.query(`UPDATE avenant SET total_ht = $1, updated_at = now() WHERE id = $2`, [
        total.toString(),
        avenant.id,
      ]);
      await em.query(
        `UPDATE marche SET total_ht = total_ht + $1, updated_at = now() WHERE id = $2`,
        [total.toString(), marcheId],
      );

      return (await em.query(`SELECT * FROM avenant WHERE id = $1`, [avenant.id]))[0];
    });
  }

  listAvenants(marcheId: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, (em) =>
      em.query(`SELECT * FROM avenant WHERE marche_id = $1 ORDER BY numero ASC`, [marcheId]),
    );
  }

  getAvenant(avenantId: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const avenant = await em.query(`SELECT * FROM avenant WHERE id = $1`, [avenantId]);
      if (avenant.length === 0) {
        throw new NotFoundException(`Unknown avenant "${avenantId}"`);
      }
      const lines = await em.query(
        `SELECT * FROM marche_line WHERE avenant_id = $1 ORDER BY sort_order ASC`,
        [avenantId],
      );
      return { avenant: avenant[0], lines };
    });
  }
}

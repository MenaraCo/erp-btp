import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import Decimal from 'decimal.js';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { runInTenant } from '../../core/tenancy/tenant-transaction';
import { isTransferable } from '../estimating/affaire-workflow';
import { VenteService } from '../estimating/vente.service';

interface DevisLineMeta {
  id: string;
  code: string | null;
  designation: string;
  unit: string | null;
  quantity: string | null;
}

@Injectable()
export class AcceptanceService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly context: TenantContext,
    private readonly vente: VenteService,
  ) {}

  /** Transfers a won affaire (latest version) into a marché with priced lines (rule #5). */
  async transfer(affaireId: string) {
    const tenantId = this.context.requireTenantId();

    // Phase A — reads + validation outside the write transaction.
    const affaire = await runInTenant(this.dataSource, tenantId, (em) =>
      em.query(`SELECT id, code, name, status FROM affaire WHERE id = $1`, [affaireId]),
    );
    if (affaire.length === 0) {
      throw new NotFoundException(`Unknown affaire "${affaireId}"`);
    }
    if (!isTransferable(affaire[0].status)) {
      throw new ConflictException('Only a won affaire can be transferred.');
    }

    const versionRow = await runInTenant(this.dataSource, tenantId, (em) =>
      em.query(
        `SELECT id FROM affaire_version WHERE affaire_id = $1 ORDER BY version_no DESC LIMIT 1`,
        [affaireId],
      ),
    );
    if (versionRow.length === 0) {
      throw new ConflictException('Affaire has no version to transfer.');
    }
    const versionId = versionRow[0].id as string;

    const fv = await this.vente.computeForVersion(versionId);
    const pvByLine = new Map(fv.items.map((i) => [i.id, i.pv]));

    const devisLines: DevisLineMeta[] = await runInTenant(this.dataSource, tenantId, (em) =>
      em.query(
        `SELECT id, code, designation, unit, quantity FROM devis_line
          WHERE affaire_version_id = $1 AND type = 'ouvrage' AND vendable = true
            AND source_ouvrage_id IS NOT NULL
          ORDER BY sort_order ASC, created_at ASC`,
        [versionId],
      ),
    );

    // Phase B — write transaction (re-checks under lock to avoid races).
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const current = await em.query(`SELECT status FROM affaire WHERE id = $1 FOR UPDATE`, [
        affaireId,
      ]);
      if (!isTransferable(current[0].status)) {
        throw new ConflictException('Only a won affaire can be transferred.');
      }
      const existing = await em.query(
        `SELECT id FROM marche WHERE affaire_version_id = $1`,
        [versionId],
      );
      if (existing.length > 0) {
        throw new ConflictException('This affaire version has already been transferred.');
      }

      let total = new Decimal(0);
      const lines = devisLines.map((l, index) => {
        const pv = new Decimal(pvByLine.get(l.id) ?? 0);
        const qty = new Decimal(l.quantity ?? 0);
        const pu = qty.isZero() ? new Decimal(0) : pv.dividedBy(qty).toDecimalPlaces(4);
        const montant = pv.toDecimalPlaces(2);
        total = total.plus(montant);
        return {
          code: l.code,
          designation: l.designation,
          unit: l.unit,
          quantite: qty.toString(),
          pu: pu.toString(),
          montant_ht: montant.toString(),
          source_devis_line_id: l.id,
          sort_order: index,
        };
      });

      const marche = (
        await em.query(
          `INSERT INTO marche (tenant_id, affaire_id, affaire_version_id, code, name, total_ht)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
          [tenantId, affaireId, versionId, `${affaire[0].code}-M`, affaire[0].name, total.toString()],
        )
      )[0];

      for (const line of lines) {
        await em.query(
          `INSERT INTO marche_line
             (tenant_id, marche_id, code, designation, unit, quantite, pu, montant_ht, source_devis_line_id, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            tenantId,
            marche.id,
            line.code,
            line.designation,
            line.unit,
            line.quantite,
            line.pu,
            line.montant_ht,
            line.source_devis_line_id,
            line.sort_order,
          ],
        );
      }

      return { marche, lineCount: lines.length };
    });
  }

  getMarche(marcheId: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const marche = await em.query(`SELECT * FROM marche WHERE id = $1`, [marcheId]);
      if (marche.length === 0) {
        throw new NotFoundException(`Unknown marché "${marcheId}"`);
      }
      const lines = await em.query(
        `SELECT * FROM marche_line WHERE marche_id = $1 ORDER BY sort_order ASC`,
        [marcheId],
      );
      return { marche: marche[0], lines };
    });
  }

  listMarches() {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, (em) =>
      em.query(`SELECT * FROM marche ORDER BY created_at DESC`),
    );
  }
}

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
import { ChantierService } from '../site-tracking/chantier.service';

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
    private readonly chantiers: ChantierService,
  ) {}

  /**
   * Acceptation unifiée (cahier des charges §5.4, « le pont ») : crée UN marché rattaché à un
   * chantier (nouveau ou existant), portant À LA FOIS sa chaîne de facturation (lignes de marché)
   * ET son étude d'exécution (déboursé). Remplace les deux anciens transferts séparés.
   */
  async accept(affaireId: string, targetChantierId?: string | null) {
    const tenantId = this.context.requireTenantId();

    const affaire = await runInTenant(this.dataSource, tenantId, (em) =>
      em.query(`SELECT id, code, name, status FROM affaire WHERE id = $1`, [affaireId]),
    );
    if (affaire.length === 0) {
      throw new NotFoundException(`Unknown affaire "${affaireId}"`);
    }
    if (!isTransferable(affaire[0].status)) {
      throw new ConflictException('Only a won affaire can be accepted.');
    }
    const versionRow = await runInTenant(this.dataSource, tenantId, (em) =>
      em.query(
        `SELECT id FROM devis_version WHERE affaire_id = $1 ORDER BY version_no DESC LIMIT 1`,
        [affaireId],
      ),
    );
    if (versionRow.length === 0) {
      throw new ConflictException('Affaire has no version to accept.');
    }
    const versionId = versionRow[0].id as string;
    const fv = await this.vente.computeForVersion(versionId);
    const pvByLine = new Map(fv.items.map((i) => [i.id, i.pv]));
    const devisLines: DevisLineMeta[] = await runInTenant(this.dataSource, tenantId, (em) =>
      em.query(
        `SELECT id, code, designation, unit, quantity FROM devis_line
          WHERE devis_version_id = $1 AND type = 'ouvrage' AND vendable = true
            AND source_ouvrage_id IS NOT NULL
          ORDER BY sort_order ASC, created_at ASC`,
        [versionId],
      ),
    );

    // Phase B — create the marché (on a chantier) + its facturation lines in one transaction.
    const marche = await runInTenant(this.dataSource, tenantId, async (em) => {
      const current = await em.query(`SELECT status FROM affaire WHERE id = $1 FOR UPDATE`, [affaireId]);
      if (!isTransferable(current[0].status)) {
        throw new ConflictException('Only a won affaire can be accepted.');
      }
      const m = await this.chantiers.createMarche(em, {
        tenantId,
        affaire: affaire[0],
        versionId,
        venteTotal: fv.totalPvHt,
        targetChantierId: targetChantierId ?? null,
      });
      let sort = 0;
      for (const l of devisLines) {
        const pv = new Decimal(pvByLine.get(l.id) ?? 0);
        const qty = new Decimal(l.quantity ?? 0);
        const pu = qty.isZero() ? new Decimal(0) : pv.dividedBy(qty).toDecimalPlaces(4);
        await em.query(
          `INSERT INTO marche_line
             (tenant_id, marche_id, code, designation, unit, quantite, pu, montant_ht, source_devis_line_id, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [tenantId, m.id, l.code, l.designation, l.unit, qty.toString(), pu.toString(),
            pv.toDecimalPlaces(2).toString(), l.id, sort++],
        );
      }
      return m;
    });

    // Phase C — materialise the étude d'exécution under the same marché.
    const executionLineCount = await this.chantiers.materialiseExecutionForMarche(marche.id);
    const chantier = await runInTenant(this.dataSource, tenantId, (em) =>
      em.query(`SELECT * FROM chantier WHERE id = $1`, [marche.chantier_id]),
    );
    return {
      chantier: chantier[0],
      marche,
      lineCount: devisLines.length,
      executionLineCount,
    };
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

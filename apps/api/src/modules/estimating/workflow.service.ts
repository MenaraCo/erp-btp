import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { runInTenant } from '../../core/tenancy/tenant-transaction';
import {
  DevisStatus,
  assertTransition,
  InvalidTransitionError,
  isDevisStatus,
  isTransferable,
  nextStates,
} from './devis-workflow';
import { deriveAffaireStatus } from './affaire-derived-status';

export interface TransferCheck {
  status: DevisStatus;
  transferable: boolean;
  alerts: Array<{ level: 'blocking' | 'warning'; message: string }>;
}

@Injectable()
export class WorkflowService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly context: TenantContext,
  ) {}

  /** Moves a devis to a new status, enforcing the state machine; recomputes the affaire status. */
  transition(devisId: string, to: string) {
    if (!isDevisStatus(to)) {
      throw new BadRequestException(`Unknown status "${to}"`);
    }
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const rows = await em.query(`SELECT status, affaire_id FROM devis WHERE id = $1`, [devisId]);
      if (rows.length === 0) {
        throw new NotFoundException(`Unknown devis "${devisId}"`);
      }
      const from = rows[0].status as DevisStatus;
      const affaireId = rows[0].affaire_id as string;
      try {
        assertTransition(from, to);
      } catch (e) {
        if (e instanceof InvalidTransitionError) {
          throw new ConflictException(e.message);
        }
        throw e;
      }
      await em.query(`UPDATE devis SET status = $1, updated_at = now() WHERE id = $2`, [
        to,
        devisId,
      ]);
      // Affaire status is derived from its devis.
      const siblings = await em.query(`SELECT status FROM devis WHERE affaire_id = $1`, [affaireId]);
      const affaireStatus = deriveAffaireStatus(
        siblings.map((r: { status: DevisStatus }) => r.status),
      );
      await em.query(`UPDATE affaire SET status = $1, updated_at = now() WHERE id = $2`, [
        affaireStatus,
        affaireId,
      ]);
      const updated = await em.query(`SELECT * FROM devis WHERE id = $1`, [devisId]);
      return { devis: updated[0], affaireStatus, allowedNext: nextStates(to) };
    });
  }

  /** Rule #7: only a won devis transfers; non-blocking alerts otherwise. */
  transferCheck(devisId: string): Promise<TransferCheck> {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const rows = await em.query(`SELECT status FROM devis WHERE id = $1`, [devisId]);
      if (rows.length === 0) {
        throw new NotFoundException(`Unknown devis "${devisId}"`);
      }
      const status = rows[0].status as DevisStatus;
      const transferable = isTransferable(status);

      const alerts: TransferCheck['alerts'] = [];
      if (!transferable) {
        alerts.push({
          level: 'blocking',
          message: 'Seul un devis « Gagné » peut être transféré.',
        });
      }

      const debourse = await em.query(
        `SELECT COALESCE(SUM(o.debourse * COALESCE(dl.quantity, 0)), 0) AS total
           FROM devis_line dl
           JOIN devis_version dv ON dv.id = dl.devis_version_id
           JOIN ouvrage o ON o.id = dl.source_ouvrage_id
          WHERE dv.devis_id = $1 AND dl.type = 'ouvrage'`,
        [devisId],
      );
      if (Number(debourse[0].total) === 0) {
        alerts.push({
          level: 'warning',
          message: 'Le déboursé du devis est nul.',
        });
      }

      return { status, transferable, alerts };
    });
  }
}

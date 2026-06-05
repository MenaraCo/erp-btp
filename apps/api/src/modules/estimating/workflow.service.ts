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
  AffaireStatus,
  assertTransition,
  InvalidTransitionError,
  isAffaireStatus,
  isTransferable,
  nextStates,
} from './affaire-workflow';

export interface TransferCheck {
  status: AffaireStatus;
  transferable: boolean;
  alerts: Array<{ level: 'blocking' | 'warning'; message: string }>;
}

@Injectable()
export class WorkflowService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly context: TenantContext,
  ) {}

  /** Moves an affaire to a new status, enforcing the state machine. */
  transition(affaireId: string, to: string) {
    if (!isAffaireStatus(to)) {
      throw new BadRequestException(`Unknown status "${to}"`);
    }
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const rows = await em.query(`SELECT status FROM affaire WHERE id = $1`, [affaireId]);
      if (rows.length === 0) {
        throw new NotFoundException(`Unknown affaire "${affaireId}"`);
      }
      const from = rows[0].status as AffaireStatus;
      try {
        assertTransition(from, to);
      } catch (e) {
        if (e instanceof InvalidTransitionError) {
          throw new ConflictException(e.message);
        }
        throw e;
      }
      await em.query(`UPDATE affaire SET status = $1, updated_at = now() WHERE id = $2`, [
        to,
        affaireId,
      ]);
      const updated = await em.query(`SELECT * FROM affaire WHERE id = $1`, [affaireId]);
      return { affaire: updated[0], allowedNext: nextStates(to) };
    });
  }

  /** Rule #7: only a won affaire transfers; non-blocking alerts otherwise. */
  transferCheck(affaireId: string): Promise<TransferCheck> {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const rows = await em.query(`SELECT status FROM affaire WHERE id = $1`, [affaireId]);
      if (rows.length === 0) {
        throw new NotFoundException(`Unknown affaire "${affaireId}"`);
      }
      const status = rows[0].status as AffaireStatus;
      const transferable = isTransferable(status);

      const alerts: TransferCheck['alerts'] = [];
      if (!transferable) {
        alerts.push({
          level: 'blocking',
          message: 'Seule une affaire « Gagnée » peut être transférée.',
        });
      }

      const debourse = await em.query(
        `SELECT COALESCE(SUM(o.debourse * COALESCE(dl.quantity, 0)), 0) AS total
           FROM devis_line dl
           JOIN devis_version av ON av.id = dl.devis_version_id
           JOIN ouvrage o ON o.id = dl.source_ouvrage_id
          WHERE av.affaire_id = $1 AND dl.type = 'ouvrage'`,
        [affaireId],
      );
      if (Number(debourse[0].total) === 0) {
        alerts.push({
          level: 'warning',
          message: 'Le déboursé de l’affaire est nul.',
        });
      }

      return { status, transferable, alerts };
    });
  }
}

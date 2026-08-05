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
import { ActivityService } from '../../core/activity/activity.service';
import {
  DEVIS_STATUS_LABELS,
  DevisStatus,
  assertTransition,
  InvalidTransitionError,
  isDevisStatus,
  isTransferable,
  nextStates,
} from './devis-workflow';
import { deriveAffaireStatus } from './affaire-derived-status';
import { VenteService } from './vente.service';
import {
  compterControles,
  Controle,
  ControleLine,
  controlerDevis,
} from './devis-controles';
import { computeLineNumbers, NumberingLine } from './devis-numbering';

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
    private readonly vente: VenteService,
    private readonly activity: ActivityService,
  ) {}

  /**
   * Contrôles de cohérence d'une version : ce qui manque ou cloche, ligne par ligne. Lus en
   * continu par le panneau de l'écran, pas seulement au moment de transférer — un oubli se corrige
   * mieux pendant l'étude qu'une fois le devis parti.
   */
  controles(versionId: string): Promise<{ controles: Controle[]; compte: Record<string, number> }> {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const version = await em.query(
        `SELECT dv.id, d.affaire_id
           FROM devis_version dv JOIN devis d ON d.id = dv.devis_id
          WHERE dv.id = $1`,
        [versionId],
      );
      if (version.length === 0) {
        throw new NotFoundException(`Unknown version "${versionId}"`);
      }

      const rows = await em.query(
        `SELECT dl.id, dl.parent_line_id, dl.type, dl.code, dl.designation, dl.unit, dl.quantity,
                dl.pu, dl.vendable, dl.code_analytique, dl.source_ouvrage_id, dl.sort_order,
                dl.pu_vente_force,
                dl.created_at, dl.num_custom
           FROM devis_line dl
          WHERE dl.devis_version_id = $1
          ORDER BY dl.sort_order ASC, dl.created_at ASC`,
        [versionId],
      );
      // La numérotation hiérarchique est la même que celle des écrans : le contrôle cite « 1.2.1 ».
      const numeros = computeLineNumbers(rows as NumberingLine[]);
      const numeroDe = (id: string | null) => (id ? numeros.get(id) ?? null : null);
      const lines: ControleLine[] = rows.map((r: Record<string, unknown>) => ({
        id: r.id as string,
        parentLineId: (r.parent_line_id as string | null) ?? null,
        type: r.type as string,
        numero: numeros.get(r.id as string) ?? (r.num_custom as string | null),
        parentNumero: numeroDe((r.parent_line_id as string | null) ?? null),
        code: (r.code as string | null) ?? null,
        designation: (r.designation as string) ?? '',
        unit: (r.unit as string | null) ?? null,
        quantity: (r.quantity as string | null) ?? null,
        pu: (r.pu as string | null) ?? null,
        vendable: (r.vendable as boolean | null) !== false,
        codeAnalytique: (r.code_analytique as string | null) ?? null,
        sourceOuvrageId: (r.source_ouvrage_id as string | null) ?? null,
        puVenteForce: (r.pu_vente_force as boolean | null) === true,
      }));

      const sheet = await em.query(
        `SELECT 1 FROM sale_sheet WHERE devis_version_id = $1`,
        [versionId],
      );
      const client = await em.query(
        `SELECT a.client_id FROM affaire a WHERE a.id = $1`,
        [version[0].affaire_id],
      );

      // Marge et total viennent du moteur : un contrôle ne recalcule jamais un prix.
      let margeNette: number | null = null;
      let totalPvHt: number | null = null;
      if (sheet.length > 0) {
        const fv = await this.vente.computeForVersion(versionId);
        margeNette = Number(fv.margeNette ?? 0);
        totalPvHt = Number(fv.totalPvHt ?? 0);
      }

      const controles = controlerDevis({
        lines,
        coefficientsConfigures: sheet.length > 0,
        margeNette,
        totalPvHt,
        clientRenseigne: Boolean(client[0]?.client_id),
      });
      return { controles, compte: compterControles(controles) };
    });
  }

  /** Moves a devis to a new status, enforcing the state machine; recomputes the affaire status. */
  transition(devisId: string, to: string) {
    if (!isDevisStatus(to)) {
      throw new BadRequestException(`Unknown status "${to}"`);
    }
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const rows = await em.query(
        `SELECT d.status, d.affaire_id, d.numero, d.designation, a.name AS affaire_name
           FROM devis d JOIN affaire a ON a.id = d.affaire_id
          WHERE d.id = $1`,
        [devisId],
      );
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
      // Journalisé dans la transaction du changement de statut : si la mise à jour du devis ou
      // celle de l'affaire échoue, le fil ne montre pas un passage qui n'a pas eu lieu.
      await this.activity.log(em, {
        entityType: 'devis',
        entityId: devisId,
        action: 'statut',
        label:
          `${rows[0].numero ?? rows[0].designation} → ${DEVIS_STATUS_LABELS[to]}` +
          ` (${rows[0].affaire_name})`,
        detail: { de: from, vers: to },
      });
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

      // Déboursé réel = feuille de vente (contenu du devis : sous-détail copié/manuel, ouvrages
      // manuels, ressources autonomes) — surtout pas la bibliothèque, sinon un devis 100% manuel
      // remonterait à tort « déboursé nul ».
      const latest = await em.query(
        `SELECT id FROM devis_version WHERE devis_id = $1 ORDER BY version_no DESC LIMIT 1`,
        [devisId],
      );
      let totalDebourse = 0;
      if (latest.length > 0) {
        const fv = await this.vente.computeForVersion(latest[0].id);
        totalDebourse = Number(fv.totalDebourse ?? 0);
      }
      if (totalDebourse === 0) {
        alerts.push({
          level: 'warning',
          message: 'Le déboursé du devis est nul.',
        });
      }

      return { status, transferable, alerts };
    });
  }
}

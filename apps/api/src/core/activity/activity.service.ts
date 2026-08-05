import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { TenantContext } from '../tenancy/tenant-context';
import { runInTenant } from '../tenancy/tenant-transaction';

/** Objets dont le fil retrace la vie. */
export type ActivityEntityType = 'affaire' | 'devis' | 'marche' | 'chantier';

/** Nature du fait journalisé — sert aussi de code couleur à l'écran. */
export type ActivityAction = 'creation' | 'modification' | 'statut' | 'acceptation';

export interface ActivityInput {
  entityType: ActivityEntityType;
  entityId?: string | null;
  action: ActivityAction;
  /** Phrase lisible telle qu'elle s'affichera, écrite au moment du fait. */
  label: string;
  /** Contexte machine (ex. { de: 'sent', vers: 'won' }) — jamais nécessaire à la lecture. */
  detail?: Record<string, unknown> | null;
}

export interface ActivityEvent {
  id: string;
  entityType: ActivityEntityType;
  entityId: string | null;
  action: ActivityAction;
  label: string;
  detail: Record<string, unknown> | null;
  actorEmail: string | null;
  createdAt: string;
}

/** Une phrase d'historique est bornée par la colonne : on coupe plutôt que de faire échouer l'écriture. */
const LABEL_MAX = 500;

/**
 * Journal des faits de l'application (création, modification, changement de statut, acceptation).
 *
 * Règle centrale : `log` prend l'`EntityManager` de l'appelant et n'ouvre JAMAIS sa propre
 * transaction. L'événement est donc écrit dans la transaction de l'opération qu'il relate — si
 * celle-ci échoue et se retire, la trace se retire avec elle. Un fil qui annoncerait un devis
 * gagné alors que le passage au statut a été annulé serait pire que pas de fil du tout.
 */
@Injectable()
export class ActivityService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly context: TenantContext,
  ) {}

  /**
   * Journalise un fait DANS la transaction en cours.
   *
   * @param em l'EntityManager de l'opération en cours — surtout pas un nouveau.
   */
  async log(em: EntityManager, input: ActivityInput): Promise<void> {
    const tenantId = this.context.requireTenantId();
    await em.query(
      `INSERT INTO activity_log
         (tenant_id, entity_type, entity_id, action, label, detail, actor_user_id)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
      [
        tenantId,
        input.entityType,
        input.entityId ?? null,
        input.action,
        input.label.slice(0, LABEL_MAX),
        input.detail != null ? JSON.stringify(input.detail) : null,
        this.context.getUserId() ?? null,
      ],
    );
  }

  /** Les N derniers faits du tenant, du plus récent au plus ancien, signés de leur auteur. */
  list(limit = 20): Promise<ActivityEvent[]> {
    const tenantId = this.context.requireTenantId();
    // Borne haute : l'écran ne demande qu'une poignée d'événements, un `?limit=100000` ne doit pas
    // pouvoir transformer une carte de tableau de bord en export complet.
    const n = Math.max(1, Math.min(200, Math.trunc(Number(limit)) || 20));
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const rows = await em.query(
        `SELECT al.id, al.entity_type, al.entity_id, al.action, al.label, al.detail,
                al.created_at, u.email AS actor_email
           FROM activity_log al
           LEFT JOIN user_account u ON u.id = al.actor_user_id
          ORDER BY al.created_at DESC, al.id DESC
          LIMIT $1`,
        [n],
      );
      return rows.map((r: Record<string, unknown>) => ({
        id: r.id as string,
        entityType: r.entity_type as ActivityEntityType,
        entityId: (r.entity_id as string | null) ?? null,
        action: r.action as ActivityAction,
        label: r.label as string,
        detail: (r.detail as Record<string, unknown> | null) ?? null,
        actorEmail: (r.actor_email as string | null) ?? null,
        createdAt:
          r.created_at instanceof Date
            ? r.created_at.toISOString()
            : String(r.created_at),
      }));
    });
  }
}

import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { TenantContext } from '../tenancy/tenant-context';
import { runInTenant } from '../tenancy/tenant-transaction';
import {
  NUMBERED_ENTITIES,
  NUMBERING_DEFAULTS,
  NumberedEntity,
  formatCode,
  patternHasSequence,
} from './code-pattern';

/**
 * Numérotation automatique centralisée. Aucun code n'est saisi à la main : au moment de créer un
 * objet, le service réserve le prochain numéro selon le motif paramétré par la société.
 *
 * `next(em, type)` prend l'EntityManager de l'appelant → la réservation du numéro et la création
 * de l'objet vivent dans la MÊME transaction : si la création échoue, le numéro n'est pas consommé.
 * Le SELECT … FOR UPDATE sérialise deux créations simultanées (pas de doublon de séquence).
 */
@Injectable()
export class NumberingService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly context: TenantContext,
  ) {}

  /** Réserve et renvoie le prochain code pour ce type d'objet, dans la transaction fournie. */
  async next(em: EntityManager, entityType: NumberedEntity): Promise<string> {
    const tenantId = this.context.requireTenantId();
    const rows = await em.query(
      `SELECT id, pattern, next_seq FROM numbering_scheme
        WHERE entity_type = $1 AND deleted_at IS NULL FOR UPDATE`,
      [entityType],
    );
    let scheme = rows[0];
    if (!scheme) {
      // Société sans réglage propre : on matérialise le motif par défaut à la volée.
      scheme = (
        await em.query(
          `INSERT INTO numbering_scheme (tenant_id, entity_type, pattern, next_seq)
           VALUES ($1, $2, $3, 1) RETURNING id, pattern, next_seq`,
          [tenantId, entityType, NUMBERING_DEFAULTS[entityType].pattern],
        )
      )[0];
    }
    const code = formatCode(scheme.pattern, scheme.next_seq, new Date());
    await em.query(
      `UPDATE numbering_scheme SET next_seq = next_seq + 1, updated_at = now() WHERE id = $1`,
      [scheme.id],
    );
    return code;
  }

  /** Liste les schémas de la société (en créant ceux qui manquent), pour l'écran Configuration. */
  listSchemes(): Promise<{ entityType: string; label: string; pattern: string; nextSeq: number; preview: string }[]> {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const existing: { entity_type: string; pattern: string; next_seq: number }[] = await em.query(
        `SELECT entity_type, pattern, next_seq FROM numbering_scheme WHERE deleted_at IS NULL`,
      );
      const byType = new Map(existing.map((r) => [r.entity_type, r]));
      return NUMBERED_ENTITIES.map((type) => {
        const row = byType.get(type);
        const pattern = row?.pattern ?? NUMBERING_DEFAULTS[type].pattern;
        const nextSeq = row?.next_seq ?? 1;
        return {
          entityType: type,
          label: NUMBERING_DEFAULTS[type].label,
          pattern,
          nextSeq,
          preview: formatCode(pattern, nextSeq, new Date()),
        };
      });
    });
  }

  /** Met à jour le motif (et éventuellement la prochaine séquence) d'un type d'objet. */
  updateScheme(entityType: string, patch: { pattern?: string; nextSeq?: number }) {
    if (!NUMBERED_ENTITIES.includes(entityType as NumberedEntity)) {
      throw new BadRequestException('Type d’objet inconnu.');
    }
    if (patch.pattern != null && !patternHasSequence(patch.pattern)) {
      throw new BadRequestException(
        'Le motif doit contenir un jeton de séquence {SEQ} ou {SEQ:n} (sinon tous les codes seraient identiques).',
      );
    }
    if (patch.nextSeq != null && (!Number.isInteger(patch.nextSeq) || patch.nextSeq < 1)) {
      throw new BadRequestException('La prochaine séquence doit être un entier ≥ 1.');
    }
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const def = NUMBERING_DEFAULTS[entityType as NumberedEntity];
      const existing = await em.query(
        `SELECT id FROM numbering_scheme WHERE entity_type = $1 AND deleted_at IS NULL`,
        [entityType],
      );
      if (existing.length === 0) {
        await em.query(
          `INSERT INTO numbering_scheme (tenant_id, entity_type, pattern, next_seq)
           VALUES ($1, $2, $3, $4)`,
          [tenantId, entityType, patch.pattern ?? def.pattern, patch.nextSeq ?? 1],
        );
      } else {
        await em.query(
          `UPDATE numbering_scheme SET
             pattern  = COALESCE($2, pattern),
             next_seq = COALESCE($3, next_seq),
             updated_at = now()
           WHERE entity_type = $1 AND deleted_at IS NULL`,
          [entityType, patch.pattern ?? null, patch.nextSeq ?? null],
        );
      }
      const [row] = await em.query(
        `SELECT entity_type, pattern, next_seq FROM numbering_scheme WHERE entity_type = $1 AND deleted_at IS NULL`,
        [entityType],
      );
      return {
        entityType: row.entity_type,
        label: def.label,
        pattern: row.pattern,
        nextSeq: row.next_seq,
        preview: formatCode(row.pattern, row.next_seq, new Date()),
      };
    });
  }
}

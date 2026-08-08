import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { runInTenant } from '../../core/tenancy/tenant-transaction';

export type PorteeBibliotheque = 'etude' | 'chantier';

export interface CandidatTransfert {
  id: string;
  code: string;
  label: string;
  unit: string | null;
  nature: string;
  prix: string;
  /** `deja_present` : la cible porte déjà ce code — on ne l'écrase pas. */
  etat: 'transferable' | 'deja_present';
}

export interface ResultatTransfert {
  transferes: number;
  ignores: number;
  codesIgnores: string[];
}

/**
 * Transfert entre la bibliothèque d'ÉTUDE DE PRIX et la bibliothèque du MODULE CHANTIER.
 *
 * Ce sont deux catalogues de référence au niveau de l'entreprise, volontairement distincts : on
 * ne chiffre pas avec les mêmes articles ni aux mêmes prix qu'on exécute. Ils ne doivent donc pas
 * se synchroniser tout seuls — mais l'entreprise doit pouvoir faire circuler ce qui le mérite :
 * un article nouvellement référencé, un prix enfin obtenu.
 *
 * À ne pas confondre avec la nomenclature d'UN chantier : celle-là est une copie de travail reçue
 * à l'acceptation d'une commande, propre à ce chantier, et elle ne participe pas à ce transfert.
 *
 * Deux garde-fous : on choisit ce qu'on transfère (rien d'automatique), et un code déjà pris à la
 * cible est signalé puis sauté, jamais écrasé.
 */
@Injectable()
export class LibraryTransferService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly context: TenantContext,
  ) {}

  /** Bibliothèques d'une portée donnée, pour alimenter les listes de choix. */
  listerBibliotheques(scope: PorteeBibliotheque) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, (em) =>
      em.query(
        `SELECT id, code, name FROM library
          WHERE scope = $1 AND deleted_at IS NULL
          ORDER BY code`,
        [scope],
      ),
    );
  }

  /** Ce que le transfert ferait, sans rien écrire. */
  apercu(sourceId: string, cibleId: string): Promise<CandidatTransfert[]> {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      await this.assertBibliotheque(em, sourceId);
      await this.assertBibliotheque(em, cibleId);
      return this.candidats(em, sourceId, cibleId);
    });
  }

  /**
   * Copie les articles retenus. Tout se joue dans UNE transaction : un transfert à moitié appliqué
   * laisserait un catalogue incohérent, impossible à rejouer sans créer de doublons.
   */
  transferer(sourceId: string, cibleId: string, ids: string[]): Promise<ResultatTransfert> {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new BadRequestException('Sélectionnez au moins une ressource à transférer.');
    }
    if (sourceId === cibleId) {
      throw new BadRequestException('La source et la cible doivent être deux bibliothèques différentes.');
    }
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      await this.assertBibliotheque(em, sourceId);
      await this.assertBibliotheque(em, cibleId);

      const retenus = (await this.candidats(em, sourceId, cibleId)).filter((c) => ids.includes(c.id));
      const codesIgnores = retenus.filter((c) => c.etat === 'deja_present').map((c) => c.code);
      const aEcrire = retenus.filter((c) => c.etat === 'transferable');

      for (const c of aEcrire) {
        // Copie franche : la fiche cible vit sa vie ensuite. Aucun lien de synchronisation, c'est
        // tout l'objet de garder deux catalogues.
        await em.query(
          `INSERT INTO resource
             (tenant_id, library_id, code, label, unit, nature, unit_cost, code_produit)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $3)`,
          [tenantId, cibleId, c.code, c.label, c.unit ?? 'U', c.nature, c.prix],
        );
      }
      return { transferes: aEcrire.length, ignores: codesIgnores.length, codesIgnores };
    });
  }

  private async assertBibliotheque(em: EntityManager, id: string): Promise<void> {
    const rows = await em.query(
      `SELECT id FROM library WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    if (rows.length === 0) throw new NotFoundException(`Bibliothèque introuvable (${id}).`);
  }

  /** Portée réelle d'une bibliothèque — le contrôleur s'en sert pour vérifier le sens demandé. */
  async porteeDe(id: string): Promise<PorteeBibliotheque> {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const rows = await em.query(
        `SELECT scope FROM library WHERE id = $1 AND deleted_at IS NULL`,
        [id],
      );
      if (rows.length === 0) throw new NotFoundException(`Bibliothèque introuvable (${id}).`);
      return rows[0].scope as PorteeBibliotheque;
    });
  }

  private async candidats(
    em: EntityManager,
    sourceId: string,
    cibleId: string,
  ): Promise<CandidatTransfert[]> {
    const rows = await em.query(
      `SELECT r.id, r.code, r.label, r.unit, r.nature, r.unit_cost,
              EXISTS (SELECT 1 FROM resource c
                       WHERE c.library_id = $2 AND c.code = r.code) AS deja
         FROM resource r
        WHERE r.library_id = $1
        ORDER BY r.code`,
      [sourceId, cibleId],
    );
    return rows.map((r: Record<string, unknown>) => ({
      id: r.id as string,
      code: r.code as string,
      label: r.label as string,
      unit: (r.unit as string | null) ?? null,
      nature: r.nature as string,
      prix: String(r.unit_cost ?? '0'),
      etat: r.deja ? 'deja_present' : 'transferable',
    }));
  }
}

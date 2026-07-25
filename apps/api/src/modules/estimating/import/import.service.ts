import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { TenantContext } from '../../../core/tenancy/tenant-context';
import { runInTenant } from '../../../core/tenancy/tenant-transaction';
import { parseDpgfExcel, parseDpgfXml, ParsedDevis } from './dpgf-parser';
import { parseNomenclatureXml } from './nomenclature-parser';

export type DpgfFormat = 'xml' | 'excel';

export interface ImportNomenclatureResult {
  libraryId: string;
  libraryCode: string;
  stats: { resources: number; ouvrages: number; composants: number; ignores: number };
}

export interface ImportDevisResult {
  affaireId: string;
  devisId: string;
  versionId: string;
  numero: string;
  stats: { lots: number; ouvrages: number; client: boolean };
}

@Injectable()
export class ImportService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly context: TenantContext,
  ) {}

  /** Importe un DPGF (bordereau) en une nouvelle affaire + devis. Les ouvrages sont des lignes
   * chiffrées (déboursé + PV forcé) sans sous-détail — conforme à un bordereau client. */
  async importDevis(buffer: Buffer, format: DpgfFormat): Promise<ImportDevisResult> {
    let parsed: ParsedDevis;
    try {
      parsed = format === 'xml' ? parseDpgfXml(buffer) : parseDpgfExcel(buffer);
    } catch (e) {
      throw new BadRequestException(`Fichier illisible : ${(e as Error).message}`);
    }
    const totalOuvrages = parsed.lots.reduce((s, l) => s + l.ouvrages.length, 0);
    if (totalOuvrages === 0) {
      throw new BadRequestException('Aucun ouvrage trouvé dans le fichier.');
    }

    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const code = await this.uniqueAffaireCode(em, tenantId, parsed.numero);
      const clientId = parsed.clientName ? await this.upsertClient(em, tenantId, parsed.clientName) : null;

      const affaire = (await em.query(
        `INSERT INTO affaire (tenant_id, code, name, client_id, status)
         VALUES ($1,$2,$3,$4,'en_cours') RETURNING id`,
        [tenantId, code, parsed.titre || code, clientId],
      ))[0];
      const devis = (await em.query(
        `INSERT INTO devis (tenant_id, affaire_id, numero, designation, type, status, sort_order)
         VALUES ($1,$2,$3,$4,'principal','open',0) RETURNING id`,
        [tenantId, affaire.id, code, parsed.titre || code],
      ))[0];
      const version = (await em.query(
        `INSERT INTO devis_version (tenant_id, devis_id, version_no, label) VALUES ($1,$2,1,'v1') RETURNING id`,
        [tenantId, devis.id],
      ))[0];

      let sort = 0;
      for (const lot of parsed.lots) {
        const titre = (await em.query(
          `INSERT INTO devis_line (tenant_id, devis_version_id, parent_line_id, type, designation, sort_order, vendable)
           VALUES ($1,$2,NULL,'titre',$3,$4,true) RETURNING id`,
          [tenantId, version.id, lot.nom, sort++],
        ))[0];
        let childSort = 0;
        for (const o of lot.ouvrages) {
          const pvForced = o.pv > 0;
          await em.query(
            `INSERT INTO devis_line
               (tenant_id, devis_version_id, parent_line_id, type, code, designation, unit,
                quantity, pu, pu_vente, pu_vente_force, sort_order, vendable)
             VALUES ($1,$2,$3,'ouvrage',$4,$5,$6,$7,$8,$9,$10,$11,true)`,
            [tenantId, version.id, titre.id, o.code, o.designation, o.unite,
              o.quantite, o.debours, pvForced ? o.pv : null, pvForced, childSort++],
          );
        }
      }

      return {
        affaireId: affaire.id,
        devisId: devis.id,
        versionId: version.id,
        numero: code,
        stats: { lots: parsed.lots.length, ouvrages: totalOuvrages, client: Boolean(clientId) },
      };
    });
  }

  /** Importe une nomenclature XML (matériaux/tâches/ouvrages) dans une bibliothèque cible
   * (créée si le code n'existe pas). Upsert par code, débours ouvrage recalculé. */
  async importNomenclature(
    buffer: Buffer,
    libraryCode: string,
    libraryName?: string,
  ): Promise<ImportNomenclatureResult> {
    let parsed;
    try {
      parsed = parseNomenclatureXml(buffer);
    } catch (e) {
      throw new BadRequestException(`Fichier illisible : ${(e as Error).message}`);
    }
    if (parsed.resources.length === 0 && parsed.ouvrages.length === 0) {
      throw new BadRequestException('Aucune ressource ni ouvrage trouvé dans le fichier.');
    }
    const code = (libraryCode || 'IMPORT-NOM').trim().slice(0, 64);

    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const lib = (await em.query(
        `INSERT INTO library (tenant_id, code, name, description)
         VALUES ($1,$2,$3,'Importée depuis une nomenclature XML')
         ON CONFLICT (tenant_id, code) DO UPDATE SET name=EXCLUDED.name RETURNING id`,
        [tenantId, code, (libraryName || code).slice(0, 255)],
      ))[0];
      const libraryId = lib.id;

      const resByCode = new Map<string, string>();
      const costById = new Map<string, number>();
      for (const r of parsed.resources) {
        const row = (await em.query(
          `INSERT INTO resource (tenant_id, library_id, code, label, unit, nature, unit_cost, prix_public)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (tenant_id, library_id, code) DO UPDATE SET
             label=EXCLUDED.label, unit=EXCLUDED.unit, nature=EXCLUDED.nature,
             unit_cost=EXCLUDED.unit_cost, prix_public=EXCLUDED.prix_public, updated_at=now()
           RETURNING id`,
          [tenantId, libraryId, r.code, r.designation, r.unite.slice(0, 16), r.nature,
            r.unitCost.toFixed(4), r.prixPublic != null ? r.prixPublic.toFixed(4) : null],
        ))[0];
        resByCode.set(r.code, row.id);
        costById.set(row.id, r.unitCost);
      }

      const ouvByCode = new Map<string, string>();
      for (const o of parsed.ouvrages) {
        const row = (await em.query(
          `INSERT INTO ouvrage (tenant_id, library_id, code, label, unit, debourse)
           VALUES ($1,$2,$3,$4,$5,0)
           ON CONFLICT (tenant_id, library_id, code) DO UPDATE SET
             label=EXCLUDED.label, unit=EXCLUDED.unit, updated_at=now()
           RETURNING id`,
          [tenantId, libraryId, o.code, o.designation, o.unite.slice(0, 16)],
        ))[0];
        ouvByCode.set(o.code, row.id);
      }

      let composants = 0, ignores = 0;
      const compByOuv = new Map<string, { kind: string; childRes: string | null; childOuv: string | null; ratio: number }[]>();
      for (const id of ouvByCode.values()) {
        await em.query(`DELETE FROM ouvrage_component WHERE parent_ouvrage_id=$1`, [id]);
        compByOuv.set(id, []);
      }
      for (const o of parsed.ouvrages) {
        const parentId = ouvByCode.get(o.code)!;
        let sort = 0;
        for (const comp of o.composants) {
          const childRes = comp.kind === 'resource' ? resByCode.get(comp.refCode) ?? null : null;
          const childOuv = comp.kind === 'sub_ouvrage' ? ouvByCode.get(comp.refCode) ?? null : null;
          if (!childRes && !childOuv) { ignores++; continue; }
          await em.query(
            `INSERT INTO ouvrage_component
               (tenant_id, parent_ouvrage_id, kind, child_resource_id, child_ouvrage_id, quantity, perte, sort_order)
             VALUES ($1,$2,$3,$4,$5,$6,0,$7)`,
            [tenantId, parentId, childRes ? 'resource' : 'sub_ouvrage', childRes, childOuv, comp.ratio.toString(), sort++],
          );
          compByOuv.get(parentId)!.push({ kind: childRes ? 'resource' : 'sub_ouvrage', childRes, childOuv, ratio: comp.ratio });
          composants++;
        }
      }

      // Débours = Σ ratio × débours(composant), récursif sur les sous-ouvrages.
      const cache = new Map<string, number>();
      const debours = (id: string, seen = new Set<string>()): number => {
        if (cache.has(id)) return cache.get(id)!;
        if (seen.has(id)) return 0;
        seen.add(id);
        let sum = 0;
        for (const k of compByOuv.get(id) ?? []) {
          sum += k.ratio * (k.kind === 'resource' ? (costById.get(k.childRes!) ?? 0) : debours(k.childOuv!, new Set(seen)));
        }
        cache.set(id, sum);
        return sum;
      };
      for (const id of ouvByCode.values()) {
        await em.query(`UPDATE ouvrage SET debourse=$2, updated_at=now() WHERE id=$1`, [id, debours(id).toFixed(4)]);
      }

      return {
        libraryId,
        libraryCode: code,
        stats: { resources: parsed.resources.length, ouvrages: parsed.ouvrages.length, composants, ignores },
      };
    });
  }

  private async uniqueAffaireCode(em: EntityManager, tenantId: string, base: string): Promise<string> {
    const clean = (base || 'IMPORT').slice(0, 60);
    const exists = async (c: string) =>
      (await em.query(`SELECT 1 FROM affaire WHERE tenant_id=$1 AND code=$2 LIMIT 1`, [tenantId, c])).length > 0;
    if (!(await exists(clean))) return clean;
    for (let i = 2; i < 1000; i++) {
      const c = `${clean}-${i}`;
      if (!(await exists(c))) return c;
    }
    return `${clean}-${Date.now()}`;
  }

  private async upsertClient(em: EntityManager, tenantId: string, name: string): Promise<string | null> {
    const found = await em.query(
      `SELECT id FROM client WHERE tenant_id=$1 AND name=$2 LIMIT 1`,
      [tenantId, name],
    );
    if (found.length) return found[0].id;
    const code = name.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'CLIENT';
    const uniqueCode = await this.uniqueClientCode(em, tenantId, code);
    const inserted = await em.query(
      `INSERT INTO client (tenant_id, code, name) VALUES ($1,$2,$3) RETURNING id`,
      [tenantId, uniqueCode, name.slice(0, 255)],
    );
    return inserted[0].id;
  }

  private async uniqueClientCode(em: EntityManager, tenantId: string, base: string): Promise<string> {
    const exists = async (c: string) =>
      (await em.query(`SELECT 1 FROM client WHERE tenant_id=$1 AND code=$2 LIMIT 1`, [tenantId, c])).length > 0;
    if (!(await exists(base))) return base;
    for (let i = 2; i < 1000; i++) if (!(await exists(`${base}-${i}`))) return `${base}-${i}`;
    return `${base}-${Date.now()}`;
  }
}

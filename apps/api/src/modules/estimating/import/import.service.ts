import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { TenantContext } from '../../../core/tenancy/tenant-context';
import { runInTenant } from '../../../core/tenancy/tenant-transaction';
import { parseDpgfExcel, parseDpgfXml, ParsedDevis } from './dpgf-parser';

export type DpgfFormat = 'xml' | 'excel';

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

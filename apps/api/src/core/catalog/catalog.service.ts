import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ModuleEntity } from './entities/module.entity';
import { CapabilityEntity } from './entities/capability.entity';
import { ModuleCapabilityEntity } from './entities/module-capability.entity';
import { PackEntity } from './entities/pack.entity';
import { PackModuleEntity } from './entities/pack-module.entity';
import { MODULES, PACKS } from './catalog.config';

export interface CatalogModule {
  code: string;
  label: string;
  isAddon: boolean;
  active: boolean;
  priceMonthly: number | null;
  description: string | null;
  /** Add-ons : palier minimum requis pour le souscrire (null = aucune contrainte). */
  minTierLevel: number | null;
}

export interface CatalogPack {
  code: string;
  label: string;
  /** Rang du palier : 1 = entrée de gamme. */
  tierLevel: number;
  /** Prix €HT par siège et par mois (base de données — éditable par l'éditeur). */
  priceMonthly: number | null;
  discountPct: number;
  modules: string[];
  description: string | null;
}

/**
 * Read access to the global commercial catalogue. This is the data the capability guard
 * (phase 0.4) builds on: given the modules active for a tenant, which capability keys are
 * unlocked. Catalogue tables are global (no RLS), so no tenant context is required.
 */
@Injectable()
export class CatalogService {
  constructor(
    @InjectRepository(ModuleEntity)
    private readonly modules: Repository<ModuleEntity>,
    @InjectRepository(CapabilityEntity)
    private readonly capabilities: Repository<CapabilityEntity>,
    @InjectRepository(ModuleCapabilityEntity)
    private readonly moduleCapabilities: Repository<ModuleCapabilityEntity>,
    @InjectRepository(PackEntity)
    private readonly packs: Repository<PackEntity>,
    @InjectRepository(PackModuleEntity)
    private readonly packModules: Repository<PackModuleEntity>,
  ) {}

  listModules(): Promise<ModuleEntity[]> {
    return this.modules.find({ order: { code: 'ASC' } });
  }

  /**
   * Commercial catalogue for the subscription console. Prices come from the database (editable
   * from the editor back-office, never hard-coded); the marketing description stays in
   * catalog.config.ts as static copy.
   */
  async getCatalogModules(): Promise<CatalogModule[]> {
    const dbModules = await this.modules.find({ order: { code: 'ASC' } });
    const byCode = new Map(MODULES.map((m) => [m.code, m]));
    return dbModules.map((m) => ({
      code: m.code,
      label: m.label,
      isAddon: m.isAddon,
      active: m.active,
      priceMonthly: m.priceMonthly === null ? null : Number(m.priceMonthly),
      description: byCode.get(m.code)?.description ?? null,
      minTierLevel: m.minTierLevel === null ? null : Number(m.minTierLevel),
    }));
  }

  /** Price €HT per seat/month by module code, from the database. Used for MRR and quotes. */
  async getPriceByModuleCode(): Promise<Map<string, number>> {
    const rows = await this.modules.find({ order: { code: 'ASC' } });
    return new Map(
      rows.map((m) => [m.code, m.priceMonthly === null ? 0 : Number(m.priceMonthly)]),
    );
  }

  /**
   * Editor back-office: updates a module's commercial attributes. Only the fields provided are
   * changed. `priceMonthly: null` means "sur devis".
   */
  async updateModule(
    code: string,
    patch: {
      priceMonthly?: number | null;
      label?: string;
      active?: boolean;
      minTierLevel?: number | null;
    },
  ): Promise<CatalogModule | null> {
    const module = await this.modules.findOne({ where: { code } });
    if (!module) {
      return null;
    }
    if (patch.priceMonthly !== undefined) {
      module.priceMonthly = patch.priceMonthly === null ? null : String(patch.priceMonthly);
    }
    if (patch.label !== undefined) {
      module.label = patch.label;
    }
    if (patch.active !== undefined) {
      module.active = patch.active;
    }
    if (patch.minTierLevel !== undefined) {
      module.minTierLevel = patch.minTierLevel;
    }
    await this.modules.save(module);
    const all = await this.getCatalogModules();
    return all.find((m) => m.code === code) ?? null;
  }

  /**
   * Back-office éditeur : ajuste le prix (ou le libellé / l'activation) d'un palier.
   * Effet immédiat sur les devis, l'inscription et le MRR — sans redéploiement.
   */
  async updatePack(
    code: string,
    patch: { priceMonthly?: number | null; label?: string; active?: boolean },
  ): Promise<CatalogPack | null> {
    const pack = await this.packs.findOne({ where: { code } });
    if (!pack) {
      return null;
    }
    if (patch.priceMonthly !== undefined) {
      pack.priceMonthly = patch.priceMonthly === null ? null : String(patch.priceMonthly);
    }
    if (patch.label !== undefined) {
      pack.label = patch.label;
    }
    if (patch.active !== undefined) {
      pack.active = patch.active;
    }
    await this.packs.save(pack);
    const all = await this.getCatalogPacks();
    return all.find((p) => p.code === code) ?? null;
  }

  /**
   * Paliers commerciaux, du plus simple au plus complet. Prix et rang viennent de la base
   * (éditables) ; le descriptif marketing reste en configuration.
   */
  async getCatalogPacks(): Promise<CatalogPack[]> {
    const rows: Array<{
      code: string;
      label: string;
      tier_level: number;
      price_monthly: string | null;
      discount_pct: string;
      modules: string[];
    }> = await this.packs.query(
      `SELECT p.code, p.label, p.tier_level, p.price_monthly, p.discount_pct,
              COALESCE(array_agg(m.code ORDER BY m.code) FILTER (WHERE m.code IS NOT NULL), '{}') AS modules
         FROM pack p
         LEFT JOIN pack_module pm ON pm.pack_id = p.id
         LEFT JOIN module m ON m.id = pm.module_id
        WHERE p.active = true
        GROUP BY p.code, p.label, p.tier_level, p.price_monthly, p.discount_pct
        ORDER BY p.tier_level`,
    );
    const byCode = new Map(PACKS.map((p) => [p.code, p]));
    return rows.map((r) => ({
      code: r.code,
      label: r.label,
      tierLevel: Number(r.tier_level),
      priceMonthly: r.price_monthly === null ? null : Number(r.price_monthly),
      discountPct: Number(r.discount_pct),
      modules: r.modules,
      description: byCode.get(r.code)?.description ?? null,
    }));
  }

  listCapabilities(): Promise<CapabilityEntity[]> {
    return this.capabilities.find({ order: { key: 'ASC' } });
  }

  /** Capability keys unlocked by the given (active) module codes. */
  async getCapabilityKeysForModuleCodes(
    moduleCodes: string[],
  ): Promise<Set<string>> {
    if (moduleCodes.length === 0) {
      return new Set();
    }
    const rows = await this.moduleCapabilities
      .createQueryBuilder('mc')
      .innerJoin(ModuleEntity, 'm', 'm.id = mc.module_id')
      .innerJoin(CapabilityEntity, 'c', 'c.id = mc.capability_id')
      .select('c.key', 'key')
      .where('m.code IN (:...moduleCodes)', { moduleCodes })
      .andWhere('m.active = true')
      .getRawMany<{ key: string }>();
    return new Set(rows.map((r) => r.key));
  }

  /** Active module codes that unlock a given capability key (reverse mapping). */
  async getModuleCodesForCapability(capabilityKey: string): Promise<string[]> {
    const rows = await this.moduleCapabilities
      .createQueryBuilder('mc')
      .innerJoin(ModuleEntity, 'm', 'm.id = mc.module_id')
      .innerJoin(CapabilityEntity, 'c', 'c.id = mc.capability_id')
      .select('m.code', 'code')
      .where('c.key = :capabilityKey', { capabilityKey })
      .andWhere('m.active = true')
      .getRawMany<{ code: string }>();
    return rows.map((r) => r.code);
  }

  /** Module codes bundled by a pack. */
  async getModuleCodesForPack(packCode: string): Promise<string[]> {
    const rows = await this.packModules
      .createQueryBuilder('pm')
      .innerJoin(PackEntity, 'p', 'p.id = pm.pack_id')
      .innerJoin(ModuleEntity, 'm', 'm.id = pm.module_id')
      .select('m.code', 'code')
      .where('p.code = :packCode', { packCode })
      .orderBy('m.code', 'ASC')
      .getRawMany<{ code: string }>();
    return rows.map((r) => r.code);
  }
}

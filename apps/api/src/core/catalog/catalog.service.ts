import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ModuleEntity } from './entities/module.entity';
import { CapabilityEntity } from './entities/capability.entity';
import { ModuleCapabilityEntity } from './entities/module-capability.entity';
import { PackEntity } from './entities/pack.entity';
import { PackModuleEntity } from './entities/pack-module.entity';

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

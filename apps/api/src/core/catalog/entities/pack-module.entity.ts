import { Entity, PrimaryColumn } from 'typeorm';

/** Join table: which modules a pack bundles (reconfigurable packaging). */
@Entity('pack_module')
export class PackModuleEntity {
  @PrimaryColumn({ name: 'pack_id', type: 'uuid' })
  packId!: string;

  @PrimaryColumn({ name: 'module_id', type: 'uuid' })
  moduleId!: string;
}

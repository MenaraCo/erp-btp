import { Entity, PrimaryColumn } from 'typeorm';

/** Join table: which capabilities a module unlocks (configurable mapping). */
@Entity('module_capability')
export class ModuleCapabilityEntity {
  @PrimaryColumn({ name: 'module_id', type: 'uuid' })
  moduleId!: string;

  @PrimaryColumn({ name: 'capability_id', type: 'uuid' })
  capabilityId!: string;
}

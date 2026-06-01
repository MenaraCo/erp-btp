import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../database/base.entity';

@Entity('module')
export class ModuleEntity extends BaseEntity {
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  code!: string;

  @Column({ type: 'varchar', length: 255 })
  label!: string;

  @Column({ name: 'is_addon', type: 'boolean', default: false })
  isAddon!: boolean;

  @Column({ type: 'boolean', default: true })
  active!: boolean;
}

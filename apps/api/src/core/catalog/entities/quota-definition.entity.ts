import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../database/base.entity';

@Entity('quota_definition')
export class QuotaDefinitionEntity extends BaseEntity {
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  key!: string;

  @Column({ type: 'varchar', length: 255 })
  label!: string;

  @Column({ type: 'varchar', length: 32 })
  unit!: string;
}

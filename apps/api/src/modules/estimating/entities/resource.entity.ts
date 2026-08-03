import { Column, Entity, Index, Unique } from 'typeorm';
import { BaseTenantEntity } from '../../../core/tenancy/base-tenant.entity';

export type ResourceNature = 'labor' | 'material' | 'equipment' | 'subcontract';

@Entity('resource')
@Unique(['tenantId', 'libraryId', 'code'])
@Index(['libraryId'])
export class ResourceEntity extends BaseTenantEntity {
  @Column({ name: 'library_id', type: 'uuid' })
  libraryId!: string;

  @Column({ type: 'varchar', length: 64 })
  code!: string;

  @Column({ type: 'varchar', length: 255 })
  label!: string;

  @Column({ type: 'varchar', length: 16 })
  unit!: string;

  @Column({ type: 'varchar', length: 16 })
  nature!: ResourceNature;

  /** Déboursé unitaire (direct cost). NUMERIC in DB; string in JS to preserve precision. */
  @Column({ name: 'unit_cost', type: 'numeric', precision: 14, scale: 4, default: 0 })
  unitCost!: string;

  /** Output / rendement (e.g. hours per unit for labour). */
  @Column({ type: 'numeric', precision: 14, scale: 6, nullable: true })
  output?: string | null;

  /** Code produit unique par société (cahier §5.1) — identifie l'article dans tout le tenant. */
  @Column({ name: 'code_produit', type: 'varchar', length: 64, nullable: true })
  codeProduit?: string | null;

  /**
   * Type de déboursé de l'entreprise (« ST Moyens », « Location »…). Il porte les % FG et bénéfice
   * du chiffrage ; sa nature de rattachement, elle, reste `nature` ci-dessus — c'est elle qui
   * alimente budgets de chantier, analytique et compta. Nullable : la ressource suit alors sa
   * seule nature.
   */
  @Column({ name: 'debourse_type_id', type: 'uuid', nullable: true })
  debourseTypeId?: string | null;

  /**
   * Rattachement au plan analytique (cahier §5.8) : la ressource appartient à exactement un
   * code analytique (→ famille → lot → nature). Nullable : classement au rythme du tenant.
   */
  @Column({ name: 'code_analytique_id', type: 'uuid', nullable: true })
  codeAnalytiqueId?: string | null;

  /** Prix catalogue, exprimé dans l'unité d'ACHAT. */
  @Column({ name: 'prix_public', type: 'numeric', precision: 14, scale: 4, nullable: true })
  prixPublic?: string | null;

  /** Unité d'achat (ex. palette, sac). */
  @Column({ name: 'unite_achat', type: 'varchar', length: 16, nullable: true })
  uniteAchat?: string | null;

  /** 1 unité d'achat = coeff unités d'emploi (déboursé = prix_public / coeff). */
  @Column({ name: 'coeff_conversion', type: 'numeric', precision: 14, scale: 6, default: 1 })
  coeffConversion!: string;

  @Column({ name: 'supplier_id', type: 'uuid', nullable: true })
  supplierId?: string | null;

  @Column({ name: 'ref_fournisseur', type: 'varchar', length: 128, nullable: true })
  refFournisseur?: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  conditionnement?: string | null;
}

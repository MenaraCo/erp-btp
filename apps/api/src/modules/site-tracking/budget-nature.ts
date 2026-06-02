/** Budget natures for chantier control (cahier des charges §5.8). */
export type BudgetNature =
  | 'labor'
  | 'material'
  | 'equipment'
  | 'subcontract'
  | 'site_overhead';

export const BUDGET_NATURES: BudgetNature[] = [
  'labor',
  'material',
  'equipment',
  'subcontract',
  'site_overhead',
];

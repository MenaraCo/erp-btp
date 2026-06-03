import { aggregateAnalytical, AnalyticalPlanNode, MeasureRow } from './analytical-aggregate';

/**
 * Pure ascending aggregation along the analytical axis (cahier des charges §5.8):
 * ressource/famille → lot → nature → total. Single responsibility: sum metrics up the tree.
 * Indicators (écart, EAC…) are the formula engine's job (B.2), not this helper's.
 */
const PLAN: AnalyticalPlanNode[] = [
  {
    nature: 'material',
    label: 'Matériaux',
    lots: [
      {
        id: 'lot-sol',
        code: 'MAT-SOL',
        label: 'Sols durs',
        familles: [
          { id: 'fam-col', code: 'MAT-SOL-COL', label: 'Colles' },
          { id: 'fam-car', code: 'MAT-SOL-CAR', label: 'Carrelage' },
        ],
      },
    ],
  },
  {
    nature: 'labor',
    label: "Main d'œuvre",
    lots: [
      {
        id: 'lot-mo',
        code: 'MO-PROD',
        label: 'Production',
        familles: [{ id: 'fam-mac', code: 'MO-PROD-MAC', label: 'Maçons' }],
      },
    ],
  },
];

describe('aggregateAnalytical — agrégation ascendante ressource→famille→lot→nature', () => {
  it('somme les mesures au niveau famille puis remonte lot → nature → total', () => {
    const rows: MeasureRow[] = [
      { familleId: 'fam-col', nature: 'material', metrics: { budgetObjectif: '100', engage: '40' } },
      { familleId: 'fam-car', nature: 'material', metrics: { budgetObjectif: '300', engage: '50' } },
      { familleId: 'fam-mac', nature: 'labor', metrics: { budgetObjectif: '200', engage: '120' } },
    ];
    const tree = aggregateAnalytical(PLAN, rows);

    const material = tree.natures.find((n) => n.nature === 'material')!;
    const sols = material.lots.find((l) => l.id === 'lot-sol')!;
    const colles = sols.familles.find((f) => f.id === 'fam-col')!;

    expect(colles.metrics.budgetObjectif).toBe('100');
    expect(colles.metrics.engage).toBe('40');
    // lot = somme des familles
    expect(sols.metrics.budgetObjectif).toBe('400');
    expect(sols.metrics.engage).toBe('90');
    // nature = somme des lots
    expect(material.metrics.budgetObjectif).toBe('400');
    // total général = somme des natures
    expect(tree.total.budgetObjectif).toBe('600');
    expect(tree.total.engage).toBe('210');
  });

  it('agrège plusieurs lignes sur une même famille', () => {
    const rows: MeasureRow[] = [
      { familleId: 'fam-col', nature: 'material', metrics: { realise: '10.5' } },
      { familleId: 'fam-col', nature: 'material', metrics: { realise: '4.25' } },
    ];
    const tree = aggregateAnalytical(PLAN, rows);
    const colles = tree.natures
      .find((n) => n.nature === 'material')!
      .lots.find((l) => l.id === 'lot-sol')!
      .familles.find((f) => f.id === 'fam-col')!;
    expect(colles.metrics.realise).toBe('14.75');
  });

  it('place les mesures sans famille dans un seau « Non réparti » sous leur nature, sans fausser les totaux', () => {
    const rows: MeasureRow[] = [
      { familleId: null, nature: 'material', metrics: { engage: '70' } },
      { familleId: 'fam-col', nature: 'material', metrics: { engage: '30' } },
    ];
    const tree = aggregateAnalytical(PLAN, rows);
    const material = tree.natures.find((n) => n.nature === 'material')!;
    expect(material.unallocated.engage).toBe('70');
    // le total de la nature inclut le réparti ET le non réparti
    expect(material.metrics.engage).toBe('100');
    expect(tree.total.engage).toBe('100');
  });

  it('ignore les familles inconnues du plan en les rattachant au non-réparti de leur nature', () => {
    const rows: MeasureRow[] = [
      { familleId: 'fam-inexistante', nature: 'labor', metrics: { realise: '55' } },
    ];
    const tree = aggregateAnalytical(PLAN, rows);
    const labor = tree.natures.find((n) => n.nature === 'labor')!;
    expect(labor.unallocated.realise).toBe('55');
    expect(labor.metrics.realise).toBe('55');
  });

  it('présente toutes les natures du plan même sans mesure (métriques à 0)', () => {
    const tree = aggregateAnalytical(PLAN, [], ['budgetObjectif', 'engage']);
    expect(tree.natures.map((n) => n.nature)).toEqual(['material', 'labor']);
    expect(tree.natures[0].metrics.budgetObjectif).toBe('0');
    expect(tree.total.engage).toBe('0');
  });
});

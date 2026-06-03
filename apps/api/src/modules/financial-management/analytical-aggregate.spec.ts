import { aggregateAnalytical, AnalyticalPlanNode, MeasureRow } from './analytical-aggregate';

/**
 * Pure ascending aggregation along the analytical axis (cahier des charges §5.8): mesure →
 * code analytique → famille → lot → nature → total. Single responsibility: sum metrics up the
 * tree. Indicators (écart, EAC…) are the formula engine's job, not this helper's.
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
          {
            id: 'fam-col',
            code: 'COL',
            label: 'Colles',
            codes: [
              { id: 'c-280', code: '280', label: 'Colle' },
              { id: 'c-281', code: '281', label: 'Colle PU' },
            ],
          },
          { id: 'fam-car', code: 'CAR', label: 'Carrelage', codes: [{ id: 'c-290', code: '290', label: 'Carrelage' }] },
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
        familles: [{ id: 'fam-mac', code: 'MAC', label: 'Maçons', codes: [{ id: 'c-500', code: '500', label: 'MO maçonnerie' }] }],
      },
    ],
  },
];

describe('aggregateAnalytical — agrégation ascendante code analytique→famille→lot→nature', () => {
  it('somme au code analytique puis remonte famille → lot → nature → total', () => {
    const rows: MeasureRow[] = [
      { codeId: 'c-280', nature: 'material', metrics: { budgetObjectif: '100', engage: '40' } },
      { codeId: 'c-281', nature: 'material', metrics: { budgetObjectif: '50' } },
      { codeId: 'c-290', nature: 'material', metrics: { budgetObjectif: '300', engage: '50' } },
      { codeId: 'c-500', nature: 'labor', metrics: { budgetObjectif: '200', engage: '120' } },
    ];
    const tree = aggregateAnalytical(PLAN, rows);
    const material = tree.natures.find((n) => n.nature === 'material')!;
    const sols = material.lots.find((l) => l.id === 'lot-sol')!;
    const colles = sols.familles.find((f) => f.id === 'fam-col')!;
    const code280 = colles.codes.find((c) => c.id === 'c-280')!;

    expect(code280.metrics.budgetObjectif).toBe('100');
    expect(code280.metrics.engage).toBe('40');
    // famille = somme de ses codes analytiques
    expect(colles.metrics.budgetObjectif).toBe('150'); // 100 + 50
    // lot = somme des familles
    expect(sols.metrics.budgetObjectif).toBe('450'); // 150 + 300
    // nature = somme des lots
    expect(material.metrics.budgetObjectif).toBe('450');
    // total = somme des natures
    expect(tree.total.budgetObjectif).toBe('650'); // 450 + 200
    expect(tree.total.engage).toBe('210'); // 40 + 50 + 120
  });

  it('agrège plusieurs lignes sur le même code analytique', () => {
    const rows: MeasureRow[] = [
      { codeId: 'c-280', nature: 'material', metrics: { realise: '10.5' } },
      { codeId: 'c-280', nature: 'material', metrics: { realise: '4.25' } },
    ];
    const tree = aggregateAnalytical(PLAN, rows);
    const code = tree.natures[0].lots[0].familles[0].codes.find((c) => c.id === 'c-280')!;
    expect(code.metrics.realise).toBe('14.75');
  });

  it('place les mesures sans code dans « Non réparti » sous leur nature, sans fausser les totaux', () => {
    const rows: MeasureRow[] = [
      { codeId: null, nature: 'material', metrics: { engage: '70' } },
      { codeId: 'c-280', nature: 'material', metrics: { engage: '30' } },
    ];
    const tree = aggregateAnalytical(PLAN, rows);
    const material = tree.natures.find((n) => n.nature === 'material')!;
    expect(material.unallocated.engage).toBe('70');
    expect(material.metrics.engage).toBe('100'); // réparti (30) + non réparti (70)
    expect(tree.total.engage).toBe('100');
  });

  it('rattache un code inconnu du plan au non-réparti de sa nature', () => {
    const tree = aggregateAnalytical(PLAN, [
      { codeId: 'c-inconnu', nature: 'labor', metrics: { realise: '55' } },
    ]);
    const labor = tree.natures.find((n) => n.nature === 'labor')!;
    expect(labor.unallocated.realise).toBe('55');
    expect(labor.metrics.realise).toBe('55');
  });

  it('présente tout le plan même sans mesure (métriques à 0)', () => {
    const tree = aggregateAnalytical(PLAN, [], ['budgetObjectif', 'engage']);
    expect(tree.natures.map((n) => n.nature)).toEqual(['material', 'labor']);
    expect(tree.natures[0].lots[0].familles[0].codes[0].metrics.budgetObjectif).toBe('0');
    expect(tree.total.engage).toBe('0');
  });
});

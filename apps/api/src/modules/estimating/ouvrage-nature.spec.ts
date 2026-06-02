import { CalcOuvrage, computeNatureBreakdownMap, NATURES } from './ouvrage-calc';

describe('ouvrage-calc — décomposition par nature', () => {
  it('répartit ressources par nature et alloue le % prorata', () => {
    const o: CalcOuvrage = {
      id: 'O',
      components: [
        { kind: 'resource', nature: 'material', quantity: '1', unitCost: '200' }, // 200
        { kind: 'resource', nature: 'labor', quantity: '1', unitCost: '100' }, // 100
        { kind: 'percentage', rate: '0.1' }, // +10% prorata
      ],
    };
    const b = computeNatureBreakdownMap(new Map([['O', o]])).get('O')!;
    expect(b.material.toString()).toBe('220'); // 200 + 10%
    expect(b.labor.toString()).toBe('110'); // 100 + 10%
    // total breakdown = 330 = déboursé sec (300 + 10%)
    const total = NATURES.reduce((s, n) => s.plus(b[n]), b.equipment.times(0));
    expect(total.toString()).toBe('330');
  });

  it('agrège les sous-ouvrages par nature', () => {
    const child: CalcOuvrage = {
      id: 'C',
      components: [{ kind: 'resource', nature: 'labor', quantity: '2', unitCost: '50' }], // 100 labor
    };
    const parent: CalcOuvrage = {
      id: 'P',
      components: [
        { kind: 'sub_ouvrage', childOuvrageId: 'C', quantity: '3' }, // 300 labor
        { kind: 'resource', nature: 'material', quantity: '1', unitCost: '40' }, // 40 material
      ],
    };
    const b = computeNatureBreakdownMap(
      new Map([
        ['C', child],
        ['P', parent],
      ]),
    ).get('P')!;
    expect(b.labor.toString()).toBe('300');
    expect(b.material.toString()).toBe('40');
  });
});

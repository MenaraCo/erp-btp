import { flattenOuvrageToResources, RawOuvrage } from './ouvrage-flatten';

describe('ouvrage-flatten — copie du sous-détail en ressources', () => {
  it('aplatit ressources directes + sous-ouvrage + pourcentage (quantités par unité)', () => {
    const byId = new Map<string, RawOuvrage>([
      [
        'SUB',
        {
          id: 'SUB',
          components: [
            { kind: 'resource', resourceId: 'r1', designation: 'Sable', nature: 'material', unit: 'kg', unitCost: '2', quantity: '3' },
          ],
        },
      ],
      [
        'OUV',
        {
          id: 'OUV',
          components: [
            { kind: 'resource', resourceId: 'mo', designation: 'Maçon', nature: 'labor', unit: 'h', unitCost: '40', quantity: '2' },
            { kind: 'sub_ouvrage', childOuvrageId: 'SUB', quantity: '4' }, // 4 × (3 kg sable @2)
            { kind: 'percentage', rate: '0.05' }, // 5 % sur la base
          ],
        },
      ],
    ]);

    const flat = flattenOuvrageToResources('OUV', byId);
    // base = 2×40 (MO=80) + 4×3×2 (sable=24) = 104 ; % = 5 % × 104 = 5.2
    const mo = flat.find((f) => f.resourceId === 'mo')!;
    expect(mo.nature).toBe('labor');
    expect(mo.qtyPerUnit).toBe('2');
    expect(mo.unitCost).toBe('40');

    const sable = flat.find((f) => f.resourceId === 'r1')!;
    expect(sable.qtyPerUnit).toBe('12'); // 3 × 4
    expect(sable.unitCost).toBe('2');

    const frais = flat.find((f) => f.resourceId === null)!;
    expect(frais.designation).toBe('Frais (5 %)');
    expect(frais.unitCost).toBe('5.2'); // 104 × 0.05
    expect(frais.qtyPerUnit).toBe('1');

    // déboursé unitaire reconstitué = Σ qty×cost = 80 + 24 + 5.2 = 109.2
    const total = flat.reduce((s, f) => s + Number(f.qtyPerUnit) * Number(f.unitCost), 0);
    expect(total).toBeCloseTo(109.2, 4);
  });
});

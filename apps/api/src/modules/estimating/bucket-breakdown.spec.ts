import Decimal from 'decimal.js';
import {
  computeBucketBreakdownMap,
  UNALLOCATED_BUCKET,
} from './bucket-breakdown';
import { CalcOuvrage } from './ouvrage-calc';

/**
 * Generic ascending breakdown keyed by an arbitrary bucket (here: analytical famille), mirroring
 * computeNatureBreakdownMap but with dynamic keys. Used to break the chantier déboursé down by
 * famille for the analytical axis (cahier des charges §5.8).
 */
describe('computeBucketBreakdownMap — déboursé ventilé par bucket (famille)', () => {
  it('somme les ressources par bucket', () => {
    const map = new Map<string, CalcOuvrage>([
      [
        'O',
        {
          id: 'O',
          components: [
            { kind: 'resource', quantity: 2, unitCost: 10, bucket: 'fam-a' },
            { kind: 'resource', quantity: 1, unitCost: 30, bucket: 'fam-b' },
            { kind: 'resource', quantity: 3, unitCost: 5, bucket: 'fam-a' },
          ],
        },
      ],
    ]);
    const res = computeBucketBreakdownMap(map).get('O')!;
    expect(res['fam-a'].toString()).toBe('35'); // 2*10 + 3*5
    expect(res['fam-b'].toString()).toBe('30');
  });

  it('cascade les sous-ouvrages en conservant les buckets', () => {
    const map = new Map<string, CalcOuvrage>([
      ['child', { id: 'child', components: [{ kind: 'resource', quantity: 1, unitCost: 100, bucket: 'fam-a' }] }],
      [
        'parent',
        {
          id: 'parent',
          components: [
            { kind: 'sub_ouvrage', quantity: 2, childOuvrageId: 'child' },
            { kind: 'resource', quantity: 1, unitCost: 50, bucket: 'fam-b' },
          ],
        },
      ],
    ]);
    const res = computeBucketBreakdownMap(map).get('parent')!;
    expect(res['fam-a'].toString()).toBe('200'); // 2 * 100
    expect(res['fam-b'].toString()).toBe('50');
  });

  it('ventile les pourcentages au prorata des buckets de l’assiette', () => {
    const map = new Map<string, CalcOuvrage>([
      [
        'O',
        {
          id: 'O',
          components: [
            { kind: 'resource', quantity: 1, unitCost: 100, bucket: 'fam-a' },
            { kind: 'resource', quantity: 1, unitCost: 100, bucket: 'fam-b' },
            { kind: 'percentage', rate: 0.1 },
          ],
        },
      ],
    ]);
    const res = computeBucketBreakdownMap(map).get('O')!;
    // 10% réparti pro rata : chaque bucket 100 -> 110
    expect(res['fam-a'].toString()).toBe('110');
    expect(res['fam-b'].toString()).toBe('110');
  });

  it('range les ressources sans bucket dans le seau « non réparti »', () => {
    const map = new Map<string, CalcOuvrage>([
      ['O', { id: 'O', components: [{ kind: 'resource', quantity: 2, unitCost: 25 }] }],
    ]);
    const res = computeBucketBreakdownMap(map).get('O')!;
    expect(res[UNALLOCATED_BUCKET].toString()).toBe('50');
  });

  it('le total par bucket égale le déboursé total (cohérence avec l’axe structurel)', () => {
    const map = new Map<string, CalcOuvrage>([
      [
        'O',
        {
          id: 'O',
          components: [
            { kind: 'resource', quantity: 2, unitCost: 10, bucket: 'fam-a' },
            { kind: 'resource', quantity: 1, unitCost: 30, bucket: 'fam-b' },
            { kind: 'percentage', rate: 0.2 },
          ],
        },
      ],
    ]);
    const res = computeBucketBreakdownMap(map).get('O')!;
    const total = Object.values(res).reduce((a, v) => a.plus(v), new Decimal(0));
    expect(total.toString()).toBe('60'); // (20 + 30) * 1.2
  });
});

import Decimal from 'decimal.js';
import {
  CalcOuvrage,
  CycleDetectedError,
  computeDebourse,
  computeDebourseMap,
  roundDebourse,
} from './ouvrage-calc';

function mapOf(...ouvrages: CalcOuvrage[]): Map<string, CalcOuvrage> {
  return new Map(ouvrages.map((o) => [o.id, o]));
}

describe('ouvrage-calc — déboursé sec', () => {
  it('agrège ressources et pourcentage (assiette = composants non-%)', () => {
    const semelle: CalcOuvrage = {
      id: 'SEMELLE',
      components: [
        { kind: 'resource', quantity: '1.05', unitCost: '120.0000' }, // 126
        { kind: 'resource', quantity: '2.5', unitCost: '38.5000' }, // 96.25
        { kind: 'percentage', rate: '0.03' }, // 3% de 222.25 = 6.6675
      ],
    };
    const result = computeDebourse('SEMELLE', mapOf(semelle));
    expect(result.toString()).toBe('228.9175');
  });

  it('calcule un ouvrage imbriqué (sous-ouvrage récursif)', () => {
    const semelle: CalcOuvrage = {
      id: 'SEMELLE',
      components: [
        { kind: 'resource', quantity: '1.05', unitCost: '120' },
        { kind: 'resource', quantity: '2.5', unitCost: '38.5' },
        { kind: 'percentage', rate: '0.03' },
      ],
    };
    const fondation: CalcOuvrage = {
      id: 'FONDATION',
      components: [
        { kind: 'sub_ouvrage', childOuvrageId: 'SEMELLE', quantity: '4' },
        { kind: 'resource', quantity: '3', unitCost: '38.5' }, // 115.5
      ],
    };
    const map = computeDebourseMap(mapOf(semelle, fondation));
    expect(map.get('SEMELLE')!.toString()).toBe('228.9175');
    expect(map.get('FONDATION')!.toString()).toBe('1031.17'); // 4*228.9175 + 115.5
  });

  it('recalcule ascendant quand le prix d’une ressource change', () => {
    // recalcul_ouvrage_compose_quand_prix_ressource_change
    const build = (moCost: string) =>
      mapOf(
        {
          id: 'SEMELLE',
          components: [
            { kind: 'resource', quantity: '1.05', unitCost: '120' },
            { kind: 'resource', quantity: '2.5', unitCost: moCost },
            { kind: 'percentage', rate: '0.03' },
          ],
        },
        {
          id: 'FONDATION',
          components: [
            { kind: 'sub_ouvrage', childOuvrageId: 'SEMELLE', quantity: '4' },
            { kind: 'resource', quantity: '3', unitCost: moCost },
          ],
        },
      );

    const before = computeDebourseMap(build('38.5'));
    expect(before.get('FONDATION')!.toString()).toBe('1031.17');

    // MO 38.5 -> 42 : SEMELLE = 237.93, FONDATION = 4*237.93 + 126 = 1077.72
    const after = computeDebourseMap(build('42'));
    expect(after.get('SEMELLE')!.toString()).toBe('237.93');
    expect(after.get('FONDATION')!.toString()).toBe('1077.72');
  });

  it('ouvrage vide -> déboursé 0', () => {
    expect(computeDebourse('E', mapOf({ id: 'E', components: [] })).toString()).toBe('0');
  });

  it('pourcentage seul (sans autre composant) -> assiette 0', () => {
    const o: CalcOuvrage = { id: 'P', components: [{ kind: 'percentage', rate: '0.1' }] };
    expect(computeDebourse('P', mapOf(o)).toString()).toBe('0');
  });

  it('detection_cycle', () => {
    const a: CalcOuvrage = {
      id: 'A',
      components: [{ kind: 'sub_ouvrage', childOuvrageId: 'B', quantity: '1' }],
    };
    const b: CalcOuvrage = {
      id: 'B',
      components: [{ kind: 'sub_ouvrage', childOuvrageId: 'A', quantity: '1' }],
    };
    expect(() => computeDebourseMap(mapOf(a, b))).toThrow(CycleDetectedError);
  });

  it('roundDebourse arrondit à 4 décimales (half-up)', () => {
    expect(roundDebourse(new Decimal('1.234565')).toString()).toBe('1.2346');
    expect(roundDebourse(new Decimal('228.9175')).toString()).toBe('228.9175');
  });
});

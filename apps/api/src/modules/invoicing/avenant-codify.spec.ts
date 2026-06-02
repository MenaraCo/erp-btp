import { recodifyForAvenant } from './avenant-codify';

describe('avenant-codify — recodification (rule #4)', () => {
  it('suffixe le code initial pour figer les prix', () => {
    expect(recodifyForAvenant('1.1', 1)).toBe('1.1-AV1');
    expect(recodifyForAvenant('LOT-3', 2)).toBe('LOT-3-AV2');
  });

  it('génère un code quand la ligne n’a pas de code', () => {
    expect(recodifyForAvenant(null, 1)).toBe('AV1');
    expect(recodifyForAvenant(undefined, 3)).toBe('AV3');
  });
});

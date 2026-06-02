import { formatChrono, patternHasSequence } from './chrono';

describe('chrono — montage de numérotation', () => {
  const date = new Date('2026-06-02T10:00:00Z');

  it('formate avec année et séquence zéro-paddée', () => {
    expect(formatChrono('FAC-{YYYY}-{SEQ:5}', 1, date)).toBe('FAC-2026-00001');
    expect(formatChrono('FAC-{YYYY}-{SEQ:5}', 42, date)).toBe('FAC-2026-00042');
  });

  it('gère les tokens YY / MM et SEQ sans padding', () => {
    expect(formatChrono('{YY}{MM}-{SEQ}', 7, date)).toBe('2606-7');
  });

  it('détecte la présence d’une séquence', () => {
    expect(patternHasSequence('FAC-{SEQ}')).toBe(true);
    expect(patternHasSequence('FAC-{YYYY}')).toBe(false);
  });
});

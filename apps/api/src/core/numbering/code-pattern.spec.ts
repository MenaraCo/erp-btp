import { formatCode, patternHasSequence } from './code-pattern';

describe('code-pattern — numérotation automatique paramétrable', () => {
  const d = new Date('2026-03-07T10:00:00Z');

  it('remplit la séquence complétée de zéros et l’année', () => {
    expect(formatCode('AFF-{YYYY}-{SEQ:4}', 1, d)).toBe('AFF-2026-0001');
    expect(formatCode('AFF-{YYYY}-{SEQ:4}', 42, d)).toBe('AFF-2026-0042');
  });

  it('gère tous les jetons de date', () => {
    expect(formatCode('{YY}{MM}{DD}-{SEQ}', 7, d)).toBe('260307-7');
  });

  it('accepte une séquence sans zéros de tête', () => {
    expect(formatCode('CLI{SEQ}', 128, d)).toBe('CLI128');
  });

  it('détecte l’absence de jeton de séquence (motif refusé)', () => {
    expect(patternHasSequence('AFF-{YYYY}')).toBe(false);
    expect(patternHasSequence('AFF-{YYYY}-{SEQ:4}')).toBe(true);
    expect(patternHasSequence('AFF-{YYYY}-{SEQ}')).toBe(true);
  });
});

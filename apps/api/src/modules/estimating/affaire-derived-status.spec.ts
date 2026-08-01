import { deriveAffaireStatus } from './affaire-derived-status';

describe('affaire-derived-status — statut affaire dérivé des devis', () => {
  it('affaire sans devis → en_cours', () => {
    expect(deriveAffaireStatus([])).toBe('en_cours');
  });

  it('tous les devis gagnés → gagnee', () => {
    expect(deriveAffaireStatus(['won', 'won', 'won'])).toBe('gagnee');
  });

  it('2 devis gagnés sur 3 (reste en cours) → gagnee_partielle', () => {
    expect(deriveAffaireStatus(['won', 'won', 'open'])).toBe('gagnee_partielle');
  });

  it('1 gagné, 2 perdus → gagnee_partielle', () => {
    expect(deriveAffaireStatus(['won', 'lost', 'lost'])).toBe('gagnee_partielle');
  });

  it('aucun gagné, tous perdus → perdue', () => {
    expect(deriveAffaireStatus(['lost', 'lost'])).toBe('perdue');
  });

  it('aucun gagné, au moins un en cours → en_cours', () => {
    expect(deriveAffaireStatus(['open', 'lost', 'sent'])).toBe('en_cours');
  });
});

import { ClientViewLine, visibleForClient } from './devis-client-view';

/**
 * Règle : le client ne voit pas les lignes de frais. Leur coût est déjà réparti dans les prix
 * des autres lignes — les afficher, même à zéro, annoncerait une prestation qui n'existe pas.
 */
const l = (
  id: string,
  type: string,
  parentLineId: string | null = null,
  vendable = true,
): ClientViewLine => ({ id, parentLineId, type, vendable });

describe('devis-client-view — ce que le client voit du devis', () => {
  it('masque une ligne de frais et garde les prestations vendues', () => {
    const vus = visibleForClient([
      l('t1', 'titre'),
      l('r1', 'ressource', 't1'),
      l('f1', 'ressource', 't1', false),
    ]);
    expect(vus.has('r1')).toBe(true);
    expect(vus.has('f1')).toBe(false);
    expect(vus.has('t1')).toBe(true);
  });

  it('masque un ouvrage entier marqué comme frais', () => {
    const vus = visibleForClient([
      l('t1', 'titre'),
      l('o1', 'ouvrage', 't1', false),
      l('r1', 'ressource', 'o1'), // sous-détail : jamais montré au client de toute façon
    ]);
    expect(vus.has('o1')).toBe(false);
  });

  it('masque un titre dont tout le contenu est en frais — sinon une section vide s’imprime', () => {
    const vus = visibleForClient([
      l('t1', 'titre'),
      l('f1', 'ressource', 't1', false),
      l('f2', 'ouvrage', 't1', false),
    ]);
    expect(vus.has('t1')).toBe(false);
  });

  it('garde un titre dès qu’il reste une prestation vendue, même au fond d’un sous-titre', () => {
    const vus = visibleForClient([
      l('t1', 'titre'),
      l('st1', 'sous_titre', 't1'),
      l('f1', 'ressource', 't1', false),
      l('r1', 'ressource', 'st1'),
    ]);
    expect(vus.has('t1')).toBe(true);
    expect(vus.has('st1')).toBe(true);
    expect(vus.has('r1')).toBe(true);
  });

  it('garde un titre qui ne porte qu’un texte libre : c’est une mention pour le client', () => {
    const vus = visibleForClient([
      l('t1', 'titre'),
      l('tx', 'texte', 't1'),
    ]);
    expect(vus.has('t1')).toBe(true);
    expect(vus.has('tx')).toBe(true);
  });

  it('écarte ce qui est déjà exclu du devis principal (options, variantes)', () => {
    const lines = [
      l('t1', 'titre'),
      l('r1', 'ressource', 't1'),
      l('topt', 'titre'),
      l('ropt', 'ressource', 'topt'),
    ];
    const vus = visibleForClient(lines, (x) => x.id === 'topt' || x.id === 'ropt');
    expect(vus.has('r1')).toBe(true);
    expect(vus.has('topt')).toBe(false);
    expect(vus.has('ropt')).toBe(false);
  });
});

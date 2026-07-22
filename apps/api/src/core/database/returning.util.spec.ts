import { returningRows } from './returning.util';

describe('returningRows — normalisation des résultats RETURNING', () => {
  it('extrait les lignes du couple [rows, affected] renvoyé par UPDATE/DELETE', () => {
    const updateResult = [[{ id: 'a' }, { id: 'b' }], 2];
    expect(returningRows<{ id: string }>(updateResult)).toEqual([{ id: 'a' }, { id: 'b' }]);
  });

  it('renvoie un tableau vide quand UPDATE n’a touché aucune ligne', () => {
    expect(returningRows([[], 0])).toEqual([]);
  });

  it('laisse intact le tableau de lignes renvoyé par SELECT / INSERT', () => {
    const selectResult = [{ id: 'a' }, { id: 'b' }];
    expect(returningRows<{ id: string }>(selectResult)).toEqual(selectResult);
  });

  it('laisse intact un SELECT d’une seule ligne', () => {
    expect(returningRows([{ id: 'a' }])).toEqual([{ id: 'a' }]);
  });

  it('ne confond pas un SELECT de deux lignes avec un couple [rows, affected]', () => {
    // deux objets — pas [array, number] — donc on ne déballe pas
    const twoRows = [{ id: 'a' }, { id: 'b' }];
    expect(returningRows(twoRows)).toEqual(twoRows);
  });

  it('tolère un résultat non tabulaire', () => {
    expect(returningRows(undefined)).toEqual([]);
    expect(returningRows(null)).toEqual([]);
  });
});

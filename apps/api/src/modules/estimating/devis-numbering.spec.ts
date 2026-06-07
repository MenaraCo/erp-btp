import { computeLineNumbers, NumberingLine } from './devis-numbering';

/** Helper concis pour construire des lignes. */
const L = (id: string, parent: string | null, type: string, sort: number, num_custom?: string): NumberingLine =>
  ({ id, parent_line_id: parent, type, sort_order: sort, num_custom: num_custom ?? null });

describe('computeLineNumbers (convention CHIFFRAGE)', () => {
  it('numerote_ouvrages_et_sous_titres_dans_la_meme_suite', () => {
    const lines: NumberingLine[] = [
      L('t1', null, 'titre', 0),
      L('o1', 't1', 'ouvrage', 0),
      L('o2', 't1', 'ouvrage', 1),
      L('st', 't1', 'sous_titre', 2),       // continue le compteur → 1.3
      L('o3', 'st', 'ouvrage', 0),          // 1.3.1
      L('t2', null, 'titre', 1),            // 2
    ];
    const n = computeLineNumbers(lines);
    expect(n.get('t1')).toBe('1');
    expect(n.get('o1')).toBe('1.1');
    expect(n.get('o2')).toBe('1.2');
    expect(n.get('st')).toBe('1.3');
    expect(n.get('o3')).toBe('1.3.1');
    expect(n.get('t2')).toBe('2');
  });

  it('texte_et_ressource_ne_sont_pas_numerotes_et_ne_consomment_pas_le_compteur', () => {
    const lines: NumberingLine[] = [
      L('t1', null, 'titre', 0),
      L('tx', 't1', 'texte', 0),            // pas de numéro, ne décale pas
      L('o1', 't1', 'ouvrage', 1),          // 1.1
      L('r1', 'o1', 'ressource', 0),        // sous-détail → pas de numéro
      L('o2', 't1', 'ouvrage', 2),          // 1.2
    ];
    const n = computeLineNumbers(lines);
    expect(n.has('tx')).toBe(false);
    expect(n.has('r1')).toBe(false);
    expect(n.get('o1')).toBe('1.1');
    expect(n.get('o2')).toBe('1.2');
  });

  it('num_custom_remplace_le_numero_et_sert_de_prefixe_aux_enfants', () => {
    const lines: NumberingLine[] = [
      L('t1', null, 'titre', 0, 'LOT 17'),
      L('o1', 't1', 'ouvrage', 0),          // LOT 17.1
      L('st', 't1', 'sous_titre', 1),       // LOT 17.2
      L('o2', 'st', 'ouvrage', 0),          // LOT 17.2.1
    ];
    const n = computeLineNumbers(lines);
    expect(n.get('t1')).toBe('LOT 17');
    expect(n.get('o1')).toBe('LOT 17.1');
    expect(n.get('st')).toBe('LOT 17.2');
    expect(n.get('o2')).toBe('LOT 17.2.1');
  });

  it('respecte_l_ordre_sort_order', () => {
    const lines: NumberingLine[] = [
      L('t1', null, 'titre', 5),
      L('t2', null, 'titre', 2),
      L('t3', null, 'titre', 8),
    ];
    const n = computeLineNumbers(lines);
    expect(n.get('t2')).toBe('1');
    expect(n.get('t1')).toBe('2');
    expect(n.get('t3')).toBe('3');
  });
});

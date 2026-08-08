import { normaliserNom, normaliserTva, trouverDoublon, PartyExistante } from './party-doublon';

describe('Référentiel — détection de doublons', () => {
  const existantes: PartyExistante[] = [
    { id: '1', code: 'PP', name: 'POINT P', vatNumber: 'FR 12 345678901' },
    { id: '2', code: 'SOLDIS', name: 'Soldis Distribution SARL', vatNumber: null },
    { id: '3', code: 'TOL', name: 'Tollens', vatNumber: null },
  ];

  describe('normalisation des intitulés', () => {
    it('ignore casse, accents, ponctuation et forme juridique', () => {
      expect(normaliserNom('Point-P S.A.S.')).toBe('point p');
      expect(normaliserNom('POINT P')).toBe('point p');
      expect(normaliserNom('Béton Prêt SARL')).toBe('beton pret');
    });

    it('traite les ligatures, que la décomposition Unicode ignore', () => {
      // « Gros œuvre » est l'un des mots les plus courants du métier : sans ce traitement il
      // deviendrait « gros uvre » et ne rejoindrait jamais « GROS OEUVRE ».
      expect(normaliserNom('Gros œuvre')).toBe('gros oeuvre');
      expect(normaliserNom('GROS OEUVRE')).toBe('gros oeuvre');
    });

    it("ne réduit pas à rien un intitulé qui n'est QUE sa forme juridique", () => {
      // « SARL » seul reste « sarl » : autrement deux sociétés sans nom se confondraient.
      expect(normaliserNom('SARL')).toBe('sarl');
    });

    it('rend un numéro de TVA comparable', () => {
      expect(normaliserTva('FR 12 345678901')).toBe('FR12345678901');
      expect(normaliserTva('  ')).toBeNull();
      expect(normaliserTva(null)).toBeNull();
    });
  });

  describe('recherche de doublon', () => {
    it('laisse passer une entreprise réellement nouvelle', () => {
      expect(trouverDoublon({ code: 'NEW', name: 'Matériaux du Nord' }, existantes)).toBeNull();
    });

    it('refuse un code déjà pris, même sous un autre nom', () => {
      const d = trouverDoublon({ code: 'PP', name: 'Autre chose' }, existantes);
      expect(d?.motif).toBe('code');
      expect(d?.existante.id).toBe('1');
    });

    it('reconnaît la même entreprise à son numéro de TVA', () => {
      const d = trouverDoublon(
        { code: 'PP2', name: 'Nom totalement différent', vatNumber: 'FR12345678901' },
        existantes,
      );
      expect(d?.motif).toBe('tva');
      expect(d?.existante.code).toBe('PP');
    });

    it('reconnaît « Point-P S.A.S. » comme le « POINT P » déjà présent', () => {
      const d = trouverDoublon({ code: 'PP2', name: 'Point-P S.A.S.' }, existantes);
      expect(d?.motif).toBe('nom');
      expect(d?.existante.code).toBe('PP');
      expect(d?.message).toContain('POINT P');
    });

    it('voit au travers de la forme juridique', () => {
      const d = trouverDoublon({ code: 'SOL2', name: 'SOLDIS DISTRIBUTION' }, existantes);
      expect(d?.motif).toBe('nom');
      expect(d?.existante.code).toBe('SOLDIS');
    });

    it('classe le code avant la TVA, et la TVA avant le nom', () => {
      // Candidat en conflit sur les trois : le motif le plus certain doit primer.
      const d = trouverDoublon(
        { code: 'PP', name: 'POINT P', vatNumber: 'FR12345678901' },
        existantes,
      );
      expect(d?.motif).toBe('code');
    });

    it('ne confond pas deux entreprises sans TVA aux noms distincts', () => {
      expect(trouverDoublon({ code: 'X', name: 'Tollens Peinture' }, existantes)).toBeNull();
    });
  });
});

import { compterControles, ControleContexte, ControleLine, controlerDevis } from './devis-controles';

/**
 * Le carnet de santé du devis. Chaque règle répond à un oubli qui coûte cher plus tard : une
 * ressource sans code analytique atterrit « À ventiler » au chantier, un prix à zéro se découvre
 * une fois le devis parti.
 */
const ligne = (over: Partial<ControleLine> = {}): ControleLine => ({
  id: 'l1', parentLineId: null, type: 'ressource', numero: '1.1',
  designation: 'Peinture', unit: 'M2', quantity: '10', pu: '25',
  codeAnalytique: '280', vendable: true,
  ...over,
});

const ctx = (over: Partial<ControleContexte> = {}): ControleContexte => ({
  lines: [ligne()],
  coefficientsConfigures: true,
  margeNette: 1000,
  totalPvHt: 5000,
  clientRenseigne: true,
  ...over,
});

const codes = (c: ReturnType<typeof controlerDevis>) => c.map((x) => x.code);

describe('devis-controles — contrôles de cohérence du devis', () => {
  it('ne signale rien sur un devis complet', () => {
    expect(controlerDevis(ctx())).toEqual([]);
  });

  it('signale une ressource sans code analytique, en citant la ligne', () => {
    const res = controlerDevis(ctx({ lines: [ligne({ codeAnalytique: null })] }));
    expect(codes(res)).toEqual(['code_analytique_manquant']);
    // Le message dit ce qui arrivera au chantier, pas seulement « champ vide ».
    expect(res[0].message).toContain('À ventiler');
    expect(res[0].ligne).toBe('1.1 Peinture');
    expect(res[0].lineId).toBe('l1');
  });

  it('situe une ressource par l’ouvrage qui la porte : elle n’a pas de numéro propre', () => {
    const res = controlerDevis(
      ctx({ lines: [ligne({ numero: null, parentNumero: '1.2', unit: null })] }),
    );
    expect(res[0].ligne).toBe('1.2 › Peinture');
  });

  it('signale une unité manquante', () => {
    expect(codes(controlerDevis(ctx({ lines: [ligne({ unit: '  ' })] })))).toEqual(['unite_manquante']);
  });

  it('distingue un prix vide, un prix à zéro et un prix négatif', () => {
    expect(codes(controlerDevis(ctx({ lines: [ligne({ pu: null })] })))).toEqual(['pu_manquant']);
    expect(codes(controlerDevis(ctx({ lines: [ligne({ pu: '0' })] })))).toEqual(['pu_nul']);
    const neg = controlerDevis(ctx({ lines: [ligne({ pu: '-5' })] }));
    expect(codes(neg)).toEqual(['pu_negatif']);
    expect(neg[0].niveau).toBe('bloquant'); // un prix négatif n'est jamais volontaire
  });

  it('traite la quantité de la même façon, zéro compris', () => {
    expect(codes(controlerDevis(ctx({ lines: [ligne({ quantity: null })] })))).toEqual(['quantite_manquante']);
    expect(codes(controlerDevis(ctx({ lines: [ligne({ quantity: '0' })] })))).toEqual(['quantite_nulle']);
    expect(codes(controlerDevis(ctx({ lines: [ligne({ quantity: '-2' })] })))).toEqual(['quantite_negative']);
  });

  it('signale un ouvrage sans sous-détail, mais pas celui venu de la bibliothèque', () => {
    const manuel = ligne({ type: 'ouvrage', pu: null, codeAnalytique: null });
    expect(codes(controlerDevis(ctx({ lines: [manuel] })))).toContain('ouvrage_sans_sous_detail');
    // Un ouvrage repris de la bibliothèque tient son déboursé de sa source : rien à signaler.
    const biblio = ligne({ type: 'ouvrage', pu: null, codeAnalytique: null, sourceOuvrageId: 'o1' });
    expect(codes(controlerDevis(ctx({ lines: [biblio] })))).not.toContain('ouvrage_sans_sous_detail');
    // Ni un ouvrage vendu à PRIX FORCÉ : bordereau repris tel quel, le sous-détail n'existe pas.
    const forfait = ligne({ type: 'ouvrage', pu: null, codeAnalytique: null, puVenteForce: true });
    expect(codes(controlerDevis(ctx({ lines: [forfait] })))).not.toContain('ouvrage_sans_sous_detail');
  });

  it('n’exige ni prix ni code analytique sur un titre, mais signale un titre vide', () => {
    const titre = ligne({ id: 't1', type: 'titre', unit: null, quantity: null, pu: null, codeAnalytique: null });
    expect(codes(controlerDevis(ctx({ lines: [titre] })))).toEqual(['devis_vide', 'titre_vide']);
  });

  it('ne compte pas comme chiffrable un devis qui n’a que des titres', () => {
    const titre = ligne({ id: 't1', type: 'titre', unit: null, quantity: null, pu: null, codeAnalytique: null });
    const enfant = ligne({ id: 'r1', parentLineId: 't1' });
    expect(codes(controlerDevis(ctx({ lines: [titre, enfant] })))).toEqual([]);
  });

  it('signale une feuille de vente non configurée, une marge négative, un total nul', () => {
    expect(codes(controlerDevis(ctx({ coefficientsConfigures: false })))).toContain('coefficients_absents');
    expect(codes(controlerDevis(ctx({ margeNette: -10 })))).toContain('marge_negative');
    expect(codes(controlerDevis(ctx({ margeNette: 0 })))).toContain('marge_nulle');
    expect(codes(controlerDevis(ctx({ totalPvHt: 0 })))).toContain('total_nul');
  });

  it('signale l’absence de client : le devis ne peut être adressé à personne', () => {
    expect(codes(controlerDevis(ctx({ clientRenseigne: false })))).toContain('client_absent');
  });

  it('compte les contrôles par niveau, pour la pastille de l’écran', () => {
    const res = controlerDevis(
      ctx({ lines: [ligne({ pu: '-5', unit: null })], clientRenseigne: false }),
    );
    const n = compterControles(res);
    expect(n.bloquant).toBe(1); // prix négatif
    expect(n.avertissement).toBe(2); // unité manquante + client absent
  });
});

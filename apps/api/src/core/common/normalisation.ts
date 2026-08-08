/**
 * Formes comparables des chaînes saisies par les utilisateurs.
 *
 * Deux personnes qui désignent la même chose ne l'écrivent jamais pareil : « Colle carrelage »,
 * « COLLE CARRELAGE », « Colle-carrelage ». Comparer les saisies brutes ne rattrape aucun doublon ;
 * on compare donc une forme normalisée.
 *
 * Module pur, sans dépendance : utilisable par n'importe quel module métier.
 */

/** Formes juridiques françaises courantes, retirées des RAISONS SOCIALES avant comparaison. */
const FORMES_JURIDIQUES = [
  'sarl', 'sas', 'sasu', 'sa', 'eurl', 'sci', 'snc', 'scop', 'gie', 'ei', 'eirl', 'sem',
];

/**
 * Forme comparable d'un libellé : minuscules, sans accents ni ponctuation, espaces réduits.
 * « Colle-carrelage » et « COLLE CARRELAGE » donnent tous deux « colle carrelage ».
 */
export function normaliserLibelle(valeur: string | null | undefined): string {
  return (valeur ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // accents
    .toLowerCase()
    // Ligatures : « œ » n'est pas un accent, la décomposition Unicode ne la sépare pas. Sans cela
    // « Gros œuvre » deviendrait « gros uvre » et ne rejoindrait jamais « GROS OEUVRE » — or c'est
    // l'un des mots les plus courants du métier.
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    // Les points partent AVANT le découpage : sans cela « S.A.S. » deviendrait « s a s », trois
    // lettres isolées où le filtre des formes juridiques ne reconnaîtrait plus rien.
    .replace(/\./g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Forme comparable d'une RAISON SOCIALE : le libellé normalisé, débarrassé de sa forme juridique.
 * « Point-P S.A.S. » et « POINT P » donnent tous deux « point p ».
 *
 * Réservé aux entreprises : sur un libellé de référentiel, retirer « SA » mutilerait des intitulés
 * légitimes.
 */
export function normaliserRaisonSociale(nom: string | null | undefined): string {
  const base = normaliserLibelle(nom);
  const mots = base.split(' ').filter((m) => m && !FORMES_JURIDIQUES.includes(m));
  // Un intitulé qui n'est QUE sa forme juridique ne doit pas se réduire à rien.
  return (mots.length > 0 ? mots.join(' ') : base).trim();
}

/** Numéro de TVA comparable : sans espaces ni ponctuation, en majuscules. */
export function normaliserTva(tva: string | null | undefined): string | null {
  const v = (tva ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return v.length > 0 ? v : null;
}

/**
 * Détection de doublons au référentiel (clients et fournisseurs).
 *
 * Un référentiel se pollue toujours de la même façon : la même entreprise saisie trois fois sous
 * « POINT P », « Point P SAS » et « POINT-P ». Comparer les intitulés bruts ne rattrape rien ;
 * on compare donc une forme NORMALISÉE — sans casse, sans accents, sans ponctuation, sans forme
 * juridique — et le numéro de TVA, qui tranche à lui seul quand il est renseigné.
 *
 * Module pur : aucune dépendance à la base, testable seul.
 */

/** Formes juridiques françaises courantes, retirées avant comparaison. */
const FORMES_JURIDIQUES = [
  'sarl', 'sas', 'sasu', 'sa', 'eurl', 'sci', 'snc', 'scop', 'gie', 'ei', 'eirl', 'sem',
];

/**
 * Forme comparable d'un intitulé : minuscules, sans accents, sans ponctuation, formes juridiques
 * ôtées. « Point-P S.A.S. » et « POINT P » donnent tous deux « point p ».
 */
export function normaliserNom(nom: string): string {
  const base = (nom ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // accents
    .toLowerCase()
    // Les points partent AVANT le découpage : sans cela « S.A.S. » deviendrait « s a s », trois
    // lettres isolées où le filtre des formes juridiques ne reconnaît plus rien.
    .replace(/\./g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const mots = base.split(' ').filter((m) => m && !FORMES_JURIDIQUES.includes(m));
  // Un intitulé qui n'est QUE sa forme juridique ne doit pas se réduire à rien : on garde la base.
  return (mots.length > 0 ? mots.join(' ') : base).trim();
}

/** Numéro de TVA comparable : sans espaces ni ponctuation, en majuscules. */
export function normaliserTva(tva: string | null | undefined): string | null {
  const v = (tva ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return v.length > 0 ? v : null;
}

export interface PartyExistante {
  id: string;
  code: string;
  name: string;
  vatNumber?: string | null;
}

export interface Doublon {
  /** La fiche déjà présente qui fait obstacle. */
  existante: PartyExistante;
  motif: 'code' | 'tva' | 'nom';
  message: string;
}

/**
 * Cherche une fiche existante équivalente au candidat. Renvoie `null` si la voie est libre.
 *
 * Ordre des motifs du plus certain au plus probable : un code déjà pris est un fait, un numéro de
 * TVA identique désigne la même entreprise, un intitulé identique une fois normalisé la désigne
 * très probablement.
 */
export function trouverDoublon(
  candidat: { code: string; name: string; vatNumber?: string | null },
  existantes: PartyExistante[],
): Doublon | null {
  const code = (candidat.code ?? '').trim().toLowerCase();
  const tva = normaliserTva(candidat.vatNumber);
  const nom = normaliserNom(candidat.name);

  for (const e of existantes) {
    if (code && (e.code ?? '').trim().toLowerCase() === code) {
      return {
        existante: e,
        motif: 'code',
        message: `Le code « ${e.code} » est déjà utilisé par « ${e.name} ».`,
      };
    }
  }
  if (tva) {
    for (const e of existantes) {
      if (normaliserTva(e.vatNumber) === tva) {
        return {
          existante: e,
          motif: 'tva',
          message: `Ce numéro de TVA est déjà celui de « ${e.name} » (${e.code}).`,
        };
      }
    }
  }
  if (nom) {
    for (const e of existantes) {
      if (normaliserNom(e.name) === nom) {
        return {
          existante: e,
          motif: 'nom',
          message: `« ${e.name} » (${e.code}) désigne déjà cette entreprise.`,
        };
      }
    }
  }
  return null;
}

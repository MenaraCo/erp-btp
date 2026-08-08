/**
 * Détection de doublons au référentiel (clients et fournisseurs).
 *
 * Un référentiel se pollue toujours de la même façon : la même entreprise saisie trois fois sous
 * « POINT P », « Point P SAS » et « POINT-P ». On compare donc des formes NORMALISÉES (voir
 * `core/common/normalisation`) plutôt que les saisies brutes, et le numéro de TVA, qui tranche à
 * lui seul quand il est renseigné.
 *
 * Module pur : aucune dépendance à la base, testable seul.
 */
import {
  normaliserRaisonSociale,
  normaliserTva,
} from '../../core/common/normalisation';

export { normaliserTva };
/** Conservé sous son nom d'origine : c'est bien une raison sociale que l'on normalise ici. */
export const normaliserNom = normaliserRaisonSociale;

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

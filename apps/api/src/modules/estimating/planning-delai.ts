/**
 * Tenue des délais d'étude.
 *
 * Une offre se juge sur une seule question : a-t-on remis à temps ? Tant que rien n'est remis, le
 * verdict se lit par rapport à AUJOURD'HUI (une échéance passée est déjà un retard) ; une fois la
 * remise faite, il se fige sur la date de retour — un retard constaté ne s'efface pas.
 *
 * Fonction PURE : la date du jour est un paramètre, jamais lue ici. Sans quoi le résultat
 * dépendrait de l'heure d'exécution et ne serait pas testable.
 */

export type EtatDelai = 'sans_echeance' | 'a_lheure' | 'avance' | 'depasse';

export interface Delai {
  etat: EtatDelai;
  /** Jours d'avance (positif) ou de retard (négatif). null sans échéance. */
  jours: number | null;
  /** Le verdict est-il définitif (offre remise) ou encore en cours ? */
  rendu: boolean;
}

const JOUR_MS = 24 * 60 * 60 * 1000;

/** Nombre de jours entiers entre deux jours calendaires, fuseau neutre. */
function ecartJours(de: string, a: string): number {
  const d = Date.UTC(+de.slice(0, 4), +de.slice(5, 7) - 1, +de.slice(8, 10));
  const b = Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10));
  return Math.round((d - b) / JOUR_MS);
}

export function evaluerDelai(
  dateLimite: string | null | undefined,
  dateRetour: string | null | undefined,
  aujourdhui: string,
): Delai {
  if (!dateLimite) {
    // Sans échéance, il n'y a pas de délai à tenir — mais c'est en soi une anomalie à compter.
    return { etat: 'sans_echeance', jours: null, rendu: Boolean(dateRetour) };
  }
  const reference = dateRetour ?? aujourdhui;
  const jours = ecartJours(dateLimite, reference);
  const etat: EtatDelai = jours < 0 ? 'depasse' : jours > 0 ? 'avance' : 'a_lheure';
  return { etat, jours, rendu: Boolean(dateRetour) };
}

export interface LigneDelai {
  dateLimite?: string | null;
  dateRetour?: string | null;
  /** Affaire close (gagnée ou perdue) : elle ne pèse plus sur la charge d'étude. */
  close?: boolean;
}

export interface CompteursPlanning {
  enCours: number;
  rendues: number;
  depassees: number;
  sansEcheance: number;
}

/** Compteurs d'en-tête du planning, calculés sur la MÊME règle que les badges de chaque ligne. */
export function compterPlanning(lignes: LigneDelai[], aujourdhui: string): CompteursPlanning {
  return lignes.reduce(
    (acc, l) => {
      const d = evaluerDelai(l.dateLimite, l.dateRetour, aujourdhui);
      if (!l.close) acc.enCours += 1;
      if (d.rendu) acc.rendues += 1;
      if (d.etat === 'sans_echeance') acc.sansEcheance += 1;
      // Une offre remise en retard reste un retard : on la compte, close ou non.
      else if (d.etat === 'depasse') acc.depassees += 1;
      return acc;
    },
    { enCours: 0, rendues: 0, depassees: 0, sansEcheance: 0 },
  );
}

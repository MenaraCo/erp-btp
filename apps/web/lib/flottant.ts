/**
 * Placement d'un panneau flottant (menu déroulant, liste de choix) rendu en PORTAIL.
 *
 * Un panneau en `position: fixed` ouvert vers le bas depuis une ligne située en bas de l'écran
 * sort du cadre : la page ne le fait pas défiler — il est là, mais hors d'atteinte. C'est
 * exactement ce qui arrive au choix du code analytique sur la dernière ligne d'un tableau.
 *
 * Deux règles, donc : BASCULER au-dessus quand le dessous est trop court, et BORNER la hauteur à
 * l'espace réellement disponible pour que la liste défile en elle-même plutôt que de déborder.
 */
export interface PositionFlottante {
  top: number;
  left: number;
  /** Hauteur maximale réellement disponible : la liste défile à l'intérieur. */
  maxHeight: number;
  /** Vrai quand le panneau s'ouvre au-dessus de son déclencheur (utile pour l'ombre/le style). */
  versLeHaut: boolean;
}

/** En deçà, un panneau ne montre plus assez de lignes pour qu'on y choisisse quoi que ce soit. */
const HAUTEUR_MINIMALE = 140;

/**
 * Placement VERTICAL seul, pour les menus qui calent eux-mêmes leur bord horizontal (alignés à
 * droite du bouton, par exemple). Même règle de bascule et de bornage.
 */
export function hauteurFlottante(
  ancre: DOMRect,
  hauteurSouhaitee = 280,
  marge = 8,
  ecart = 4,
): Omit<PositionFlottante, 'left'> {
  const dessous = window.innerHeight - ancre.bottom - ecart - marge;
  const dessus = ancre.top - ecart - marge;

  // On bascule vers le haut seulement si le dessous est vraiment trop court ET que le dessus fait
  // mieux : basculer pour gagner dix pixels ferait sauter le menu d'un clic à l'autre.
  if (dessous < Math.min(hauteurSouhaitee, HAUTEUR_MINIMALE) && dessus > dessous) {
    const hauteur = Math.max(HAUTEUR_MINIMALE, Math.min(hauteurSouhaitee, dessus));
    return { top: Math.max(marge, ancre.top - ecart - hauteur), maxHeight: hauteur, versLeHaut: true };
  }
  return {
    top: ancre.bottom + ecart,
    maxHeight: Math.max(HAUTEUR_MINIMALE, Math.min(hauteurSouhaitee, dessous)),
    versLeHaut: false,
  };
}

export function positionFlottante(
  ancre: DOMRect,
  largeur: number,
  hauteurSouhaitee = 280,
  marge = 8,
): PositionFlottante {
  return {
    ...hauteurFlottante(ancre, hauteurSouhaitee, marge),
    left: Math.max(marge, Math.min(ancre.left, window.innerWidth - largeur - marge)),
  };
}

/**
 * Suit l'ancre tant que le panneau est ouvert : une page qui défile (ou une fenêtre redimensionnée)
 * déplace le déclencheur, jamais le panneau `fixed` — sans cela, la liste se décroche de sa ligne.
 * `scroll` est écouté en CAPTURE pour attraper aussi le défilement des conteneurs internes.
 */
export function suivreAncre(replacer: () => void): () => void {
  window.addEventListener('scroll', replacer, true);
  window.addEventListener('resize', replacer);
  return () => {
    window.removeEventListener('scroll', replacer, true);
    window.removeEventListener('resize', replacer);
  };
}

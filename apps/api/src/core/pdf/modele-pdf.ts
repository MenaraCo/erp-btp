/**
 * Les MODÈLES de document PDF — une identité visuelle, choisie une fois, appliquée partout.
 *
 * Un devis, un bon de commande, une facture et une situation partent du même expéditeur : ils
 * doivent se ressembler. Jusqu'ici chaque éditeur dessinait son en-tête à sa façon, et le client
 * recevait quatre papiers différents de la même entreprise.
 *
 * Un modèle ne change pas ce qui est écrit — les montants, les mentions légales et l'ordre des
 * colonnes ne sont pas affaire de goût. Il décide de la MISE EN FORME : la typographie, la façon
 * de poser l'en-tête, l'habillage des tableaux. Les deux couleurs de la société (principale et
 * accent) restent celles des Préférences : le modèle dit comment s'en servir, pas lesquelles.
 */
export type ModelePdf = 'classique' | 'contemporain' | 'compact' | 'bandeau';

export interface StyleModele {
  cle: ModelePdf;
  nom: string;
  /** Ce que le modèle donne à voir — sert d'aide au choix dans les Préférences. */
  description: string;
  /** Polices PDF standard : présentes partout, aucune fonte à embarquer. */
  police: { titre: string; corps: string; italique: string };
  tailles: { titreDocument: number; nomSociete: number; corps: number; petit: number; tableau: number };
  /**
   * Mise en place de l'en-tête :
   *  - `cartouche` : société à gauche, encadré du document à droite (le classique du bâtiment) ;
   *  - `epure`     : une ligne de titre, un filet, les informations en colonnes ;
   *  - `bandeau`   : bandeau plein couleur en tête de page, texte en réserve blanche.
   */
  enTete: 'cartouche' | 'epure' | 'bandeau';
  tableau: {
    /** Fond de la ligne d'en-tête : la couleur principale, un gris, ou rien. */
    fondEntete: 'primaire' | 'gris' | 'aucun';
    couleurTexteEntete: string;
    /** Filets horizontaux entre les lignes. */
    filets: boolean;
    /** Fond alterné une ligne sur deux — utile sur les tableaux denses. */
    alternance: boolean;
  };
  marge: number;
  /** Hauteur d'une ligne de tableau : c'est elle qui décide de la densité. */
  hauteurLigne: number;
}

export const MODELES_PDF: Record<ModelePdf, StyleModele> = {
  classique: {
    cle: 'classique',
    nom: 'Classique',
    description:
      'Société à gauche, cartouche du document à droite, en-têtes de tableau sur fond de couleur. '
      + 'La présentation attendue d’un devis de bâtiment — celle qui ne surprend personne.',
    police: { titre: 'Helvetica-Bold', corps: 'Helvetica', italique: 'Helvetica-Oblique' },
    tailles: { titreDocument: 15, nomSociete: 13, corps: 9, petit: 8, tableau: 8.5 },
    enTete: 'cartouche',
    tableau: { fondEntete: 'primaire', couleurTexteEntete: '#ffffff', filets: true, alternance: false },
    marge: 40,
    hauteurLigne: 17,
  },
  contemporain: {
    cle: 'contemporain',
    nom: 'Contemporain',
    description:
      'Beaucoup de blanc, un titre net posé sur un filet, des tableaux sans aplat. '
      + 'Sobre et aéré : le document respire, la couleur ne sert qu’à souligner.',
    police: { titre: 'Helvetica-Bold', corps: 'Helvetica', italique: 'Helvetica-Oblique' },
    tailles: { titreDocument: 20, nomSociete: 11, corps: 9, petit: 8, tableau: 8.5 },
    enTete: 'epure',
    tableau: { fondEntete: 'aucun', couleurTexteEntete: '#0f172a', filets: true, alternance: false },
    marge: 48,
    hauteurLigne: 19,
  },
  compact: {
    cle: 'compact',
    nom: 'Compact',
    description:
      'Marges réduites, lignes serrées, fond alterné : conçu pour les pièces longues — un DPGF '
      + 'de trois cents lignes tient en deux fois moins de pages, et reste lisible.',
    police: { titre: 'Helvetica-Bold', corps: 'Helvetica', italique: 'Helvetica-Oblique' },
    tailles: { titreDocument: 13, nomSociete: 11, corps: 8, petit: 7, tableau: 7.5 },
    enTete: 'cartouche',
    tableau: { fondEntete: 'gris', couleurTexteEntete: '#0f172a', filets: false, alternance: true },
    marge: 30,
    hauteurLigne: 14,
  },
  bandeau: {
    cle: 'bandeau',
    nom: 'Bandeau coloré',
    description:
      'Un bandeau plein aux couleurs de la société en tête de page, le titre en réserve blanche. '
      + 'Le plus affirmé des quatre : il se reconnaît d’un coup d’œil dans une pile de courrier.',
    police: { titre: 'Helvetica-Bold', corps: 'Helvetica', italique: 'Helvetica-Oblique' },
    tailles: { titreDocument: 17, nomSociete: 12, corps: 9, petit: 8, tableau: 8.5 },
    enTete: 'bandeau',
    tableau: { fondEntete: 'primaire', couleurTexteEntete: '#ffffff', filets: true, alternance: true },
    marge: 40,
    hauteurLigne: 17,
  },
};

/** Modèle demandé, ou le classique : un document doit toujours pouvoir s'éditer. */
export function modelePdf(cle?: string | null): StyleModele {
  return MODELES_PDF[(cle ?? '') as ModelePdf] ?? MODELES_PDF.classique;
}

export interface CouleursSociete {
  primary: string;
  accent: string;
}

export interface EnTeteDocument {
  /** Ce que le document est : DEVIS, BON DE COMMANDE, FACTURE… */
  titre: string;
  /** Les repères du document : numéro, date, référence. Une entrée par ligne. */
  references: string[];
  societe: { nom: string; lignes: string[]; logo?: Buffer | null };
}

/**
 * Dessine l'en-tête d'un document selon le modèle et renvoie l'ordonnée où le contenu peut
 * commencer. Chaque éditeur PDF passe par ici : c'est ce qui garantit qu'un devis et une facture
 * de la même entreprise se ressemblent.
 */
export function dessinerEnTete(
  doc: PDFKit.PDFDocument,
  style: StyleModele,
  couleurs: CouleursSociete,
  data: EnTeteDocument,
): number {
  const M = style.marge;
  const largeur = doc.page.width - M * 2;
  const droite = doc.page.width - M;

  if (style.enTete === 'bandeau') {
    const hauteur = 76;
    doc.rect(0, 0, doc.page.width, hauteur).fill(couleurs.primary);
    let x = M;
    if (data.societe.logo) {
      try {
        doc.image(data.societe.logo, M, 14, { fit: [110, 40] });
        x = M + 122;
      } catch { /* logo illisible : le bandeau se suffit */ }
    }
    doc.fillColor('#ffffff').font(style.police.titre).fontSize(style.tailles.nomSociete)
      .text(data.societe.nom, x, 18, { width: largeur / 2 });
    doc.font(style.police.corps).fontSize(style.tailles.petit).fillColor('#e2e8f0')
      .text(data.societe.lignes.join(' · '), x, doc.y + 1, { width: largeur / 2 });

    doc.font(style.police.titre).fontSize(style.tailles.titreDocument).fillColor('#ffffff')
      .text(data.titre, droite - 240, 18, { width: 240, align: 'right' });
    doc.font(style.police.corps).fontSize(style.tailles.petit).fillColor('#e2e8f0');
    let y = doc.y + 1;
    for (const r of data.references) {
      doc.text(r, droite - 240, y, { width: 240, align: 'right' });
      y = doc.y;
    }
    return hauteur + 18;
  }

  if (style.enTete === 'epure') {
    let y = M;
    doc.font(style.police.titre).fontSize(style.tailles.titreDocument).fillColor(couleurs.primary)
      .text(data.titre, M, y, { width: largeur });
    y = doc.y + 6;
    doc.moveTo(M, y).lineTo(droite, y).lineWidth(1.2).strokeColor(couleurs.accent).stroke();
    y += 12;

    if (data.societe.logo) {
      try {
        doc.image(data.societe.logo, M, y, { fit: [110, 38] });
      } catch { /* sans logo, la colonne de gauche reste du texte */ }
    }
    const decalage = data.societe.logo ? 122 : 0;
    doc.font(style.police.titre).fontSize(style.tailles.nomSociete).fillColor('#0f172a')
      .text(data.societe.nom, M + decalage, y, { width: largeur / 2 - decalage });
    doc.font(style.police.corps).fontSize(style.tailles.petit).fillColor('#64748b');
    for (const l of data.societe.lignes) {
      doc.text(l, M + decalage, doc.y, { width: largeur / 2 - decalage });
    }
    const basSociete = doc.y;

    doc.font(style.police.corps).fontSize(style.tailles.petit).fillColor('#334155');
    let yr = y;
    for (const r of data.references) {
      doc.text(r, droite - 220, yr, { width: 220, align: 'right' });
      yr = doc.y;
    }
    return Math.max(basSociete, yr) + 14;
  }

  /* cartouche : la mise en page classique du bâtiment */
  let hautSociete = M;
  if (data.societe.logo) {
    try {
      doc.image(data.societe.logo, M, hautSociete, { fit: [130, 46] });
      hautSociete += 52;
    } catch { /* logo illisible : on continue sans bloquer l'édition */ }
  }
  doc.font(style.police.titre).fontSize(style.tailles.nomSociete).fillColor(couleurs.primary)
    .text(data.societe.nom, M, hautSociete, { width: largeur / 2 });
  doc.font(style.police.corps).fontSize(style.tailles.petit).fillColor('#555555');
  for (const l of data.societe.lignes) {
    doc.text(l, M, doc.y, { width: largeur / 2 });
  }
  const basSociete = doc.y;

  const boxW = 210;
  const boxX = droite - boxW;
  const boxH = 26 + data.references.length * 12;
  doc.roundedRect(boxX, M, boxW, boxH, 4).fillAndStroke('#f8fafc', '#cbd5e1');
  doc.font(style.police.titre).fontSize(style.tailles.titreDocument).fillColor(couleurs.primary)
    .text(data.titre, boxX + 10, M + 8, { width: boxW - 20 });
  doc.font(style.police.corps).fontSize(style.tailles.petit).fillColor('#334155');
  let y = M + 10 + style.tailles.titreDocument + 4;
  for (const r of data.references) {
    doc.text(r, boxX + 10, y, { width: boxW - 20 });
    y = doc.y;
  }
  return Math.max(basSociete, M + boxH) + 14;
}

/**
 * Ligne d'en-tête d'un tableau, dans la manière du modèle. Renvoie l'ordonnée de la première
 * ligne de données.
 */
export function dessinerEnteteTableau(
  doc: PDFKit.PDFDocument,
  style: StyleModele,
  couleurs: CouleursSociete,
  colonnes: Array<{ titre: string; x: number; largeur: number; alignement?: 'left' | 'right' | 'center' }>,
  y: number,
): number {
  const M = style.marge;
  const largeur = doc.page.width - M * 2;
  const hauteur = style.hauteurLigne;

  if (style.tableau.fondEntete !== 'aucun') {
    doc.rect(M, y - 2, largeur, hauteur)
      .fill(style.tableau.fondEntete === 'primaire' ? couleurs.primary : '#e2e8f0');
  }
  doc.font(style.police.titre).fontSize(style.tailles.tableau)
    .fillColor(style.tableau.fondEntete === 'aucun' ? style.tableau.couleurTexteEntete : style.tableau.couleurTexteEntete);
  for (const c of colonnes) {
    doc.text(c.titre, c.x, y + 3, { width: c.largeur, align: c.alignement ?? 'left' });
  }
  const bas = y - 2 + hauteur;
  if (style.tableau.fondEntete === 'aucun' || style.tableau.filets) {
    doc.moveTo(M, bas).lineTo(M + largeur, bas).lineWidth(0.8)
      .strokeColor(style.tableau.fondEntete === 'aucun' ? couleurs.primary : '#cbd5e1').stroke();
  }
  return bas + 4;
}

/** Fond alterné d'une ligne de tableau, quand le modèle le prévoit. */
export function fondLigne(
  doc: PDFKit.PDFDocument,
  style: StyleModele,
  y: number,
  index: number,
): void {
  if (!style.tableau.alternance || index % 2 === 0) return;
  doc.rect(style.marge, y - 2, doc.page.width - style.marge * 2, style.hauteurLigne).fill('#f8fafc');
}

'use client';

import { BibliothequeView } from '@/components/BibliothequeView';

/**
 * Catalogue de référence du module chantier — les articles et les prix du terrain, au niveau de
 * l'entreprise. Distinct de la bibliothèque d'étude (qui sert à chiffrer) et de la nomenclature
 * d'un chantier donné (copie de travail reçue à l'acceptation).
 */
export default function BibliothequeChantierPage() {
  return <BibliothequeView scope="chantier" />;
}

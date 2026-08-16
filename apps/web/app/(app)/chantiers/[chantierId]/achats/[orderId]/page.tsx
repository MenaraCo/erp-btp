'use client';

import { useParams } from 'next/navigation';
import { FicheCommande } from '@/components/FicheCommande';

/**
 * La même fiche, ouverte DEPUIS un chantier — et qui y reste.
 * Ouvrir une commande ne doit pas faire sortir du chantier sur lequel on travaille.
 */
export default function FicheCommandeChantierPage() {
  const { chantierId, orderId } = useParams();
  return (
    <FicheCommande
      orderId={String(orderId)}
      retour={{ href: `/chantiers/${String(chantierId)}/achats`, label: 'Commandes du chantier' }}
    />
  );
}

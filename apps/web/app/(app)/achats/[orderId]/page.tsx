'use client';

import { useParams } from 'next/navigation';
import { FicheCommande } from '@/components/FicheCommande';

/** Fiche d'une commande ouverte depuis le registre d'entreprise. */
export default function FicheCommandeRegistrePage() {
  const orderId = String(useParams().orderId);
  return <FicheCommande orderId={orderId} retour={{ href: '/achats', label: 'Bons de commande' }} />;
}

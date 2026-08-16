'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ReceiptText } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { euro } from '@/lib/format';
import { GroupeFacture, TableauFactures } from '@/components/RegistreGroupe';

interface Reponse {
  lignes: GroupeFacture[];
  total: number;
  totalPieces: number;
  montantTotal: string;
}

/** Factures fournisseur de CE chantier — ce qui alimente son réalisé, groupé par commande. */
export default function FacturesChantierPage() {
  const { token } = useAuth();
  const chantierId = String(useParams().chantierId);
  const [recherche, setRecherche] = useState('');

  const requete = new URLSearchParams({ chantier: chantierId, parPage: '100' });
  if (recherche) requete.set('q', recherche);

  const data = useQuery({
    queryKey: ['achats-factures', requete.toString()],
    enabled: Boolean(token),
    retry: false,
    queryFn: () => apiFetch<Reponse>(`/achats/factures?${requete.toString()}`, { token }),
  });
  const r = data.data;

  return (
    <div>
      <p className="muted" style={{ marginTop: 0 }}>
        <Link href={`/chantiers/${chantierId}/achats`} className="link">← Commandes du chantier</Link>
      </p>
      <h1 style={{ marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
        <ReceiptText size={20} /> Factures fournisseur
      </h1>
      <p className="muted" style={{ marginTop: 0, maxWidth: 800 }}>
        Une ligne par commande : ce qui est facturé face à ce qui était commandé. Ce sont ces
        montants qui entrent dans le <strong>réalisé</strong> du chantier.
      </p>

      <div className="field" style={{ marginTop: 12, marginBottom: 0, maxWidth: 260 }}>
        <label>Recherche</label>
        <input
          value={recherche}
          placeholder="N° de facture, commande, fournisseur…"
          onChange={(e) => setRecherche(e.target.value)}
        />
      </div>

      <TableauFactures
        lignes={r?.lignes ?? []}
        lienCommande={(id) => `/chantiers/${chantierId}/achats/${id}`}
        avecChantier={false}
        vide="Aucune facture sur ce chantier."
      />

      {r && r.total > 0 && (
        <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>
          {r.total} groupe{r.total > 1 ? 's' : ''} · {r.totalPieces} facture
          {r.totalPieces > 1 ? 's' : ''} · {euro(r.montantTotal)} HT
        </p>
      )}
    </div>
  );
}

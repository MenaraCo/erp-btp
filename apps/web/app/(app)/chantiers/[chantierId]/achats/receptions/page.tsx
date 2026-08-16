'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { PackageCheck } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { euro } from '@/lib/format';
import { GroupeReception, TableauReceptions } from '@/components/RegistreGroupe';

interface Reponse {
  lignes: GroupeReception[];
  total: number;
  totalBons: number;
  montantTotal: string;
}

/**
 * Réceptions de CE chantier — même tableau que le registre d'entreprise, sans la colonne chantier
 * (on sait déjà où l'on est) et sans quitter le chantier quand on ouvre une commande.
 */
export default function ReceptionsChantierPage() {
  const { token } = useAuth();
  const chantierId = String(useParams().chantierId);
  const [recherche, setRecherche] = useState('');

  const requete = new URLSearchParams({ chantier: chantierId, parPage: '100' });
  if (recherche) requete.set('q', recherche);

  const data = useQuery({
    queryKey: ['achats-receptions', requete.toString()],
    enabled: Boolean(token),
    retry: false,
    queryFn: () => apiFetch<Reponse>(`/achats/receptions?${requete.toString()}`, { token }),
  });
  const r = data.data;

  return (
    <div>
      <p className="muted" style={{ marginTop: 0 }}>
        <Link href={`/chantiers/${chantierId}/achats`} className="link">← Commandes du chantier</Link>
      </p>
      <h1 style={{ marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
        <PackageCheck size={20} /> Réceptions
      </h1>
      <p className="muted" style={{ marginTop: 0, maxWidth: 800 }}>
        Une ligne par commande de ce chantier : ce qui est arrivé, ce qui manque. Une réception
        s’enregistre depuis la commande concernée.
      </p>

      <div className="field" style={{ marginTop: 12, marginBottom: 0, maxWidth: 260 }}>
        <label>Recherche</label>
        <input
          value={recherche}
          placeholder="N° de BL, commande, fournisseur…"
          onChange={(e) => setRecherche(e.target.value)}
        />
      </div>

      <TableauReceptions
        lignes={r?.lignes ?? []}
        lienCommande={(id) => `/chantiers/${chantierId}/achats/${id}`}
        avecChantier={false}
        vide="Aucune réception sur ce chantier."
      />

      {r && r.total > 0 && (
        <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>
          {r.total} commande{r.total > 1 ? 's' : ''} réceptionnée{r.total > 1 ? 's' : ''} ·{' '}
          {r.totalBons} bon{r.totalBons > 1 ? 's' : ''} de livraison · {euro(r.montantTotal)} reçus
        </p>
      )}
    </div>
  );
}

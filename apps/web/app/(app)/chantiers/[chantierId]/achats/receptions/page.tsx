'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { PackageCheck } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';

interface Reception {
  id: string;
  code: string;
  received_at: string | null;
  order_id: string;
  commande: string;
  fournisseur: string | null;
}
interface Reponse { lignes: Reception[]; total: number }

function jour(v: string | null): string {
  return v ? new Date(v).toLocaleDateString('fr-FR') : '—';
}

/** Réceptions de CE chantier : ce qui est arrivé, et pour quelle commande. */
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
        Les bons de livraison de ce chantier. Une réception s’enregistre depuis la commande
        concernée ; le rapprochement ligne à ligne arrive à l’étape suivante.
      </p>

      <div className="field" style={{ marginTop: 12, marginBottom: 0, maxWidth: 260 }}>
        <label>Recherche</label>
        <input
          value={recherche}
          placeholder="N° de BL, commande, fournisseur…"
          onChange={(e) => setRecherche(e.target.value)}
        />
      </div>

      <div className="card" style={{ marginTop: 16, padding: 0, overflow: 'hidden' }}>
        <table className="grid" style={{ margin: 0 }}>
          <thead>
            <tr>
              <th style={{ width: 160 }}>N° de BL</th>
              <th style={{ width: 120 }}>Reçu le</th>
              <th>Commande</th>
              <th>Fournisseur</th>
            </tr>
          </thead>
          <tbody>
            {(r?.lignes ?? []).map((d) => (
              <tr key={d.id}>
                <td className="code-cell">{d.code}</td>
                <td className="muted">{jour(d.received_at)}</td>
                <td>
                  <Link href={`/chantiers/${chantierId}/achats/${d.order_id}`} className="link">
                    {d.commande}
                  </Link>
                </td>
                <td>{d.fournisseur ?? <span className="muted">Non renseigné</span>}</td>
              </tr>
            ))}
            {r && r.lignes.length === 0 && (
              <tr>
                <td colSpan={4} className="muted" style={{ padding: 20, textAlign: 'center' }}>
                  Aucune réception sur ce chantier.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

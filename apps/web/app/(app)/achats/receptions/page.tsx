'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { PackageCheck } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { BarreRecherche, Pagination, useRegistre } from '@/components/RegistreAchats';

interface Reception {
  id: string;
  code: string;
  received_at: string | null;
  order_id: string;
  commande: string;
  chantier_code: string | null;
  fournisseur: string | null;
}
interface Reponse { lignes: Reception[]; total: number; page: number; parPage: number }

function jour(v: string | null): string {
  return v ? new Date(v).toLocaleDateString('fr-FR') : '—';
}

/** Registre des réceptions : ce qui est arrivé sur les chantiers, et pour quelle commande. */
export default function ReceptionsPage() {
  const { token } = useAuth();
  const { filtres, majFiltres, page, setPage, requete } = useRegistre();

  const data = useQuery({
    queryKey: ['achats-receptions', requete],
    enabled: Boolean(token),
    queryFn: () => apiFetch<Reponse>(`/achats/receptions?${requete}`, { token }),
  });
  const r = data.data;

  return (
    <div>
      <h1 style={{ marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
        <PackageCheck size={20} /> Réceptions
      </h1>
      <p className="muted" style={{ marginTop: 0, maxWidth: 820 }}>
        Les bons de livraison enregistrés, rattachés à leur commande. Le rapprochement ligne à ligne
        entre commandé et reçu arrive à l’étape suivante du module.
      </p>

      <BarreRecherche filtres={filtres} onChange={majFiltres} total={r?.total ?? 0} />

      <div className="card" style={{ marginTop: 16, padding: 0, overflow: 'hidden' }}>
        <table className="grid" style={{ margin: 0 }}>
          <thead>
            <tr>
              <th style={{ width: 150 }}>N° de BL</th>
              <th style={{ width: 110 }}>Reçu le</th>
              <th>Commande</th>
              <th>Chantier</th>
              <th>Fournisseur</th>
            </tr>
          </thead>
          <tbody>
            {(r?.lignes ?? []).map((d) => (
              <tr key={d.id}>
                <td className="code-cell">{d.code}</td>
                <td className="muted">{jour(d.received_at)}</td>
                <td>
                  <Link href={`/achats/${d.order_id}`} className="link">{d.commande}</Link>
                </td>
                <td>{d.chantier_code ?? '—'}</td>
                <td>{d.fournisseur ?? <span className="muted">Non renseigné</span>}</td>
              </tr>
            ))}
            {r && r.lignes.length === 0 && (
              <tr>
                <td colSpan={5} className="muted" style={{ padding: 20, textAlign: 'center' }}>
                  Aucune réception ne correspond à cette recherche.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pagination page={page} total={r?.total ?? 0} parPage={r?.parPage ?? 25} onPage={setPage} />
    </div>
  );
}

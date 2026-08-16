'use client';

import { useQuery } from '@tanstack/react-query';
import { PackageCheck } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { euro } from '@/lib/format';
import { BarreRecherche, Pagination, useRegistre } from '@/components/RegistreAchats';
import { GroupeReception, TableauReceptions } from '@/components/RegistreGroupe';

interface Reponse {
  lignes: GroupeReception[];
  total: number;
  totalBons: number;
  montantTotal: string;
  page: number;
  parPage: number;
}

/** Registre des réceptions de l'entreprise — une ligne par commande, ses BL dépliables. */
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
        Une ligne par commande : ce qui est arrivé, ce qui manque encore. Dépliez pour voir les bons
        de livraison qui l’ont alimentée.
      </p>

      <BarreRecherche filtres={filtres} onChange={majFiltres} total={r?.total ?? 0} />

      <TableauReceptions
        lignes={r?.lignes ?? []}
        lienCommande={(id) => `/achats/${id}`}
      />

      {r && r.total > 0 && (
        <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>
          {r.total} commande{r.total > 1 ? 's' : ''} réceptionnée{r.total > 1 ? 's' : ''} ·{' '}
          {r.totalBons} bon{r.totalBons > 1 ? 's' : ''} de livraison · {euro(r.montantTotal)} reçus
          (valorisés au prix de la commande)
        </p>
      )}

      <Pagination page={page} total={r?.total ?? 0} parPage={r?.parPage ?? 25} onPage={setPage} />
    </div>
  );
}

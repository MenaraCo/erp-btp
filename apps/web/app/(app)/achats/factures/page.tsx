'use client';

import { useQuery } from '@tanstack/react-query';
import { ReceiptText } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { euro } from '@/lib/format';
import { BarreRecherche, Pagination, useRegistre } from '@/components/RegistreAchats';
import { GroupeFacture, TableauFactures } from '@/components/RegistreGroupe';

interface Reponse {
  lignes: GroupeFacture[];
  total: number;
  totalPieces: number;
  montantTotal: string;
  page: number;
  parPage: number;
}

/** Registre des factures fournisseur de l'entreprise — une ligne par commande. */
export default function FacturesPage() {
  const { token } = useAuth();
  const { filtres, majFiltres, page, setPage, requete } = useRegistre();

  const data = useQuery({
    queryKey: ['achats-factures', requete],
    enabled: Boolean(token),
    queryFn: () => apiFetch<Reponse>(`/achats/factures?${requete}`, { token }),
  });
  const r = data.data;

  return (
    <div>
      <h1 style={{ marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
        <ReceiptText size={20} /> Factures fournisseur
      </h1>
      <p className="muted" style={{ marginTop: 0, maxWidth: 820 }}>
        Une ligne par commande : ce qui est facturé face à ce qui était commandé. Ce sont les
        factures qui alimentent le <strong>réalisé</strong> du chantier — la commande, elle,
        n’engage que l’avenir.
      </p>

      <BarreRecherche
        filtres={filtres}
        onChange={majFiltres}
        total={r?.total ?? 0}
        montant={r ? euro(r.montantTotal) : null}
      />

      <TableauFactures
        lignes={r?.lignes ?? []}
        lienCommande={(id) => `/achats/${id}`}
      />

      {r && r.total > 0 && (
        <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>
          {r.total} groupe{r.total > 1 ? 's' : ''} · {r.totalPieces} facture
          {r.totalPieces > 1 ? 's' : ''} · {euro(r.montantTotal)} HT
        </p>
      )}

      <Pagination page={page} total={r?.total ?? 0} parPage={r?.parPage ?? 25} onPage={setPage} />
    </div>
  );
}

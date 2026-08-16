'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ReceiptText } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { euro } from '@/lib/format';
import { BarreRecherche, Pagination, useRegistre } from '@/components/RegistreAchats';

interface Facture {
  id: string;
  code: string;
  amount_ht: string;
  invoice_date: string | null;
  nature: string;
  order_id: string | null;
  commande: string | null;
  chantier_code: string | null;
  fournisseur: string | null;
  code_analytique: string | null;
}
interface Reponse { lignes: Facture[]; total: number; montantTotal: string; page: number; parPage: number }

const NATURES: Record<string, string> = {
  material: 'Matériaux', equipment: 'Matériel', subcontract: 'Sous-traitance',
  labor: 'Main d’œuvre', site_overhead: 'Frais de chantier',
};

function jour(v: string | null): string {
  return v ? new Date(v).toLocaleDateString('fr-FR') : '—';
}

/** Registre des factures fournisseur : ce qui est réellement dû, et sur quel chantier. */
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
        Les factures enregistrées, avec leur imputation. Ce sont elles qui alimentent le
        <strong> réalisé</strong> du chantier — la commande, elle, n’engage que l’avenir.
      </p>

      <BarreRecherche
        filtres={filtres}
        onChange={majFiltres}
        total={r?.total ?? 0}
        montant={r ? euro(r.montantTotal) : null}
      />

      <div className="card" style={{ marginTop: 16, padding: 0, overflow: 'hidden' }}>
        <table className="grid" style={{ margin: 0 }}>
          <thead>
            <tr>
              <th style={{ width: 150 }}>N° de facture</th>
              <th style={{ width: 110 }}>Date</th>
              <th>Commande</th>
              <th>Chantier</th>
              <th>Fournisseur</th>
              <th>Nature</th>
              <th>Code analytique</th>
              <th style={{ width: 130, textAlign: 'right' }}>Montant HT</th>
            </tr>
          </thead>
          <tbody>
            {(r?.lignes ?? []).map((f) => (
              <tr key={f.id}>
                <td className="code-cell">{f.code}</td>
                <td className="muted">{jour(f.invoice_date)}</td>
                <td>
                  {f.order_id
                    ? <Link href={`/achats/${f.order_id}`} className="link">{f.commande}</Link>
                    : <span className="muted">Hors commande</span>}
                </td>
                <td>{f.chantier_code ?? '—'}</td>
                <td>{f.fournisseur ?? <span className="muted">Non renseigné</span>}</td>
                <td>{NATURES[f.nature] ?? f.nature}</td>
                <td>{f.code_analytique
                  ? <span className="code-cell">{f.code_analytique}</span>
                  : <span className="muted">À ventiler</span>}</td>
                <td style={{ textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                  {euro(f.amount_ht)}
                </td>
              </tr>
            ))}
            {r && r.lignes.length === 0 && (
              <tr>
                <td colSpan={8} className="muted" style={{ padding: 20, textAlign: 'center' }}>
                  Aucune facture ne correspond à cette recherche.
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

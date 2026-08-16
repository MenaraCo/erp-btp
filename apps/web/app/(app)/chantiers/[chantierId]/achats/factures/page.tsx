'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ReceiptText } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { euro } from '@/lib/format';

interface Facture {
  id: string;
  code: string;
  amount_ht: string;
  invoice_date: string | null;
  nature: string;
  order_id: string | null;
  commande: string | null;
  fournisseur: string | null;
  code_analytique: string | null;
}
interface Reponse { lignes: Facture[]; total: number; montantTotal: string }

const NATURES: Record<string, string> = {
  material: 'Matériaux', equipment: 'Matériel', subcontract: 'Sous-traitance',
  labor: 'Main d’œuvre', site_overhead: 'Frais de chantier',
};

function jour(v: string | null): string {
  return v ? new Date(v).toLocaleDateString('fr-FR') : '—';
}

/** Factures fournisseur de CE chantier — ce qui alimente son réalisé. */
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
        Les factures de ce chantier, avec leur imputation. Ce sont elles qui entrent dans le
        <strong> réalisé</strong> — la commande, elle, n’engage que l’avenir.
      </p>

      <div className="field" style={{ marginTop: 12, marginBottom: 0, maxWidth: 260 }}>
        <label>Recherche</label>
        <input
          value={recherche}
          placeholder="N° de facture, commande, fournisseur…"
          onChange={(e) => setRecherche(e.target.value)}
        />
      </div>

      <div className="card" style={{ marginTop: 16, padding: 0, overflow: 'hidden' }}>
        <table className="grid" style={{ margin: 0 }}>
          <thead>
            <tr>
              <th style={{ width: 150 }}>N° de facture</th>
              <th style={{ width: 110 }}>Date</th>
              <th>Commande</th>
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
                    ? <Link href={`/chantiers/${chantierId}/achats/${f.order_id}`} className="link">{f.commande}</Link>
                    : <span className="muted">Hors commande</span>}
                </td>
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
                <td colSpan={7} className="muted" style={{ padding: 20, textAlign: 'center' }}>
                  Aucune facture sur ce chantier.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {r && r.lignes.length > 0 && (
        <div className="muted" style={{ fontSize: 12, marginTop: 10, textAlign: 'right' }}>
          {r.total} facture{r.total > 1 ? 's' : ''} · {euro(r.montantTotal)}
        </div>
      )}
    </div>
  );
}

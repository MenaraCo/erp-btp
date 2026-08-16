'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, PackageCheck, ReceiptText } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { euro } from '@/lib/format';
import { teinteChantier } from '@/components/CalendrierMois';

interface Ligne {
  id: string;
  nature: string;
  designation: string;
  quantity: string;
  unit_price: string;
  amount_ht: string;
  ouvrage: string | null;
  code_analytique: string | null;
  ressource_code: string | null;
  unite_achat: string | null;
}
interface Fiche {
  commande: {
    id: string; code: string; status: string; total_ht: string; validated_at: string | null;
    created_at: string; chantier_id: string; chantier_code: string | null; chantier_nom: string | null;
    chantier_couleur: string | null; fournisseur: string | null;
  };
  lignes: Ligne[];
  receptions: Array<{ id: string; code: string; received_at: string | null }>;
  factures: Array<{ id: string; code: string; nature: string; amount_ht: string; invoice_date: string | null }>;
}

const NATURES: Record<string, string> = {
  material: 'Matériaux', equipment: 'Matériel', subcontract: 'Sous-traitance',
  labor: 'Main d’œuvre', site_overhead: 'Frais de chantier',
};
const STATUTS: Record<string, string> = { draft: 'Brouillon', validated: 'Validée', cancelled: 'Annulée' };
const BADGE: Record<string, string> = { draft: 'info', validated: 'success', cancelled: 'danger' };

function jour(v: string | null): string {
  return v ? new Date(v).toLocaleDateString('fr-FR') : '—';
}

/**
 * Fiche d'un bon de commande, sur sa propre page.
 *
 * Le détail d'une commande — cinquante lignes parfois — n'a rien à faire dans une liste dépliée :
 * on l'ouvre, on la lit, on revient. Les réceptions et les factures rattachées sont rappelées ici,
 * puisque c'est là qu'on vient vérifier ce qui reste à recevoir.
 */
export default function FicheCommandePage() {
  const { token } = useAuth();
  const orderId = String(useParams().orderId);

  const fiche = useQuery({
    queryKey: ['commande', orderId],
    enabled: Boolean(token),
    queryFn: () => apiFetch<Fiche>(`/purchase-orders/${orderId}`, { token }),
  });
  const f = fiche.data;

  if (!f) {
    return (
      <div>
        <Link href="/achats" className="link"><ArrowLeft size={13} /> Bons de commande</Link>
        <p className="muted" style={{ marginTop: 16 }}>
          {fiche.isError ? 'Commande introuvable.' : 'Chargement…'}
        </p>
      </div>
    );
  }

  const c = f.commande;
  const factureTotal = f.factures.reduce((t, x) => t + Number(x.amount_ht), 0);

  return (
    <div>
      <p className="muted" style={{ marginTop: 0 }}>
        <Link href="/achats" className="link"><ArrowLeft size={13} /> Bons de commande</Link>
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0 }}>Commande {c.code}</h1>
        <span className={`badge ${BADGE[c.status] ?? 'info'}`}>{STATUTS[c.status] ?? c.status}</span>
        <span style={{ marginLeft: 'auto', fontSize: 20, fontWeight: 700 }}>{euro(c.total_ht)}</span>
      </div>

      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginTop: 10, fontSize: 13 }}>
        <div>
          <span className="muted">Chantier : </span>
          <span style={{
            display: 'inline-block', width: 9, height: 9, borderRadius: 2, marginRight: 6,
            background: teinteChantier(c.chantier_id, c.chantier_couleur),
          }} />
          <Link href={`/chantiers/${c.chantier_id}`} className="link">
            {c.chantier_code} {c.chantier_nom}
          </Link>
        </div>
        <div><span className="muted">Fournisseur : </span>{c.fournisseur ?? '—'}</div>
        <div><span className="muted">Validée le : </span>{jour(c.validated_at)}</div>
      </div>

      <div className="card" style={{ marginTop: 16, padding: 0, overflow: 'hidden' }}>
        <table className="grid" style={{ margin: 0 }}>
          <thead>
            <tr>
              <th>Désignation</th>
              <th>Nature</th>
              <th>Ouvrage</th>
              <th>Code analytique</th>
              <th style={{ width: 100, textAlign: 'right' }}>Qté</th>
              <th style={{ width: 110, textAlign: 'right' }}>PU</th>
              <th style={{ width: 130, textAlign: 'right' }}>Montant HT</th>
            </tr>
          </thead>
          <tbody>
            {f.lignes.map((l) => (
              <tr key={l.id}>
                <td>
                  {l.ressource_code && <span className="code-cell" style={{ marginRight: 6 }}>{l.ressource_code}</span>}
                  {l.designation}
                </td>
                <td className="muted">{NATURES[l.nature] ?? l.nature}</td>
                <td className="muted" style={{ fontSize: 12 }}>{l.ouvrage ?? '—'}</td>
                <td>{l.code_analytique
                  ? <span className="code-cell">{l.code_analytique}</span>
                  : <span className="muted">À ventiler</span>}</td>
                <td style={{ textAlign: 'right' }}>{Number(l.quantity)} {l.unite_achat ?? ''}</td>
                <td style={{ textAlign: 'right' }}>{euro(l.unit_price)}</td>
                <td style={{ textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                  {euro(l.amount_ht)}
                </td>
              </tr>
            ))}
            {f.lignes.length === 0 && (
              <tr><td colSpan={7} className="muted" style={{ padding: 16, textAlign: 'center' }}>
                Cette commande n’a aucune ligne.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 16 }}>
        <div className="card" style={{ flex: '1 1 300px', padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <PackageCheck size={15} /><strong style={{ fontSize: 13 }}>Réceptions</strong>
          </div>
          {f.receptions.length === 0
            ? <span className="muted" style={{ fontSize: 12 }}>Rien de reçu pour l’instant.</span>
            : f.receptions.map((d) => (
              <div key={d.id} style={{ fontSize: 12, padding: '2px 0' }}>
                <span className="code-cell">{d.code}</span>
                <span className="muted"> · {jour(d.received_at)}</span>
              </div>
            ))}
        </div>
        <div className="card" style={{ flex: '1 1 300px', padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <ReceiptText size={15} /><strong style={{ fontSize: 13 }}>Factures</strong>
            {f.factures.length > 0 && (
              <span style={{ marginLeft: 'auto', fontWeight: 600 }}>{euro(factureTotal.toFixed(2))}</span>
            )}
          </div>
          {f.factures.length === 0
            ? <span className="muted" style={{ fontSize: 12 }}>Aucune facture rattachée.</span>
            : f.factures.map((x) => (
              <div key={x.id} style={{ fontSize: 12, padding: '2px 0', display: 'flex', gap: 8 }}>
                <span className="code-cell">{x.code}</span>
                <span className="muted">{jour(x.invoice_date)}</span>
                <span style={{ marginLeft: 'auto' }}>{euro(x.amount_ht)}</span>
              </div>
            ))}
        </div>
      </div>

      <p className="muted" style={{ fontSize: 12, marginTop: 14 }}>
        La saisie des lignes, la réception et la facturation se font depuis le chantier —{' '}
        <Link href={`/chantiers/${c.chantier_id}/achats`} className="link">Achats du chantier</Link>.
        Le verrouillage après envoi, la validation par seuil et l’aperçu PDF arrivent aux étapes
        suivantes.
      </p>
    </div>
  );
}

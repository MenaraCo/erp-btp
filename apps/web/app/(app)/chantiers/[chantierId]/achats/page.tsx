'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { apiFetch, ApiError } from '@/lib/api';
import { euro } from '@/lib/format';

/* ─────────── types ─────────── */
interface OrderLine {
  id: string;
  nature: string;
  designation: string;
  quantity: string;
  unit_price: string;
  amount_ht: string;
  code_analytique: string | null;
}
interface Order {
  id: string;
  code: string;
  status: string;
  supplier_name: string | null;
  total_ht: string;
  lines: OrderLine[];
  deliveries: { id: string; code: string }[];
  invoices: { id: string; code: string; nature: string; amount_ht: string }[];
}
interface Chain {
  requests: { id: string; code: string; status: string; supplier_name: string | null }[];
  orders: Order[];
}
interface Summary {
  engageTotal: string;
  realiseTotal: string;
}

const NATURES: { value: string; label: string }[] = [
  { value: 'material', label: 'Matériaux' },
  { value: 'labor', label: 'Main d’œuvre' },
  { value: 'equipment', label: 'Matériel' },
  { value: 'subcontract', label: 'Sous-traitance' },
  { value: 'site_overhead', label: 'Frais de chantier' },
];
const natureLabel = (v: string) => NATURES.find((n) => n.value === v)?.label ?? v;

const STATUS_LABELS: Record<string, string> = {
  draft: 'Brouillon',
  validated: 'Validé',
  delivered: 'Livré',
  invoiced: 'Facturé',
  cancelled: 'Annulé',
};
const STATUS_BADGE: Record<string, string> = {
  draft: 'info',
  validated: 'success',
  delivered: 'success',
  invoiced: 'success',
  cancelled: 'danger',
};

/** Écran Achats d'un chantier : chaîne demande de prix → BC → BL → facture (cahier §5.5). */
export default function AchatsPage() {
  const { token } = useAuth();
  const qc = useQueryClient();
  const chantierId = String(useParams().chantierId);
  const [err, setErr] = useState<string | null>(null);
  const [newOrderCode, setNewOrderCode] = useState('');

  const chantier = useQuery({
    queryKey: ['chantier', chantierId],
    enabled: Boolean(token),
    queryFn: () => apiFetch<{ code: string }>(`/chantiers/${chantierId}`, { token }),
  });
  const chain = useQuery({
    queryKey: ['purchasing-chain', chantierId],
    enabled: Boolean(token),
    retry: false,
    queryFn: () => apiFetch<Chain>(`/chantiers/${chantierId}/purchasing-chain`, { token }),
  });
  const summary = useQuery({
    queryKey: ['purchasing-summary', chantierId],
    enabled: Boolean(token),
    retry: false,
    queryFn: () => apiFetch<Summary>(`/chantiers/${chantierId}/purchasing-summary`, { token }),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['purchasing-chain', chantierId] });
    qc.invalidateQueries({ queryKey: ['purchasing-summary', chantierId] });
  };
  const onError = (e: unknown) => setErr(e instanceof ApiError ? e.message : 'Erreur');

  const createOrder = useMutation({
    mutationFn: () =>
      apiFetch(`/chantiers/${chantierId}/purchase-orders`, { method: 'POST', token, body: { code: newOrderCode || undefined } }),
    onSuccess: () => { setErr(null); setNewOrderCode(''); refresh(); },
    onError,
  });
  const validate = useMutation({
    mutationFn: (orderId: string) => apiFetch(`/purchase-orders/${orderId}/validate`, { method: 'POST', token }),
    onSuccess: () => { setErr(null); refresh(); },
    onError,
  });
  const cancel = useMutation({
    mutationFn: (orderId: string) => apiFetch(`/purchase-orders/${orderId}/cancel`, { method: 'POST', token }),
    onSuccess: () => { setErr(null); refresh(); },
    onError,
  });

  return (
    <div>
      <p className="muted" style={{ marginTop: 0 }}>
        <Link href={`/chantiers/${chantierId}`} className="link">← Chantier {chantier.data?.code ?? ''}</Link>
      </p>
      <h1 style={{ marginBottom: 4 }}>Chaîne des achats</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Commande → réception → facture. L’engagé est compté dès la validation du bon de commande.
      </p>

      {summary.data && (
        <div className="card-grid" style={{ marginTop: 12 }}>
          <div className="card"><h2>Engagé (commandes validées)</h2><div className="stat">{euro(summary.data.engageTotal)}</div></div>
          <div className="card"><h2>Réalisé (factures)</h2><div className="stat">{euro(summary.data.realiseTotal)}</div></div>
        </div>
      )}
      {chain.isError && (
        <p className="muted">Module « Suivi de chantiers » non actif pour cet utilisateur, ou accès refusé.</p>
      )}

      {err && <div className="error" style={{ marginTop: 12 }}>{err}</div>}

      <div className="card" style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Nouveau bon de commande</label>
            <input value={newOrderCode} onChange={(e) => setNewOrderCode(e.target.value)} placeholder="Code (optionnel)" style={{ width: 180 }} />
          </div>
          <button className="btn" disabled={createOrder.isPending} onClick={() => { setErr(null); createOrder.mutate(); }}>
            {createOrder.isPending ? 'Création…' : 'Créer un BC'}
          </button>
        </div>
      </div>

      {(chain.data?.orders ?? []).map((o) => (
        <OrderCard
          key={o.id}
          order={o}
          token={token}
          onError={onError}
          onChanged={refresh}
          onValidate={() => validate.mutate(o.id)}
          onCancel={() => cancel.mutate(o.id)}
          busy={validate.isPending || cancel.isPending}
        />
      ))}
      {chain.data && chain.data.orders.length === 0 && (
        <p className="muted" style={{ marginTop: 16 }}>Aucune commande. Créez le premier bon de commande ci-dessus.</p>
      )}
    </div>
  );
}

/* ─────────── carte d'une commande ─────────── */
function OrderCard({
  order, token, onError, onChanged, onValidate, onCancel, busy,
}: {
  order: Order;
  token: string | null;
  onError: (e: unknown) => void;
  onChanged: () => void;
  onValidate: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const qc = useQueryClient();
  const [nature, setNature] = useState('material');
  const [designation, setDesignation] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  const [blCode, setBlCode] = useState('');
  const [invCode, setInvCode] = useState('');
  const [invAmount, setInvAmount] = useState('');
  const [invNature, setInvNature] = useState('material');

  const draft = order.status === 'draft';

  const addLine = useMutation({
    mutationFn: () =>
      apiFetch(`/purchase-orders/${order.id}/lines`, {
        method: 'POST', token, body: { nature, designation, quantity, unitPrice },
      }),
    onSuccess: () => {
      setDesignation(''); setQuantity(''); setUnitPrice('');
      qc.invalidateQueries({ queryKey: ['purchasing-chain'] });
      qc.invalidateQueries({ queryKey: ['purchasing-summary'] });
      onChanged();
    },
    onError,
  });
  const doReceive = useMutation({
    mutationFn: () =>
      apiFetch(`/purchase-orders/${order.id}/delivery-notes`, {
        method: 'POST', token, body: { code: blCode },
      }),
    onSuccess: () => { setBlCode(''); onChanged(); },
    onError,
  });
  const addInvoice = useMutation({
    mutationFn: () =>
      apiFetch(`/purchase-orders/${order.id}/invoices`, {
        method: 'POST', token, body: { code: invCode, nature: invNature, amountHt: invAmount },
      }),
    onSuccess: () => { setInvCode(''); setInvAmount(''); onChanged(); },
    onError,
  });

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>BC {order.code}</h2>
        <span className={`badge ${STATUS_BADGE[order.status] ?? 'info'}`}>{STATUS_LABELS[order.status] ?? order.status}</span>
        {order.supplier_name && <span className="muted">· {order.supplier_name}</span>}
        <span style={{ marginLeft: 'auto', fontWeight: 700 }}>{euro(order.total_ht)}</span>
      </div>

      {order.lines.length > 0 && (
        <table className="grid" style={{ marginTop: 10 }}>
          <thead>
            <tr>
              <th>Nature</th><th>Désignation</th>
              <th style={{ textAlign: 'right' }}>Qté</th>
              <th style={{ textAlign: 'right' }}>PU</th>
              <th style={{ textAlign: 'right' }}>Montant HT</th>
              <th>Code analytique</th>
            </tr>
          </thead>
          <tbody>
            {order.lines.map((l) => (
              <tr key={l.id}>
                <td>{natureLabel(l.nature)}</td>
                <td>{l.designation}</td>
                <td style={{ textAlign: 'right' }}>{l.quantity}</td>
                <td style={{ textAlign: 'right' }}>{euro(l.unit_price)}</td>
                <td style={{ textAlign: 'right', fontWeight: 600 }}>{euro(l.amount_ht)}</td>
                <td>{l.code_analytique ? <span className="code-cell">{l.code_analytique}</span> : <span className="muted">Non réparti</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Ajout de ligne : seulement tant que le BC est en brouillon */}
      {draft && (
        <form
          style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 10 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (!designation.trim() || !quantity || !unitPrice) return;
            addLine.mutate();
          }}
        >
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Nature</label>
            <select value={nature} onChange={(e) => setNature(e.target.value)} style={{ width: 150 }}>
              {NATURES.map((n) => <option key={n.value} value={n.value}>{n.label}</option>)}
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Désignation</label>
            <input value={designation} onChange={(e) => setDesignation(e.target.value)} style={{ width: 200 }} />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Qté</label>
            <input type="number" min={0} step="0.01" value={quantity} onChange={(e) => setQuantity(e.target.value)} style={{ width: 80, textAlign: 'right' }} />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>PU (€)</label>
            <input type="number" min={0} step="0.01" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} style={{ width: 100, textAlign: 'right' }} />
          </div>
          <button className="btn btn-secondary" type="submit" disabled={addLine.isPending}>Ajouter la ligne</button>
        </form>
      )}

      {/* Bons de livraison et factures */}
      {(order.deliveries.length > 0 || order.invoices.length > 0) && (
        <div style={{ display: 'flex', gap: 24, marginTop: 12, flexWrap: 'wrap' }}>
          {order.deliveries.length > 0 && (
            <div className="muted" style={{ fontSize: 12 }}>
              <strong>Bons de livraison :</strong> {order.deliveries.map((d) => d.code).join(', ')}
            </div>
          )}
          {order.invoices.length > 0 && (
            <div className="muted" style={{ fontSize: 12 }}>
              <strong>Factures :</strong> {order.invoices.map((i) => `${i.code} (${euro(i.amount_ht)})`).join(', ')}
            </div>
          )}
        </div>
      )}

      {/* Actions de workflow */}
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        {draft && order.lines.length > 0 && (
          <button className="btn" disabled={busy} onClick={onValidate}>Valider le BC</button>
        )}
        {order.status === 'validated' && (
          <>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>N° bon de livraison</label>
              <input value={blCode} onChange={(e) => setBlCode(e.target.value)} placeholder="BL-…" style={{ width: 130 }} />
            </div>
            <button className="btn btn-secondary" disabled={busy || doReceive.isPending || !blCode.trim()} onClick={() => doReceive.mutate()}>
              Réceptionner
            </button>
          </>
        )}
        {order.status !== 'cancelled' && order.status !== 'invoiced' && (
          <button className="btn-ghost" disabled={busy} onClick={onCancel}>Annuler le BC</button>
        )}
      </div>

      {/* Facture fournisseur : possible dès la validation */}
      {(order.status === 'validated' || order.status === 'delivered') && (
        <form
          style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 12, flexWrap: 'wrap' }}
          onSubmit={(e) => {
            e.preventDefault();
            if (!invCode.trim() || !invAmount) return;
            addInvoice.mutate();
          }}
        >
          <div className="field" style={{ marginBottom: 0 }}>
            <label>N° facture</label>
            <input value={invCode} onChange={(e) => setInvCode(e.target.value)} placeholder="FF-…" style={{ width: 120 }} />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Nature</label>
            <select value={invNature} onChange={(e) => setInvNature(e.target.value)} style={{ width: 150 }}>
              {NATURES.map((n) => <option key={n.value} value={n.value}>{n.label}</option>)}
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Montant HT (€)</label>
            <input type="number" min={0} step="0.01" value={invAmount} onChange={(e) => setInvAmount(e.target.value)} style={{ width: 120, textAlign: 'right' }} />
          </div>
          <button className="btn btn-secondary" type="submit" disabled={addInvoice.isPending}>Enregistrer la facture</button>
        </form>
      )}
    </div>
  );
}

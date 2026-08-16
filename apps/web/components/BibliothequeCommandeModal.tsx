'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { euro } from '@/lib/format';

interface Library { id: string; code: string; name: string }
interface Resource {
  id: string;
  code: string;
  label: string;
  unit: string | null;
  nature: string;
  unitCost: string;
  uniteAchat?: string | null;
  coeffConversion?: string | null;
  refFournisseur?: string | null;
  codeAnalytiqueCode?: string | null;
}
interface Page<T> { rows: T[]; total: number }

const NATURES: Record<string, string> = {
  material: 'Matériaux', equipment: 'Matériel', subcontract: 'Sous-traitance',
  labor: 'Main d’œuvre', site_overhead: 'Frais de chantier',
};

/**
 * Insertion d'articles depuis la BIBLIOTHÈQUE GÉNÉRALE du module chantier.
 *
 * À ne pas confondre avec l'approvisionnement depuis le chantier : celui-là reprend ce qui a été
 * BUDGÉTÉ, avec ses quantités et son reste à commander. Ici on pioche dans le catalogue de
 * l'entreprise ce qui n'était pas prévu — un consommable, un article de dernière minute — et la
 * quantité se saisit forcément à la main, puisqu'aucun budget ne la dicte.
 */
export function BibliothequeCommandeModal({
  orderId,
  onClose,
  onInsere,
}: {
  orderId: string;
  onClose: () => void;
  onInsere: (nombre: number) => void;
}) {
  const { token } = useAuth();
  const qc = useQueryClient();
  const [libId, setLibId] = useState('');
  const [recherche, setRecherche] = useState('');
  const [nature, setNature] = useState('');
  const [quantites, setQuantites] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);

  const libs = useQuery({
    queryKey: ['libraries', 'chantier'],
    enabled: Boolean(token),
    queryFn: () => apiFetch<Page<Library>>('/libraries?pageSize=100&scope=chantier', { token }),
  });
  const bibliotheque = libId || libs.data?.rows[0]?.id || '';

  const requete = useMemo(() => {
    const p = new URLSearchParams({ pageSize: '200' });
    if (recherche) p.set('search', recherche);
    if (nature) p.set('nature', nature);
    return p.toString();
  }, [recherche, nature]);

  const articles = useQuery({
    queryKey: ['resources-commande', bibliotheque, requete],
    enabled: Boolean(token && bibliotheque),
    queryFn: () => apiFetch<Page<Resource>>(`/libraries/${bibliotheque}/resources?${requete}`, { token }),
  });

  const inserer = useMutation({
    mutationFn: () => apiFetch<{ inserees: number }>(
      `/purchase-orders/${orderId}/lines/bibliotheque`,
      {
        method: 'POST', token,
        body: {
          articles: Object.entries(quantites)
            .filter(([, q]) => Number(q) > 0)
            .map(([resourceId, quantite]) => ({ resourceId, quantite })),
        },
      },
    ),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['commande', orderId] });
      onInsere(r.inserees);
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Insertion impossible.'),
  });

  const lignes = articles.data?.rows ?? [];
  const choisis = Object.entries(quantites).filter(([, q]) => Number(q) > 0);
  const total = lignes.reduce((t, r) => {
    const q = Number(quantites[r.id] || 0);
    return t + q * Number(r.unitCost) * Number(r.coeffConversion || 1);
  }, 0);

  return (
    <div className="modal-overlay" style={overlay} onClick={onClose}>
      <div className="modal-box" style={panel} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <strong style={{ fontSize: 16 }}>Bibliothèque générale du chantier</strong>
            <p className="muted" style={{ margin: '2px 0 0', fontSize: 12 }}>
              Le catalogue de l’entreprise — pour ce qui n’était pas prévu au budget. Les quantités
              se saisissent à la main : aucun budget ne les dicte ici.
            </p>
          </div>
          <button className="btn btn-ghost" onClick={onClose} style={{ fontSize: 18 }}>✕</button>
        </div>

        {err && <div className="error" style={{ marginBottom: 12 }}>{err}</div>}

        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 10 }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Bibliothèque</label>
            <select value={bibliotheque} onChange={(e) => setLibId(e.target.value)} style={{ minWidth: 180 }}>
              {(libs.data?.rows ?? []).map((l) => (
                <option key={l.id} value={l.id}>{l.code} — {l.name}</option>
              ))}
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Recherche</label>
            <input
              value={recherche}
              placeholder="Code ou désignation…"
              onChange={(e) => setRecherche(e.target.value)}
              style={{ width: 230 }}
            />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Nature</label>
            <select value={nature} onChange={(e) => setNature(e.target.value)}>
              <option value="">Toutes</option>
              {Object.entries(NATURES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        </div>

        <div style={{ maxHeight: '48vh', overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
          <table className="grid" style={{ margin: 0 }}>
            <thead>
              <tr>
                <th style={{ width: 110 }}>Code</th>
                <th>Désignation</th>
                <th style={{ width: 120 }}>Nature</th>
                <th style={{ width: 100 }}>Code analyt.</th>
                <th style={{ width: 110, textAlign: 'right' }}>PU achat</th>
                <th style={{ width: 110, textAlign: 'right' }}>Quantité</th>
              </tr>
            </thead>
            <tbody>
              {lignes.map((r) => {
                const coeff = Number(r.coeffConversion || 1);
                const puAchat = Number(r.unitCost) * coeff;
                return (
                  <tr key={r.id}>
                    <td className="code-cell">{r.code}</td>
                    <td>
                      {r.label}
                      {r.refFournisseur && <span className="muted" style={{ fontSize: 11 }}> · réf. {r.refFournisseur}</span>}
                    </td>
                    <td className="muted">{NATURES[r.nature] ?? r.nature}</td>
                    <td>
                      {r.codeAnalytiqueCode
                        ? <span className="code-cell">{r.codeAnalytiqueCode}</span>
                        : <span className="muted" title="À renseigner sur la ligne de commande">À ventiler</span>}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {euro(puAchat.toFixed(2))}
                      <span className="muted" style={{ fontSize: 11 }}> /{r.uniteAchat ?? r.unit ?? ''}</span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <input
                        type="number" min={0} step="0.01"
                        value={quantites[r.id] ?? ''}
                        onChange={(e) => setQuantites({ ...quantites, [r.id]: e.target.value })}
                        style={{ width: 90, textAlign: 'right' }}
                      />
                    </td>
                  </tr>
                );
              })}
              {lignes.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted" style={{ padding: 16, textAlign: 'center' }}>
                    Aucun article dans cette bibliothèque avec ces filtres.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14 }}>
          <span className="muted" style={{ fontSize: 12 }}>
            {choisis.length > 0
              ? `${choisis.length} article${choisis.length > 1 ? 's' : ''} à insérer`
              : 'Saisissez une quantité pour choisir un article'}
          </span>
          <strong style={{ marginLeft: 'auto' }}>{euro(total.toFixed(2))}</strong>
          <button className="btn btn-secondary" onClick={onClose}>Annuler</button>
          <button
            className="btn"
            disabled={choisis.length === 0 || inserer.isPending}
            onClick={() => { setErr(null); inserer.mutate(); }}
          >
            {inserer.isPending ? 'Insertion…' : 'Insérer dans la commande'}
          </button>
        </div>
      </div>
    </div>
  );
}

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(15,23,42,.5)', zIndex: 1100,
  display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 20px',
  overflowY: 'auto',
};
const panel: React.CSSProperties = {
  borderRadius: 12, padding: '20px 24px', width: 1000, maxWidth: '100%',
};

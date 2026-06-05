'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { apiFetch, ApiError } from '@/lib/api';
import { euro } from '@/lib/format';

interface MarcheLine {
  id: string;
  code: string | null;
  designation: string;
  unit: string | null;
  quantite: string;
  pu: string;
  montant_ht: string;
}
interface MarcheDetail {
  marche: { id: string; code: string; name: string; total_ht: string };
  lines: MarcheLine[];
}
interface Situation {
  id: string;
  numero: number;
  montant_periode_ht: string;
  cumul_ht: string;
  tva: string;
  ttc: string;
  retenue_garantie: string;
  nap: string;
}

export default function MarcheDetailPage() {
  const { token } = useAuth();
  const qc = useQueryClient();
  const marcheId = String(useParams().marcheId);
  const [pct, setPct] = useState<Record<string, string>>({});
  const [retenue, setRetenue] = useState('0.05');
  const [err, setErr] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: ['marche', marcheId],
    enabled: Boolean(token),
    queryFn: () => apiFetch<MarcheDetail>(`/marches/${marcheId}`, { token }),
  });
  const situations = useQuery({
    queryKey: ['situations', marcheId],
    enabled: Boolean(token),
    queryFn: () => apiFetch<Situation[]>(`/marches/${marcheId}/situations`, { token }),
  });

  const create = useMutation({
    mutationFn: () =>
      apiFetch(`/marches/${marcheId}/situations`, {
        method: 'POST',
        body: {
          retenueRate: retenue || '0',
          lines: (detail.data?.lines ?? []).map((l) => ({
            marcheLineId: l.id,
            pctAvancement: pct[l.id] || '0',
          })),
        },
        token,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['situations', marcheId] });
      setPct({});
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Erreur'),
  });

  const m = detail.data;

  return (
    <div>
      <p className="muted" style={{ marginTop: 0 }}>
        <Link href="/invoicing" className="link">← Facturation</Link>
      </p>
      {detail.isError && <p className="muted">Marché introuvable ou accès non autorisé.</p>}
      {err && <div className="error">{err}</div>}

      {m && (
        <>
          <h1 style={{ marginBottom: 4 }}>Marché {m.marche.code}</h1>
          <p className="muted" style={{ marginTop: 0 }}>{m.marche.name} · Total marché {euro(m.marche.total_ht)}</p>

          <div className="card" style={{ marginTop: 12 }}>
            <h2>Nouvelle situation</h2>
            {m.lines.length === 0 ? (
              <p className="muted">Ce marché n'a pas de lignes facturables.</p>
            ) : (
              <form onSubmit={(e) => { e.preventDefault(); setErr(null); create.mutate(); }}>
                <table className="grid">
                  <thead>
                    <tr>
                      <th>Ligne</th>
                      <th style={{ textAlign: 'right' }}>Qté</th>
                      <th style={{ textAlign: 'right' }}>PU</th>
                      <th style={{ textAlign: 'right' }}>Montant marché</th>
                      <th style={{ textAlign: 'right' }}>Avancement (0 à 1)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {m.lines.map((l) => (
                      <tr key={l.id}>
                        <td>{l.code ? <strong>{l.code} </strong> : null}{l.designation}</td>
                        <td style={{ textAlign: 'right' }}>{l.quantite} {l.unit ?? ''}</td>
                        <td style={{ textAlign: 'right' }}>{euro(l.pu)}</td>
                        <td style={{ textAlign: 'right' }}>{euro(l.montant_ht)}</td>
                        <td style={{ textAlign: 'right' }}>
                          <input
                            style={{ width: 80, textAlign: 'right' }}
                            value={pct[l.id] ?? ''}
                            placeholder="0.50"
                            onChange={(e) => setPct({ ...pct, [l.id]: e.target.value })}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'flex-end' }}>
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label>Retenue de garantie (0 à 1)</label>
                    <input style={{ width: 90 }} value={retenue} onChange={(e) => setRetenue(e.target.value)} />
                  </div>
                  <button className="btn" type="submit" disabled={create.isPending}>
                    {create.isPending ? 'Calcul…' : 'Créer la situation'}
                  </button>
                </div>
              </form>
            )}
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <h2>Situations {situations.data ? `(${situations.data.length})` : ''}</h2>
            {situations.data && situations.data.length > 0 ? (
              <table className="grid">
                <thead>
                  <tr>
                    <th>N°</th>
                    <th style={{ textAlign: 'right' }}>Montant période HT</th>
                    <th style={{ textAlign: 'right' }}>Cumul HT</th>
                    <th style={{ textAlign: 'right' }}>TVA</th>
                    <th style={{ textAlign: 'right' }}>TTC</th>
                    <th style={{ textAlign: 'right' }}>Retenue</th>
                    <th style={{ textAlign: 'right' }}>Net à payer</th>
                  </tr>
                </thead>
                <tbody>
                  {situations.data.map((s) => (
                    <tr key={s.id}>
                      <td>{s.numero}</td>
                      <td style={{ textAlign: 'right' }}>{euro(s.montant_periode_ht)}</td>
                      <td style={{ textAlign: 'right' }}>{euro(s.cumul_ht)}</td>
                      <td style={{ textAlign: 'right' }}>{euro(s.tva)}</td>
                      <td style={{ textAlign: 'right' }}>{euro(s.ttc)}</td>
                      <td style={{ textAlign: 'right' }}>{euro(s.retenue_garantie)}</td>
                      <td style={{ textAlign: 'right' }}>{euro(s.nap)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="muted">Aucune situation. Renseignez les avancements ci-dessus et créez la première.</p>}
          </div>
        </>
      )}
    </div>
  );
}

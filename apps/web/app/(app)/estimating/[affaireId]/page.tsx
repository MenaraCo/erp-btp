'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { apiFetch, ApiError } from '@/lib/api';
import { AFFAIRE_STATUS_LABELS, euro } from '@/lib/format';

interface Kpis {
  debourse: string; revient: string; pvHt: string; margeBrute: string; margeNette: string;
}
interface DevisRow {
  id: string; numero: string | null; designation: string; type: string; status: string;
  versions: { id: string; version_no: number }[];
  kpis: Kpis | null;
}
interface Lieu {
  adresse?: string; code_postal?: string; ville?: string; pays?: string;
}
interface AffaireDetail {
  affaire: {
    id: string; code: string; name: string; status: string; moa: string | null;
    lieu_execution: Lieu | null; budget_objectif: string | null; responsable: string | null; notes: string | null;
  };
  devis: DevisRow[];
  totals: Kpis;
}

/** Libellés du statut DÉRIVÉ de l'affaire (calculé depuis ses devis). */
const AFFAIRE_DERIVED_LABELS: Record<string, string> = {
  en_cours: 'En cours', gagnee_partielle: 'Gagnée partiellement', gagnee: 'Gagnée', perdue: 'Perdue',
};
const DEVIS_TYPE_LABELS: Record<string, string> = { principal: 'Principal', lot: 'Lot', avenant: 'Avenant' };

export default function AffaireDetailPage() {
  const { token } = useAuth();
  const qc = useQueryClient();
  const affaireId = String(useParams().affaireId);
  const [err, setErr] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: ['affaire', affaireId],
    enabled: Boolean(token),
    queryFn: () => apiFetch<AffaireDetail>(`/affaires/${affaireId}`, { token }),
  });

  // --- métadonnées affaire ---
  const [meta, setMeta] = useState({ responsable: '', budget: '', adresse: '', cp: '', ville: '', notes: '' });
  const metaInit = useRef<string | null>(null);
  useEffect(() => {
    const a = detail.data?.affaire;
    if (!a || metaInit.current === affaireId) return;
    metaInit.current = affaireId;
    const l = a.lieu_execution ?? {};
    setMeta({
      responsable: a.responsable ?? '', budget: a.budget_objectif ?? '',
      adresse: l.adresse ?? '', cp: l.code_postal ?? '', ville: l.ville ?? '', notes: a.notes ?? '',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.data]);

  const saveMeta = useMutation({
    mutationFn: () => apiFetch(`/affaires/${affaireId}`, {
      method: 'PATCH',
      body: {
        responsable: meta.responsable || null,
        budgetObjectif: meta.budget || null,
        lieuExecution: { adresse: meta.adresse, code_postal: meta.cp, ville: meta.ville, pays: 'FR' },
        notes: meta.notes || null,
      },
      token,
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['affaire', affaireId] }),
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Erreur'),
  });

  // --- nouveau devis ---
  const [nd, setNd] = useState({ designation: '', type: 'lot', numero: '' });
  const addDevis = useMutation({
    mutationFn: () => apiFetch(`/affaires/${affaireId}/devis`, {
      method: 'POST',
      body: { designation: nd.designation, type: nd.type, numero: nd.numero || null },
      token,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['affaire', affaireId] }); setNd({ designation: '', type: 'lot', numero: '' }); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Erreur'),
  });

  const a = detail.data?.affaire;
  const totals = detail.data?.totals;
  const marge = totals && Number(totals.pvHt) > 0 ? (Number(totals.margeNette) / Number(totals.pvHt)) * 100 : null;

  return (
    <div>
      <p className="muted" style={{ marginTop: 0 }}>
        <Link href="/estimating" className="link">← Affaires</Link>
      </p>
      {detail.isError && <p className="muted">Affaire introuvable ou accès non autorisé.</p>}
      {err && <div className="error">{err}</div>}

      {a && (
        <>
          <h1 style={{ marginBottom: 4 }}>{a.code} — {a.name}</h1>
          <p className="muted" style={{ marginTop: 0 }}>
            <span className="badge">{AFFAIRE_DERIVED_LABELS[a.status] ?? a.status}</span>
            {a.responsable ? ` · Resp. ${a.responsable}` : ''}
            {a.lieu_execution?.ville ? ` · ${a.lieu_execution.ville}` : ''}
            {a.moa ? ` · MOA : ${a.moa}` : ''}
          </p>

          <div className="card-grid" style={{ marginTop: 12 }}>
            <div className="card"><h2>Déboursé</h2><div className="stat">{euro(totals?.debourse)}</div></div>
            <div className="card"><h2>Prix de revient</h2><div className="stat">{euro(totals?.revient)}</div></div>
            <div className="card"><h2>Total HT</h2><div className="stat">{euro(totals?.pvHt)}</div></div>
            <div className="card">
              <h2>Marge nette</h2><div className="stat">{euro(totals?.margeNette)}</div>
              {marge != null && <p className="muted" style={{ margin: 0 }}>{marge.toFixed(1)} %</p>}
            </div>
            <div className="card"><h2>Budget objectif</h2><div className="stat">{a.budget_objectif ? euro(a.budget_objectif) : '—'}</div></div>
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0 }}>Devis de l’affaire</h2>
            </div>
            {detail.data && detail.data.devis.length > 0 ? (
              <table className="grid" style={{ marginTop: 12 }}>
                <thead><tr>
                  <th>Désignation</th><th>Type</th><th>Statut</th>
                  <th style={{ textAlign: 'right' }}>Déboursé</th>
                  <th style={{ textAlign: 'right' }}>PV HT</th>
                  <th style={{ textAlign: 'right' }}>Marge nette</th>
                  <th />
                </tr></thead>
                <tbody>
                  {detail.data.devis.map((dv) => (
                    <tr key={dv.id}>
                      <td>{dv.numero ? <strong>{dv.numero} </strong> : null}{dv.designation}</td>
                      <td className="muted">{DEVIS_TYPE_LABELS[dv.type] ?? dv.type}</td>
                      <td><span className="badge">{AFFAIRE_STATUS_LABELS[dv.status] ?? dv.status}</span></td>
                      <td style={{ textAlign: 'right' }}>{euro(dv.kpis?.debourse)}</td>
                      <td style={{ textAlign: 'right' }}>{euro(dv.kpis?.pvHt)}</td>
                      <td style={{ textAlign: 'right' }}>{euro(dv.kpis?.margeNette)}</td>
                      <td style={{ textAlign: 'right' }}>
                        <Link className="link" href={`/estimating/${affaireId}/devis/${dv.id}`}>Ouvrir →</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="muted">Aucun devis. Ajoutez-en un ci-dessous.</p>}

            <form
              style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}
              onSubmit={(e) => { e.preventDefault(); setErr(null); if (nd.designation) addDevis.mutate(); }}
            >
              <Field label="N° (optionnel)"><input style={{ width: 90 }} value={nd.numero} onChange={(e) => setNd({ ...nd, numero: e.target.value })} /></Field>
              <Field label="Désignation"><input placeholder="Lot 2 — Sols" value={nd.designation} onChange={(e) => setNd({ ...nd, designation: e.target.value })} /></Field>
              <Field label="Type">
                <select value={nd.type} onChange={(e) => setNd({ ...nd, type: e.target.value })}>
                  <option value="lot">Lot</option>
                  <option value="principal">Principal</option>
                  <option value="avenant">Avenant</option>
                </select>
              </Field>
              <button className="btn" type="submit" disabled={addDevis.isPending}>+ Nouveau devis</button>
            </form>
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <h2>Informations de l’affaire</h2>
            <p className="muted" style={{ marginTop: 0 }}>Client et lieu d’exécution sont partagés par tous les devis de l’affaire.</p>
            <form
              style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}
              onSubmit={(e) => { e.preventDefault(); setErr(null); saveMeta.mutate(); }}
            >
              <Field label="Responsable"><input value={meta.responsable} onChange={(e) => setMeta({ ...meta, responsable: e.target.value })} /></Field>
              <Field label="Budget objectif (€)"><input style={{ width: 110 }} value={meta.budget} onChange={(e) => setMeta({ ...meta, budget: e.target.value })} /></Field>
              <Field label="Adresse"><input value={meta.adresse} onChange={(e) => setMeta({ ...meta, adresse: e.target.value })} /></Field>
              <Field label="Code postal"><input style={{ width: 80 }} value={meta.cp} onChange={(e) => setMeta({ ...meta, cp: e.target.value })} /></Field>
              <Field label="Ville"><input value={meta.ville} onChange={(e) => setMeta({ ...meta, ville: e.target.value })} /></Field>
              <Field label="Notes"><input style={{ width: 220 }} value={meta.notes} onChange={(e) => setMeta({ ...meta, notes: e.target.value })} /></Field>
              <button className="btn" type="submit" disabled={saveMeta.isPending}>Enregistrer</button>
            </form>
          </div>
        </>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="field" style={{ marginBottom: 0 }}><label>{label}</label>{children}</div>;
}

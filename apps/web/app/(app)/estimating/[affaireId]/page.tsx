'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { apiFetch, apiFetchBlobUrl, ApiError } from '@/lib/api';
import { AFFAIRE_STATUS_LABELS, euro } from '@/lib/format';

interface Version { id: string; version_no: number; label: string }
interface AffaireDetail {
  affaire: { id: string; code: string; name: string; status: string; moa: string | null };
  versions: Version[];
}
interface DevisLine {
  id: string;
  parent_line_id: string | null;
  type: string;
  code: string | null;
  designation: string;
  unit: string | null;
  quantity: string | null;
  pu: string | null;
  sort_order: number;
}
interface SaleSheet { totalDebourse: string; totalPvHt: string; tva: string; totalTtc: string }
interface Library { id: string; code: string; name: string }
interface Ouvrage { id: string; code: string; label: string; unit: string; debourse: string }
interface Page<T> { rows: T[] }

const TYPE_LABELS: Record<string, string> = { titre: 'Titre', sous_titre: 'Sous-titre', ouvrage: 'Ouvrage', ressource: 'Ressource' };

function orderTree(lines: DevisLine[]): { line: DevisLine; depth: number }[] {
  const byParent = new Map<string | null, DevisLine[]>();
  for (const l of lines) (byParent.get(l.parent_line_id) ?? byParent.set(l.parent_line_id, []).get(l.parent_line_id)!).push(l);
  for (const arr of byParent.values()) arr.sort((a, b) => a.sort_order - b.sort_order);
  const out: { line: DevisLine; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const l of byParent.get(parent) ?? []) { out.push({ line: l, depth }); walk(l.id, depth + 1); }
  };
  walk(null, 0);
  return out;
}

export default function AffaireDetailPage() {
  const { token } = useAuth();
  const qc = useQueryClient();
  const affaireId = String(useParams().affaireId);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: ['affaire', affaireId],
    enabled: Boolean(token),
    queryFn: () => apiFetch<AffaireDetail>(`/affaires/${affaireId}`, { token }),
  });
  const versionId = detail.data?.versions[detail.data.versions.length - 1]?.id;
  const latest = detail.data?.versions[detail.data.versions.length - 1];

  const lines = useQuery({
    queryKey: ['lines', versionId],
    enabled: Boolean(token && versionId),
    queryFn: () => apiFetch<DevisLine[]>(`/versions/${versionId}/lines`, { token }),
  });
  const sale = useQuery({
    queryKey: ['sale-sheet', versionId],
    enabled: Boolean(token && versionId),
    retry: false,
    queryFn: () => apiFetch<SaleSheet>(`/versions/${versionId}/sale-sheet`, { token }),
  });
  const libs = useQuery({
    queryKey: ['libraries'],
    enabled: Boolean(token),
    queryFn: () => apiFetch<Page<Library>>('/libraries?pageSize=100', { token }),
  });

  const ordered = useMemo(() => orderTree(lines.data ?? []), [lines.data]);
  const parents = ordered.filter((o) => o.line.type === 'titre' || o.line.type === 'sous_titre');

  function refresh() {
    qc.invalidateQueries({ queryKey: ['lines', versionId] });
    qc.invalidateQueries({ queryKey: ['sale-sheet', versionId] });
  }

  // --- add line ---
  const [pl, setPl] = useState({ parentId: '', type: 'titre', code: '', designation: '', libId: '', ouvrageId: '', unit: '', quantity: '', formula: '' });
  const ouvragesOfLib = useQuery({
    queryKey: ['ouvrages', pl.libId],
    enabled: Boolean(token && pl.libId),
    queryFn: () => apiFetch<Page<Ouvrage>>(`/libraries/${pl.libId}/ouvrages?pageSize=200`, { token }),
  });

  const addLine = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        type: pl.type,
        parentLineId: pl.parentId || null,
        code: pl.code || null,
        designation: pl.designation,
      };
      if (pl.type === 'ouvrage') {
        body.sourceOuvrageId = pl.ouvrageId;
        body.unit = pl.unit || null;
        if (pl.formula) body.quantityFormula = pl.formula;
        else body.quantity = pl.quantity || '0';
      }
      return apiFetch(`/versions/${versionId}/lines`, { method: 'POST', body, token });
    },
    onSuccess: () => {
      refresh();
      setPl({ ...pl, code: '', designation: '', ouvrageId: '', unit: '', quantity: '', formula: '' });
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Erreur'),
  });

  // --- métré variable ---
  const [varForm, setVarForm] = useState({ name: '', value: '' });
  const setVar = useMutation({
    mutationFn: () => apiFetch(`/versions/${versionId}/variables/${varForm.name}`, { method: 'PUT', body: { value: varForm.value || '0' }, token }),
    onSuccess: () => { refresh(); setVarForm({ name: '', value: '' }); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Erreur'),
  });

  // --- coefficients (feuille de vente) ---
  const [coef, setCoef] = useState({ labor: '1.5', material: '1.2', equipment: '1.2', subcontract: '1.1', frais: '1.1', tva: '0.20' });
  const setSale = useMutation({
    mutationFn: () =>
      apiFetch(`/versions/${versionId}/sale-sheet`, {
        method: 'PUT',
        body: {
          byNature: { labor: coef.labor, material: coef.material, equipment: coef.equipment, subcontract: coef.subcontract },
          fraisCoefficient: coef.frais,
          tvaRate: coef.tva,
        },
        token,
      }),
    onSuccess: () => refresh(),
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Erreur'),
  });

  async function downloadPdf() {
    if (!versionId) return;
    setPdfError(null);
    try { window.open(await apiFetchBlobUrl(`/versions/${versionId}/devis.pdf`, token), '_blank'); }
    catch { setPdfError('PDF indisponible.'); }
  }

  const a = detail.data?.affaire;

  return (
    <div>
      <p className="muted" style={{ marginTop: 0 }}>
        <Link href="/estimating" className="link">← Devis</Link>
      </p>
      {detail.isError && <p className="muted">Affaire introuvable ou accès non autorisé.</p>}
      {err && <div className="error">{err}</div>}

      {a && (
        <>
          <h1 style={{ marginBottom: 4 }}>{a.code} — {a.name}</h1>
          <p className="muted" style={{ marginTop: 0 }}>
            <span className="badge">{AFFAIRE_STATUS_LABELS[a.status] ?? a.status}</span>
            {a.moa ? ` · MOA : ${a.moa}` : ''}{latest ? ` · Version ${latest.version_no}` : ''}
          </p>

          <div className="card-grid" style={{ marginTop: 12 }}>
            <div className="card"><h2>Déboursé</h2><div className="stat">{euro(sale.data?.totalDebourse)}</div></div>
            <div className="card"><h2>Total HT</h2><div className="stat">{euro(sale.data?.totalPvHt)}</div></div>
            <div className="card"><h2>TVA</h2><div className="stat">{euro(sale.data?.tva)}</div></div>
            <div className="card"><h2>Total TTC</h2><div className="stat">{euro(sale.data?.totalTtc)}</div></div>
          </div>
          {sale.isError && <p className="muted">Définissez les coefficients de vente ci-dessous pour calculer les totaux.</p>}

          <div className="card" style={{ marginTop: 16 }}>
            <h2>Construire le devis</h2>
            <form
              style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}
              onSubmit={(e) => {
                e.preventDefault();
                setErr(null);
                if (!pl.designation) { setErr('Désignation requise.'); return; }
                if (pl.type === 'ouvrage' && !pl.ouvrageId) { setErr('Choisissez un ouvrage.'); return; }
                addLine.mutate();
              }}
            >
              <Field label="Parent">
                <select value={pl.parentId} onChange={(e) => setPl({ ...pl, parentId: e.target.value })}>
                  <option value="">(racine)</option>
                  {parents.map((p) => <option key={p.line.id} value={p.line.id}>{'— '.repeat(p.depth)}{p.line.code} {p.line.designation}</option>)}
                </select>
              </Field>
              <Field label="Type">
                <select value={pl.type} onChange={(e) => setPl({ ...pl, type: e.target.value })}>
                  <option value="titre">Titre</option>
                  <option value="sous_titre">Sous-titre</option>
                  <option value="ouvrage">Ouvrage</option>
                </select>
              </Field>
              <Field label="Code"><input style={{ width: 70 }} value={pl.code} onChange={(e) => setPl({ ...pl, code: e.target.value })} /></Field>
              <Field label="Désignation"><input value={pl.designation} onChange={(e) => setPl({ ...pl, designation: e.target.value })} /></Field>
              {pl.type === 'ouvrage' && (
                <>
                  <Field label="Bibliothèque">
                    <select value={pl.libId} onChange={(e) => setPl({ ...pl, libId: e.target.value, ouvrageId: '' })}>
                      <option value="">—</option>
                      {(libs.data?.rows ?? []).map((l) => <option key={l.id} value={l.id}>{l.code}</option>)}
                    </select>
                  </Field>
                  <Field label="Ouvrage">
                    <select
                      value={pl.ouvrageId}
                      onChange={(e) => {
                        const o = (ouvragesOfLib.data?.rows ?? []).find((x) => x.id === e.target.value);
                        setPl({ ...pl, ouvrageId: e.target.value, unit: o?.unit ?? pl.unit, designation: pl.designation || (o?.label ?? '') });
                      }}
                    >
                      <option value="">—</option>
                      {(ouvragesOfLib.data?.rows ?? []).map((o) => <option key={o.id} value={o.id}>{o.code} ({euro(o.debourse)})</option>)}
                    </select>
                  </Field>
                  <Field label="Quantité (métré)"><input style={{ width: 80 }} value={pl.quantity} onChange={(e) => setPl({ ...pl, quantity: e.target.value })} /></Field>
                  <Field label="ou formule"><input style={{ width: 110 }} placeholder="ex: surface*2" value={pl.formula} onChange={(e) => setPl({ ...pl, formula: e.target.value })} /></Field>
                </>
              )}
              <button className="btn" type="submit" disabled={addLine.isPending}>+ Ligne</button>
            </form>

            <form
              style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'flex-end' }}
              onSubmit={(e) => { e.preventDefault(); setErr(null); if (varForm.name) setVar.mutate(); }}
            >
              <Field label="Variable de métré"><input placeholder="nom (ex: surface)" value={varForm.name} onChange={(e) => setVarForm({ ...varForm, name: e.target.value })} /></Field>
              <Field label="Valeur"><input style={{ width: 90 }} value={varForm.value} onChange={(e) => setVarForm({ ...varForm, value: e.target.value })} /></Field>
              <button className="btn" type="submit">Définir variable</button>
            </form>
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <h2>Feuille de vente — coefficients</h2>
            <form
              style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}
              onSubmit={(e) => { e.preventDefault(); setErr(null); setSale.mutate(); }}
            >
              <Field label="MO"><input style={{ width: 60 }} value={coef.labor} onChange={(e) => setCoef({ ...coef, labor: e.target.value })} /></Field>
              <Field label="Matériaux"><input style={{ width: 60 }} value={coef.material} onChange={(e) => setCoef({ ...coef, material: e.target.value })} /></Field>
              <Field label="Matériel"><input style={{ width: 60 }} value={coef.equipment} onChange={(e) => setCoef({ ...coef, equipment: e.target.value })} /></Field>
              <Field label="Sous-trait."><input style={{ width: 60 }} value={coef.subcontract} onChange={(e) => setCoef({ ...coef, subcontract: e.target.value })} /></Field>
              <Field label="Frais"><input style={{ width: 60 }} value={coef.frais} onChange={(e) => setCoef({ ...coef, frais: e.target.value })} /></Field>
              <Field label="TVA"><input style={{ width: 60 }} value={coef.tva} onChange={(e) => setCoef({ ...coef, tva: e.target.value })} /></Field>
              <button className="btn" type="submit" disabled={setSale.isPending}>Appliquer</button>
            </form>
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0 }}>Corps du devis</h2>
              <button className="btn" onClick={downloadPdf} disabled={!versionId}>Télécharger le PDF</button>
            </div>
            {pdfError && <p className="muted">{pdfError}</p>}
            {ordered.length > 0 ? (
              <table className="grid" style={{ marginTop: 12 }}>
                <thead><tr><th>Désignation</th><th>Type</th><th style={{ textAlign: 'right' }}>Quantité</th><th style={{ textAlign: 'right' }}>PU</th></tr></thead>
                <tbody>
                  {ordered.map(({ line, depth }) => (
                    <tr key={line.id}>
                      <td style={{ paddingLeft: 8 + depth * 20 }}>{line.code ? <strong>{line.code} </strong> : null}{line.designation}</td>
                      <td className="muted">{TYPE_LABELS[line.type] ?? line.type}</td>
                      <td style={{ textAlign: 'right' }}>{line.quantity ?? '—'} {line.unit ?? ''}</td>
                      <td style={{ textAlign: 'right' }}>{line.pu ? euro(line.pu) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="muted">Devis vide — ajoutez un titre puis des ouvrages ci-dessus.</p>}
          </div>
        </>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="field" style={{ marginBottom: 0 }}><label>{label}</label>{children}</div>;
}

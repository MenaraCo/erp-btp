'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { apiFetch, apiFetchBlobUrl } from '@/lib/api';
import { AFFAIRE_STATUS_LABELS, euro } from '@/lib/format';

interface Version {
  id: string;
  version_no: number;
  label: string;
}
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
interface SaleSheet {
  totalDebourse: string;
  totalPvHt: string;
  tva: string;
  totalTtc: string;
}

const TYPE_LABELS: Record<string, string> = {
  titre: 'Titre',
  sous_titre: 'Sous-titre',
  ouvrage: 'Ouvrage',
  ressource: 'Ressource',
};

/** Flat parent_line_id rows → depth-ordered list for indented rendering. */
function orderTree(lines: DevisLine[]): { line: DevisLine; depth: number }[] {
  const byParent = new Map<string | null, DevisLine[]>();
  for (const l of lines) {
    const key = l.parent_line_id;
    (byParent.get(key) ?? byParent.set(key, []).get(key)!).push(l);
  }
  for (const arr of byParent.values()) arr.sort((a, b) => a.sort_order - b.sort_order);
  const out: { line: DevisLine; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const l of byParent.get(parent) ?? []) {
      out.push({ line: l, depth });
      walk(l.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export default function AffaireDetailPage() {
  const { token } = useAuth();
  const params = useParams();
  const affaireId = String(params.affaireId);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: ['affaire', affaireId],
    enabled: Boolean(token),
    queryFn: () => apiFetch<AffaireDetail>(`/affaires/${affaireId}`, { token }),
  });

  const latest = detail.data?.versions[detail.data.versions.length - 1];
  const versionId = latest?.id;

  const lines = useQuery({
    queryKey: ['lines', versionId],
    enabled: Boolean(token && versionId),
    queryFn: () => apiFetch<DevisLine[]>(`/versions/${versionId}/lines`, { token }),
  });
  const sale = useQuery({
    queryKey: ['sale-sheet', versionId],
    enabled: Boolean(token && versionId),
    queryFn: () => apiFetch<SaleSheet>(`/versions/${versionId}/sale-sheet`, { token }),
  });

  const ordered = useMemo(() => orderTree(lines.data ?? []), [lines.data]);

  async function downloadPdf() {
    if (!versionId) return;
    setPdfError(null);
    try {
      const url = await apiFetchBlobUrl(`/versions/${versionId}/devis.pdf`, token);
      window.open(url, '_blank');
    } catch {
      setPdfError('PDF indisponible.');
    }
  }

  const a = detail.data?.affaire;

  return (
    <div>
      <p className="muted" style={{ marginTop: 0 }}>
        <Link href="/estimating" className="link">
          ← Études de prix
        </Link>
      </p>

      {detail.isLoading && <p className="muted">Chargement…</p>}
      {detail.isError && <p className="muted">Affaire introuvable ou accès non autorisé.</p>}

      {a && (
        <>
          <h1 style={{ marginBottom: 4 }}>
            {a.code} — {a.name}
          </h1>
          <p className="muted" style={{ marginTop: 0 }}>
            <span className="badge">{AFFAIRE_STATUS_LABELS[a.status] ?? a.status}</span>
            {a.moa ? ` · MOA : ${a.moa}` : ''}
            {latest ? ` · Version ${latest.version_no}` : ''}
          </p>

          {sale.data && (
            <div className="card-grid" style={{ marginTop: 12 }}>
              <div className="card">
                <h2>Déboursé</h2>
                <div className="stat">{euro(sale.data.totalDebourse)}</div>
              </div>
              <div className="card">
                <h2>Total HT</h2>
                <div className="stat">{euro(sale.data.totalPvHt)}</div>
              </div>
              <div className="card">
                <h2>TVA</h2>
                <div className="stat">{euro(sale.data.tva)}</div>
              </div>
              <div className="card">
                <h2>Total TTC</h2>
                <div className="stat">{euro(sale.data.totalTtc)}</div>
              </div>
            </div>
          )}

          <div className="card" style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0 }}>Corps du devis</h2>
              <button className="btn" onClick={downloadPdf} disabled={!versionId}>
                Télécharger le PDF
              </button>
            </div>
            {pdfError && <p className="muted">{pdfError}</p>}
            {lines.isLoading && <p className="muted">Chargement du devis…</p>}
            {ordered.length > 0 && (
              <table className="grid" style={{ marginTop: 12 }}>
                <thead>
                  <tr>
                    <th>Désignation</th>
                    <th>Type</th>
                    <th style={{ textAlign: 'right' }}>Quantité</th>
                    <th style={{ textAlign: 'right' }}>PU</th>
                  </tr>
                </thead>
                <tbody>
                  {ordered.map(({ line, depth }) => (
                    <tr key={line.id}>
                      <td style={{ paddingLeft: 8 + depth * 20 }}>
                        {line.code ? <strong>{line.code} </strong> : null}
                        {line.designation}
                      </td>
                      <td className="muted">{TYPE_LABELS[line.type] ?? line.type}</td>
                      <td style={{ textAlign: 'right' }}>
                        {line.quantity ?? '—'} {line.unit ?? ''}
                      </td>
                      <td style={{ textAlign: 'right' }}>{line.pu ? euro(line.pu) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {lines.data && ordered.length === 0 && <p className="muted">Devis vide.</p>}
          </div>
        </>
      )}
    </div>
  );
}

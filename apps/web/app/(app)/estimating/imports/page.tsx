'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation } from '@tanstack/react-query';
import { apiUpload } from '@/lib/api';
import { useAuth } from '@/lib/auth';

interface ImportResult {
  affaireId: string;
  devisId: string;
  versionId: string;
  numero: string;
  stats: { lots: number; ouvrages: number; client: boolean };
}

const ACCEPT = '.xml,.xlsx,.xls';

export default function ImportsPage() {
  const { token } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const mutation = useMutation<ImportResult, Error, File>({
    mutationFn: (f) => apiUpload<ImportResult>('/imports/devis', f, token),
  });

  const pick = (f: File | null) => { setFile(f); mutation.reset(); };
  const ext = file?.name.toLowerCase().split('.').pop();
  const formatLabel = ext === 'xml' ? 'XML (bordereau standard)' : ext ? 'Excel' : '';

  return (
    <div style={{ maxWidth: 760 }}>
      <h1 style={{ marginBottom: 4 }}>Imports</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Importer un bordereau (DPGF) depuis un fichier XML ou Excel — crée une affaire et son devis.
      </p>

      <div className="card" style={{ padding: 20, marginTop: 16 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <span style={tabStyle(true)}>Import Devis (DPGF)</span>
          <span style={tabStyle(false)} title="À venir">Nomenclature XML</span>
          <span style={tabStyle(false)} title="À venir">Ressources Excel</span>
        </div>

        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault(); setDragOver(false);
            const f = e.dataTransfer.files?.[0]; if (f) pick(f);
          }}
          onClick={() => inputRef.current?.click()}
          style={{
            border: `2px dashed ${dragOver ? 'var(--accent)' : '#cbd5e1'}`,
            borderRadius: 10, padding: '36px 16px', textAlign: 'center', cursor: 'pointer',
            background: dragOver ? 'rgba(232,85,10,0.05)' : '#f8fafc', transition: 'all .15s',
          }}
        >
          <div style={{ fontSize: 32, lineHeight: 1 }}>⬆️</div>
          <div style={{ marginTop: 8, fontWeight: 600, color: '#334155' }}>
            {file ? file.name : 'Glissez un fichier ici, ou cliquez pour parcourir'}
          </div>
          <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
            {file ? formatLabel : '.xml, .xlsx ou .xls — le format est détecté automatiquement'}
          </div>
          <input ref={inputRef} type="file" accept={ACCEPT} hidden
            onChange={(e) => pick(e.target.files?.[0] ?? null)} />
        </div>

        <div style={{ marginTop: 14, padding: '10px 12px', background: '#f1f5f9', borderRadius: 8, fontSize: 13, color: '#475569' }}>
          <strong>Contenu importé :</strong> l&apos;arbre des lots (titres) et les ouvrages chiffrés
          (déboursé + prix de vente). Excel : onglets <em>Informations</em> et <em>Lignes</em>
          (LOT, DÉSIGNATION, QTE, UNITE, PU_HT, DEBOURS_UNITAIRE).
        </div>

        <button
          className="btn-primary"
          style={{ width: '100%', justifyContent: 'center', marginTop: 14 }}
          disabled={!file || mutation.isPending}
          onClick={() => file && mutation.mutate(file)}
        >
          {mutation.isPending ? 'Import en cours…' : 'Lancer l’import'}
        </button>

        {mutation.isError && (
          <p style={{ color: '#dc2626', marginTop: 12 }}>{mutation.error.message}</p>
        )}
        {mutation.isSuccess && (
          <div style={{ marginTop: 14, padding: 14, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8 }}>
            <div style={{ fontWeight: 600, color: '#166534' }}>
              Import réussi — devis {mutation.data.numero}
            </div>
            <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
              {mutation.data.stats.lots} lot(s), {mutation.data.stats.ouvrages} ouvrage(s)
              {mutation.data.stats.client ? ' · client rattaché' : ''}.
            </div>
            <Link
              className="btn-secondary"
              style={{ marginTop: 10, display: 'inline-flex' }}
              href={`/estimating/${mutation.data.affaireId}/devis/${mutation.data.devisId}`}
            >
              Ouvrir le devis →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

function tabStyle(active: boolean): React.CSSProperties {
  return {
    padding: '6px 12px', borderRadius: 8, fontSize: 13, fontWeight: 600,
    background: active ? 'var(--primary)' : '#f1f5f9',
    color: active ? '#fff' : '#94a3b8',
    cursor: active ? 'default' : 'not-allowed',
  };
}

'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation } from '@tanstack/react-query';
import { apiUpload } from '@/lib/api';
import { useAuth } from '@/lib/auth';

interface DevisResult {
  affaireId: string; devisId: string; versionId: string; numero: string;
  stats: { lots: number; ouvrages: number; client: boolean };
}
interface NomResult {
  libraryId: string; libraryCode: string;
  stats: { resources: number; ouvrages: number; composants: number; ignores: number };
}

type Tab = 'devis' | 'nomenclature';

export default function ImportsPage() {
  const { token } = useAuth();
  const [tab, setTab] = useState<Tab>('devis');

  return (
    <div style={{ maxWidth: 760 }}>
      <h1 style={{ marginBottom: 4 }}>Imports</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Importer depuis XML ou Excel — devis (bordereau DPGF) ou bibliothèque (nomenclature).
      </p>

      <div className="card" style={{ padding: 20, marginTop: 16 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button style={tabStyle(tab === 'devis')} onClick={() => setTab('devis')}>Import Devis (DPGF)</button>
          <button style={tabStyle(tab === 'nomenclature')} onClick={() => setTab('nomenclature')}>Nomenclature XML</button>
          <span style={{ ...tabStyle(false), cursor: 'not-allowed' }} title="À venir">Ressources Excel</span>
        </div>
        {tab === 'devis' ? <DevisImport token={token} /> : <NomenclatureImport token={token} />}
      </div>
    </div>
  );
}

function DevisImport({ token }: { token: string | null }) {
  const mutation = useMutation<DevisResult, Error, File>({
    mutationFn: (f) => apiUpload<DevisResult>('/imports/devis', f, token),
  });
  return (
    <Dropzone
      accept=".xml,.xlsx,.xls"
      hint=".xml, .xlsx ou .xls — format détecté automatiquement"
      note={<>L&apos;arbre des lots (titres) et les ouvrages chiffrés (déboursé + prix de vente). Excel : onglets <em>Informations</em> et <em>Lignes</em> (LOT, DÉSIGNATION, QTE, UNITE, PU_HT, DEBOURS_UNITAIRE).</>}
      onSubmit={(f) => mutation.mutate(f)}
      pending={mutation.isPending}
      error={mutation.error?.message}
      success={mutation.isSuccess && (
        <>
          <div style={okTitle}>Import réussi — devis {mutation.data.numero}</div>
          <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
            {mutation.data.stats.lots} lot(s), {mutation.data.stats.ouvrages} ouvrage(s)
            {mutation.data.stats.client ? ' · client rattaché' : ''}.
          </div>
          <Link className="btn-secondary" style={{ marginTop: 10, display: 'inline-flex' }}
            href={`/estimating/${mutation.data.affaireId}/devis/${mutation.data.devisId}`}>
            Ouvrir le devis →
          </Link>
        </>
      )}
      reset={() => mutation.reset()}
    />
  );
}

function NomenclatureImport({ token }: { token: string | null }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const mutation = useMutation<NomResult, Error, File>({
    mutationFn: (f) =>
      apiUpload<NomResult>(`/imports/nomenclature?libraryCode=${encodeURIComponent(code)}&libraryName=${encodeURIComponent(name || code)}`, f, token),
  });
  return (
    <>
      <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
        <label style={{ flex: 1 }}>
          <div className="form-label">Code bibliothèque cible *</div>
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="ex. MENARA-NOM" />
        </label>
        <label style={{ flex: 2 }}>
          <div className="form-label">Nom</div>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nom affiché (optionnel)" />
        </label>
      </div>
      <Dropzone
        accept=".xml"
        hint="Fichier .xml (RESS_MX / TACHE / OUVRAGE)"
        note={<>Matériaux, tâches (MO/sous-traitance) et ouvrages composés → la bibliothèque cible. Les enregistrements existants (même code) sont mis à jour ; le débours des ouvrages est recalculé.</>}
        disabled={!code.trim()}
        disabledReason="Renseignez d’abord le code de la bibliothèque cible."
        onSubmit={(f) => mutation.mutate(f)}
        pending={mutation.isPending}
        error={mutation.error?.message}
        success={mutation.isSuccess && (
          <>
            <div style={okTitle}>Import réussi — bibliothèque {mutation.data.libraryCode}</div>
            <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
              {mutation.data.stats.resources} ressource(s), {mutation.data.stats.ouvrages} ouvrage(s),
              {' '}{mutation.data.stats.composants} composant(s)
              {mutation.data.stats.ignores ? ` · ${mutation.data.stats.ignores} ignoré(s)` : ''}.
            </div>
            <Link className="btn-secondary" style={{ marginTop: 10, display: 'inline-flex' }}
              href="/estimating/bibliotheque/ressources">
              Voir la bibliothèque →
            </Link>
          </>
        )}
        reset={() => mutation.reset()}
      />
    </>
  );
}

function Dropzone({ accept, hint, note, onSubmit, pending, error, success, reset, disabled, disabledReason }: {
  accept: string; hint: string; note: React.ReactNode;
  onSubmit: (f: File) => void; pending: boolean; error?: string;
  success: React.ReactNode; reset: () => void; disabled?: boolean; disabledReason?: string;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const pick = (f: File | null) => { setFile(f); reset(); };

  return (
    <>
      <div
        onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); if (!disabled) { const f = e.dataTransfer.files?.[0]; if (f) pick(f); } }}
        onClick={() => !disabled && inputRef.current?.click()}
        title={disabled ? disabledReason : undefined}
        style={{
          border: `2px dashed ${dragOver ? 'var(--accent)' : '#cbd5e1'}`, borderRadius: 10,
          padding: '36px 16px', textAlign: 'center', cursor: disabled ? 'not-allowed' : 'pointer',
          background: dragOver ? 'rgba(232,85,10,0.05)' : '#f8fafc', opacity: disabled ? 0.55 : 1, transition: 'all .15s',
        }}
      >
        <div style={{ fontSize: 32, lineHeight: 1 }}>⬆️</div>
        <div style={{ marginTop: 8, fontWeight: 600, color: '#334155' }}>
          {file ? file.name : 'Glissez un fichier ici, ou cliquez pour parcourir'}
        </div>
        <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>{hint}</div>
        <input ref={inputRef} type="file" accept={accept} hidden onChange={(e) => pick(e.target.files?.[0] ?? null)} />
      </div>

      <div style={{ marginTop: 14, padding: '10px 12px', background: '#f1f5f9', borderRadius: 8, fontSize: 13, color: '#475569' }}>
        <strong>Contenu importé :</strong> {note}
      </div>

      <button className="btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: 14 }}
        disabled={!file || pending || disabled} onClick={() => file && onSubmit(file)}>
        {pending ? 'Import en cours…' : 'Lancer l’import'}
      </button>

      {error && <p style={{ color: '#dc2626', marginTop: 12 }}>{error}</p>}
      {success && (
        <div style={{ marginTop: 14, padding: 14, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8 }}>
          {success}
        </div>
      )}
    </>
  );
}

const okTitle: React.CSSProperties = { fontWeight: 600, color: '#166534' };
function tabStyle(active: boolean): React.CSSProperties {
  return {
    padding: '6px 12px', borderRadius: 8, fontSize: 13, fontWeight: 600, border: 'none',
    background: active ? 'var(--primary)' : '#f1f5f9', color: active ? '#fff' : '#64748b',
    cursor: active ? 'default' : 'pointer',
  };
}

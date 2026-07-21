'use client';

import { useEffect, useRef, useState } from 'react';
import { Search, Loader2 } from 'lucide-react';
import { apiFetch } from '@/lib/api';

export interface CompanyMatch {
  siren: string;
  siret: string | null;
  name: string;
  legalForm: string | null;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  naf: string | null;
  vatIntra: string | null;
}

/**
 * Reusable French company lookup (raison sociale / SIREN / SIRET) backed by the public registry.
 * On selection, calls `onSelect` with the normalised legal info so a parent form can auto-fill.
 * Uses the public, tenant-less endpoint — no token required.
 */
export function CompanySearch({
  onSelect,
  placeholder = 'Rechercher par nom, SIREN ou SIRET…',
  label = 'Rechercher l’entreprise (annuaire officiel)',
}: {
  onSelect: (c: CompanyMatch) => void;
  placeholder?: string;
  label?: string;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<CompanyMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const reqId = useRef(0);

  // Debounced search.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 3) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const id = ++reqId.current;
    const t = setTimeout(async () => {
      try {
        const data = await apiFetch<CompanyMatch[]>(
          `/public/company-search?q=${encodeURIComponent(term)}`,
        );
        if (id === reqId.current) {
          setResults(data);
          setOpen(true);
        }
      } catch {
        if (id === reqId.current) setResults([]);
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [q]);

  // Close on outside click.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  function pick(c: CompanyMatch) {
    onSelect(c);
    setQ('');
    setResults([]);
    setOpen(false);
  }

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      {label && <label className="label" style={{ display: 'block', marginBottom: 3 }}>{label}</label>}
      <div style={{ position: 'relative' }}>
        <Search
          size={14}
          style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }}
        />
        <input
          className="input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder={placeholder}
          style={{ width: '100%', paddingLeft: 30 }}
        />
        {loading && (
          <Loader2
            size={14}
            className="spin"
            style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }}
          />
        )}
      </div>

      {open && (results.length > 0 || (!loading && q.trim().length >= 3)) && (
        <div
          style={{
            position: 'absolute', zIndex: 30, top: 'calc(100% + 4px)', left: 0, right: 0,
            background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 8,
            boxShadow: '0 8px 24px rgba(26,58,92,0.14)', maxHeight: 320, overflowY: 'auto',
          }}
        >
          {results.length === 0 ? (
            <div className="muted" style={{ padding: 12, fontSize: 12 }}>Aucune entreprise trouvée.</div>
          ) : (
            results.map((c) => (
              <button
                key={c.siret ?? c.siren}
                type="button"
                onClick={() => pick(c)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', background: 'none',
                  border: 'none', borderBottom: '1px solid var(--border)', padding: '8px 12px', cursor: 'pointer',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
              >
                <div style={{ fontWeight: 600, fontSize: 13 }}>
                  {c.name}
                  {c.legalForm && <span className="muted" style={{ fontWeight: 400 }}> · {c.legalForm}</span>}
                </div>
                <div className="muted" style={{ fontSize: 11 }}>
                  SIRET {c.siret ?? '—'}
                  {(c.postalCode || c.city) && ` · ${[c.postalCode, c.city].filter(Boolean).join(' ')}`}
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

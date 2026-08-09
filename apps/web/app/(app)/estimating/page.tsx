'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { apiFetch } from '@/lib/api';
import { AFFAIRE_STATUS_LABELS, euro } from '@/lib/format';
import { usePermissions } from '@/lib/capabilities';
import { SortHeader, SortState, nextSort, applySort } from '@/components/SortHeader';
import { IconBtn } from '@/components/IconBtn';
import { AffaireModal } from '@/components/AffaireModal';

interface Affaire {
  id: string;
  code: string;
  name: string;
  status: string;
  budgetObjectif?: string | null;
}
interface AffairesPage {
  rows: Affaire[];
  total: number;
}
interface DevisRow {
  affaire_id: string;
  status: string;
  totals: { pvHt: string } | null;
}
const AFFAIRE_BADGE: Record<string, string> = {
  gagnee: 'badge success',
  perdue: 'badge danger',
  gagnee_partielle: 'badge info',
};
const AFFAIRE_LABEL: Record<string, string> = {
  en_cours: 'En cours', gagnee: 'Gagnée', gagnee_partielle: 'Gagnée part.', perdue: 'Perdue',
};

type FilterTab = 'all' | 'en_cours' | 'gagnee' | 'perdue';
const TABS: { key: FilterTab; label: string; match: (s: string) => boolean }[] = [
  { key: 'all', label: 'Toutes', match: () => true },
  { key: 'en_cours', label: 'En cours', match: (s) => s === 'en_cours' },
  { key: 'gagnee', label: 'Gagnées', match: (s) => s === 'gagnee' || s === 'gagnee_partielle' },
  { key: 'perdue', label: 'Perdues', match: (s) => s === 'perdue' },
];

export default function EstimatingPage() {
  const { token } = useAuth();
  const peutEcrire = usePermissions().canOrLoading('estimating.devis.write');
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterTab>('all');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['affaires'],
    enabled: Boolean(token),
    queryFn: () => apiFetch<AffairesPage>('/affaires?sort=code&pageSize=200', { token }),
  });
  const devisQ = useQuery({
    queryKey: ['devis-list'],
    enabled: Boolean(token),
    queryFn: () => apiFetch<DevisRow[]>('/devis', { token }),
  });

  // Agrégats par affaire : nb devis + total HT (marchés gagnés, sinon tous les devis).
  const agg = useMemo(() => {
    const m = new Map<string, { nb: number; totalHt: number; wonHt: number }>();
    for (const d of devisQ.data ?? []) {
      const e = m.get(d.affaire_id) ?? { nb: 0, totalHt: 0, wonHt: 0 };
      e.nb += 1;
      const pv = Number(d.totals?.pvHt ?? 0);
      e.totalHt += pv;
      if (d.status === 'won') e.wonHt += pv;
      m.set(d.affaire_id, e);
    }
    return m;
  }, [devisQ.data]);

  const [sort, setSort] = useState<SortState>({ key: null, dir: 'asc' });
  const onSort = (k: string) => setSort((s) => nextSort(s, k));

  const filtered = (data?.rows ?? []).filter((a) => {
    const tab = TABS.find((t) => t.key === filter)!;
    if (!tab.match(a.status)) return false;
    const q = search.toLowerCase();
    return !q || a.code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q);
  });
  const affaireRows = applySort(filtered, sort, (a, k) => (a as unknown as Record<string, unknown>)[k]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ marginBottom: 0 }}>Affaires</h1>
          <p className="muted" style={{ marginTop: 2, marginBottom: 0 }}>Opérations et leurs devis.</p>
        </div>
        {peutEcrire && <button className="btn" onClick={() => setModalOpen(true)}>+ Nouvelle affaire</button>}
      </div>

      {modalOpen && (
        <AffaireModal
          affaire={null}
          onClose={() => setModalOpen(false)}
          onSaved={(id) => { setModalOpen(false); router.push(`/estimating/${id}`); }}
        />
      )}

      {/* Recherche */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 12, marginBottom: 4 }}>
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher par code ou nom…" style={{ flex: 1, maxWidth: 360 }} />
      </div>

      {/* Onglets statut */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
        {TABS.map((t) => {
          const count = (data?.rows ?? []).filter((a) => t.match(a.status)).length;
          const active = filter === t.key;
          return (
            <button key={t.key} onClick={() => setFilter(t.key)} style={{
              padding: '7px 16px', fontSize: 12, background: 'none', border: 'none',
              borderBottom: active ? '2px solid var(--primary)' : '2px solid transparent',
              color: active ? 'var(--primary)' : 'var(--muted)', fontWeight: active ? 700 : 400, cursor: 'pointer',
            }}>
              {t.label}
              {data && <span style={{ marginLeft: 5, fontSize: 10, borderRadius: 10, padding: '1px 6px',
                background: active ? 'var(--primary)' : 'var(--border)', color: active ? '#fff' : 'var(--muted)', fontWeight: 700 }}>{count}</span>}
            </button>
          );
        })}
      </div>

      <div className="card" style={{ marginTop: 0, borderTopLeftRadius: 0, borderTopRightRadius: 0, borderTop: 'none', padding: 0, overflow: 'hidden' }}>
        {isLoading && <p className="muted" style={{ padding: 16 }}>Chargement…</p>}
        {isError && <p className="muted" style={{ padding: 16 }}>Accès non autorisé ou aucune donnée.</p>}
        {data && affaireRows.length > 0 && (
          <table className="grid" style={{ margin: 0 }}>
            <thead>
              <tr>
                <SortHeader label="Code" colKey="code" sort={sort} onSort={onSort} />
                <SortHeader label="Désignation" colKey="name" sort={sort} onSort={onSort} />
                <SortHeader label="Statut" colKey="status" sort={sort} onSort={onSort} />
                <th style={{ textAlign: 'right' }}>Devis</th>
                <th style={{ textAlign: 'right' }}>Total HT</th>
                <th style={{ textAlign: 'right' }}>Budget</th>
                <th style={{ width: 40 }} />
              </tr>
            </thead>
            <tbody>
              {affaireRows.map((a) => {
                const g = agg.get(a.id);
                const totalHt = g ? (g.wonHt > 0 ? g.wonHt : g.totalHt) : 0;
                return (
                  <tr key={a.id} style={{ cursor: 'pointer' }}
                    onClick={() => router.push(`/estimating/${a.id}`)}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}>
                    <td className="code-cell">{a.code}</td>
                    <td style={{ fontWeight: 500 }}>{a.name}</td>
                    <td><span className={AFFAIRE_BADGE[a.status] ?? 'badge'}>{AFFAIRE_LABEL[a.status] ?? AFFAIRE_STATUS_LABELS[a.status] ?? a.status}</span></td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--muted)' }}>{g?.nb ?? 0}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{totalHt ? euro(totalHt) : '—'}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--muted)' }}>{a.budgetObjectif ? euro(a.budgetObjectif) : '—'}</td>
                    <td style={{ textAlign: 'right', paddingRight: 8 }}>
                      <IconBtn title="Ouvrir l'affaire" color="var(--muted)"
                        onClick={(e) => { e.stopPropagation(); router.push(`/estimating/${a.id}`); }}>
                        <ArrowRight size={14} />
                      </IconBtn>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {data && affaireRows.length === 0 && <p className="muted" style={{ padding: 16 }}>Aucune affaire.</p>}
      </div>
    </div>
  );
}

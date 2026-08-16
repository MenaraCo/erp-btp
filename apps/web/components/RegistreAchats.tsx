'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export interface FiltresRegistre {
  q: string;
  chantier: string;
  fournisseur: string;
  statut: string;
  du: string;
  au: string;
}

const VIDE: FiltresRegistre = { q: '', chantier: '', fournisseur: '', statut: '', du: '', au: '' };

interface Chantier { id: string; code: string; name: string }
interface Fournisseur { id: string; name: string }

/**
 * Barre de recherche commune aux trois registres d'achats.
 *
 * Une pièce passée ne se relit pas en déroulant une liste : elle se retrouve. Les mêmes critères
 * partout — numéro, fournisseur, chantier, période — pour ne pas réapprendre l'écran à chaque
 * onglet.
 */
export function BarreRecherche({
  filtres,
  onChange,
  statuts,
  total,
  montant,
}: {
  filtres: FiltresRegistre;
  onChange: (f: FiltresRegistre) => void;
  statuts?: Array<{ value: string; label: string }>;
  total: number;
  montant?: string | null;
}) {
  const { token } = useAuth();
  const chantiers = useQuery({
    queryKey: ['chantiers'], enabled: Boolean(token),
    queryFn: () => apiFetch<Chantier[]>('/chantiers', { token }),
  });
  // Le référentiel répond paginé ({ rows, total }) : cent fournisseurs suffisent à un filtre.
  const fournisseurs = useQuery({
    queryKey: ['suppliers-filtre'], enabled: Boolean(token), retry: false,
    queryFn: () => apiFetch<{ rows: Fournisseur[] }>('/suppliers?sort=name&pageSize=100', { token }),
  });

  const set = (patch: Partial<FiltresRegistre>) => onChange({ ...filtres, ...patch });
  const actif = Object.values(filtres).some(Boolean);

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 12 }}>
      <div className="field" style={{ marginBottom: 0 }}>
        <label>Recherche</label>
        <input
          value={filtres.q}
          placeholder="N° de pièce, fournisseur, chantier…"
          onChange={(e) => set({ q: e.target.value })}
          style={{ width: 240 }}
        />
      </div>
      <div className="field" style={{ marginBottom: 0 }}>
        <label>Chantier</label>
        <select value={filtres.chantier} onChange={(e) => set({ chantier: e.target.value })} style={{ minWidth: 160 }}>
          <option value="">Tous</option>
          {(chantiers.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
        </select>
      </div>
      <div className="field" style={{ marginBottom: 0 }}>
        <label>Fournisseur</label>
        <select value={filtres.fournisseur} onChange={(e) => set({ fournisseur: e.target.value })} style={{ minWidth: 160 }}>
          <option value="">Tous</option>
          {(fournisseurs.data?.rows ?? []).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      </div>
      {statuts && (
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Statut</label>
          <select value={filtres.statut} onChange={(e) => set({ statut: e.target.value })}>
            <option value="">Tous</option>
            {statuts.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
      )}
      <div className="field" style={{ marginBottom: 0 }}>
        <label>Du</label>
        <input type="date" value={filtres.du} onChange={(e) => set({ du: e.target.value })} style={{ width: 145 }} />
      </div>
      <div className="field" style={{ marginBottom: 0 }}>
        <label>Au</label>
        <input type="date" value={filtres.au} onChange={(e) => set({ au: e.target.value })} style={{ width: 145 }} />
      </div>
      {actif && (
        <button className="btn btn-secondary" onClick={() => onChange({ ...VIDE })}>Effacer</button>
      )}
      <div className="muted" style={{ marginLeft: 'auto', fontSize: 12, paddingBottom: 6 }}>
        {total} pièce{total > 1 ? 's' : ''}{montant ? ` · ${montant}` : ''}
      </div>
    </div>
  );
}

export function filtresVides(): FiltresRegistre {
  return { ...VIDE };
}

/** Construit la requête d'URL à partir des filtres et de la page. */
export function requeteRegistre(filtres: FiltresRegistre, page: number, parPage = 25): string {
  const p = new URLSearchParams();
  if (filtres.q) p.set('q', filtres.q);
  if (filtres.chantier) p.set('chantier', filtres.chantier);
  if (filtres.fournisseur) p.set('fournisseur', filtres.fournisseur);
  if (filtres.statut) p.set('statut', filtres.statut);
  if (filtres.du) p.set('du', filtres.du);
  if (filtres.au) p.set('au', filtres.au);
  p.set('page', String(page));
  p.set('parPage', String(parPage));
  return p.toString();
}

/** Pagination sobre : on ne montre que ce dont on a besoin pour avancer d'une page. */
export function Pagination({
  page, total, parPage, onPage,
}: { page: number; total: number; parPage: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / parPage));
  if (pages <= 1) return null;
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end', marginTop: 12 }}>
      <button className="btn btn-secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>‹</button>
      <span className="muted" style={{ fontSize: 12 }}>Page {page} sur {pages}</span>
      <button className="btn btn-secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>›</button>
    </div>
  );
}

/** Hook commun : filtres + page, remis à la première page dès qu'un critère change. */
export function useRegistre() {
  const [filtres, setFiltres] = useState<FiltresRegistre>(filtresVides());
  const [page, setPage] = useState(1);
  const majFiltres = (f: FiltresRegistre) => { setFiltres(f); setPage(1); };
  const requete = useMemo(() => requeteRegistre(filtres, page), [filtres, page]);
  return { filtres, majFiltres, page, setPage, requete };
}

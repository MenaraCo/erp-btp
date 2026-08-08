'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { apiFetch, ApiError } from '@/lib/api';
import { usePermissions } from '@/lib/capabilities';
import { usePreferences, fmtEuro } from '@/lib/preferences';

type Sens = 'vers-chantier' | 'vers-etude';

interface Library { id: string; code: string; name: string }
interface Candidat {
  id: string; code: string; label: string; unit: string | null;
  nature: string; prix: string; etat: 'transferable' | 'deja_present';
}

const NATURES: Record<string, string> = {
  material: 'Matériaux', labor: "Main d'œuvre", equipment: 'Matériel', subcontract: 'Sous-traitance',
};

/**
 * Transfert entre la bibliothèque d'ÉTUDE DE PRIX et celle du MODULE CHANTIER.
 *
 * Deux catalogues de référence de l'entreprise, volontairement distincts : on ne chiffre pas avec
 * les mêmes prix qu'on exécute. Cet outil les fait communiquer à la demande — jamais tout seul, et
 * sans jamais écraser une fiche existante.
 *
 * Rien à voir avec la nomenclature d'un chantier donné, qui reste une copie de travail propre à
 * ce chantier.
 */
export default function TransfertBibliothequePage() {
  const { token } = useAuth();
  const { nb_decimales: nbDec } = usePreferences();
  const { can } = usePermissions();
  const qc = useQueryClient();

  const [sens, setSens] = useState<Sens>('vers-chantier');
  const [bibEtude, setBibEtude] = useState('');
  const [bibChantier, setBibChantier] = useState('');
  const [choisis, setChoisis] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);
  const [bilan, setBilan] = useState<string | null>(null);

  const autorise = sens === 'vers-chantier' ? can('site_tracking.write') : can('estimating.devis.write');

  const libsEtude = useQuery({
    queryKey: ['libraries'], enabled: Boolean(token),
    queryFn: () => apiFetch<{ rows: Library[] }>('/libraries?pageSize=100', { token }),
  });
  const libsChantier = useQuery({
    queryKey: ['libraries', 'chantier'], enabled: Boolean(token),
    queryFn: () => apiFetch<Library[]>('/transfert-bibliotheque/bibliotheques-chantier', { token }),
  });

  const sourceId = sens === 'vers-chantier' ? bibEtude : bibChantier;
  const cibleId = sens === 'vers-chantier' ? bibChantier : bibEtude;
  const pret = Boolean(bibEtude && bibChantier && autorise);

  const apercu = useQuery({
    queryKey: ['transfert-apercu', sens, sourceId, cibleId],
    enabled: Boolean(token) && pret,
    queryFn: () => apiFetch<Candidat[]>(
      `/transfert-bibliotheque/${sens}/apercu?sourceId=${sourceId}&cibleId=${cibleId}`, { token },
    ),
  });

  const transferer = useMutation({
    mutationFn: () => apiFetch<{ transferes: number; ignores: number; codesIgnores: string[] }>(
      `/transfert-bibliotheque/${sens}`,
      { method: 'POST', token, body: { sourceId, cibleId, ids: [...choisis] } },
    ),
    onSuccess: (r) => {
      setChoisis(new Set());
      setBilan(
        `${r.transferes} ressource(s) transférée(s)` +
        (r.ignores > 0 ? ` · ${r.ignores} ignorée(s), déjà présente(s) : ${r.codesIgnores.join(', ')}` : ''),
      );
      qc.invalidateQueries({ queryKey: ['transfert-apercu'] });
      qc.invalidateQueries({ queryKey: ['resources'] });
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Transfert impossible.'),
  });

  const candidats = apercu.data ?? [];
  const transferables = candidats.filter((c) => c.etat === 'transferable');
  const bascule = (id: string) =>
    setChoisis((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  function changerSens(v: Sens) {
    setSens(v); setChoisis(new Set()); setBilan(null); setErr(null);
  }

  return (
    <div>
      <h1 style={{ marginBottom: 2 }}>Transfert de bibliothèque</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Le catalogue d’étude de prix et celui du module chantier sont deux références distinctes de
        l’entreprise. Cet outil les fait communiquer à votre initiative — jamais automatiquement.
      </p>

      {err && <div className="error" style={{ marginTop: 12 }}>{err}</div>}

      <div className="card" style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
          <button className={sens === 'vers-chantier' ? 'btn' : 'btn-secondary'}
            onClick={() => changerSens('vers-chantier')}>
            Étude → chantier
          </button>
          <button className={sens === 'vers-etude' ? 'btn' : 'btn-secondary'}
            onClick={() => changerSens('vers-etude')}>
            Chantier → étude
          </button>
        </div>

        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          {sens === 'vers-chantier'
            ? "Verser des articles du catalogue de chiffrage dans celui du chantier — pour que le terrain dispose des références déjà connues du bureau d’études."
            : "Remonter au catalogue de chiffrage des articles et des prix éprouvés sur le terrain — pour cesser de chiffrer au prix d’hier."}
        </p>

        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
          <Champ label={`Bibliothèque d’étude${sens === 'vers-chantier' ? ' (source)' : ' (cible)'}`}>
            <select className="input" value={bibEtude}
              onChange={(e) => { setBibEtude(e.target.value); setChoisis(new Set()); }}>
              <option value="">— choisir —</option>
              {(libsEtude.data?.rows ?? []).map((l) => <option key={l.id} value={l.id}>{l.code} — {l.name}</option>)}
            </select>
          </Champ>
          <Champ label={`Bibliothèque chantier${sens === 'vers-chantier' ? ' (cible)' : ' (source)'}`}>
            <select className="input" value={bibChantier}
              onChange={(e) => { setBibChantier(e.target.value); setChoisis(new Set()); }}>
              <option value="">— choisir —</option>
              {(libsChantier.data ?? []).map((l) => <option key={l.id} value={l.id}>{l.code} — {l.name}</option>)}
            </select>
            {(libsChantier.data ?? []).length === 0 && !libsChantier.isLoading && (
              <span className="muted" style={{ fontSize: 10.5 }}>
                Aucune bibliothèque de chantier. Créez-en une depuis le module Chantier.
              </span>
            )}
          </Champ>
        </div>

        {!autorise && (
          <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
            Ce sens demande le droit de modifier{' '}
            {sens === 'vers-chantier' ? 'le catalogue du chantier' : 'la bibliothèque d’étude'}.
          </p>
        )}
      </div>

      {bilan && (
        <div className="card" style={{ marginTop: 12, borderColor: 'var(--success)' }}>
          <strong style={{ fontSize: 13, color: 'var(--success)' }}>{bilan}</strong>
        </div>
      )}

      {pret && (
        <div className="card" style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div className="form-section-title" style={{ margin: 0 }}>
              À transférer ({transferables.length} disponible{transferables.length > 1 ? 's' : ''})
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button className="btn-secondary btn" disabled={transferables.length === 0}
                onClick={() => setChoisis(new Set(transferables.map((c) => c.id)))}>
                Tout sélectionner
              </button>
              <button className="btn" disabled={choisis.size === 0 || transferer.isPending}
                onClick={() => { setErr(null); setBilan(null); transferer.mutate(); }}>
                <ArrowLeftRight size={13} style={{ marginRight: 4 }} />
                Transférer {choisis.size > 0 ? `(${choisis.size})` : ''}
              </button>
            </div>
          </div>

          {apercu.isLoading ? (
            <p className="muted" style={{ marginTop: 12 }}>Chargement…</p>
          ) : candidats.length === 0 ? (
            <p className="muted" style={{ marginTop: 12 }}>Cette bibliothèque source est vide.</p>
          ) : (
            <table className="grid" style={{ marginTop: 10 }}>
              <thead>
                <tr>
                  <th style={{ width: 34 }} />
                  <th>Code</th><th>Désignation</th><th>Nature</th><th>Unité</th>
                  <th style={{ textAlign: 'right' }}>Prix repris</th><th>État</th>
                </tr>
              </thead>
              <tbody>
                {candidats.map((c) => {
                  const bloque = c.etat === 'deja_present';
                  return (
                    <tr key={c.id} style={{ opacity: bloque ? 0.55 : 1 }}>
                      <td>
                        <input type="checkbox" disabled={bloque}
                          checked={choisis.has(c.id)} onChange={() => bascule(c.id)} />
                      </td>
                      <td className="code-cell">{c.code}</td>
                      <td>{c.label}</td>
                      <td className="muted">{NATURES[c.nature] ?? c.nature}</td>
                      <td className="muted">{c.unit ?? '—'}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {fmtEuro(c.prix, nbDec)}
                      </td>
                      <td>
                        {bloque
                          ? <span className="badge" title="La cible porte déjà ce code : elle ne sera pas écrasée">Déjà présente</span>
                          : <span className="badge success">À transférer</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

function Champ({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

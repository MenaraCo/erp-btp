'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, BarChart3 } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { apiFetch } from '@/lib/api';
import { euro } from '@/lib/format';

type Axe = 'fournisseur' | 'ressource' | 'code' | 'famille' | 'lot' | 'chantier' | 'nature';

const AXES: Array<{ v: Axe; l: string }> = [
  { v: 'fournisseur', l: 'Fournisseur' },
  { v: 'ressource', l: 'Ressource' },
  { v: 'code', l: 'Code analytique' },
  { v: 'famille', l: 'Famille' },
  { v: 'lot', l: 'Lot' },
  { v: 'chantier', l: 'Chantier' },
  { v: 'nature', l: 'Nature' },
];

const NATURES: Array<{ v: string; l: string }> = [
  { v: 'material', l: 'Matériaux' },
  { v: 'equipment', l: 'Matériel' },
  { v: 'subcontract', l: 'Sous-traitance' },
  { v: 'labor', l: 'Main d’œuvre' },
  { v: 'site_overhead', l: 'Frais de chantier' },
];

interface LigneConso {
  cle: string;
  code: string;
  label: string | null;
  couleur: string | null;
  unite: string | null;
  unitesMultiples: boolean;
  nbCommandes: number;
  nbLignes: number;
  nbChantiers: number;
  quantiteCommandee: string | null;
  quantiteRecue: string | null;
  quantiteFacturee: string | null;
  commande: string;
  receptionne: string;
  facture: string;
  resteARecevoir: string;
  ecartPrix: string;
  part: string;
}
interface Consommation {
  axe: Axe;
  lignes: LigneConso[];
  total: {
    commande: string; receptionne: string; facture: string;
    resteARecevoir: string; ecartPrix: string; nbLignes: number; nbGroupes: number;
  };
  factureHorsLignes: { montant: string; nombre: number };
}
interface Chantier { id: string; code: string; name: string }
interface Fournisseur { id: string; name: string }

const VIDE = { chantier: '', fournisseur: '', nature: '', du: '', au: '', q: '' };

/** Quantité lisible : les décimales inutiles encombrent une colonne qu'on lit en diagonale. */
function qte(v: string | null): string {
  if (v == null) return '—';
  return Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
}

/**
 * Additionner des quantités n'a de sens que si elles portent sur la MÊME chose, dans la même
 * unité. Le groupe « Sans code » rassemble des lignes qui n'ont en commun que leur absence de
 * code : son total en quantité ne veut rien dire, on ne l'affiche pas.
 */
function quantiteAdditionnable(l: LigneConso): boolean {
  return l.code !== 'Sans code' && !l.unitesMultiples;
}

/**
 * Reporting Direction des achats (cahier §5.8) — la consommation de toute l'entreprise.
 *
 * Le registre sert à retrouver une pièce ; cet écran-ci répond à une autre question : combien
 * dépense-t-on, chez qui, et sur quoi. On change d'axe sans changer de page, parce que la réponse
 * utile est presque toujours la comparaison entre deux axes — ce fournisseur, sur quels chantiers.
 */
export default function ReportingAchatsPage() {
  const { token } = useAuth();
  const [axe, setAxe] = useState<Axe>('fournisseur');
  const [f, setF] = useState({ ...VIDE });

  const params = new URLSearchParams({ axe });
  if (f.chantier) params.set('chantier', f.chantier);
  if (f.fournisseur) params.set('fournisseur', f.fournisseur);
  if (f.nature) params.set('nature', f.nature);
  if (f.du) params.set('du', f.du);
  if (f.au) params.set('au', f.au);
  if (f.q) params.set('q', f.q);

  const conso = useQuery({
    queryKey: ['achats-reporting', params.toString()],
    enabled: Boolean(token),
    retry: false,
    queryFn: () => apiFetch<Consommation>(`/achats/reporting?${params.toString()}`, { token }),
  });
  const chantiers = useQuery({
    queryKey: ['chantiers'], enabled: Boolean(token),
    queryFn: () => apiFetch<Chantier[]>('/chantiers', { token }),
  });
  const fournisseurs = useQuery({
    queryKey: ['suppliers-filtre'], enabled: Boolean(token), retry: false,
    queryFn: () => apiFetch<{ rows: Fournisseur[] }>('/suppliers?sort=name&pageSize=100', { token }),
  });

  const set = (patch: Partial<typeof VIDE>) => setF({ ...f, ...patch });
  const actif = Object.values(f).some(Boolean);
  const t = conso.data?.total;
  const quantites = axe === 'ressource';

  /** Un clic sur une ligne restreint l'analyse à ce groupe — l'axe suivant répond au « pourquoi ». */
  const creuser = (l: LigneConso) => {
    if (axe === 'fournisseur' && l.cle !== 'sans') { set({ fournisseur: l.cle }); setAxe('ressource'); }
    else if (axe === 'chantier') { set({ chantier: l.cle }); setAxe('fournisseur'); }
    else if (axe === 'ressource') { set({ q: l.code === 'Sans code' ? '' : l.code }); setAxe('chantier'); }
    else if (axe === 'nature') { set({ nature: l.cle }); setAxe('fournisseur'); }
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <BarChart3 size={20} />
        <h1 style={{ margin: 0 }}>Consommation achats</h1>
      </div>
      <p className="muted" style={{ marginTop: 4 }}>
        Tous chantiers confondus, à partir des commandes validées — l’engagé naît à la validation.
        Un brouillon n’a encore rien coûté et n’entre pas ici.
      </p>

      {conso.isError && (
        <p className="muted">Module « Suivi de chantiers » non actif pour cet utilisateur, ou accès refusé.</p>
      )}

      {/* Axes : la même mesure, regardée sous un autre angle. */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
        {AXES.map((a) => (
          <button
            key={a.v}
            className={axe === a.v ? 'btn' : 'btn btn-secondary'}
            onClick={() => setAxe(a.v)}
          >
            {a.l}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 12 }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Recherche</label>
          <input
            value={f.q}
            placeholder="Code ou désignation…"
            onChange={(e) => set({ q: e.target.value })}
            style={{ width: 200 }}
          />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Chantier</label>
          <select value={f.chantier} onChange={(e) => set({ chantier: e.target.value })} style={{ minWidth: 160 }}>
            <option value="">Tous</option>
            {(chantiers.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
          </select>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Fournisseur</label>
          <select value={f.fournisseur} onChange={(e) => set({ fournisseur: e.target.value })} style={{ minWidth: 160 }}>
            <option value="">Tous</option>
            {(fournisseurs.data?.rows ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Nature</label>
          <select value={f.nature} onChange={(e) => set({ nature: e.target.value })} style={{ minWidth: 140 }}>
            <option value="">Toutes</option>
            {NATURES.map((n) => <option key={n.v} value={n.v}>{n.l}</option>)}
          </select>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Du</label>
          <input type="date" value={f.du} onChange={(e) => set({ du: e.target.value })} style={{ width: 145 }} />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Au</label>
          <input type="date" value={f.au} onChange={(e) => set({ au: e.target.value })} style={{ width: 145 }} />
        </div>
        {actif && <button className="btn btn-secondary" onClick={() => setF({ ...VIDE })}>Effacer</button>}
      </div>

      {t && (
        <div className="card-grid" style={{ marginTop: 14 }}>
          <div className="card">
            <h2>Commandé</h2>
            <div className="stat">{euro(t.commande)}</div>
            <div className="muted">{t.nbLignes} ligne{t.nbLignes > 1 ? 's' : ''} de commande</div>
          </div>
          <div className="card">
            <h2>Réceptionné</h2>
            <div className="stat">{euro(t.receptionne)}</div>
            <div className="muted">reste à recevoir {euro(t.resteARecevoir)}</div>
          </div>
          <div className="card">
            <h2>Facturé</h2>
            <div className="stat">{euro(t.facture)}</div>
            {conso.data && conso.data.factureHorsLignes.nombre > 0 && (
              <div className="muted">
                + {euro(conso.data.factureHorsLignes.montant)} de factures sans détail de lignes
              </div>
            )}
          </div>
          <div className="card">
            <h2>Écart de prix</h2>
            <div className="stat" style={{ color: Number(t.ecartPrix) > 0 ? '#dc2626' : undefined }}>
              {euro(t.ecartPrix)}
            </div>
            <div className="muted">facturé − commandé, à quantité égale</div>
          </div>
        </div>
      )}

      <div className="card" style={{ marginTop: 16, padding: 0, overflow: 'hidden' }}>
        {conso.isLoading && <p className="muted" style={{ padding: 16 }}>Chargement…</p>}
        {conso.data && conso.data.lignes.length === 0 && (
          <p className="muted" style={{ padding: 16 }}>
            Aucune commande validée sur ce périmètre.
          </p>
        )}
        {conso.data && conso.data.lignes.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table className="grid" style={{ margin: 0, minWidth: 900 }}>
              <thead>
                <tr>
                  <th style={{ width: 32 }}></th>
                  <th>{AXES.find((a) => a.v === axe)?.l}</th>
                  <th style={{ textAlign: 'right', width: 88 }}>Part</th>
                  {quantites && <th style={{ textAlign: 'right', width: 90 }}>Qté cdée</th>}
                  {quantites && <th style={{ width: 50 }}>Unité</th>}
                  <th style={{ textAlign: 'right' }}>Commandé</th>
                  <th style={{ textAlign: 'right' }}>Réceptionné</th>
                  <th style={{ textAlign: 'right' }}>Reste à recevoir</th>
                  <th style={{ textAlign: 'right' }}>Facturé</th>
                  <th style={{ textAlign: 'right' }}>Écart prix</th>
                  <th style={{ textAlign: 'right', width: 60 }}>Cdes</th>
                </tr>
              </thead>
              <tbody>
                {conso.data.lignes.map((l, i) => (
                  <tr
                    key={l.cle}
                    style={{ cursor: axe === 'code' || axe === 'famille' || axe === 'lot' ? 'default' : 'pointer' }}
                    onClick={() => creuser(l)}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}
                  >
                    <td className="muted" style={{ textAlign: 'right', fontSize: 11 }}>{i + 1}</td>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        {l.couleur && (
                          <span style={{
                            width: 10, height: 10, borderRadius: 2, background: l.couleur, flexShrink: 0,
                          }} />
                        )}
                        <span className="code-cell">{l.code}</span>
                        {l.label && <span className="muted" style={{ fontSize: 11 }}>{l.label}</span>}
                        {l.nbChantiers > 1 && (
                          <span className="muted" style={{ fontSize: 11 }}>· {l.nbChantiers} chantiers</span>
                        )}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {/* La barre dit d'un coup d'œil qui pèse : le chiffre seul se compare mal. */}
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ width: 34, height: 5, background: 'var(--surface)', borderRadius: 3 }}>
                          <span style={{
                            display: 'block', height: 5, borderRadius: 3, background: 'var(--accent)',
                            width: `${Math.max(2, Math.round(Number(l.part) * 34))}px`,
                          }} />
                        </span>
                        <span style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                          {(Number(l.part) * 100).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} %
                        </span>
                      </span>
                    </td>
                    {quantites && (
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {quantiteAdditionnable(l) ? qte(l.quantiteCommandee) : '—'}
                      </td>
                    )}
                    {quantites && (
                      <td className="muted" style={{ fontSize: 11 }}>
                        {l.unitesMultiples ? 'mixtes' : (quantiteAdditionnable(l) ? (l.unite ?? '—') : '—')}
                      </td>
                    )}
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{euro(l.commande)}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{euro(l.receptionne)}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{euro(l.resteARecevoir)}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{euro(l.facture)}</td>
                    <td style={{
                      textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                      color: Number(l.ecartPrix) > 0 ? '#dc2626' : Number(l.ecartPrix) < 0 ? '#16a34a' : undefined,
                    }}>
                      {Number(l.ecartPrix) === 0 ? '—' : euro(l.ecartPrix)}
                    </td>
                    <td className="muted" style={{ textAlign: 'right' }}>{l.nbCommandes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {conso.data && conso.data.factureHorsLignes.nombre > 0 && (
        <p className="muted" style={{ marginTop: 10, fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          <AlertTriangle size={13} />
          {conso.data.factureHorsLignes.nombre} facture
          {conso.data.factureHorsLignes.nombre > 1 ? 's' : ''} saisie
          {conso.data.factureHorsLignes.nombre > 1 ? 's' : ''} sans détail de lignes
          ({euro(conso.data.factureHorsLignes.montant)}) : aucun axe ne peut les ventiler. Elles
          restent hors du tableau plutôt que d’en fausser un total.
        </p>
      )}

      <p className="muted" style={{ marginTop: 12, fontSize: 12 }}>
        Cliquez une ligne pour restreindre l’analyse à ce groupe.{' '}
        <Link href="/achats" className="link">Registre des commandes →</Link>{' '}
        <Link href="/direction" className="link">Portefeuille de chantiers →</Link>
      </p>
    </div>
  );
}

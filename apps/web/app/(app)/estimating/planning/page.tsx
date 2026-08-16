'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CalendarCheck, CalendarDays, Clock, FileText } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { LigneVide } from '@/components/ui';
import { apiFetch } from '@/lib/api';

/**
 * Planning des études, au niveau AFFAIRE : c'est elle qui porte les jalons (une seule date de
 * remise pour tous ses lots). L'affectation d'un devis à un chargé d'étude se règle, elle, dans
 * « Paramètres du devis » — d'où le retrait de l'ancien tableau par devis, qui faisait doublon.
 *
 * Le délai est calculé par l'API (module pur `planning-delai`), jamais ici : les badges de chaque
 * ligne et les compteurs d'en-tête sortent ainsi de la même règle et ne peuvent pas diverger.
 */
interface Delai {
  etat: 'sans_echeance' | 'a_lheure' | 'avance' | 'depasse';
  jours: number | null;
  rendu: boolean;
}
interface AffairePlanning {
  id: string;
  code: string;
  name: string;
  status: string;
  responsable: string | null;
  conducteur: string | null;
  client_name: string | null;
  devis_count: number;
  date_limite_remise: string | null;
  date_retour_effectif: string | null;
  date_debut_etudes: string | null;
  date_fin_etudes: string | null;
  date_debut_travaux: string | null;
  date_fin_travaux: string | null;
  delai: Delai;
  close: boolean;
}
interface PlanningData {
  aujourdhui: string;
  affaires: AffairePlanning[];
  compteurs: { enCours: number; rendues: number; depassees: number; sansEcheance: number };
}

const STATUT_LABELS: Record<string, string> = {
  en_cours: 'En cours', gagnee: 'Gagnée', gagnee_partielle: 'Gagnée partiellement', perdue: 'Perdue',
};
const statutBadge = (s: string) =>
  s === 'gagnee' ? 'badge success' : s === 'perdue' ? 'badge danger'
    : s === 'gagnee_partielle' ? 'badge info' : 'badge';

/** Date courte : « 15 juin ». Un planning se lit d'un coup d'œil, pas en déchiffrant du 2026-06-15. */
function jour(v: string | null): string {
  if (!v) return '—';
  const d = new Date(`${v}T12:00:00`);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
}

/** Le verdict de délai, dit en français. */
function DelaiBadge({ d }: { d: Delai }) {
  if (d.etat === 'sans_echeance') return <span className="muted">—</span>;
  if (d.etat === 'depasse') {
    return (
      <span className="badge danger" title={d.rendu ? 'Remis après l’échéance' : 'Échéance passée'}>
        {d.rendu ? `Remis +${-d.jours!}j` : `Dépassé ${-d.jours!}j`}
      </span>
    );
  }
  if (d.etat === 'a_lheure') return <span className="badge info">Le jour même</span>;
  return (
    <span className="badge success" title={d.rendu ? 'Remis en avance' : 'Il reste du temps'}>
      {d.jours}j {d.rendu ? 'd’avance' : 'restants'}
    </span>
  );
}

type Vue = 'gantt' | 'tableau' | 'calendrier' | 'charge';

export default function PlanningEtudesPage() {
  const { token } = useAuth();
  const [vue, setVue] = useState<Vue>('tableau');
  const [affaireFiltre, setAffaireFiltre] = useState('');
  const [respFiltre, setRespFiltre] = useState('');
  /** Décalage en mois par rapport au mois courant : les vues à échelle de temps le partagent. */
  const [decalage, setDecalage] = useState(0);

  const planning = useQuery({
    queryKey: ['affaires-planning'],
    enabled: Boolean(token),
    queryFn: () => apiFetch<PlanningData>('/affaires-planning', { token }),
  });

  const affaires = useMemo(() => planning.data?.affaires ?? [], [planning.data]);
  const responsables = useMemo(
    () => Array.from(new Set(affaires.map((a) => a.responsable).filter(Boolean) as string[])).sort(),
    [affaires],
  );
  const lignes = useMemo(
    () => affaires.filter((a) =>
      (!affaireFiltre || a.id === affaireFiltre) &&
      (!respFiltre || a.responsable === respFiltre)),
    [affaires, affaireFiltre, respFiltre],
  );

  const c = planning.data?.compteurs;
  const cartes = [
    { l: 'Affaires en cours', v: c?.enCours ?? 0, Icon: FileText, color: '#2563eb', bg: '#eff6ff' },
    { l: 'Offres rendues', v: c?.rendues ?? 0, Icon: CalendarCheck, color: '#16a34a', bg: '#f0fdf4' },
    { l: 'Délai dépassé', v: c?.depassees ?? 0, Icon: AlertTriangle, color: '#dc2626', bg: '#fef2f2' },
    { l: 'Sans date limite', v: c?.sansEcheance ?? 0, Icon: Clock, color: '#d97706', bg: '#fffbeb' },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ marginBottom: 2 }}>Planning des études</h1>
          <p className="muted" style={{ marginTop: 0 }}>
            {affaires.length} affaire(s) · {affaires.reduce((n, a) => n + a.devis_count, 0)} devis
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 4, background: '#f1f5f9', padding: 3, borderRadius: 8 }}>
            {([
              ['gantt', 'Gantt'], ['tableau', 'Tableau'],
              ['calendrier', 'Calendrier'], ['charge', 'Charge'],
            ] as [Vue, string][]).map(([v, l]) => (
              <button key={v} type="button" onClick={() => setVue(v)}
                style={{
                  border: 'none', borderRadius: 6, padding: '4px 12px', fontSize: 12, cursor: 'pointer',
                  fontWeight: vue === v ? 700 : 500,
                  background: vue === v ? '#fff' : 'transparent',
                  color: vue === v ? 'var(--primary)' : '#64748b',
                  boxShadow: vue === v ? '0 1px 3px rgba(15,23,42,.12)' : 'none',
                }}>{l}</button>
            ))}
          </div>
          <select className="input" style={{ minWidth: 200 }} value={affaireFiltre}
            onChange={(e) => setAffaireFiltre(e.target.value)}>
            <option value="">Toutes les affaires</option>
            {affaires.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
          </select>
          <select className="input" style={{ minWidth: 180 }} value={respFiltre}
            onChange={(e) => setRespFiltre(e.target.value)}>
            <option value="">Tous les responsables</option>
            {responsables.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
      </div>

      <div className="card-grid" style={{ marginTop: 12 }}>
        {cartes.map((k) => (
          <div key={k.l} className="card" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{
              width: 34, height: 34, borderRadius: 9, background: k.bg, color: k.color,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <k.Icon size={17} />
            </span>
            <span>
              <span className="stat" style={{ display: 'block', lineHeight: 1.1, color: k.color }}>{k.v}</span>
              <span className="muted" style={{ fontSize: 11 }}>{k.l}</span>
            </span>
          </div>
        ))}
      </div>

      {vue !== 'tableau' && planning.data && (
        <FenetreTemps
          vue={vue}
          lignes={lignes}
          decalage={decalage}
          setDecalage={setDecalage}
          aujourdhui={planning.data.aujourdhui}
        />
      )}

      <div className="card" style={{ marginTop: 16, display: vue === 'tableau' ? undefined : 'none' }}>
        {planning.isLoading && <p className="muted">Chargement…</p>}
        {planning.isError && <p className="muted">Planning indisponible.</p>}
        {planning.data && (
          <table className="grid">
            <thead>
              <tr>
                <th>Affaire</th>
                <th>Client</th>
                <th>Statut</th>
                <th>Date limite</th>
                <th>Retour effectif</th>
                <th>Études</th>
                <th>Réalisation</th>
                <th>Délai</th>
                <th style={{ textAlign: 'right' }}>Devis</th>
              </tr>
            </thead>
            <tbody>
              {lignes.map((a) => (
                <tr key={a.id}>
                  <td>
                    <Link href={`/estimating/${a.id}`} className="link">
                      <span className="code-cell">{a.code}</span> {a.name}
                    </Link>
                    {a.responsable && <div className="muted" style={{ fontSize: 10.5 }}>{a.responsable}</div>}
                  </td>
                  <td className="muted">{a.client_name ?? '—'}</td>
                  <td><span className={statutBadge(a.status)}>{STATUT_LABELS[a.status] ?? a.status}</span></td>
                  <td style={{
                    color: a.delai.etat === 'depasse' ? '#b91c1c' : undefined,
                    fontWeight: a.date_limite_remise ? 600 : 400,
                  }}>
                    {jour(a.date_limite_remise)}
                  </td>
                  <td style={{ color: a.date_retour_effectif ? '#15803d' : undefined }}>
                    {jour(a.date_retour_effectif)}
                  </td>
                  <td className="muted">
                    {a.date_debut_etudes || a.date_fin_etudes
                      ? `${jour(a.date_debut_etudes)} → ${jour(a.date_fin_etudes)}`
                      : '—'}
                  </td>
                  <td className="muted">
                    {a.date_debut_travaux || a.date_fin_travaux
                      ? `${jour(a.date_debut_travaux)} → ${jour(a.date_fin_travaux)}`
                      : '—'}
                  </td>
                  <td><DelaiBadge d={a.delai} /></td>
                  <td style={{ textAlign: 'right' }}>{a.devis_count}</td>
                </tr>
              ))}
              {lignes.length === 0 && (
                <LigneVide
                  colonnes={9}
                  icone={CalendarDays}
                  titre="Aucune affaire ne correspond à ce filtre."
                  indice="Élargissez la période ou effacez les filtres pour retrouver vos affaires."
                />
              )}
            </tbody>
          </table>
        )}
        <p className="muted" style={{ fontSize: 11, marginBottom: 0, marginTop: 10 }}>
          Les jalons se saisissent sur la fiche de l’affaire. L’affectation d’un devis à un chargé
          d’étude se règle dans « Paramètres du devis ».
        </p>
      </div>
    </div>
  );
}

/* ─────────── Vues à échelle de temps : Gantt, Calendrier, Charge ─────────── */

const MOIS = ['janv.', 'févr.', 'mars', 'avril', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const d0 = (v: string) => new Date(`${v}T12:00:00`);
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Les six jalons, avec leur teinte — la même dans le Gantt, le calendrier et la légende. */
const JALONS = [
  { k: 'date_limite_remise', l: 'Date limite (client)', c: '#f97316' },
  { k: 'date_retour_effectif', l: 'Retour effectif', c: '#16a34a' },
  { k: 'date_debut_etudes', l: 'Début études', c: '#2563eb' },
  { k: 'date_fin_etudes', l: 'Fin études', c: '#a855f7' },
  { k: 'date_debut_travaux', l: 'Début travaux', c: '#0ea5e9' },
  { k: 'date_fin_travaux', l: 'Fin travaux', c: '#059669' },
] as const;

/**
 * Cadre commun aux vues datées : une fenêtre de quatre mois qu'on fait défiler, et la même
 * échelle pour tout le monde — deux vues qui ne partagent pas leur échelle ne se comparent pas.
 */
function FenetreTemps({ vue, lignes, decalage, setDecalage, aujourdhui }: {
  vue: Vue; lignes: AffairePlanning[]; decalage: number;
  setDecalage: (n: number) => void; aujourdhui: string;
}) {
  const debut = useMemo(() => {
    const d = d0(aujourdhui);
    return new Date(d.getFullYear(), d.getMonth() + decalage, 1);
  }, [aujourdhui, decalage]);
  const nbMois = vue === 'calendrier' ? 1 : 4;
  const fin = useMemo(
    () => new Date(debut.getFullYear(), debut.getMonth() + nbMois, 1),
    [debut, nbMois],
  );
  const titre = vue === 'calendrier'
    ? `${MOIS[debut.getMonth()]} ${debut.getFullYear()}`
    : `${MOIS[debut.getMonth()]} ${debut.getFullYear()} — ${MOIS[(debut.getMonth() + nbMois - 1) % 12]} ${new Date(debut.getFullYear(), debut.getMonth() + nbMois - 1, 1).getFullYear()}`;

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <button type="button" className="btn-secondary" style={{ padding: '2px 10px' }}
          onClick={() => setDecalage(decalage - 1)}>‹</button>
        <strong style={{ fontSize: 13 }}>{titre}</strong>
        <button type="button" className="btn-secondary" style={{ padding: '2px 10px' }}
          onClick={() => setDecalage(decalage + 1)}>›</button>
        {decalage !== 0 && (
          <button type="button" className="btn-ghost" style={{ fontSize: 11 }}
            onClick={() => setDecalage(0)}>Aujourd’hui</button>
        )}
      </div>

      {vue === 'gantt' && <Gantt lignes={lignes} debut={debut} fin={fin} aujourdhui={aujourdhui} />}
      {vue === 'calendrier' && <Calendrier lignes={lignes} mois={debut} aujourdhui={aujourdhui} />}
      {vue === 'charge' && <Charge lignes={lignes} debut={debut} fin={fin} aujourdhui={aujourdhui} />}

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 12, fontSize: 11 }} className="muted">
        {(vue === 'calendrier' ? JALONS : [
          { l: 'Période d’études', c: '#2563eb' }, { l: 'Période de réalisation', c: '#16a34a' },
        ]).map((j) => (
          <span key={j.l} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: j.c }} />{j.l}
          </span>
        ))}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 2, height: 11, background: '#dc2626' }} />Aujourd’hui
        </span>
      </div>
    </div>
  );
}

/** Barre positionnée dans la fenêtre, en pourcentage — indépendante de la largeur de l'écran. */
function barre(de: string | null, a: string | null, debut: Date, fin: Date) {
  if (!de && !a) return null;
  const d = d0(de ?? a!).getTime();
  const f = d0(a ?? de!).getTime();
  const t0 = debut.getTime();
  const t1 = fin.getTime();
  if (f < t0 || d > t1) return null; // hors fenêtre
  const gauche = Math.max(0, ((d - t0) / (t1 - t0)) * 100);
  const droite = Math.min(100, ((f - t0) / (t1 - t0)) * 100);
  return { gauche, largeur: Math.max(1.2, droite - gauche) };
}

function TraitAujourdhui({ debut, fin, aujourdhui }: { debut: Date; fin: Date; aujourdhui: string }) {
  const p = ((d0(aujourdhui).getTime() - debut.getTime()) / (fin.getTime() - debut.getTime())) * 100;
  if (p < 0 || p > 100) return null;
  return (
    <div style={{ position: 'absolute', left: `${p}%`, top: 0, bottom: 0, width: 2, background: '#dc2626', zIndex: 1 }} />
  );
}

/** En-tête de mois, commun au Gantt et à la charge. */
function EnTeteMois({ debut, fin }: { debut: Date; fin: Date }) {
  const mois: Date[] = [];
  for (let d = new Date(debut); d < fin; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) mois.push(d);
  return (
    <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
      {mois.map((m) => (
        <div key={m.toISOString()} style={{
          flex: 1, textAlign: 'center', fontSize: 11, fontWeight: 600, padding: '4px 0', color: '#64748b',
        }}>
          {MOIS[m.getMonth()]} <span style={{ fontWeight: 400 }}>{m.getFullYear()}</span>
        </div>
      ))}
    </div>
  );
}

function Gantt({ lignes, debut, fin, aujourdhui }: {
  lignes: AffairePlanning[]; debut: Date; fin: Date; aujourdhui: string;
}) {
  const visibles = lignes.filter((a) =>
    barre(a.date_debut_etudes, a.date_fin_etudes, debut, fin) ||
    barre(a.date_debut_travaux, a.date_fin_travaux, debut, fin));
  if (visibles.length === 0) {
    return <p className="muted">Aucune affaire jalonnée sur cette période. Renseignez les dates sur la fiche de l’affaire.</p>;
  }
  return (
    <div>
      <div style={{ display: 'flex' }}>
        <div style={{ width: 260, flexShrink: 0 }} />
        <div style={{ flex: 1 }}><EnTeteMois debut={debut} fin={fin} /></div>
      </div>
      {visibles.map((a) => {
        const etu = barre(a.date_debut_etudes, a.date_fin_etudes, debut, fin);
        const tra = barre(a.date_debut_travaux, a.date_fin_travaux, debut, fin);
        return (
          <div key={a.id} style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid #f1f5f9' }}>
            <div style={{ width: 260, flexShrink: 0, padding: '7px 8px 7px 0', fontSize: 12 }}>
              <Link href={`/estimating/${a.id}`} className="link">
                <span className="code-cell">{a.code}</span> {a.name}
              </Link>
            </div>
            <div style={{ flex: 1, position: 'relative', height: 30 }}>
              <TraitAujourdhui debut={debut} fin={fin} aujourdhui={aujourdhui} />
              {etu && (
                <div title={`Études : ${jour(a.date_debut_etudes)} → ${jour(a.date_fin_etudes)}`}
                  style={{
                    position: 'absolute', left: `${etu.gauche}%`, width: `${etu.largeur}%`,
                    top: 5, height: 9, borderRadius: 5, background: '#bfdbfe', border: '1px solid #2563eb',
                  }} />
              )}
              {tra && (
                <div title={`Travaux : ${jour(a.date_debut_travaux)} → ${jour(a.date_fin_travaux)}`}
                  style={{
                    position: 'absolute', left: `${tra.gauche}%`, width: `${tra.largeur}%`,
                    top: 17, height: 9, borderRadius: 5, background: '#bbf7d0', border: '1px solid #16a34a',
                  }} />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Calendrier({ lignes, mois, aujourdhui }: {
  lignes: AffairePlanning[]; mois: Date; aujourdhui: string;
}) {
  // Les jalons du mois, rangés par jour : un même jour peut en porter plusieurs.
  const parJour = new Map<string, { l: string; c: string; code: string }[]>();
  for (const a of lignes) {
    for (const j of JALONS) {
      const v = a[j.k];
      if (!v) continue;
      const d = d0(v);
      if (d.getMonth() !== mois.getMonth() || d.getFullYear() !== mois.getFullYear()) continue;
      const arr = parJour.get(v) ?? [];
      arr.push({ l: j.l, c: j.c, code: a.code });
      parJour.set(v, arr);
    }
  }
  const premier = new Date(mois.getFullYear(), mois.getMonth(), 1);
  // Semaine commençant le lundi (getDay : 0 = dimanche).
  const decalageLundi = (premier.getDay() + 6) % 7;
  const nbJours = new Date(mois.getFullYear(), mois.getMonth() + 1, 0).getDate();
  const cases: (Date | null)[] = [
    ...Array.from({ length: decalageLundi }, () => null),
    ...Array.from({ length: nbJours }, (_, i) => new Date(mois.getFullYear(), mois.getMonth(), i + 1)),
  ];

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, background: 'var(--border)', border: '1px solid var(--border)' }}>
        {['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map((d) => (
          <div key={d} style={{ background: '#f8fafc', padding: '5px 6px', fontSize: 11, fontWeight: 600, color: '#64748b', textAlign: 'center' }}>{d}</div>
        ))}
        {cases.map((d, i) => {
          const k = d ? iso(d) : null;
          const evts = k ? parJour.get(k) ?? [] : [];
          const cejour = k === aujourdhui;
          return (
            <div key={i} style={{
              background: d ? (cejour ? '#fff7ed' : '#fff') : '#f8fafc',
              minHeight: 84, padding: '4px 5px',
            }}>
              {d && (
                <div style={{ fontSize: 11, fontWeight: cejour ? 700 : 500, color: cejour ? '#c2410c' : '#64748b' }}>
                  {d.getDate()}
                </div>
              )}
              {evts.map((e, n) => (
                <div key={n} title={`${e.code} — ${e.l}`} style={{
                  marginTop: 2, padding: '1px 4px', borderRadius: 3, fontSize: 10,
                  background: `${e.c}1a`, color: e.c, border: `1px solid ${e.c}55`,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {e.code} — {e.l}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Charge({ lignes, debut, fin, aujourdhui }: {
  lignes: AffairePlanning[]; debut: Date; fin: Date; aujourdhui: string;
}) {
  // Une ligne par responsable : qui porte quoi, et quand. « Non attribué » se voit aussi — c'est
  // souvent là que se cachent les affaires oubliées.
  const parResp = new Map<string, AffairePlanning[]>();
  for (const a of lignes) {
    const k = a.responsable ?? '';
    parResp.set(k, [...(parResp.get(k) ?? []), a]);
  }
  const groupes = [...parResp.entries()].sort((a, b) => (a[0] || 'zz').localeCompare(b[0] || 'zz'));

  return (
    <div>
      <div style={{ display: 'flex' }}>
        <div style={{ width: 220, flexShrink: 0 }} />
        <div style={{ flex: 1 }}><EnTeteMois debut={debut} fin={fin} /></div>
      </div>
      {groupes.map(([resp, aff]) => (
        <div key={resp || 'na'} style={{ display: 'flex', alignItems: 'stretch', borderBottom: '1px solid #f1f5f9' }}>
          <div style={{ width: 220, flexShrink: 0, padding: '8px 8px 8px 0' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: resp ? '#334155' : '#94a3b8' }}>
              {resp || 'Non attribué'}
            </div>
            <div className="muted" style={{ fontSize: 10.5 }}>{aff.length} affaire(s)</div>
          </div>
          <div style={{ flex: 1, position: 'relative', padding: '6px 0' }}>
            <TraitAujourdhui debut={debut} fin={fin} aujourdhui={aujourdhui} />
            {aff.map((a) => {
              const etu = barre(a.date_debut_etudes, a.date_fin_etudes, debut, fin);
              const tra = barre(a.date_debut_travaux, a.date_fin_travaux, debut, fin);
              if (!etu && !tra) return null;
              return (
                <div key={a.id} style={{ position: 'relative', height: 16 }}>
                  {etu && (
                    <div title={`${a.code} — études`} style={{
                      position: 'absolute', left: `${etu.gauche}%`, width: `${etu.largeur}%`,
                      top: 3, height: 10, borderRadius: 5, background: '#bfdbfe', border: '1px solid #2563eb',
                      fontSize: 9, color: '#1d4ed8', overflow: 'hidden', paddingLeft: 3, lineHeight: '9px',
                    }}>{a.code}</div>
                  )}
                  {tra && (
                    <div title={`${a.code} — travaux`} style={{
                      position: 'absolute', left: `${tra.gauche}%`, width: `${tra.largeur}%`,
                      top: 3, height: 10, borderRadius: 5, background: '#bbf7d0', border: '1px solid #16a34a',
                    }} />
                  )}
                </div>
              );
            })}
            {aff.every((a) => !barre(a.date_debut_etudes, a.date_fin_etudes, debut, fin)
              && !barre(a.date_debut_travaux, a.date_fin_travaux, debut, fin)) && (
              <div className="muted" style={{ fontSize: 11, padding: '4px 0' }}>Aucune période sur ce trimestre</div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

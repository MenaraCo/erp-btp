'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CalendarCheck, Clock, FileText } from 'lucide-react';
import { useAuth } from '@/lib/auth';
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

export default function PlanningEtudesPage() {
  const { token } = useAuth();
  const [affaireFiltre, setAffaireFiltre] = useState('');
  const [respFiltre, setRespFiltre] = useState('');

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
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
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

      <div className="card" style={{ marginTop: 16 }}>
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
                <tr><td colSpan={9} className="muted">Aucune affaire ne correspond à ce filtre.</td></tr>
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

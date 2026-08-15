'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CalendarDays } from 'lucide-react';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { CalendrierMois, grilleDuMois, iso } from '@/components/CalendrierMois';

interface Creneau {
  id: string;
  kind: 'realise' | 'prevu';
  employeeId: string;
  label: string;
  chantierId: string;
  chantierCode: string;
  chantierNom: string;
  date: string;
  heures: string;
  debut: string | null;
  fin: string | null;
  fige: boolean;
}
interface Creneaux { debut: string; fin: string; jours: string[]; creneaux: Creneau[] }
interface Conflit { employeeId: string; label: string; date: string; motifs: string[] }
interface Conflits { conflits: Conflit[]; total: number }
interface Employee { id: string; fullName: string }
interface Chantier { id: string; code: string; name: string }

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août',
  'septembre', 'octobre', 'novembre', 'décembre'];

/**
 * Occupation du personnel — calendrier mensuel.
 *
 * La version précédente était un tableau qui s'étirait sur trente colonnes : il fallait le faire
 * défiler de gauche à droite pour lire un mois, ce qu'aucun calendrier ne demande. Ici, la
 * semaine se lit sur une ligne et le mois tient dans l'écran, comme dans un agenda.
 *
 * Chaque jour liste ses interventions ; celles qui posent problème (même personne à deux endroits
 * au même moment, cumul impossible) teintent la case.
 */
export default function OccupationPage() {
  const { token } = useAuth();
  const qc = useQueryClient();
  const [ancre, setAncre] = useState(() => iso(new Date()));
  const [salarie, setSalarie] = useState('');
  const [chantier, setChantier] = useState('');
  const [contrat, setContrat] = useState('');
  const [err, setErr] = useState<string | null>(null);

  // La grille couvre des semaines entières : un mois commence rarement un lundi.
  const { debut, fin, jours, mois, moisAffiche } = useMemo(() => {
    const g = grilleDuMois(ancre);
    const d = new Date(`${ancre}T00:00:00Z`);
    return { ...g, moisAffiche: `${MOIS[d.getUTCMonth()]} ${d.getUTCFullYear()}` };
  }, [ancre]);

  const requete = useMemo(() => {
    const p = new URLSearchParams({ debut, fin });
    if (salarie) p.set('salarie', salarie);
    if (chantier) p.set('chantier', chantier);
    if (contrat) p.set('contrat', contrat);
    return p.toString();
  }, [debut, fin, salarie, chantier, contrat]);

  const donnees = useQuery({
    queryKey: ['creneaux-mois', requete],
    enabled: Boolean(token),
    queryFn: () => apiFetch<Creneaux>(`/personnel/creneaux?${requete}`, { token }),
  });
  const conflits = useQuery({
    queryKey: ['conflits-mois', debut, fin],
    enabled: Boolean(token),
    queryFn: () => apiFetch<Conflits>(`/personnel/conflits?debut=${debut}&fin=${fin}`, { token }),
  });
  const salaries = useQuery({
    queryKey: ['employees'], enabled: Boolean(token),
    queryFn: () => apiFetch<Employee[]>('/employees', { token }),
  });
  const chantiers = useQuery({
    queryKey: ['chantiers'], enabled: Boolean(token),
    queryFn: () => apiFetch<Chantier[]>('/chantiers', { token }),
  });

  const deplacer = useMutation({
    mutationFn: (v: { kind: string; id: string; date: string }) =>
      apiFetch(`/personnel/creneaux/${v.kind}/${v.id}`, { method: 'PATCH', token, body: { date: v.date } }),
    onSuccess: () => {
      setErr(null);
      qc.invalidateQueries({ queryKey: ['creneaux-mois'] });
      qc.invalidateQueries({ queryKey: ['conflits-mois'] });
      qc.invalidateQueries({ queryKey: ['occupation'] });
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Déplacement impossible'),
  });

  const decaler = (pas: number) => {
    const d = new Date(`${ancre}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + pas, 1);
    setAncre(iso(d));
  };

  const conflitsParJour = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const c of conflits.data?.conflits ?? []) {
      m.set(c.date, [...(m.get(c.date) ?? []), `${c.label} — ${c.motifs.join(' · ')}`]);
    }
    return m;
  }, [conflits.data]);


  return (
    <div>
      <h1 style={{ marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
        <CalendarDays size={20} /> Occupation du personnel
      </h1>
      <p className="muted" style={{ marginTop: 0, maxWidth: 820 }}>
        Qui travaille où, tous chantiers confondus. Glissez une intervention sur un autre jour pour
        la déplacer ; les journées teintées demandent une vérification.
      </p>

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 12 }}>
        <button className="btn btn-secondary" onClick={() => decaler(-1)}>‹</button>
        <div style={{ minWidth: 150, textAlign: 'center', fontWeight: 600, textTransform: 'capitalize' }}>
          {moisAffiche}
        </div>
        <button className="btn btn-secondary" onClick={() => decaler(1)}>›</button>
        <button className="btn btn-secondary" onClick={() => setAncre(iso(new Date()))}>Aujourd’hui</button>

        <div className="field" style={{ marginBottom: 0, marginLeft: 12 }}>
          <label>Salarié</label>
          <select value={salarie} onChange={(e) => setSalarie(e.target.value)} style={{ minWidth: 160 }}>
            <option value="">Tous</option>
            {(salaries.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.fullName}</option>)}
          </select>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Chantier</label>
          <select value={chantier} onChange={(e) => setChantier(e.target.value)} style={{ minWidth: 160 }}>
            <option value="">Tous</option>
            {(chantiers.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
          </select>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Contrat</label>
          <select value={contrat} onChange={(e) => setContrat(e.target.value)}>
            <option value="">Tous</option>
            <option value="salarie">Salariés</option>
            <option value="interimaire">Intérimaires</option>
            <option value="apprenti">Apprentis</option>
          </select>
        </div>
      </div>

      {err && <div className="error" style={{ marginTop: 12 }}>{err}</div>}
      {conflits.data && conflits.data.total > 0 && (
        <div className="card" style={{ marginTop: 12, borderColor: 'var(--danger, #dc2626)', padding: '10px 14px' }}>
          <span style={{ color: 'var(--danger, #dc2626)', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <AlertTriangle size={16} />
            <strong>{conflits.data.total} journée{conflits.data.total > 1 ? 's' : ''} à vérifier</strong>
          </span>
        </div>
      )}

      <CalendrierMois
        jours={jours}
        mois={mois}
        creneaux={donnees.data?.creneaux ?? []}
        conflitsParJour={conflitsParJour}
        onDeplacer={(kind, id, date) => deplacer.mutate({ kind, id, date })}
      />
    </div>
  );
}

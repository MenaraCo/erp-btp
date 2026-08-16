'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  CalendarDays, CalendarRange, ChevronLeft, ChevronRight, List, Lock, Plus, Users,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { apiFetch } from '@/lib/api';
import { euro } from '@/lib/format';
import { Alerte, Bouton, CarteKpi, LigneVide } from '@/components/ui';
import { CalendrierPointages, estFige, PointageJour } from '@/components/CalendrierPointages';
import { PointageModal } from '@/components/PointageModal';

interface TimesheetSummary { totalCost: string; totalHours: string }

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function libelleMois(d: string): string {
  const [a, m] = d.split('-').map(Number);
  return new Date(a, m - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
}
/** Bornes chargées : le mois élargi aux semaines entières, ou la semaine du jour d'ancrage. */
function bornes(ancre: string, vue: 'mois' | 'semaine'): { debut: string; fin: string } {
  const [a, m, j] = ancre.split('-').map(Number);
  if (vue === 'semaine') {
    const base = new Date(a, m - 1, j);
    const lundi = new Date(base);
    lundi.setDate(base.getDate() - ((base.getDay() + 6) % 7));
    const dimanche = new Date(lundi);
    dimanche.setDate(lundi.getDate() + 6);
    return { debut: iso(lundi), fin: iso(dimanche) };
  }
  const premier = new Date(a, m - 1, 1);
  const debut = new Date(premier);
  debut.setDate(1 - ((premier.getDay() + 6) % 7));
  const fin = new Date(debut);
  fin.setDate(debut.getDate() + 41);
  return { debut: iso(debut), fin: iso(fin) };
}
function decaler(ancre: string, vue: 'mois' | 'semaine', pas: number): string {
  const [a, m, j] = ancre.split('-').map(Number);
  const d = new Date(a, m - 1, j);
  if (vue === 'semaine') d.setDate(d.getDate() + pas * 7);
  else d.setMonth(d.getMonth() + pas, 1);
  return iso(d);
}

/**
 * Pointages d'un chantier — l'agenda des heures réellement faites.
 *
 * La saisie se relisait dans une liste à plat : pour vérifier une semaine, il fallait la
 * reconstituer de tête. Posée sur un calendrier, une journée creuse ou un oubli se voit sans rien
 * chercher, et un clic sur la case ouvre la saisie du jour.
 *
 * Tout se corrige tant que ce n'est pas FIGÉ : imputé au résultat du chantier, ou couvert par un
 * relevé de paye signé. Ces lignes-là portent un cadenas et s'ouvrent en lecture — on doit
 * pouvoir vérifier ce qui a été compté même quand il est trop tard pour le changer.
 */
export default function PointagesPage() {
  const { token } = useAuth();
  const chantierId = String(useParams().chantierId);

  const [vue, setVue] = useState<'mois' | 'semaine' | 'liste'>('mois');
  const [ancre, setAncre] = useState(() => iso(new Date()));
  const [fenetre, setFenetre] = useState<null | { pointage: PointageJour | null; date: string }>(null);

  const grille = vue === 'liste' ? 'mois' : vue;
  const periode = useMemo(() => bornes(ancre, grille), [ancre, grille]);

  const chantier = useQuery({
    queryKey: ['chantier', chantierId],
    enabled: Boolean(token),
    queryFn: () => apiFetch<{ code: string }>(`/chantiers/${chantierId}`, { token }),
  });
  const list = useQuery({
    queryKey: ['timesheets', chantierId, periode.debut, periode.fin],
    enabled: Boolean(token),
    retry: false,
    queryFn: () => apiFetch<PointageJour[]>(
      `/chantiers/${chantierId}/timesheets?debut=${periode.debut}&fin=${periode.fin}`, { token },
    ),
  });
  const summary = useQuery({
    queryKey: ['timesheets-summary', chantierId],
    enabled: Boolean(token),
    retry: false,
    queryFn: () => apiFetch<TimesheetSummary>(`/chantiers/${chantierId}/timesheets/summary`, { token }),
  });

  const lignes = list.data ?? [];
  const heuresPeriode = lignes.reduce((s, p) => s + Number(p.hours), 0);
  const coutPeriode = lignes.reduce((s, p) => s + Number(p.cost), 0);
  const figes = lignes.filter(estFige).length;
  const salaries = new Set(lignes.map((p) => p.employee_label)).size;

  return (
    <div>
      <p className="muted" style={{ marginTop: 0 }}>
        <Link href={`/chantiers/${chantierId}`} className="link">← Chantier {chantier.data?.code ?? ''}</Link>
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Users size={20} /> Pointages
        </h1>
        <span style={{ marginLeft: 'auto' }}>
          <Bouton icone={Plus} onClick={() => setFenetre({ pointage: null, date: iso(new Date()) })}>
            Nouveau pointage
          </Bouton>
        </span>
      </div>
      <p className="muted" style={{ marginTop: 4, maxWidth: 820 }}>
        Les heures réellement faites sur ce chantier. Cliquez une case pour saisir la journée, une
        pastille pour la corriger — tant qu’elle n’est pas figée.
      </p>

      {summary.isError && (
        <Alerte>Module « Suivi de chantiers » non actif pour cet utilisateur, ou accès refusé.</Alerte>
      )}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button className="btn-ghost" title="Précédent" onClick={() => setAncre(decaler(ancre, grille, -1))}>
            <ChevronLeft size={16} />
          </button>
          <strong style={{ minWidth: 170, textAlign: 'center', fontSize: 13, textTransform: 'capitalize' }}>
            {grille === 'mois'
              ? libelleMois(ancre)
              : `Semaine du ${new Date(periode.debut).toLocaleDateString('fr-FR')}`}
          </strong>
          <button className="btn-ghost" title="Suivant" onClick={() => setAncre(decaler(ancre, grille, 1))}>
            <ChevronRight size={16} />
          </button>
          <button className="btn-ghost" onClick={() => setAncre(iso(new Date()))}>Aujourd’hui</button>
        </div>

        <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
          <Bouton variante={vue === 'mois' ? 'primaire' : 'secondaire'} icone={CalendarDays} onClick={() => setVue('mois')}>
            Mois
          </Bouton>
          <Bouton variante={vue === 'semaine' ? 'primaire' : 'secondaire'} icone={CalendarRange} onClick={() => setVue('semaine')}>
            Semaine
          </Bouton>
          <Bouton variante={vue === 'liste' ? 'primaire' : 'secondaire'} icone={List} onClick={() => setVue('liste')}>
            Liste
          </Bouton>
        </div>
      </div>

      <div className="card-grid" style={{ marginTop: 14 }}>
        <CarteKpi
          titre="Heures sur la période"
          valeur={heuresPeriode.toLocaleString('fr-FR')}
          detail={grille === 'mois' ? libelleMois(ancre) : `semaine du ${new Date(periode.debut).toLocaleDateString('fr-FR')}`}
        />
        <CarteKpi titre="Coût sur la période" valeur={euro(coutPeriode.toFixed(2))} />
        <CarteKpi titre="Salariés pointés" valeur={salaries} detail={`${figes} ligne${figes > 1 ? 's' : ''} figée${figes > 1 ? 's' : ''}`} />
        {summary.data && (
          <CarteKpi
            titre="Total chantier"
            valeur={`${Number(summary.data.totalHours).toLocaleString('fr-FR')} h`}
            detail={euro(summary.data.totalCost)}
          />
        )}
      </div>

      <div style={{ marginTop: 14 }}>
        {vue === 'liste' ? (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table className="grid" style={{ margin: 0 }}>
              <thead>
                <tr>
                  <th style={{ width: 110 }}>Date</th>
                  <th>Salarié / équipe</th>
                  <th>Ouvrage</th>
                  <th style={{ width: 90 }}>Poste</th>
                  <th style={{ width: 80, textAlign: 'right' }}>Heures</th>
                  <th style={{ width: 110, textAlign: 'right' }}>Coût horaire</th>
                  <th style={{ width: 110, textAlign: 'right' }}>Coût</th>
                  <th style={{ width: 40 }} />
                </tr>
              </thead>
              <tbody>
                {lignes.map((p) => (
                  <tr
                    key={p.id}
                    style={{ cursor: 'pointer' }}
                    onClick={() => setFenetre({ pointage: p, date: p.work_date })}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}
                  >
                    <td className="code-cell">{new Date(p.work_date).toLocaleDateString('fr-FR')}</td>
                    <td>{p.employee_label}</td>
                    <td className="muted">{p.ouvrage_label ?? '—'}</td>
                    <td>{p.code_analytique
                      ? <span className="code-cell">{p.code_analytique}</span>
                      : <span className="muted">—</span>}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{Number(p.hours)}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{euro(p.hourly_cost)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{euro(p.cost)}</td>
                    <td style={{ textAlign: 'center' }}>
                      {estFige(p) && (
                        <Lock
                          size={12}
                          className="muted"
                          aria-label={p.impute ? 'Imputé au résultat' : 'Relevé de paye signé'}
                        />
                      )}
                    </td>
                  </tr>
                ))}
                {lignes.length === 0 && (
                  <LigneVide
                    colonnes={8}
                    icone={Users}
                    titre="Aucun pointage sur cette période."
                    indice="Cliquez une case du calendrier, ou « Nouveau pointage » : le coût horaire vient de la fiche du salarié."
                  />
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <CalendrierPointages
            vue={grille}
            ancre={ancre}
            pointages={lignes}
            onJour={(date) => setFenetre({ pointage: null, date })}
            onPointage={(p) => setFenetre({ pointage: p, date: p.work_date })}
          />
        )}
      </div>

      {fenetre && (
        <PointageModal
          chantierId={chantierId}
          pointage={fenetre.pointage}
          date={fenetre.date}
          onClose={() => setFenetre(null)}
        />
      )}
    </div>
  );
}

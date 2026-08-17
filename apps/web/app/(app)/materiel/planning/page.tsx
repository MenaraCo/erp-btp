'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CalendarRange, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Alerte, Bouton, LigneVide } from '@/components/ui';
import { Modale } from '@/components/Modale';
import { Materiel } from '@/components/MaterielModal';
import { teinteChantier } from '@/components/CalendrierMois';

interface Affectation {
  id: string;
  equipment_id: string;
  chantier_id: string;
  date_debut: string;
  date_fin: string;
  materiel_code: string;
  materiel: string;
  chantier_code: string;
  chantier_nom: string | null;
  chantier_couleur: string | null;
}
interface Chantier { id: string; code: string; name: string }

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function moisCourant(): string { return iso(new Date()).slice(0, 7); }
function libelleMois(m: string): string {
  const [a, mo] = m.split('-').map(Number);
  return new Date(a, mo - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
}

/**
 * Planning du parc — quel engin, sur quel chantier, quels jours.
 *
 * Une ligne par matériel, une colonne par jour : c'est la lecture qui répond à « puis-je promettre
 * la pelle la semaine prochaine ». Les barres portent la couleur du chantier, comme partout
 * ailleurs dans l'application, et un engin promis deux fois le même jour se voit d'un coup d'œil.
 */
export default function PlanningMaterielPage() {
  const { token } = useAuth();
  const qc = useQueryClient();
  const [mois, setMois] = useState(moisCourant);
  const [err, setErr] = useState<string | null>(null);
  const [saisie, setSaisie] = useState<null | {
    equipmentId: string; chantierId: string; dateDebut: string; dateFin: string;
  }>(null);

  const [annee, moisNum] = mois.split('-').map(Number);
  const debut = `${mois}-01`;
  const fin = iso(new Date(annee, moisNum, 0));
  const jours = useMemo(
    () => Array.from({ length: new Date(annee, moisNum, 0).getDate() }, (_, i) =>
      new Date(annee, moisNum - 1, i + 1)),
    [annee, moisNum],
  );

  const materiels = useQuery({
    queryKey: ['materiel', false],
    enabled: Boolean(token),
    retry: false,
    queryFn: () => apiFetch<Materiel[]>('/materiel', { token }),
  });
  const affectations = useQuery({
    queryKey: ['materiel-affectations', debut, fin],
    enabled: Boolean(token),
    retry: false,
    queryFn: () => apiFetch<Affectation[]>(`/materiel/affectations?debut=${debut}&fin=${fin}`, { token }),
  });
  const conflits = useQuery({
    queryKey: ['materiel-conflits', debut, fin],
    enabled: Boolean(token),
    retry: false,
    queryFn: () => apiFetch<Array<{ materiel_code: string; chantier_a: string; chantier_b: string; debut: string; fin: string }>>(
      `/materiel/conflits?debut=${debut}&fin=${fin}`, { token },
    ),
  });
  const chantiers = useQuery({
    queryKey: ['chantiers'], enabled: Boolean(token),
    queryFn: () => apiFetch<Chantier[]>('/chantiers', { token }),
  });

  const rafraichir = () => {
    qc.invalidateQueries({ queryKey: ['materiel-affectations'] });
    qc.invalidateQueries({ queryKey: ['materiel-conflits'] });
    qc.invalidateQueries({ queryKey: ['materiel'] });
  };
  const echoue = (e: unknown) => setErr(e instanceof ApiError ? e.message : 'Opération impossible.');

  const affecter = useMutation({
    mutationFn: () => apiFetch(`/materiel/${saisie?.equipmentId}/affectations`, {
      method: 'POST', token,
      body: {
        chantierId: saisie?.chantierId, dateDebut: saisie?.dateDebut, dateFin: saisie?.dateFin,
      },
    }),
    onSuccess: () => { setErr(null); setSaisie(null); rafraichir(); },
    onError: echoue,
  });
  const retirer = useMutation({
    mutationFn: (id: string) => apiFetch(`/materiel/affectations/${id}`, { method: 'DELETE', token }),
    onSuccess: () => { setErr(null); rafraichir(); },
    onError: echoue,
  });

  const parMateriel = useMemo(() => {
    const carte = new Map<string, Affectation[]>();
    for (const a of affectations.data ?? []) {
      const liste = carte.get(a.equipment_id) ?? [];
      liste.push(a);
      carte.set(a.equipment_id, liste);
    }
    return carte;
  }, [affectations.data]);

  const decaler = (pas: number) => {
    const d = new Date(annee, moisNum - 1 + pas, 1);
    setMois(iso(d).slice(0, 7));
  };

  return (
    <div>
      <p className="muted" style={{ marginTop: 0 }}>
        <Link href="/materiel" className="link">← Parc matériel</Link>
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <CalendarRange size={20} /> Planning du parc
        </h1>
        <span style={{ marginLeft: 'auto' }}>
          <Bouton
            icone={Plus}
            disabled={!materiels.data?.length}
            onClick={() => setSaisie({
              equipmentId: materiels.data?.[0]?.id ?? '',
              chantierId: chantiers.data?.[0]?.id ?? '',
              dateDebut: iso(new Date()),
              dateFin: iso(new Date()),
            })}
          >
            Affecter un matériel
          </Bouton>
        </span>
      </div>
      <p className="muted" style={{ marginTop: 4, maxWidth: 820 }}>
        Une ligne par matériel, une colonne par jour. Un engin ne peut pas être promis à deux
        chantiers le même jour : l’affectation est refusée, et les conflits déjà en base se
        signalent ici.
      </p>

      {err && <Alerte>{err}</Alerte>}
      {(conflits.data ?? []).length > 0 && (
        <Alerte>
          <AlertTriangle size={13} style={{ verticalAlign: 'middle', marginRight: 6 }} />
          {conflits.data!.map((c) => (
            `${c.materiel_code} : ${c.chantier_a} et ${c.chantier_b} du ${c.debut} au ${c.fin}`
          )).join(' · ')}
        </Alerte>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 12 }}>
        <button className="btn-ghost" title="Mois précédent" onClick={() => decaler(-1)}>
          <ChevronLeft size={16} />
        </button>
        <strong style={{ minWidth: 160, textAlign: 'center', fontSize: 13, textTransform: 'capitalize' }}>
          {libelleMois(mois)}
        </strong>
        <button className="btn-ghost" title="Mois suivant" onClick={() => decaler(1)}>
          <ChevronRight size={16} />
        </button>
        <button className="btn-ghost" onClick={() => setMois(moisCourant())}>Aujourd’hui</button>
      </div>

      <div className="card" style={{ marginTop: 12, padding: 0, overflow: 'auto' }}>
        <table className="grid" style={{ margin: 0, minWidth: 900 }}>
          <thead>
            <tr>
              <th style={{ width: 190, position: 'sticky', left: 0, background: 'var(--panel)' }}>
                Matériel
              </th>
              {jours.map((d) => {
                const weekend = d.getDay() === 0 || d.getDay() === 6;
                return (
                  <th
                    key={iso(d)}
                    style={{
                      width: 22, textAlign: 'center', fontSize: 10, padding: '6px 0',
                      background: weekend ? 'var(--surface)' : undefined,
                    }}
                  >
                    {d.getDate()}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {(materiels.data ?? []).map((m) => {
              const lignes = parMateriel.get(m.id) ?? [];
              return (
                <tr key={m.id}>
                  <td style={{ position: 'sticky', left: 0, background: 'var(--panel)' }}>
                    <span className="code-cell">{m.code}</span>
                    <span style={{ marginLeft: 6, fontSize: 12 }}>{m.label}</span>
                  </td>
                  {jours.map((d) => {
                    const cle = iso(d);
                    const a = lignes.find((x) => x.date_debut <= cle && x.date_fin >= cle);
                    const weekend = d.getDay() === 0 || d.getDay() === 6;
                    return (
                      <td
                        key={cle}
                        title={a ? `${a.chantier_code} — ${a.chantier_nom ?? ''}` : undefined}
                        onClick={() => a && retirer.mutate(a.id)}
                        style={{
                          padding: 0, height: 24, cursor: a ? 'pointer' : 'default',
                          background: a
                            ? teinteChantier(a.chantier_id, a.chantier_couleur)
                            : (weekend ? 'var(--surface)' : undefined),
                        }}
                      />
                    );
                  })}
                </tr>
              );
            })}
            {materiels.data && materiels.data.length === 0 && (
              <LigneVide
                colonnes={jours.length + 1}
                icone={CalendarRange}
                titre="Aucun matériel à planifier."
                indice="Créez d’abord une fiche dans le parc matériel."
              />
            )}
          </tbody>
        </table>
      </div>

      <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
        Cliquez une barre pour libérer le matériel sur cette période.
      </p>

      {saisie && (
        <Modale
          titre="Affecter un matériel"
          sousTitre="Un engin réservé est de l’engagé sur le chantier : il compte avant même d’avoir servi."
          largeur="s"
          onClose={() => setSaisie(null)}
          actions={(
            <Bouton
              chargement={affecter.isPending}
              disabled={!saisie.equipmentId || !saisie.chantierId}
              onClick={() => { setErr(null); affecter.mutate(); }}
            >
              Affecter
            </Bouton>
          )}
        >
          <div className="field">
            <label>Matériel</label>
            <select
              value={saisie.equipmentId}
              onChange={(e) => setSaisie({ ...saisie, equipmentId: e.target.value })}
            >
              {(materiels.data ?? []).map((m) => (
                <option key={m.id} value={m.id}>{m.code} — {m.label}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Chantier</label>
            <select
              value={saisie.chantierId}
              onChange={(e) => setSaisie({ ...saisie, chantierId: e.target.value })}
            >
              {(chantiers.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.code} — {c.name}</option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <div className="field" style={{ flex: 1 }}>
              <label>Du</label>
              <input
                type="date" value={saisie.dateDebut}
                onChange={(e) => setSaisie({ ...saisie, dateDebut: e.target.value })}
              />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Au</label>
              <input
                type="date" value={saisie.dateFin}
                onChange={(e) => setSaisie({ ...saisie, dateFin: e.target.value })}
              />
            </div>
          </div>
        </Modale>
      )}
    </div>
  );
}

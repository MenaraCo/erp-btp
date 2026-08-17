'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Stethoscope, Trash2, Users } from 'lucide-react';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { euro } from '@/lib/format';
import { Alerte, Badge, Bouton, LigneVide } from '@/components/ui';
import { CONTRATS, Salarie, SalarieModal, visiteAExpirer } from '@/components/SalarieModal';



function jour(v: string | null): string {
  return v ? new Date(v).toLocaleDateString('fr-FR') : '—';
}

/**
 * Fichier des salariés.
 *
 * La fiche s'ouvre en fenêtre, à la création COMME à la modification : une adresse change, une
 * visite médicale se refait, un coût horaire est révisé. Auparavant il fallait supprimer puis
 * recréer — donc perdre le matricule et le lien avec les heures déjà pointées.
 *
 * Le <strong>coût horaire</strong> est celui de revient (ce que l'heure coûte à l'entreprise,
 * charges comprises), pas le salaire brut : c'est lui qui alimente le réalisé main-d'œuvre.
 */
export default function SalariesPage() {
  const { token } = useAuth();
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);
  const [tous, setTous] = useState(false);
  const [aSupprimer, setASupprimer] = useState<string | null>(null);
  const [fiche, setFiche] = useState<Salarie | null | undefined>(undefined);

  const liste = useQuery({
    queryKey: ['employees', tous],
    enabled: Boolean(token),
    queryFn: () => apiFetch<Salarie[]>(`/employees${tous ? '?tous=1' : ''}`, { token }),
  });
  const rafraichir = () => qc.invalidateQueries({ queryKey: ['employees'] });

  const supprimer = useMutation({
    mutationFn: (id: string) => apiFetch<{ deactivated: boolean }>(`/employees/${id}`, { method: 'DELETE', token }),
    onSuccess: (r) => {
      setASupprimer(null);
      setErr(r.deactivated
        ? 'Ce salarié a déjà pointé : ses heures composent le réalisé du chantier. Il a été rendu inactif plutôt que supprimé.'
        : null);
      rafraichir();
    },
    onError: (e) => { setASupprimer(null); setErr(e instanceof ApiError ? e.message : 'Suppression impossible'); },
  });

  const aVisiteExpiree = (liste.data ?? []).filter((e) => e.active && visiteAExpirer(e.dateVisiteMedicale));

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <h1 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Users size={20} /> Salariés
        </h1>
        <span style={{ marginLeft: 'auto' }}>
          <Bouton icone={Plus} onClick={() => { setErr(null); setFiche(null); }}>Nouveau salarié</Bouton>
        </span>
      </div>
      <p className="muted" style={{ marginTop: 4, maxWidth: 780 }}>
        Le fichier des personnes qui pointent sur vos chantiers. Cliquez une ligne pour ouvrir sa
        fiche : identité, contrat, coordonnées, visite médicale. Le <strong>coût horaire</strong> est
        celui de revient — ce que l’heure coûte à l’entreprise — et non le salaire brut.
      </p>

      {err && <Alerte>{err}</Alerte>}
      {aVisiteExpiree.length > 0 && (
        <Alerte ton="info">
          <Stethoscope size={13} style={{ verticalAlign: 'middle', marginRight: 6 }} />
          {aVisiteExpiree.length} salarié{aVisiteExpiree.length > 1 ? 's ont' : ' a'} une visite
          médicale de plus de deux ans : {aVisiteExpiree.map((e) => e.lastName).join(', ')}.
        </Alerte>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
        <label className="muted" style={{ fontSize: 12, display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={tous} onChange={(e) => setTous(e.target.checked)} />
          Afficher aussi les inactifs
        </label>
        <span className="muted" style={{ fontSize: 12, marginLeft: 'auto' }}>
          {liste.data ? `${liste.data.length} salarié${liste.data.length > 1 ? 's' : ''}` : 'Chargement…'}
        </span>
      </div>

      <div className="card" style={{ marginTop: 8, padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="grid" style={{ margin: 0, minWidth: 860 }}>
            <thead>
              <tr>
                <th style={{ width: 90 }}>Matricule</th>
                <th>Salarié</th>
                <th style={{ width: 150 }}>Poste</th>
                <th style={{ width: 90 }}>Qualif.</th>
                <th style={{ width: 110 }}>Contrat</th>
                <th style={{ width: 110 }}>Entré le</th>
                <th style={{ width: 120 }}>Visite méd.</th>
                <th style={{ width: 110, textAlign: 'right' }}>Coût horaire</th>
                <th style={{ width: 80 }}>État</th>
                <th style={{ width: 90 }} />
              </tr>
            </thead>
            <tbody>
              {(liste.data ?? []).map((e) => (
                <tr
                  key={e.id}
                  style={{ opacity: e.active ? 1 : 0.55, cursor: 'pointer' }}
                  onClick={() => { setErr(null); setFiche(e); }}
                  onMouseEnter={(ev) => { ev.currentTarget.style.background = 'var(--surface)'; }}
                  onMouseLeave={(ev) => { ev.currentTarget.style.background = ''; }}
                >
                  <td className="code-cell">{e.code}</td>
                  <td>
                    {e.lastName} {e.firstName}
                    {e.telephone && <span className="muted" style={{ fontSize: 11, marginLeft: 8 }}>{e.telephone}</span>}
                  </td>
                  <td className="muted">{e.jobTitle ?? '—'}</td>
                  <td className="muted">{e.qualification ?? '—'}</td>
                  <td className="muted">
                    {CONTRATS.find((c) => c.v === e.contractType)?.l ?? e.contractType}
                    {/* Une fin de contrat proche est ce qu'on cherche dans cette colonne. */}
                    {e.dateFinContrat && (
                      <span className="muted" style={{ fontSize: 10, display: 'block' }}>
                        jusqu’au {jour(e.dateFinContrat)}
                      </span>
                    )}
                  </td>
                  <td className="muted">{jour(e.dateEntree)}</td>
                  <td style={{ color: visiteAExpirer(e.dateVisiteMedicale) ? 'var(--danger)' : undefined }}>
                    {jour(e.dateVisiteMedicale)}
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {euro(Number(e.hourlyCost))}
                  </td>
                  <td><Badge ton={e.active ? 'succes' : 'neutre'}>{e.active ? 'Actif' : 'Inactif'}</Badge></td>
                  <td style={{ textAlign: 'right' }} onClick={(ev) => ev.stopPropagation()}>
                    {/* Confirmation en ligne : la fenêtre système du navigateur est bloquée ici. */}
                    {aSupprimer === e.id ? (
                      <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                        <button className="btn btn-danger" style={{ padding: '2px 8px', fontSize: 11 }}
                          disabled={supprimer.isPending}
                          onClick={() => supprimer.mutate(e.id)}>
                          Supprimer ?
                        </button>
                        <button className="link" type="button" onClick={() => setASupprimer(null)}>✕</button>
                      </span>
                    ) : (
                      <>
                        <button className="btn-ghost" title="Ouvrir la fiche" onClick={() => setFiche(e)}>
                          <Pencil size={13} />
                        </button>
                        <button className="btn-ghost" title="Retirer ce salarié" onClick={() => { setErr(null); setASupprimer(e.id); }}>
                          <Trash2 size={13} />
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {liste.data && liste.data.length === 0 && (
                <LigneVide
                  colonnes={10}
                  icone={Users}
                  titre="Aucun salarié pour l’instant."
                  indice="« Nouveau salarié » ouvre sa fiche ; il sera ensuite proposé à la saisie des heures."
                />
              )}
            </tbody>
          </table>
        </div>
      </div>

      {fiche !== undefined && (
        <SalarieModal salarie={fiche} onClose={() => { setFiche(undefined); rafraichir(); }} />
      )}
    </div>
  );
}

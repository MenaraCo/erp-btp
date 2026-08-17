'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Pencil, Plus, Trash2, Truck, Wrench } from 'lucide-react';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { euro } from '@/lib/format';
import { Alerte, Badge, Bouton, CarteKpi, LigneVide } from '@/components/ui';
import { echeanceProche, Materiel, MaterielModal, TYPES_MATERIEL } from '@/components/MaterielModal';

function jour(v: string | null): string {
  return v ? new Date(v).toLocaleDateString('fr-FR') : '—';
}

/**
 * Parc matériel — la liste des engins, véhicules et outillages.
 *
 * Deux questions se posent devant un parc : où est cette machine en ce moment, et laquelle va
 * être immobilisée. La colonne « Sur chantier » répond à la première, les échéances d'entretien
 * en rouge à la seconde — une révision ou un contrôle périmé cloue l'engin au dépôt.
 */
export default function MaterielPage() {
  const { token } = useAuth();
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);
  const [tous, setTous] = useState(false);
  const [fiche, setFiche] = useState<Materiel | null | undefined>(undefined);

  const liste = useQuery({
    queryKey: ['materiel', tous],
    enabled: Boolean(token),
    retry: false,
    queryFn: () => apiFetch<Materiel[]>(`/materiel${tous ? '?tous=1' : ''}`, { token }),
  });
  const echeances = useQuery({
    queryKey: ['materiel-echeances'],
    enabled: Boolean(token),
    retry: false,
    queryFn: () => apiFetch<Array<{ id: string; code: string; label: string; prochaine_echeance: string }>>(
      '/materiel/echeances?jours=30', { token },
    ),
  });

  const supprimer = useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ desactive: boolean }>(`/materiel/${id}`, { method: 'DELETE', token }),
    onSuccess: (r) => {
      setErr(r.desactive
        ? 'Ce matériel a déjà servi : ses heures composent le réalisé d’un chantier. Il a été désactivé plutôt que supprimé.'
        : null);
      qc.invalidateQueries({ queryKey: ['materiel'] });
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Suppression impossible.'),
  });

  const lignes = liste.data ?? [];
  const surChantier = lignes.filter((m) => m.chantier_actuel).length;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Truck size={20} /> Parc matériel
        </h1>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <Link href="/materiel/planning" className="btn btn-secondary">Planning du parc</Link>
          <Bouton icone={Plus} onClick={() => { setErr(null); setFiche(null); }}>Nouveau matériel</Bouton>
        </span>
      </div>
      <p className="muted" style={{ marginTop: 4, maxWidth: 820 }}>
        Engins, véhicules et outillage. Le <strong>coût d’utilisation</strong> de la fiche est ce
        qui sera imputé au chantier à chaque journée relevée — pas le prix d’achat.
      </p>

      {liste.isError && (
        <Alerte>Module « Suivi de chantiers » non actif pour cet utilisateur, ou accès refusé.</Alerte>
      )}
      {err && <Alerte>{err}</Alerte>}
      {(echeances.data ?? []).length > 0 && (
        <Alerte ton="info">
          <Wrench size={13} style={{ verticalAlign: 'middle', marginRight: 6 }} />
          {echeances.data!.length} matériel{echeances.data!.length > 1 ? 's ont' : ' a'} une
          échéance d’entretien dans les 30 jours :{' '}
          {echeances.data!.map((m) => `${m.code} (${jour(m.prochaine_echeance)})`).join(', ')}.
        </Alerte>
      )}

      <div className="card-grid" style={{ marginTop: 14 }}>
        <CarteKpi titre="Matériels actifs" valeur={lignes.length} />
        <CarteKpi titre="Sur chantier" valeur={surChantier} detail="affectés aujourd’hui" />
        <CarteKpi
          titre="Entretien à prévoir"
          valeur={echeances.data?.length ?? 0}
          ton={(echeances.data?.length ?? 0) > 0 ? 'danger' : undefined}
          detail="dans les 30 jours"
        />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
        <label style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={tous} onChange={(e) => setTous(e.target.checked)} />
          Afficher aussi les matériels retirés
        </label>
      </div>

      <div className="card" style={{ marginTop: 8, padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="grid" style={{ margin: 0, minWidth: 900 }}>
            <thead>
              <tr>
                <th style={{ width: 90 }}>Code</th>
                <th>Désignation</th>
                <th style={{ width: 100 }}>Type</th>
                <th style={{ width: 110 }}>Immat. / série</th>
                <th style={{ width: 110 }}>Propriété</th>
                <th style={{ width: 130, textAlign: 'right' }}>Coût utilisation</th>
                <th style={{ width: 90 }}>Poste</th>
                <th style={{ width: 120 }}>Sur chantier</th>
                <th style={{ width: 120 }}>Entretien</th>
                <th style={{ width: 80 }} />
              </tr>
            </thead>
            <tbody>
              {lignes.map((m) => {
                const alerte = echeanceProche(m.date_prochaine_revision)
                  || echeanceProche(m.date_controle_technique)
                  || echeanceProche(m.date_assurance);
                return (
                  <tr
                    key={m.id}
                    style={{ cursor: 'pointer', opacity: m.actif ? 1 : 0.55 }}
                    onClick={() => { setErr(null); setFiche(m); }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}
                  >
                    <td className="code-cell">{m.code}</td>
                    <td>
                      {m.label}
                      {(m.marque || m.modele) && (
                        <span className="muted" style={{ fontSize: 11, marginLeft: 8 }}>
                          {[m.marque, m.modele].filter(Boolean).join(' ')}
                        </span>
                      )}
                    </td>
                    <td className="muted">{TYPES_MATERIEL.find((t) => t.v === m.type)?.l ?? m.type}</td>
                    <td className="muted">{m.immatriculation ?? m.numero_serie ?? '—'}</td>
                    <td>
                      {m.propriete === 'location'
                        ? <Badge ton="attention">Location{m.fournisseur ? ` · ${m.fournisseur}` : ''}</Badge>
                        : <span className="muted">Parc</span>}
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {euro(m.cout_unitaire)}
                      <span className="muted" style={{ fontSize: 11 }}>
                        {m.unite_cout === 'jour' ? ' / j' : ' / h'}
                      </span>
                    </td>
                    <td>{m.code_analytique
                      ? <span className="code-cell">{m.code_analytique}</span>
                      : <Badge ton="attention">—</Badge>}</td>
                    <td>{m.chantier_actuel
                      ? <span className="code-cell">{m.chantier_actuel}</span>
                      : <span className="muted">au dépôt</span>}</td>
                    <td style={{ color: alerte ? 'var(--danger)' : undefined, fontSize: 12 }}>
                      {alerte && <AlertTriangle size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />}
                      {jour(m.date_controle_technique ?? m.date_prochaine_revision)}
                    </td>
                    <td style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                      <button className="btn-ghost" title="Ouvrir la fiche" onClick={() => setFiche(m)}>
                        <Pencil size={13} />
                      </button>
                      <button className="btn-ghost" title="Retirer du parc" onClick={() => supprimer.mutate(m.id)}>
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {liste.data && lignes.length === 0 && (
                <LigneVide
                  colonnes={10}
                  icone={Truck}
                  titre="Aucun matériel dans le parc."
                  indice="« Nouveau matériel » ouvre sa fiche : c’est son coût d’utilisation qui sera imputé aux chantiers."
                />
              )}
            </tbody>
          </table>
        </div>
      </div>

      {fiche !== undefined && (
        <MaterielModal materiel={fiche} onClose={() => setFiche(undefined)} />
      )}
    </div>
  );
}

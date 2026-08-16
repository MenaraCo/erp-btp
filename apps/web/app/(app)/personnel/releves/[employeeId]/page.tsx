'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Calculator, CheckCircle2, FileSignature, PenLine, Trash2, Unlock } from 'lucide-react';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { euro } from '@/lib/format';
import { libelleAbsence } from '@/lib/absences';
import { STATUT_RELEVE, statut } from '@/lib/statuts';
import { Alerte, Badge, BadgeStatut, Bouton, CarteKpi, EtatVide } from '@/components/ui';
import { Camembert } from '@/components/Graphiques';
import { Modale } from '@/components/Modale';

interface Rubrique { id: string; code: string; label: string; type: string; unite: string; montant_unitaire: string }
interface LigneRubrique {
  id: string;
  rubrique_id: string;
  code: string;
  label: string;
  type: string;
  unite: string;
  quantite: string;
  montant_unitaire: string;
  montant: string;
  origine: 'auto' | 'manuel';
  commentaire: string | null;
  chantier_code: string | null;
}
interface Releve {
  salarie: { id: string; code: string; first_name: string | null; last_name: string; job_title: string | null; hourly_cost: string };
  mois: string;
  entete: {
    statut: 'brouillon' | 'valide' | 'signe';
    heures_travaillees: string;
    jours_travailles: string;
    heures_absence: string;
    montant_rubriques: string;
    calcule_le: string | null;
    signe_le: string | null;
    signe_par: string | null;
  };
  heuresParChantier: Array<{
    chantier_id: string; chantier_code: string; chantier_nom: string | null;
    chantier_couleur: string | null; heures: string; jours: number; cout: string;
  }>;
  absences: Array<{ kind: string; heures: string; jours: number }>;
  lignes: LigneRubrique[];
  modifiable: boolean;
}

function moisCourant(): string {
  return new Date().toISOString().slice(0, 7);
}
function libelleMois(m: string): string {
  const [a, mo] = m.split('-');
  return new Date(Number(a), Number(mo) - 1, 1)
    .toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
}

/**
 * Relevé mensuel d'un salarié — heures, absences, éléments variables, signature.
 *
 * Le calcul pose ce qui se déduit des pointages (paniers, déplacements, heures supplémentaires) ;
 * le conducteur ajoute ce qui ne se devine pas. La signature fige le mois : c'est ce document qui
 * fait foi si la paye est contestée.
 */
export default function RelevePage() {
  const { token } = useAuth();
  const qc = useQueryClient();
  const employeeId = String(useParams().employeeId);
  const mois = useSearchParams().get('mois') ?? moisCourant();

  const [err, setErr] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [ajout, setAjout] = useState<{ rubriqueId: string; quantite: string; montant: string } | null>(null);

  const releve = useQuery({
    queryKey: ['paye-releve', employeeId, mois],
    enabled: Boolean(token),
    retry: false,
    queryFn: () => apiFetch<Releve>(`/paye/releves/${employeeId}?mois=${mois}`, { token }),
  });
  const rubriques = useQuery({
    queryKey: ['paye-rubriques', false],
    enabled: Boolean(token),
    queryFn: () => apiFetch<Rubrique[]>('/paye/rubriques', { token }),
  });

  const rafraichir = () => {
    qc.invalidateQueries({ queryKey: ['paye-releve', employeeId, mois] });
    qc.invalidateQueries({ queryKey: ['paye-releves'] });
  };
  const echoue = (e: unknown) => setErr(e instanceof ApiError ? e.message : 'Opération impossible.');

  const calculer = useMutation({
    mutationFn: () => apiFetch(`/paye/releves/${employeeId}/calculer?mois=${mois}`, { method: 'POST', token }),
    onSuccess: () => { setErr(null); rafraichir(); }, onError: echoue,
  });
  const valider = useMutation({
    mutationFn: () => apiFetch(`/paye/releves/${employeeId}/valider?mois=${mois}`, { method: 'POST', token }),
    onSuccess: () => { setErr(null); rafraichir(); }, onError: echoue,
  });
  const signer = useMutation({
    mutationFn: (nom: string) => apiFetch(`/paye/releves/${employeeId}/signer?mois=${mois}`, {
      method: 'POST', token, body: { nom },
    }),
    onSuccess: () => { setErr(null); setSignature(null); rafraichir(); }, onError: echoue,
  });
  const rouvrir = useMutation({
    mutationFn: () => apiFetch(`/paye/releves/${employeeId}/rouvrir?mois=${mois}`, { method: 'POST', token, body: {} }),
    onSuccess: () => { setErr(null); rafraichir(); }, onError: echoue,
  });
  const ajouterLigne = useMutation({
    mutationFn: (l: { rubriqueId: string; quantite: string; montantUnitaire: string }) =>
      apiFetch(`/paye/releves/${employeeId}/lignes?mois=${mois}`, { method: 'POST', token, body: l }),
    onSuccess: () => { setErr(null); setAjout(null); rafraichir(); }, onError: echoue,
  });
  const supprimerLigne = useMutation({
    mutationFn: (id: string) => apiFetch(`/paye/lignes/${id}`, { method: 'DELETE', token }),
    onSuccess: () => { setErr(null); rafraichir(); }, onError: echoue,
  });

  const r = releve.data;
  const e = r?.entete;

  return (
    <div>
      <p className="muted" style={{ marginTop: 0 }}>
        <Link href={`/personnel/releves?mois=${mois}`} className="link">← Relevés mensuels</Link>
      </p>

      {releve.isError && <Alerte>Relevé introuvable ou accès refusé.</Alerte>}
      {err && <Alerte>{err}</Alerte>}

      {r && e && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h1 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <FileSignature size={20} /> {r.salarie.last_name} {r.salarie.first_name}
            </h1>
            <span className="code-cell">{r.salarie.code}</span>
            <BadgeStatut statut={statut(STATUT_RELEVE, e.statut)} />
            <span className="muted">{libelleMois(mois)}</span>

            <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {r.modifiable && (
                <Bouton
                  variante="secondaire"
                  icone={Calculator}
                  chargement={calculer.isPending}
                  libelleChargement="Calcul…"
                  onClick={() => calculer.mutate()}
                >
                  Calculer le mois
                </Bouton>
              )}
              {e.statut === 'brouillon' && (
                <Bouton icone={CheckCircle2} chargement={valider.isPending} onClick={() => valider.mutate()}>
                  Valider
                </Bouton>
              )}
              {e.statut === 'valide' && (
                <Bouton icone={PenLine} onClick={() => setSignature(`${r.salarie.first_name ?? ''} ${r.salarie.last_name}`.trim())}>
                  Faire signer
                </Bouton>
              )}
              {e.statut !== 'brouillon' && (
                <Bouton variante="secondaire" icone={Unlock} onClick={() => rouvrir.mutate()}>
                  Rouvrir
                </Bouton>
              )}
            </span>
          </div>

          {e.signe_le && (
            <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>
              Signé par <strong>{e.signe_par}</strong> le{' '}
              {new Date(e.signe_le).toLocaleDateString('fr-FR')} — le mois est figé.
            </p>
          )}

          <div className="card-grid" style={{ marginTop: 14 }}>
            <CarteKpi titre="Heures travaillées" valeur={Number(e.heures_travaillees).toLocaleString('fr-FR')} detail={`${Number(e.jours_travailles).toLocaleString('fr-FR')} jours`} />
            <CarteKpi titre="Heures d’absence" valeur={Number(e.heures_absence).toLocaleString('fr-FR')} detail={r.absences.map((a) => libelleAbsence(a.kind)).join(', ') || 'aucune'} />
            <CarteKpi titre="Éléments variables" valeur={euro(e.montant_rubriques)} detail={`${r.lignes.length} ligne${r.lignes.length > 1 ? 's' : ''}`} />
            <CarteKpi titre="Coût horaire" valeur={euro(r.salarie.hourly_cost)} detail={r.salarie.job_title ?? '—'} />
          </div>

          <div style={{ display: 'grid', gap: 14, marginTop: 14, gridTemplateColumns: 'minmax(280px, 1fr) minmax(320px, 1.2fr)' }}>
            <div className="card">
              <h2 style={{ marginTop: 0 }}>Où sont passées les heures</h2>
              <Camembert
                parts={r.heuresParChantier.map((h) => ({
                  label: h.chantier_code, valeur: Number(h.heures), couleur: h.chantier_couleur ?? undefined,
                }))}
                total={Number(e.heures_travaillees).toLocaleString('fr-FR')}
                titre="heures"
                unite="h"
              />
            </div>
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <table className="grid" style={{ margin: 0 }}>
                <thead>
                  <tr>
                    <th>Chantier</th>
                    <th style={{ width: 80, textAlign: 'right' }}>Heures</th>
                    <th style={{ width: 70, textAlign: 'right' }}>Jours</th>
                    <th style={{ width: 110, textAlign: 'right' }}>Coût</th>
                  </tr>
                </thead>
                <tbody>
                  {r.heuresParChantier.map((h) => (
                    <tr key={h.chantier_id}>
                      <td>
                        <span className="code-cell">{h.chantier_code}</span>
                        {h.chantier_nom && <span className="muted" style={{ fontSize: 11, marginLeft: 6 }}>{h.chantier_nom}</span>}
                      </td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{Number(h.heures).toLocaleString('fr-FR')}</td>
                      <td style={{ textAlign: 'right' }}>{h.jours}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{euro(h.cout)}</td>
                    </tr>
                  ))}
                  {r.heuresParChantier.length === 0 && (
                    <tr><td colSpan={4} style={{ padding: 0 }}>
                      <EtatVide titre="Aucune heure pointée ce mois-ci." />
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card" style={{ marginTop: 16, padding: 0, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
              <strong style={{ fontSize: 13 }}>Éléments variables</strong>
              {e.calcule_le && (
                <span className="muted" style={{ fontSize: 11 }}>
                  calculé le {new Date(e.calcule_le).toLocaleDateString('fr-FR')}
                </span>
              )}
              {r.modifiable && (
                <span style={{ marginLeft: 'auto' }}>
                  <Bouton
                    variante="secondaire"
                    onClick={() => setAjout({
                      rubriqueId: rubriques.data?.[0]?.id ?? '',
                      quantite: '1',
                      montant: rubriques.data?.[0]?.montant_unitaire ?? '0',
                    })}
                    disabled={!rubriques.data?.length}
                  >
                    + Ajouter une ligne
                  </Bouton>
                </span>
              )}
            </div>
            <table className="grid" style={{ margin: 0 }}>
              <thead>
                <tr>
                  <th style={{ width: 90 }}>Code</th>
                  <th>Libellé</th>
                  <th style={{ width: 90, textAlign: 'right' }}>Quantité</th>
                  <th style={{ width: 60 }}>Unité</th>
                  <th style={{ width: 110, textAlign: 'right' }}>PU</th>
                  <th style={{ width: 120, textAlign: 'right' }}>Montant</th>
                  <th style={{ width: 90 }}>Origine</th>
                  <th style={{ width: 40 }} />
                </tr>
              </thead>
              <tbody>
                {r.lignes.map((l) => (
                  <tr key={l.id}>
                    <td className="code-cell">{l.code}</td>
                    <td>
                      {l.label}
                      {l.commentaire && <span className="muted" style={{ fontSize: 11, marginLeft: 8 }}>{l.commentaire}</span>}
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{Number(l.quantite).toLocaleString('fr-FR')}</td>
                    <td className="muted">{l.unite}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{euro(l.montant_unitaire)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{euro(l.montant)}</td>
                    <td>
                      <Badge ton={l.origine === 'auto' ? 'info' : 'neutre'}>
                        {l.origine === 'auto' ? 'Calculé' : 'Saisi'}
                      </Badge>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {r.modifiable && (
                        <button className="btn-ghost" title="Supprimer la ligne" onClick={() => supprimerLigne.mutate(l.id)}>
                          <Trash2 size={13} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {r.lignes.length === 0 && (
                  <tr><td colSpan={8} style={{ padding: 0 }}>
                    <EtatVide
                      icone={Calculator}
                      titre="Aucun élément variable."
                      indice="« Calculer le mois » pose les paniers, déplacements et heures supplémentaires depuis les pointages."
                    />
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {signature !== null && (
        <Modale
          titre="Signature du relevé"
          largeur="s"
          onClose={() => setSignature(null)}
          actions={(
            <Bouton
              icone={PenLine}
              disabled={!signature.trim()}
              chargement={signer.isPending}
              onClick={() => signer.mutate(signature)}
            >
              Signer
            </Bouton>
          )}
        >
          <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
            Le nom porté ici est celui qui signe le relevé, comme sur le papier. Une fois signé, le
            mois est figé : plus de recalcul ni de retouche sans réouverture.
          </p>
          <div className="field">
            <label>Nom du signataire</label>
            <input value={signature} onChange={(ev) => setSignature(ev.target.value)} autoFocus />
          </div>
        </Modale>
      )}

      {ajout && (
        <Modale
          titre="Ajouter un élément variable"
          largeur="s"
          onClose={() => setAjout(null)}
          actions={(
            <Bouton
              chargement={ajouterLigne.isPending}
              onClick={() => ajouterLigne.mutate({
                rubriqueId: ajout.rubriqueId, quantite: ajout.quantite, montantUnitaire: ajout.montant,
              })}
            >
              Ajouter
            </Bouton>
          )}
        >
          <div className="field">
            <label>Rubrique</label>
            <select
              value={ajout.rubriqueId}
              onChange={(ev) => {
                const rub = rubriques.data?.find((x) => x.id === ev.target.value);
                setAjout({ ...ajout, rubriqueId: ev.target.value, montant: rub?.montant_unitaire ?? ajout.montant });
              }}
            >
              {(rubriques.data ?? []).map((x) => (
                <option key={x.id} value={x.id}>{x.code} — {x.label}</option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <div className="field" style={{ flex: 1 }}>
              <label>Quantité</label>
              <input type="number" step="0.5" value={ajout.quantite} onChange={(ev) => setAjout({ ...ajout, quantite: ev.target.value })} />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Montant unitaire</label>
              <input type="number" step="0.01" value={ajout.montant} onChange={(ev) => setAjout({ ...ajout, montant: ev.target.value })} />
            </div>
          </div>
        </Modale>
      )}
    </div>
  );
}

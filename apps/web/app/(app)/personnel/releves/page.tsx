'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Download, FileSignature } from 'lucide-react';
import { apiFetch, apiDownload } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { euro } from '@/lib/format';
import { STATUT_RELEVE, statut } from '@/lib/statuts';
import { BadgeStatut, Bouton, CarteKpi, LigneVide } from '@/components/ui';

interface LigneReleve {
  employee_id: string;
  code: string;
  first_name: string | null;
  last_name: string;
  contract_type: string;
  statut: 'brouillon' | 'valide' | 'signe';
  heures_travaillees: string;
  jours_travailles: string;
  heures_absence: string;
  montant_rubriques: string;
  calcule_le: string | null;
  signe_le: string | null;
  signe_par: string | null;
  heures_pointees: string;
}
interface Reponse {
  mois: string;
  lignes: LigneReleve[];
  totalRubriques: string;
  aCalculer: number;
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
 * Relevés mensuels — la paye du mois, salarié par salarié.
 *
 * Un relevé n'est pas un écran de plus : c'est le document qu'on fait signer, et qui justifie les
 * heures et les éléments variables transmis à la paye. Tant qu'il est brouillon, tout bouge ; une
 * fois signé, le mois est figé.
 */
export default function RelevesPage() {
  const { token } = useAuth();
  const router = useRouter();
  const [mois, setMois] = useState(moisCourant);

  const data = useQuery({
    queryKey: ['paye-releves', mois],
    enabled: Boolean(token),
    queryFn: () => apiFetch<Reponse>(`/paye/releves?mois=${mois}`, { token }),
  });
  const r = data.data;

  const heures = (r?.lignes ?? []).reduce((s, l) => s + Number(l.heures_pointees ?? 0), 0);
  const signes = (r?.lignes ?? []).filter((l) => l.statut === 'signe').length;

  return (
    <div>
      <h1 style={{ marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
        <FileSignature size={20} /> Relevés mensuels
      </h1>
      <p className="muted" style={{ marginTop: 0, maxWidth: 820 }}>
        Le document qu’on fait signer, et qui justifie ce qui part en paye : heures, absences et
        éléments variables du mois.
      </p>

      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 12 }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Mois</label>
          <input type="month" value={mois} onChange={(e) => setMois(e.target.value)} style={{ width: 160 }} />
        </div>
        <Bouton
          variante="secondaire"
          icone={Download}
          onClick={() => apiDownload(`/paye/export?mois=${mois}`, token, `paye-${mois}.csv`)}
        >
          Export paye (CSV)
        </Bouton>
      </div>

      {r && (
        <div className="card-grid" style={{ marginTop: 14 }}>
          <CarteKpi titre="Heures pointées" valeur={heures.toLocaleString('fr-FR')} detail={libelleMois(mois)} />
          <CarteKpi
            titre="Éléments variables"
            valeur={euro(r.totalRubriques)}
            detail="paniers, déplacements, primes, heures sup."
          />
          <CarteKpi
            titre="Relevés signés"
            valeur={`${signes} / ${r.lignes.length}`}
            ton={signes === r.lignes.length && r.lignes.length > 0 ? 'succes' : undefined}
          />
          <CarteKpi
            titre="À calculer"
            valeur={r.aCalculer}
            ton={r.aCalculer > 0 ? 'danger' : undefined}
            detail="salariés pointés dont le relevé n’a jamais été calculé"
          />
        </div>
      )}

      <div className="card" style={{ marginTop: 16, padding: 0, overflow: 'hidden' }}>
        <table className="grid" style={{ margin: 0 }}>
          <thead>
            <tr>
              <th style={{ width: 90 }}>Matricule</th>
              <th>Salarié</th>
              <th style={{ width: 100, textAlign: 'right' }}>Heures</th>
              <th style={{ width: 80, textAlign: 'right' }}>Jours</th>
              <th style={{ width: 100, textAlign: 'right' }}>Absences</th>
              <th style={{ width: 130, textAlign: 'right' }}>Éléments variables</th>
              <th style={{ width: 110 }}>Relevé</th>
            </tr>
          </thead>
          <tbody>
            {(r?.lignes ?? []).map((l) => {
              // Un relevé calculé puis complété par de nouveaux pointages ment : on le signale.
              const aRecalculer = Boolean(l.calcule_le)
                && Number(l.heures_pointees) !== Number(l.heures_travaillees);
              return (
                <tr
                  key={l.employee_id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => router.push(`/personnel/releves/${l.employee_id}?mois=${mois}`)}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}
                >
                  <td className="code-cell">{l.code}</td>
                  <td>
                    {l.last_name} {l.first_name}
                    {aRecalculer && (
                      <span className="muted" style={{ fontSize: 11, marginLeft: 8, color: 'var(--danger)' }}>
                        pointages modifiés depuis le calcul
                      </span>
                    )}
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {Number(l.heures_pointees).toLocaleString('fr-FR')}
                  </td>
                  <td style={{ textAlign: 'right' }}>{Number(l.jours_travailles).toLocaleString('fr-FR')}</td>
                  <td style={{ textAlign: 'right' }} className="muted">
                    {Number(l.heures_absence) === 0 ? '—' : Number(l.heures_absence).toLocaleString('fr-FR')}
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                    {euro(l.montant_rubriques)}
                  </td>
                  <td><BadgeStatut statut={statut(STATUT_RELEVE, l.statut)} /></td>
                </tr>
              );
            })}
            {r && r.lignes.length === 0 && (
              <LigneVide
                colonnes={7}
                icone={FileSignature}
                titre="Aucun salarié actif."
                indice="Le fichier des salariés alimente cet écran : commencez par y créer les fiches."
              />
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

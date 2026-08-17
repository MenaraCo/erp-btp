'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Modale } from './Modale';
import { Alerte, Bouton } from './ui';
import { CodeAnalytique, SelectCodeAnalytique } from './SelectCodeAnalytique';
import { ContratInterimBloc } from './ContratInterim';

export interface Salarie {
  id: string;
  code: string;
  firstName: string | null;
  lastName: string;
  jobTitle: string | null;
  hourlyCost: string;
  contractType: 'cdi' | 'cdd' | 'alternance' | 'stage' | 'apprentissage' | 'interimaire';
  agency: string | null;
  codeAnalytiqueId: string | null;
  active: boolean;
  dateEntree: string | null;
  dateSortie: string | null;
  dateNaissance: string | null;
  numeroSecu: string | null;
  telephone: string | null;
  email: string | null;
  adresse: string | null;
  codePostal: string | null;
  ville: string | null;
  qualification: string | null;
  dateVisiteMedicale: string | null;
  dateFinContrat: string | null;
  commentaire: string | null;
}

export const CONTRATS: Array<{ v: Salarie['contractType']; l: string }> = [
  { v: 'cdi', l: 'CDI' },
  { v: 'cdd', l: 'CDD' },
  { v: 'alternance', l: 'Alternance' },
  { v: 'stage', l: 'Stage' },
  { v: 'apprentissage', l: 'Apprentissage' },
  { v: 'interimaire', l: 'Intérim' },
];

/** Contrats à terme : leur date de fin n'est pas une option, c'est ce qui les définit. */
const A_TERME: Array<Salarie['contractType']> = ['cdd', 'alternance', 'stage', 'apprentissage'];

/** Classification BTP : ce qu'on lit sur un bulletin, pas une invention maison. */
const QUALIFICATIONS = [
  'N1P1', 'N1P2', 'N2', 'N3P1', 'N3P2', 'N4P1', 'N4P2', 'ETAM A', 'ETAM B', 'ETAM C',
  'ETAM D', 'ETAM E', 'ETAM F', 'Cadre',
];

type Champs = Omit<Salarie, 'id' | 'code'>;

const VIDE: Champs = {
  firstName: '', lastName: '', jobTitle: '', hourlyCost: '', contractType: 'cdi',
  agency: '', codeAnalytiqueId: null, active: true,
  dateEntree: '', dateSortie: '', dateNaissance: '', numeroSecu: '', telephone: '', email: '',
  adresse: '', codePostal: '', ville: '', qualification: '', dateVisiteMedicale: '',
  dateFinContrat: '', commentaire: '',
};

/** Une visite de plus de deux ans ne vaut plus : c'est la règle de la médecine du travail. */
export function visiteAExpirer(date: string | null): boolean {
  if (!date) return false;
  const limite = new Date(date);
  limite.setFullYear(limite.getFullYear() + 2);
  return limite < new Date();
}

/**
 * Fiche salarié — création ET modification, dans la même fenêtre.
 *
 * La fiche ne se saisissait qu'à la création, sur une ligne de formulaire : une adresse changeait,
 * une visite médicale se refaisait, et il fallait supprimer puis recréer — donc perdre le
 * matricule et l'historique des pointages. Tout se modifie ici, l'identité comme l'administratif.
 */
export function SalarieModal({
  salarie, onClose,
}: {
  /** Fiche à modifier ; absente, la fenêtre crée un nouveau salarié. */
  salarie: Salarie | null;
  onClose: () => void;
}) {
  const { token } = useAuth();
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState<Champs>(() => (salarie
    ? { ...VIDE, ...salarie, hourlyCost: String(salarie.hourlyCost ?? '') }
    : { ...VIDE }));

  const codes = useQuery({
    queryKey: ['params-codes'],
    enabled: Boolean(token),
    retry: false,
    queryFn: () => apiFetch<CodeAnalytique[]>('/params/codes', { token }),
  });

  const set = (patch: Partial<Champs>) => setF({ ...f, ...patch });

  const enregistrer = useMutation({
    mutationFn: () => apiFetch(
      salarie ? `/employees/${salarie.id}` : '/employees',
      { method: salarie ? 'PATCH' : 'POST', token, body: { ...f, hourlyCost: f.hourlyCost || '0' } },
    ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employees'] });
      qc.invalidateQueries({ queryKey: ['paye-releves'] });
      onClose();
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Enregistrement impossible.'),
  });

  const champ = (
    libelle: string, cle: keyof Champs, type = 'text', largeur?: number,
  ) => (
    <div className="field" style={{ marginBottom: 0, flex: largeur ? undefined : 1, width: largeur }}>
      <label>{libelle}</label>
      <input
        type={type}
        value={(f[cle] as string) ?? ''}
        onChange={(e) => set({ [cle]: e.target.value } as Partial<Champs>)}
      />
    </div>
  );

  return (
    <Modale
      titre={salarie ? `Fiche de ${salarie.lastName} ${salarie.firstName ?? ''}` : 'Nouveau salarié'}
      sousTitre={salarie ? `Matricule ${salarie.code}` : 'Le matricule est attribué automatiquement.'}
      largeur="l"
      onClose={onClose}
      actions={(
        <Bouton
          chargement={enregistrer.isPending}
          libelleChargement="Enregistrement…"
          disabled={!f.lastName?.trim() || (A_TERME.includes(f.contractType) && !f.dateFinContrat)}
          onClick={() => { setErr(null); enregistrer.mutate(); }}
        >
          Enregistrer
        </Bouton>
      )}
    >
      {err && <Alerte>{err}</Alerte>}

      <div className="form-section-title">Identité</div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {champ('Nom', 'lastName')}
        {champ('Prénom', 'firstName')}
        {champ('Date de naissance', 'dateNaissance', 'date', 160)}
      </div>

      <div className="form-section-title" style={{ marginTop: 14 }}>Contrat et coût</div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="field" style={{ marginBottom: 0, width: 150 }}>
          <label>Type de contrat</label>
          <select
            value={f.contractType}
            onChange={(e) => set({ contractType: e.target.value as Salarie['contractType'] })}
          >
            {CONTRATS.map((c) => <option key={c.v} value={c.v}>{c.l}</option>)}
          </select>
        </div>
        {champ('Poste', 'jobTitle')}
        <div className="field" style={{ marginBottom: 0, width: 130 }}>
          <label>Qualification</label>
          <select value={f.qualification ?? ''} onChange={(e) => set({ qualification: e.target.value })}>
            <option value="">—</option>
            {QUALIFICATIONS.map((q) => <option key={q} value={q}>{q}</option>)}
          </select>
        </div>
        <div className="field" style={{ marginBottom: 0, width: 130 }}>
          <label>Coût horaire (€)</label>
          <input
            type="number" step="0.01" style={{ textAlign: 'right' }}
            value={f.hourlyCost}
            onChange={(e) => set({ hourlyCost: e.target.value })}
          />
        </div>
        {A_TERME.includes(f.contractType) && (
          <div className="field" style={{ marginBottom: 0, width: 170 }}>
            <label>Fin de contrat *</label>
            <input
              type="date"
              value={f.dateFinContrat ?? ''}
              onChange={(e) => set({ dateFinContrat: e.target.value })}
            />
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 10 }}>
        {champ('Date d’entrée', 'dateEntree', 'date', 160)}
        {champ('Date de sortie', 'dateSortie', 'date', 160)}
        <div className="field" style={{ marginBottom: 0, width: 190 }}>
          <label>Code analytique par défaut</label>
          <SelectCodeAnalytique
            valeur={f.codeAnalytiqueId}
            codes={codes.data ?? []}
            onChange={(id) => set({ codeAnalytiqueId: id })}
          />
          <span className="muted" style={{ fontSize: 11 }}>
            Poste d’imputation de ses heures.
          </span>
        </div>
        <label style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6, paddingBottom: 6 }}>
          <input type="checkbox" checked={f.active} onChange={(e) => set({ active: e.target.checked })} />
          Actif
        </label>
      </div>

      <div className="form-section-title" style={{ marginTop: 14 }}>Coordonnées</div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {champ('Téléphone', 'telephone', 'tel', 160)}
        {champ('E-mail', 'email', 'email')}
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
        {champ('Adresse', 'adresse')}
        {champ('Code postal', 'codePostal', 'text', 110)}
        {champ('Ville', 'ville', 'text', 180)}
      </div>

      <div className="form-section-title" style={{ marginTop: 14 }}>Administratif et médical</div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        {champ('N° de sécurité sociale', 'numeroSecu', 'text', 220)}
        {champ('Dernière visite médicale', 'dateVisiteMedicale', 'date', 190)}
        {visiteAExpirer(f.dateVisiteMedicale) && (
          <span style={{ color: 'var(--danger)', fontSize: 12, paddingBottom: 6 }}>
            Visite de plus de deux ans : à renouveler avant tout envoi sur chantier.
          </span>
        )}
      </div>
      <div className="field" style={{ marginTop: 10, marginBottom: 0 }}>
        <label>Commentaire</label>
        <textarea
          rows={2}
          value={f.commentaire ?? ''}
          onChange={(e) => set({ commentaire: e.target.value })}
        />
      </div>
      <p className="muted" style={{ fontSize: 11, marginBottom: 0 }}>
        Le numéro de sécurité sociale ne sert qu’à la paye : il n’apparaît ni dans les listes, ni
        dans les exports d’écran.
      </p>

      {/* L'intérim se gère par contrat d'agence — il faut donc une fiche déjà créée pour l'y
          rattacher. Le bloc n'apparaît qu'ensuite, plutôt que de proposer un formulaire orphelin. */}
      {f.contractType === 'interimaire' && (
        salarie
          ? <div style={{ marginTop: 16 }}><ContratInterimBloc employeeId={salarie.id} /></div>
          : (
            <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
              Enregistrez d’abord la fiche : le contrat d’agence (taux, coefficient, indemnités)
              s’ajoute ensuite, et c’est lui qui donnera le coût réel de l’heure.
            </p>
          )
      )}
    </Modale>
  );
}

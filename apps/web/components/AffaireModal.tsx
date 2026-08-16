'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { apiFetch, ApiError } from '@/lib/api';
import { Modale } from '@/components/Modale';

/* Forme brute de l'affaire renvoyée par l'API (colonnes snake_case). null = création. */
export interface AffaireInit {
  id: string;
  code: string;
  name: string;
  client_id?: string | null;
  moa?: string | null;
  responsable?: string | null;
  conducteur?: string | null;
  nature_travaux?: string | null;
  lots_traites?: string | null;
  conditions_paiement?: string | null;
  budget_objectif?: string | null;
  notes?: string | null;
  lieu_execution?: { adresse?: string; code_postal?: string; ville?: string } | null;
  date_limite_remise?: string | null;
  date_retour_effectif?: string | null;
  date_debut_etudes?: string | null;
  date_fin_etudes?: string | null;
  date_debut_travaux?: string | null;
  date_fin_travaux?: string | null;
}

interface ClientLite { id: string; code: string; name: string }

const empty = {
  code: '', name: '', clientId: '', responsable: '', conducteur: '',
  natureTravaux: '', lotsTraites: '', conditionsPaiement: '', budget: '',
  adresse: '', cp: '', ville: '', notes: '',
  dateLimiteRemise: '', dateRetourEffectif: '', dateDebutEtudes: '', dateFinEtudes: '',
  dateDebutTravaux: '', dateFinTravaux: '',
};

export function AffaireModal({ affaire, onClose, onSaved }: {
  affaire: AffaireInit | null; // null = création
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const { token } = useAuth();
  const qc = useQueryClient();
  const isEdit = Boolean(affaire);
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState({ ...empty });

  const clients = useQuery({
    queryKey: ['clients-picker'], enabled: Boolean(token),
    queryFn: () => apiFetch<{ rows: ClientLite[] }>('/clients?sort=name&pageSize=500', { token }),
  });
  // Listes de valeurs paramétrées (Configuration) + utilisateurs, pour harmoniser la saisie.
  const useList = (type: string) => useQuery({
    queryKey: ['list', type], enabled: Boolean(token),
    queryFn: () => apiFetch<{ id: string; label: string }[]>(`/params/lists/${type}`, { token }),
  });
  const paymentTerms = useList('payment_term');
  const natures = useList('work_nature');
  const lots = useList('work_lot');
  const users = useQuery({
    queryKey: ['users-pickable'], enabled: Boolean(token),
    queryFn: () => apiFetch<{ id: string; label: string }[]>('/users/pickable', { token }),
  });

  useEffect(() => {
    if (affaire) {
      const l = affaire.lieu_execution ?? {};
      setF({
        code: affaire.code ?? '', name: affaire.name ?? '', clientId: affaire.client_id ?? '',
        responsable: affaire.responsable ?? '', conducteur: affaire.conducteur ?? '',
        natureTravaux: affaire.nature_travaux ?? '', lotsTraites: affaire.lots_traites ?? '',
        conditionsPaiement: affaire.conditions_paiement ?? '', budget: affaire.budget_objectif ?? '',
        adresse: l.adresse ?? '', cp: l.code_postal ?? '', ville: l.ville ?? '', notes: affaire.notes ?? '',
        dateLimiteRemise: affaire.date_limite_remise ?? '', dateRetourEffectif: affaire.date_retour_effectif ?? '',
        dateDebutEtudes: affaire.date_debut_etudes ?? '', dateFinEtudes: affaire.date_fin_etudes ?? '',
        dateDebutTravaux: affaire.date_debut_travaux ?? '', dateFinTravaux: affaire.date_fin_travaux ?? '',
      });
    } else {
      setF({ ...empty });
    }
  }, [affaire]);

  const save = useMutation({
    mutationFn: async () => {
      const client = (clients.data?.rows ?? []).find((c) => c.id === f.clientId);
      const common = {
        name: f.name.trim(),
        clientId: f.clientId || null,
        moa: client?.name ?? null,
        responsable: f.responsable || null,
        conducteur: f.conducteur || null,
        natureTravaux: f.natureTravaux || null,
        lotsTraites: f.lotsTraites || null,
        conditionsPaiement: f.conditionsPaiement || null,
        budgetObjectif: f.budget ? f.budget.replace(',', '.') : null,
        lieuExecution: { adresse: f.adresse, code_postal: f.cp, ville: f.ville, pays: 'FR' },
        notes: f.notes || null,
      };
      if (isEdit) {
        const body = {
          ...common,
          dateLimiteRemise: f.dateLimiteRemise, dateRetourEffectif: f.dateRetourEffectif,
          dateDebutEtudes: f.dateDebutEtudes, dateFinEtudes: f.dateFinEtudes,
          dateDebutTravaux: f.dateDebutTravaux, dateFinTravaux: f.dateFinTravaux,
        };
        await apiFetch(`/affaires/${affaire!.id}`, { method: 'PATCH', body, token });
        return affaire!.id;
      }
      // Pas de code : la numérotation société l'attribue automatiquement.
      const res = await apiFetch<{ affaire: { id: string } }>('/affaires', {
        method: 'POST', body: common, token,
      });
      return res.affaire.id;
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ['affaires'] });
      qc.invalidateQueries({ queryKey: ['affaire', id] });
      onSaved(id);
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : "Enregistrement impossible."),
  });

  const canSave = f.name.trim().length > 0 && !save.isPending;

  return (
    <Modale
      titre={isEdit ? "Modifier l'affaire" : 'Nouvelle affaire'}
      largeur="l"
      onClose={onClose}
      actions={(
        <>
          <button className="btn-secondary btn" onClick={onClose}>Annuler</button>
          <button className="btn" disabled={!canSave} onClick={() => { setErr(null); save.mutate(); }}>
            {save.isPending ? '…' : isEdit ? 'Enregistrer' : "Créer l'affaire"}
          </button>
        </>
      )}
    >
      <>
        {err && <div className="error" style={{ marginBottom: 12 }}>{err}</div>}

        <SectionTitle>Identification</SectionTitle>
        {isEdit ? (
          <Grid>
            <Field label="Code">
              <input className="input" value={f.code} disabled title="Attribué automatiquement" />
            </Field>
            <Field label="Désignation *">
              <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
            </Field>
          </Grid>
        ) : (
          <Field label="Désignation *">
            <input className="input" style={{ width: '100%' }} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
            <span className="muted" style={{ fontSize: 10 }}>Le code est attribué automatiquement selon la numérotation paramétrée (Configuration).</span>
          </Field>
        )}

        <SectionTitle>Client &amp; équipe</SectionTitle>
        <Field label="Client (MOA)">
          <select className="input" style={{ width: '100%' }} value={f.clientId}
            onChange={(e) => setF({ ...f, clientId: e.target.value })}>
            <option value="">— aucun —</option>
            {(clients.data?.rows ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.code ? `${c.code} — ${c.name}` : c.name}</option>
            ))}
          </select>
        </Field>
        <Grid>
          <Field label="Responsable">
            <SelectFromList value={f.responsable} options={users.data ?? []}
              onChange={(v) => setF({ ...f, responsable: v })} placeholder="— choisir un utilisateur —" />
          </Field>
          <Field label="Conducteur de travaux">
            <SelectFromList value={f.conducteur} options={users.data ?? []}
              onChange={(v) => setF({ ...f, conducteur: v })} placeholder="— choisir un utilisateur —" />
          </Field>
        </Grid>

        <SectionTitle>Travaux</SectionTitle>
        <Field label="Nature des travaux">
          <SelectFromList value={f.natureTravaux} options={natures.data ?? []}
            onChange={(v) => setF({ ...f, natureTravaux: v })} />
        </Field>
        <Field label="Lots traités">
          <MultiFromList value={f.lotsTraites} options={lots.data ?? []}
            onChange={(v) => setF({ ...f, lotsTraites: v })} />
        </Field>

        <SectionTitle>Commercial</SectionTitle>
        <Grid>
          <Field label="Conditions de paiement">
            <SelectFromList value={f.conditionsPaiement} options={paymentTerms.data ?? []}
              onChange={(v) => setF({ ...f, conditionsPaiement: v })} />
          </Field>
          <Field label="Budget objectif (€)">
            <input className="input" inputMode="decimal" value={f.budget}
              onChange={(e) => setF({ ...f, budget: e.target.value })} />
          </Field>
        </Grid>

        <SectionTitle>Lieu d’exécution</SectionTitle>
        <Field label="Adresse">
          <input className="input" style={{ width: '100%' }} value={f.adresse}
            onChange={(e) => setF({ ...f, adresse: e.target.value })} />
        </Field>
        <Grid>
          <Field label="Code postal">
            <input className="input" value={f.cp} onChange={(e) => setF({ ...f, cp: e.target.value })} />
          </Field>
          <Field label="Ville">
            <input className="input" value={f.ville} onChange={(e) => setF({ ...f, ville: e.target.value })} />
          </Field>
        </Grid>

        {isEdit && (
          <>
            <SectionTitle>Jalons — étude</SectionTitle>
            <Grid>
              <Field label="Date limite (client)">
                <input className="input" type="date" value={f.dateLimiteRemise} onChange={(e) => setF({ ...f, dateLimiteRemise: e.target.value })} />
              </Field>
              <Field label="Retour effectif">
                <input className="input" type="date" value={f.dateRetourEffectif} onChange={(e) => setF({ ...f, dateRetourEffectif: e.target.value })} />
              </Field>
              <Field label="Début des études">
                <input className="input" type="date" value={f.dateDebutEtudes} onChange={(e) => setF({ ...f, dateDebutEtudes: e.target.value })} />
              </Field>
              <Field label="Fin des études">
                <input className="input" type="date" value={f.dateFinEtudes} onChange={(e) => setF({ ...f, dateFinEtudes: e.target.value })} />
              </Field>
            </Grid>
            <SectionTitle>Jalons — réalisation</SectionTitle>
            <Grid>
              <Field label="Début des travaux">
                <input className="input" type="date" value={f.dateDebutTravaux} onChange={(e) => setF({ ...f, dateDebutTravaux: e.target.value })} />
              </Field>
              <Field label="Fin des travaux">
                <input className="input" type="date" value={f.dateFinTravaux} onChange={(e) => setF({ ...f, dateFinTravaux: e.target.value })} />
              </Field>
            </Grid>
          </>
        )}

        <SectionTitle>Notes</SectionTitle>
        <Field label="">
          <textarea className="input" style={{ width: '100%', minHeight: 60 }} value={f.notes}
            onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </Field>

      </>
    </Modale>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.07em',
      color: 'var(--accent)', margin: '16px 0 8px', paddingBottom: 5, borderBottom: '1px solid var(--border)',
    }}>{children}</div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 8 }}>
      {label && <label className="label">{label}</label>}
      {children}
    </div>
  );
}
function Grid({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>{children}</div>;
}

/** Liste déroulante depuis un référentiel société (on stocke le libellé, valeur harmonisée).
 *  Une valeur héritée absente de la liste reste sélectionnée pour ne rien perdre. */
function SelectFromList({ value, options, onChange, placeholder }: {
  value: string; options: { id: string; label: string }[]; onChange: (v: string) => void; placeholder?: string;
}) {
  const known = options.some((o) => o.label === value);
  return (
    <select className="input" style={{ width: '100%' }} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder ?? '— choisir —'}</option>
      {value && !known && <option value={value}>{value} (valeur héritée)</option>}
      {options.map((o) => <option key={o.id} value={o.label}>{o.label}</option>)}
    </select>
  );
}

/** Choix multiple depuis un référentiel : on stocke les libellés joints par « , ». */
function MultiFromList({ value, options, onChange }: {
  value: string; options: { id: string; label: string }[]; onChange: (v: string) => void;
}) {
  const selected = value ? value.split(',').map((s) => s.trim()).filter(Boolean) : [];
  const toggle = (label: string) => {
    const next = selected.includes(label) ? selected.filter((l) => l !== label) : [...selected, label];
    onChange(next.join(', '));
  };
  const legacy = selected.filter((l) => !options.some((o) => o.label === l));
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {options.map((o) => {
        const on = selected.includes(o.label);
        return (
          <button type="button" key={o.id} onClick={() => toggle(o.label)}
            className={on ? 'btn' : 'btn-secondary'} style={{ fontSize: 11, padding: '3px 10px' }}>
            {on ? '✓ ' : ''}{o.label}
          </button>
        );
      })}
      {legacy.map((l) => (
        <button type="button" key={l} onClick={() => toggle(l)} className="btn"
          style={{ fontSize: 11, padding: '3px 10px' }} title="Valeur héritée">✓ {l}</button>
      ))}
      {options.length === 0 && legacy.length === 0 && (
        <span className="muted" style={{ fontSize: 11 }}>Aucun lot paramétré (Configuration → Listes de valeurs).</span>
      )}
    </div>
  );
}


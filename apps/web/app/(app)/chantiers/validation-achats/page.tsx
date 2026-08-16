'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, Trash2 } from 'lucide-react';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { LigneVide } from '@/components/ui';
import { euro } from '@/lib/format';
import { IconBtn } from '@/components/IconBtn';

interface Regle {
  id: string;
  chantierId: string | null;
  montantMin: string;
  validatorId: string;
  validateur: string;
}
interface Chantier { id: string; code: string; name: string }
interface Utilisateur { id: string; label: string }

/**
 * Seuils de validation des achats.
 *
 * Sans seuil, une commande de 80 000 € part aussi facilement qu'une caisse de gants. Une règle
 * dit « au-delà de tel montant, telle personne approuve ». Les règles de la société s'appliquent
 * partout ; celles d'un chantier les REMPLACENT sur ce chantier — cumuler les deux rendrait le
 * paramétrage imprévisible, on ne saurait plus qui doit signer en regardant l'écran.
 */
export default function ValidationAchatsPage() {
  const { token } = useAuth();
  const qc = useQueryClient();
  const [perimetre, setPerimetre] = useState('');
  const [seuil, setSeuil] = useState('5000');
  const [validateur, setValidateur] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const requete = perimetre ? `?chantier=${perimetre}` : '';
  const regles = useQuery({
    queryKey: ['regles-validation', perimetre],
    enabled: Boolean(token),
    queryFn: () => apiFetch<Regle[]>(`/validation-achats/regles${requete}`, { token }),
  });
  const chantiers = useQuery({
    queryKey: ['chantiers'], enabled: Boolean(token),
    queryFn: () => apiFetch<Chantier[]>('/chantiers', { token }),
  });
  const utilisateurs = useQuery({
    queryKey: ['users-pickable'], enabled: Boolean(token), retry: false,
    queryFn: () => apiFetch<Utilisateur[]>('/users/pickable', { token }),
  });

  const rafraichir = () => {
    setErr(null);
    qc.invalidateQueries({ queryKey: ['regles-validation'] });
    qc.invalidateQueries({ queryKey: ['commande-validation'] });
  };
  const ajouter = useMutation({
    mutationFn: () => apiFetch('/validation-achats/regles', {
      method: 'POST', token,
      body: { chantierId: perimetre || null, montantMin: seuil, validatorId: validateur },
    }),
    onSuccess: () => { setValidateur(''); rafraichir(); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Règle non ajoutée.'),
  });
  const supprimer = useMutation({
    mutationFn: (id: string) => apiFetch(`/validation-achats/regles/${id}`, { method: 'DELETE', token }),
    onSuccess: rafraichir,
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Suppression impossible.'),
  });

  const lignes = regles.data ?? [];

  return (
    <div>
      <h1 style={{ marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
        <ShieldCheck size={20} /> Validation des achats
      </h1>
      <p className="muted" style={{ marginTop: 0, maxWidth: 840 }}>
        Qui engage l’entreprise, et jusqu’à quel montant. Une commande dont le total atteint un
        seuil part <strong>au visa</strong> de la personne désignée, et n’entre dans l’engagé
        qu’une fois approuvée. Sans règle, les commandes partent directement.
      </p>

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 16 }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Périmètre</label>
          <select value={perimetre} onChange={(e) => setPerimetre(e.target.value)} style={{ minWidth: 230 }}>
            <option value="">Toute la société</option>
            {(chantiers.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.code} — {c.name}</option>
            ))}
          </select>
        </div>
      </div>

      {perimetre && (
        <p className="muted" style={{ fontSize: 12, marginTop: 10, maxWidth: 840 }}>
          Dès qu’un chantier a ses propres règles, elles <strong>remplacent</strong> celles de la
          société sur ce chantier. Sans règle propre, il suit la société.
        </p>
      )}
      {err && <div className="error" style={{ marginTop: 12 }}>{err}</div>}

      <div className="card" style={{ marginTop: 12, padding: 14 }}>
        <form
          style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}
          onSubmit={(e) => { e.preventDefault(); if (validateur) ajouter.mutate(); }}
        >
          <div className="field" style={{ marginBottom: 0 }}>
            <label>À partir de (HT)</label>
            <input type="number" min={0} step="100" value={seuil}
              onChange={(e) => setSeuil(e.target.value)} style={{ width: 130, textAlign: 'right' }} />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Doit être validée par</label>
            <select value={validateur} onChange={(e) => setValidateur(e.target.value)} style={{ minWidth: 220 }}>
              <option value="">— Choisir —</option>
              {(utilisateurs.data ?? []).map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
            </select>
          </div>
          <button className="btn" type="submit" disabled={!validateur || ajouter.isPending}>
            {ajouter.isPending ? 'Ajout…' : 'Ajouter la règle'}
          </button>
        </form>
      </div>

      <div className="card" style={{ marginTop: 16, padding: 0, overflow: 'hidden' }}>
        <table className="grid" style={{ margin: 0 }}>
          <thead>
            <tr>
              <th style={{ width: 180 }}>À partir de</th>
              <th>Validateur</th>
              <th style={{ width: 60 }} />
            </tr>
          </thead>
          <tbody>
            {lignes.map((r) => (
              <tr key={r.id}>
                <td style={{ fontVariantNumeric: 'tabular-nums' }}>{euro(r.montantMin)}</td>
                <td>{r.validateur}</td>
                <td style={{ textAlign: 'right', paddingRight: 8 }}>
                  <IconBtn
                    title="Supprimer cette règle"
                    color="var(--danger, #dc2626)"
                    onClick={() => supprimer.mutate(r.id)}
                  >
                    <Trash2 size={13} />
                  </IconBtn>
                </td>
              </tr>
            ))}
            {lignes.length === 0 && (
              <LigneVide
                colonnes={3}
                icone={ShieldCheck}
                titre="Aucune règle de validation."
                indice="Sans règle, une commande part dès son envoi : ajoutez un seuil pour exiger un accord au-delà d’un montant."
              />
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

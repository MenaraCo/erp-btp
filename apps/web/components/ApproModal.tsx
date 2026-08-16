'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { euro } from '@/lib/format';
import { Modale } from '@/components/Modale';

interface Suggestion {
  resourceId: string;
  code: string;
  label: string;
  nature: string;
  unite: string | null;
  uniteAchat: string | null;
  coeffConversion: string;
  puAchat: string;
  fournisseur: string | null;
  refFournisseur: string | null;
  codeAnalytique: string | null;
  famille: string | null;
  lot: string | null;
  ouvrage: string | null;
  quantiteBudget: string;
  quantiteAvancement: string;
  quantiteCommandee: string;
  quantiteRestante: string;
}
interface Regroupements {
  fournisseurs: Array<{ id: string; label: string }>;
  lots: Array<{ id: string; label: string }>;
  familles: Array<{ id: string; label: string }>;
  codes: Array<{ id: string; label: string }>;
}

type Mode = 'reste' | 'total' | 'avancement';

const MODES: Array<{ code: Mode; label: string; aide: string }> = [
  { code: 'reste', label: 'Ce qu’il reste', aide: 'Budget moins ce qui est déjà commandé.' },
  { code: 'total', label: 'Tout le besoin', aide: 'La totalité du budget, en une commande.' },
  { code: 'avancement', label: 'Selon l’avancement', aide: 'Seulement la part débloquée par l’avancement des ouvrages.' },
];

/**
 * Insertion de ressources dans un bon de commande, depuis la nomenclature du chantier.
 *
 * On ne commande pas « une ressource » : on commande tout ce qu'il faut chez un fournisseur, ou
 * le lot peinture. D'où les filtres par fournisseur, lot et famille, et la sélection en masse.
 *
 * La quantité est convertie en unité d'ACHAT (le sac, pas le kilo) et le montant reste celui du
 * budget : commander ne doit pas changer ce qui a été chiffré.
 */
export function ApproModal({
  chantierId,
  orderId,
  onClose,
  onInsere,
}: {
  chantierId: string;
  orderId: string;
  onClose: () => void;
  onInsere: (nombre: number) => void;
}) {
  const { token } = useAuth();
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode>('reste');
  const [fournisseur, setFournisseur] = useState('');
  const [lot, setLot] = useState('');
  const [famille, setFamille] = useState('');
  const [resteSeulement, setResteSeulement] = useState(true);
  const [choisies, setChoisies] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);

  const requete = useMemo(() => {
    const p = new URLSearchParams();
    if (fournisseur) p.set('fournisseur', fournisseur);
    if (lot) p.set('lot', lot);
    if (famille) p.set('famille', famille);
    if (resteSeulement) p.set('reste', '1');
    return p.toString();
  }, [fournisseur, lot, famille, resteSeulement]);

  const appro = useQuery({
    queryKey: ['appro', chantierId, requete],
    enabled: Boolean(token),
    queryFn: () => apiFetch<{ lignes: Suggestion[] }>(
      `/chantiers/${chantierId}/approvisionnement?${requete}`, { token },
    ),
  });
  const groupes = useQuery({
    queryKey: ['appro-regroupements', chantierId],
    enabled: Boolean(token),
    queryFn: () => apiFetch<Regroupements>(
      `/chantiers/${chantierId}/approvisionnement/regroupements`, { token },
    ),
  });

  const lignes = appro.data?.lignes ?? [];

  /** Quantité que l'insertion retiendra, selon le mode — affichée pour éviter la surprise. */
  const quantiteRetenue = (l: Suggestion): number => {
    const n = mode === 'total' ? Number(l.quantiteBudget)
      : mode === 'avancement' ? Number(l.quantiteAvancement) - Number(l.quantiteCommandee)
        : Number(l.quantiteRestante);
    return Math.max(0, n);
  };

  const inserer = useMutation({
    mutationFn: () => apiFetch<{ inserees: number }>(
      `/purchase-orders/${orderId}/lines/nomenclature`,
      {
        method: 'POST', token,
        body: {
          mode,
          resourceIds: [...choisies],
          filtre: {
            supplierId: fournisseur || null, lotId: lot || null, familleId: famille || null,
            resteSeulement,
          },
        },
      },
    ),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['purchasing-chain', chantierId] });
      qc.invalidateQueries({ queryKey: ['purchasing-summary', chantierId] });
      qc.invalidateQueries({ queryKey: ['appro', chantierId] });
      onInsere(r.inserees);
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Insertion impossible.'),
  });

  const toutSelectionner = () => {
    setChoisies(choisies.size === lignes.length
      ? new Set()
      : new Set(lignes.map((l) => l.resourceId)));
  };

  const totalRetenu = lignes
    .filter((l) => choisies.size === 0 || choisies.has(l.resourceId))
    .reduce((t, l) => t + (quantiteRetenue(l) / Number(l.coeffConversion)) * Number(l.puAchat), 0);

  return (
    <Modale
      titre="Insérer des ressources du chantier"
      sousTitre="Les quantités viennent du budget, converties en unité d’achat."
      largeur="xl"
      onClose={onClose}
      actions={(
        <>
          <span className="muted" style={{ fontSize: 12, marginRight: 'auto' }}>
            {choisies.size > 0
              ? `${choisies.size} ressource${choisies.size > 1 ? 's' : ''} choisie${choisies.size > 1 ? 's' : ''}`
              : 'Aucune sélection : tout ce qui est affiché sera inséré'}
          </span>
          <strong>{euro(totalRetenu.toFixed(2))}</strong>
          <button className="btn btn-secondary" onClick={onClose}>Annuler</button>
          <button
            className="btn"
            disabled={lignes.length === 0 || inserer.isPending}
            onClick={() => { setErr(null); inserer.mutate(); }}
          >
            {inserer.isPending ? 'Insertion…' : 'Insérer dans la commande'}
          </button>
        </>
      )}
    >
      <>
        {err && <div className="error" style={{ marginBottom: 12 }}>{err}</div>}

        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 10 }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Fournisseur</label>
            <select value={fournisseur} onChange={(e) => setFournisseur(e.target.value)} style={{ minWidth: 160 }}>
              <option value="">Tous</option>
              {(groupes.data?.fournisseurs ?? []).map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Lot</label>
            <select value={lot} onChange={(e) => setLot(e.target.value)} style={{ minWidth: 150 }}>
              <option value="">Tous</option>
              {(groupes.data?.lots ?? []).map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Famille</label>
            <select value={famille} onChange={(e) => setFamille(e.target.value)} style={{ minWidth: 150 }}>
              <option value="">Toutes</option>
              {(groupes.data?.familles ?? []).map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, paddingBottom: 6 }}>
            <input type="checkbox" checked={resteSeulement} onChange={(e) => setResteSeulement(e.target.checked)} />
            Masquer ce qui est déjà commandé
          </label>
        </div>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {MODES.map((m) => (
            <button
              key={m.code}
              type="button"
              className={mode === m.code ? 'btn' : 'btn btn-secondary'}
              style={{ fontSize: 12 }}
              title={m.aide}
              onClick={() => setMode(m.code)}
            >
              {m.label}
            </button>
          ))}
          <span className="muted" style={{ fontSize: 11, alignSelf: 'center' }}>
            {MODES.find((m) => m.code === mode)?.aide}
          </span>
        </div>

        <div style={{ maxHeight: '46vh', overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
          <table className="grid" style={{ margin: 0 }}>
            <thead>
              <tr>
                <th style={{ width: 34 }}>
                  <input
                    type="checkbox"
                    checked={choisies.size > 0 && choisies.size === lignes.length}
                    onChange={toutSelectionner}
                    title="Tout sélectionner"
                  />
                </th>
                <th>Ressource</th>
                <th>Fournisseur</th>
                <th>Ouvrage</th>
                <th>Code</th>
                <th style={{ textAlign: 'right' }}>Budget</th>
                <th style={{ textAlign: 'right' }}>Commandé</th>
                <th style={{ textAlign: 'right' }}>À commander</th>
                <th style={{ textAlign: 'right' }}>PU achat</th>
              </tr>
            </thead>
            <tbody>
              {lignes.map((l) => {
                const retenue = quantiteRetenue(l);
                const enAchat = retenue / Number(l.coeffConversion);
                return (
                  <tr key={l.resourceId} style={{ opacity: retenue > 0 ? 1 : 0.5 }}>
                    <td>
                      <input
                        type="checkbox"
                        checked={choisies.has(l.resourceId)}
                        onChange={(e) => {
                          const s = new Set(choisies);
                          if (e.target.checked) s.add(l.resourceId); else s.delete(l.resourceId);
                          setChoisies(s);
                        }}
                      />
                    </td>
                    <td>
                      <span className="code-cell">{l.code}</span> {l.label}
                      {l.refFournisseur && <span className="muted"> · réf. {l.refFournisseur}</span>}
                    </td>
                    <td className="muted">{l.fournisseur ?? '—'}</td>
                    <td className="muted" style={{ fontSize: 12 }}>{l.ouvrage ?? '—'}</td>
                    <td>{l.codeAnalytique
                      ? <span className="code-cell">{l.codeAnalytique}</span>
                      : <span className="muted">À ventiler</span>}</td>
                    <td style={{ textAlign: 'right' }}>{Number(l.quantiteBudget)} {l.unite}</td>
                    <td style={{ textAlign: 'right' }}>{Number(l.quantiteCommandee)} {l.unite}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>
                      {Math.round(enAchat * 10000) / 10000} {l.uniteAchat ?? l.unite}
                    </td>
                    <td style={{ textAlign: 'right' }}>{euro(l.puAchat)}</td>
                  </tr>
                );
              })}
              {lignes.length === 0 && (
                <tr>
                  <td colSpan={9} className="muted" style={{ padding: 16, textAlign: 'center' }}>
                    Rien à approvisionner avec ces filtres.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

      </>
    </Modale>
  );
}

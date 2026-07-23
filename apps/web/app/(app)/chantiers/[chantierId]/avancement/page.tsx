'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { apiFetch, ApiError } from '@/lib/api';
import { euro } from '@/lib/format';

/* ─────────── types ─────────── */
const NATURE_LABELS: Record<string, string> = {
  material: 'Matériaux',
  equipment: 'Matériel',
  subcontract: 'Sous-traitance',
  labor: "Main d'œuvre",
  site_overhead: 'Frais de chantier',
};
const NATURE_ORDER = ['material', 'equipment', 'subcontract', 'labor', 'site_overhead'];

interface NatureResult {
  nature: string;
  budgetObjectif: string;
  engage: string;
  realise: string;
  ecart: string;
}
interface Results {
  budgetVenteHt: string | null;
  byNature: NatureResult[];
  totals: { budgetObjectif: string; engage: string; realise: string; ecart: string };
}
interface AdvancementRow { nature: string | null; pct: string; source: string; recorded_at: string }
interface Advancement { global: AdvancementRow | null; byNature: AdvancementRow[] }
interface Forecast {
  avancement: string;
  indicators: {
    budgetAvance: string;
    ecartAuStade: string;
    eac: string | null;
    margePrevisionnelle: string | null;
    margePrevisionnellePct: string | null;
    alerts: string[];
  };
}

/** '18' (saisie %) → 0.18 (fraction). Renvoie null si vide/invalide. */
function pctToFraction(input: string): number | null {
  if (input.trim() === '') return null;
  const n = Number(input.replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  return n / 100;
}

/**
 * Saisie de l'avancement d'un chantier (cahier §5.8).
 * L'avancement débloque le « budget avancé » (crédit) = budget objectif × avancement,
 * qui alimente l'écart au stade, l'EAC et la marge prévisionnelle. Saisie globale
 * et/ou par nature : le moteur prend le % de la nature s'il existe, sinon le global.
 */
export default function AvancementPage() {
  const { token } = useAuth();
  const qc = useQueryClient();
  const chantierId = String(useParams().chantierId);

  const chantier = useQuery({
    queryKey: ['chantier', chantierId],
    enabled: Boolean(token),
    queryFn: () => apiFetch<{ code: string }>(`/chantiers/${chantierId}`, { token }),
  });
  const results = useQuery({
    queryKey: ['chantier-results', chantierId],
    enabled: Boolean(token),
    queryFn: () => apiFetch<Results>(`/chantiers/${chantierId}/results`, { token }),
  });
  const advancement = useQuery({
    queryKey: ['advancement', chantierId],
    enabled: Boolean(token),
    retry: false,
    queryFn: () => apiFetch<Advancement>(`/chantiers/${chantierId}/advancement`, { token }),
  });
  const forecast = useQuery({
    queryKey: ['chantier-forecast', chantierId],
    enabled: Boolean(token),
    retry: false,
    queryFn: () => apiFetch<Forecast>(`/chantiers/${chantierId}/forecast`, { token }),
  });

  /** Après enregistrement, tout ce qui dépend de l'avancement doit se recalculer. */
  const invalidateDependents = () => {
    for (const key of [
      ['advancement', chantierId],
      ['chantier-forecast', chantierId],
      ['chantier-analytical', chantierId],
      ['chantier-results', chantierId],
      ['pilotage', chantierId],
      ['portfolio'],
    ]) {
      qc.invalidateQueries({ queryKey: key });
    }
  };

  const record = useMutation({
    mutationFn: (body: { nature?: string | null; pct: number }) =>
      apiFetch(`/chantiers/${chantierId}/advancement`, { method: 'POST', token, body }),
    onSuccess: invalidateDependents,
  });

  if (results.isError || advancement.isError) {
    return (
      <div>
        <p className="muted" style={{ marginTop: 0 }}>
          <Link href={`/chantiers/${chantierId}`} className="link">← Chantier {chantier.data?.code ?? ''}</Link>
        </p>
        <h1>Saisie de l'avancement</h1>
        <p className="muted">Module « Gestion financière » non actif pour cet utilisateur, ou accès refusé.</p>
      </div>
    );
  }

  const globalPctNow = advancement.data?.global ? Number(advancement.data.global.pct) : null;
  const byNatureMap = new Map((advancement.data?.byNature ?? []).map((r) => [r.nature as string, Number(r.pct)]));

  // natures présentes au budget, dans l'ordre métier
  const natures = (results.data?.byNature ?? [])
    .filter((n) => Number(n.budgetObjectif) !== 0 || byNatureMap.has(n.nature))
    .sort((a, b) => NATURE_ORDER.indexOf(a.nature) - NATURE_ORDER.indexOf(b.nature));

  const budgetTotal = results.data ? Number(results.data.totals.budgetObjectif) : 0;
  const f = forecast.data?.indicators;

  return (
    <div>
      <p className="muted" style={{ marginTop: 0 }}>
        <Link href={`/chantiers/${chantierId}`} className="link">← Chantier {chantier.data?.code ?? ''}</Link>
      </p>
      <h1 style={{ marginBottom: 4 }}>Saisie de l'avancement</h1>
      <p className="muted" style={{ marginTop: 0, maxWidth: 720 }}>
        L'avancement débloque le <strong>budget avancé</strong> (le crédit) : budget avancé = budget objectif ×
        avancement. On le compare à la dépense (réalisé + engagé) pour obtenir l'écart au stade, puis l'EAC et la
        marge prévisionnelle. Saisissez un avancement global, et affinez par nature si besoin.
      </p>

      {/* effet immédiat sur les indicateurs prévisionnels */}
      {f && (
        <div className="card-grid" style={{ marginTop: 12 }}>
          <div className="card"><h2>Budget avancé (crédit)</h2><div className="stat">{euro(f.budgetAvance)}</div></div>
          <div className="card">
            <h2>Écart au stade</h2>
            <div className="stat" style={{ color: Number(f.ecartAuStade) < 0 ? 'var(--danger)' : undefined }}>{euro(f.ecartAuStade)}</div>
          </div>
          <div className="card"><h2>Coût final estimé (EAC)</h2><div className="stat">{euro(f.eac)}</div></div>
          <div className="card">
            <h2>Marge prévisionnelle</h2>
            <div className="stat" style={{ color: Number(f.margePrevisionnelle ?? 0) < 0 ? 'var(--danger)' : undefined }}>
              {euro(f.margePrevisionnelle)}
            </div>
          </div>
        </div>
      )}

      {/* avancement global */}
      <GlobalAdvancement
        currentPct={globalPctNow}
        budgetTotal={budgetTotal}
        saving={record.isPending}
        onSave={(pct) => record.mutate({ nature: null, pct })}
      />

      {/* avancement par nature */}
      <div className="card" style={{ marginTop: 16 }}>
        <h2 style={{ marginTop: 0 }}>Avancement par nature (optionnel)</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Une nature avec un avancement propre prime sur le global. Laissez vide pour utiliser le global.
        </p>
        {record.isError && <div className="error">{record.error instanceof ApiError ? record.error.message : 'Erreur'}</div>}
        <table className="grid" style={{ marginTop: 8 }}>
          <thead>
            <tr>
              <th>Nature</th>
              <th style={{ textAlign: 'right' }}>Budget objectif</th>
              <th style={{ textAlign: 'right' }}>Réalisé + engagé</th>
              <th style={{ textAlign: 'right' }}>Avanc. actuel</th>
              <th style={{ textAlign: 'right' }}>Nouvel avancement</th>
              <th style={{ textAlign: 'right' }}>Budget avancé</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {natures.map((n) => (
              <NatureRow
                key={n.nature}
                nature={n}
                currentPct={byNatureMap.get(n.nature) ?? null}
                globalPct={globalPctNow}
                saving={record.isPending}
                onSave={(pct) => record.mutate({ nature: n.nature, pct })}
              />
            ))}
          </tbody>
        </table>
      </div>

      <p className="muted" style={{ marginTop: 12, fontSize: 12 }}>
        Chaque enregistrement recalcule en direct les indicateurs, les courbes de pilotage et le tableau de bord Direction.
      </p>
    </div>
  );
}

/* ─────────── avancement global ─────────── */
function GlobalAdvancement({
  currentPct,
  budgetTotal,
  saving,
  onSave,
}: {
  currentPct: number | null;
  budgetTotal: number;
  saving: boolean;
  onSave: (pct: number) => void;
}) {
  const [input, setInput] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const draft = pctToFraction(input);
  // aperçu : crédit débloqué avec la valeur saisie (sinon la valeur actuelle)
  const previewFraction = draft ?? currentPct ?? 0;
  const previewCredit = budgetTotal * previewFraction;

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h2 style={{ marginTop: 0 }}>Avancement global</h2>
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Avancement actuel</label>
          <div className="stat" style={{ fontSize: 22 }}>
            {currentPct == null ? '— non saisi' : `${(currentPct * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`}
          </div>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Nouvel avancement (%)</label>
          <input
            type="number"
            min={0}
            max={100}
            step={1}
            value={input}
            placeholder={currentPct != null ? String(Math.round(currentPct * 100)) : '0'}
            onChange={(e) => setInput(e.target.value)}
            style={{ width: 120, textAlign: 'right' }}
          />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Budget avancé (aperçu)</label>
          <div className="stat" style={{ fontSize: 22 }}>{euro(previewCredit)}</div>
          <span className="muted" style={{ fontSize: 11 }}>= {euro(budgetTotal)} × {(previewFraction * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %</span>
        </div>
        <button
          className="btn"
          disabled={saving || draft == null}
          onClick={() => {
            setErr(null);
            if (draft == null) return;
            if (draft < 0 || draft > 1) { setErr('L\'avancement doit être entre 0 et 100 %.'); return; }
            onSave(draft);
            setInput('');
          }}
        >
          {saving ? 'Enregistrement…' : 'Enregistrer l\'avancement global'}
        </button>
      </div>
      {err && <div className="error" style={{ marginTop: 8 }}>{err}</div>}
    </div>
  );
}

/* ─────────── avancement d'une nature ─────────── */
function NatureRow({
  nature,
  currentPct,
  globalPct,
  saving,
  onSave,
}: {
  nature: NatureResult;
  currentPct: number | null;
  globalPct: number | null;
  saving: boolean;
  onSave: (pct: number) => void;
}) {
  const [input, setInput] = useState('');
  const draft = pctToFraction(input);
  const budget = Number(nature.budgetObjectif);
  const depense = Number(nature.engage) + Number(nature.realise);
  // % effectif appliqué : nature saisie > nature actuelle > global
  const effectiveFraction = useMemo(() => draft ?? currentPct ?? globalPct ?? 0, [draft, currentPct, globalPct]);
  const credit = budget * effectiveFraction;
  const label = NATURE_LABELS[nature.nature] ?? nature.nature;

  const inherited = currentPct == null;

  return (
    <tr>
      <td>{label}</td>
      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{euro(nature.budgetObjectif)}</td>
      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{euro(depense)}</td>
      <td style={{ textAlign: 'right' }}>
        {currentPct == null ? (
          <span className="muted" style={{ fontSize: 12 }}>
            {globalPct != null ? `${(globalPct * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} % (global)` : '—'}
          </span>
        ) : (
          `${(currentPct * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`
        )}
      </td>
      <td style={{ textAlign: 'right' }}>
        <input
          type="number"
          min={0}
          max={100}
          step={1}
          value={input}
          placeholder={inherited ? '—' : String(Math.round((currentPct ?? 0) * 100))}
          onChange={(e) => setInput(e.target.value)}
          style={{ width: 90, textAlign: 'right' }}
        />
      </td>
      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{euro(credit)}</td>
      <td style={{ textAlign: 'right' }}>
        <button
          className="btn btn-secondary"
          style={{ fontSize: 12, padding: '4px 10px' }}
          disabled={saving || draft == null || draft < 0 || draft > 1}
          onClick={() => { if (draft != null) { onSave(draft); setInput(''); } }}
        >
          Enregistrer
        </button>
      </td>
    </tr>
  );
}

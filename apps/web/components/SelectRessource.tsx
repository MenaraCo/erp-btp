'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PositionFlottante, positionFlottante, suivreAncre } from '@/lib/flottant';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { euro } from '@/lib/format';

interface Article {
  code: string;
  label: string;
  unite: string | null;
  nature: string;
  puAchat: string;
  codeAnalytique: string | null;
  origine: 'chantier' | 'bibliotheque' | 'etude' | string;
}

const ORIGINES: Record<string, string> = {
  chantier: 'budget du chantier',
  bibliotheque: 'bibliothèque',
  etude: 'étude de prix',
};

/**
 * Cellule « Code » d'une ligne de commande : saisie libre ET liste des ressources connues.
 *
 * Le code n'est PAS obligatoire — une commande contient parfois un article qui n'est dans aucun
 * catalogue. Mais quand il est renseigné, la ligne se rattache à une ressource connue : c'est ce
 * rattachement qui permettra de dire combien de sacs de colle l'entreprise commande dans l'année,
 * et chez qui.
 *
 * La liste propose d'abord ce qui a été chiffré POUR CE CHANTIER — le plus probable — puis les
 * catalogues de l'entreprise.
 */
const LARGEUR = 420;
const HAUTEUR = 300;

export function SelectRessource({
  valeur,
  chantierId,
  readOnly,
  onChange,
}: {
  valeur: string | null;
  chantierId: string;
  readOnly?: boolean;
  onChange: (code: string) => void;
}) {
  const { token } = useAuth();
  const [ouvert, setOuvert] = useState(false);
  const [saisie, setSaisie] = useState(valeur ?? '');
  /**
   * Le champ n'émet QUE si l'utilisateur y a touché.
   *
   * Sans ce garde-fou, un blur déclenché par un simple re-rendu (la ligne se rafraîchit après une
   * autre modification) envoyait une valeur vide et EFFAÇAIT le code déjà saisi. Une cellule ne
   * doit jamais écrire ce que personne n'a tapé.
   */
  const touche = useRef(false);
  const [pos, setPos] = useState<PositionFlottante | null>(null);
  const champ = useRef<HTMLInputElement>(null);

  useEffect(() => { setSaisie(valeur ?? ''); touche.current = false; }, [valeur]);

  useEffect(() => {
    if (!ouvert) return undefined;
    const dehors = (e: MouseEvent) => {
      const dansLaListe = document.getElementById('liste-ressources')?.contains(e.target as Node);
      if (!champ.current?.contains(e.target as Node) && !dansLaListe) setOuvert(false);
    };
    const echap = (e: KeyboardEvent) => { if (e.key === 'Escape') setOuvert(false); };
    document.addEventListener('mousedown', dehors);
    document.addEventListener('keydown', echap);
    return () => {
      document.removeEventListener('mousedown', dehors);
      document.removeEventListener('keydown', echap);
    };
  }, [ouvert]);

  const articles = useQuery({
    queryKey: ['achats-ressources', chantierId, saisie],
    enabled: Boolean(token && ouvert),
    queryFn: () => apiFetch<Article[]>(
      `/achats/ressources?chantier=${chantierId}&q=${encodeURIComponent(saisie)}`, { token },
    ),
  });

  // Placement partagé : bascule au-dessus quand la ligne est en bas de l'écran, et borne la
  // hauteur à l'espace libre — sinon la liste sort du cadre et devient inatteignable.
  const placer = useCallback(() => {
    const r = champ.current?.getBoundingClientRect();
    if (r) setPos(positionFlottante(r, LARGEUR, HAUTEUR));
  }, []);

  useEffect(() => {
    if (!ouvert) return undefined;
    return suivreAncre(placer);
  }, [ouvert, placer]);

  const choisir = (code: string) => {
    setSaisie(code);
    touche.current = false;
    setOuvert(false);
    if (code !== (valeur ?? '')) onChange(code);
  };

  return (
    <>
      <input
        ref={champ}
        value={saisie}
        disabled={readOnly}
        placeholder="Code"
        title="Code d’article — facultatif. Choisissez-en un pour rattacher la ligne à une ressource connue."
        onChange={(e) => { setSaisie(e.target.value); touche.current = true; placer(); setOuvert(true); }}
        onFocus={() => { placer(); setOuvert(true); }}
        onBlur={(e) => {
          // Le blur valide la saisie libre ; la sélection dans la liste passe par `choisir`.
          if (!touche.current) return;
          touche.current = false;
          const v = e.target.value.trim();
          if (v !== (valeur ?? '')) onChange(v);
        }}
        style={{ width: '100%', fontFamily: 'monospace', fontSize: 11 }}
      />

      {ouvert && pos && !readOnly && createPortal(
        <div id="liste-ressources" style={{
          position: 'fixed', top: pos.top, left: pos.left, zIndex: 2000,
          width: LARGEUR, maxHeight: pos.maxHeight, overflow: 'auto',
          background: 'var(--card, #fff)', border: '1px solid var(--border)', borderRadius: 8,
          boxShadow: '0 8px 24px rgba(15,23,42,.16)', padding: 6,
        }}>
          <div className="muted" style={{ fontSize: 10.5, padding: '2px 6px 6px' }}>
            Facultatif — laissez vide pour une ligne libre.
          </div>
          {(articles.data ?? []).map((a) => (
            <button
              key={`${a.origine}-${a.code}`}
              type="button"
              onClick={() => choisir(a.code)}
              style={{
                display: 'flex', alignItems: 'baseline', gap: 8, width: '100%', textAlign: 'left',
                border: 'none', borderRadius: 6, padding: '5px 7px', background: 'transparent',
                font: 'inherit', fontSize: 12, cursor: 'pointer',
              }}
            >
              <span className="code-cell" style={{ minWidth: 92 }}>{a.code}</span>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {a.label}
              </span>
              <span className="muted" style={{ fontSize: 10.5 }}>
                {euro(a.puAchat)}{a.unite ? ` /${a.unite}` : ''} · {ORIGINES[a.origine] ?? a.origine}
              </span>
            </button>
          ))}
          {articles.isFetched && (articles.data ?? []).length === 0 && (
            <div className="muted" style={{ fontSize: 12, padding: 8 }}>
              Aucun article ne correspond — la saisie reste libre.
            </div>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}

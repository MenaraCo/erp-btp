'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export interface NoeudExecution {
  id: string;
  type: 'titre' | 'ouvrage';
  vendable: boolean;
  code: string | null;
  designation: string | null;
  children?: NoeudExecution[];
}
interface MarcheExecution {
  id: string;
  code: string;
  name: string;
  lines: NoeudExecution[];
}
interface ArbreExecution { marches: MarcheExecution[] }

export interface OptionOuvrage { id: string; label: string; groupe: string }

/**
 * Ouvrages d'imputation d'un chantier, à plat mais avec leur contexte.
 *
 * L'arbre d'exécution est renvoyé par MARCHÉ, chaque ligne portant ses enfants : on le parcourt
 * donc en profondeur. Deux lots portent souvent un ouvrage de même nom — le titre parent (et le
 * marché quand il y en a plusieurs) accompagne chaque option, sans quoi « Cloisons » ne dit pas
 * lequel.
 */
export function ouvragesDuChantier(arbre: ArbreExecution | undefined): OptionOuvrage[] {
  const marches = arbre?.marches ?? [];
  const plusieurs = marches.length > 1;
  const options: OptionOuvrage[] = [];

  const parcourir = (noeuds: NoeudExecution[], marche: MarcheExecution, chemin: string[]) => {
    for (const n of noeuds) {
      const etiquette = [n.code, n.designation].filter(Boolean).join(' — ');
      if (n.type === 'ouvrage') {
        const groupe = [
          plusieurs ? marche.code : null,
          ...chemin,
          // Une ligne de tête non vendable est un frais de chantier : le dire évite d'y imputer
          // par erreur des heures productives.
          chemin.length === 0 && !n.vendable ? 'Frais de chantier' : null,
        ].filter(Boolean).join(' · ');
        options.push({ id: n.id, label: etiquette, groupe: groupe || 'Ouvrages' });
      }
      if (n.children?.length) {
        parcourir(n.children, marche, n.type === 'titre' ? [...chemin, etiquette] : chemin);
      }
    }
  };

  for (const m of marches) parcourir(m.lines ?? [], m, []);
  return options;
}

/**
 * Choix d'un ouvrage d'imputation — TOUJOURS ceux de l'étude d'exécution du chantier.
 *
 * Les heures et le matériel s'imputent aux ouvrages réellement en exécution, jamais à une liste
 * tenue à part : c'est la seule façon de comparer, ouvrage par ouvrage, le prévu et le dépensé.
 * Pointages, relevés de matériel et lignes de commande lisent donc le même arbre, par ce
 * composant unique — trois lectures séparées avaient déjà divergé, et deux listaient un champ que
 * l'API ne renvoie pas : le menu restait vide sans rien dire.
 */
export function SelectOuvrage({
  chantierId, valeur, onChange, disabled = false, libelleVide = '— Non rattaché —',
}: {
  chantierId: string;
  valeur: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  libelleVide?: string;
}) {
  const { token } = useAuth();

  // Même clé de cache que les autres écrans du chantier : l'arbre n'est chargé qu'une fois, et
  // une modification de la structure rafraîchit tout le monde.
  const arbre = useQuery({
    queryKey: ['execution-tree', chantierId],
    enabled: Boolean(token && chantierId),
    retry: false,
    queryFn: () => apiFetch<ArbreExecution>(`/chantiers/${chantierId}/execution-tree`, { token }),
  });

  const options = useMemo(() => ouvragesDuChantier(arbre.data), [arbre.data]);
  const groupes = useMemo(() => {
    const carte = new Map<string, OptionOuvrage[]>();
    for (const o of options) {
      const liste = carte.get(o.groupe) ?? [];
      liste.push(o);
      carte.set(o.groupe, liste);
    }
    return [...carte.entries()];
  }, [options]);

  const aucun = options.length === 0;

  return (
    <>
      <select
        value={valeur}
        disabled={disabled || aucun}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{aucun ? 'Aucun ouvrage dans l’étude d’exécution' : libelleVide}</option>
        {groupes.map(([groupe, liste]) => (
          <optgroup key={groupe} label={groupe}>
            {liste.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </optgroup>
        ))}
      </select>
      {aucun && !arbre.isLoading && (
        <span className="muted" style={{ fontSize: 11 }}>
          Structurez le chantier pour imputer à un ouvrage.
        </span>
      )}
    </>
  );
}

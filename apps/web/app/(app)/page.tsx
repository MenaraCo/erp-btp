'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCapabilities } from '@/lib/capabilities';
import { AppModule, MODULES, moduleIsOpen } from '@/lib/modules';

/**
 * Menu de démarrage — la porte d'entrée de l'application.
 *
 * Une tuile par module. Celles que la société n'a pas souscrites restent VISIBLES mais grisées :
 * les masquer laisserait croire que la fonction n'existe pas, alors qu'elle s'ouvre d'un
 * abonnement. Un clic mène donc à l'écran Abonnement plutôt qu'à un accès refusé.
 */
export default function MenuDemarragePage() {
  const caps = useCapabilities();

  return (
    <div>
      <h1 style={{ marginBottom: 2 }}>Par où commencer&nbsp;?</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Choisissez un module. Vous retrouverez ce menu à tout moment depuis la barre de gauche.
      </p>

      <div style={grille}>
        {MODULES.map((m) => (
          <Tuile key={m.key} module={m} ouvert={caps.isLoading || moduleIsOpen(m, caps.has)} />
        ))}
      </div>
    </div>
  );
}

function Tuile({ module: m, ouvert }: { module: AppModule; ouvert: boolean }) {
  const router = useRouter();

  // Grisée : la tuile reste cliquable, mais elle mène à l'offre — pas à un mur.
  if (!ouvert) {
    return (
      <button
        type="button"
        className="tuile tuile-off"
        title={`${m.label} — module non souscrit`}
        onClick={() => router.push(`/abonnement?decouvrir=${m.key}`)}
      >
        <span className="tuile-titre">{m.label}</span>
        <span className="tuile-sub">{m.tagline}</span>
        <span className="tuile-badge">Non souscrit</span>
      </button>
    );
  }

  return (
    <Link href={m.home} className="tuile" title={m.label}>
      <span className="tuile-titre">{m.label}</span>
      <span className="tuile-sub">{m.tagline}</span>
    </Link>
  );
}

const grille: React.CSSProperties = {
  display: 'grid',
  gap: 14,
  marginTop: 20,
  gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
};

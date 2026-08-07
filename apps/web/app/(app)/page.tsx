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
        style={{ ...tuile, ...tuileGrisee }}
        title={`${m.label} — module non souscrit`}
        onClick={() => router.push(`/abonnement?decouvrir=${m.key}`)}
      >
        <span style={{ ...titre, color: '#94a3b8' }}>{m.label}</span>
        <span style={{ ...sousTitre, color: '#94a3b8' }}>{m.tagline}</span>
        <span style={badgeOffre}>Non souscrit</span>
      </button>
    );
  }

  return (
    <Link href={m.home} style={tuile} title={m.label}>
      <span style={titre}>{m.label}</span>
      <span style={sousTitre}>{m.tagline}</span>
    </Link>
  );
}

const grille: React.CSSProperties = {
  display: 'grid',
  gap: 14,
  marginTop: 20,
  gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
};

const tuile: React.CSSProperties = {
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  gap: 6,
  minHeight: 148,
  padding: '22px 24px',
  borderRadius: 10,
  background: 'var(--primary)',
  color: '#fff',
  textDecoration: 'none',
  border: 'none',
  textAlign: 'left',
  cursor: 'pointer',
  font: 'inherit',
};

const tuileGrisee: React.CSSProperties = {
  background: '#f1f5f9',
  border: '1px dashed var(--border)',
};

const titre: React.CSSProperties = {
  fontSize: 19,
  fontWeight: 700,
  letterSpacing: '-0.2px',
  lineHeight: 1.15,
};

const sousTitre: React.CSSProperties = {
  fontSize: 12,
  opacity: 0.85,
  lineHeight: 1.35,
};

const badgeOffre: React.CSSProperties = {
  position: 'absolute',
  top: 12,
  right: 14,
  fontSize: 9.5,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--accent)',
  border: '1px solid var(--accent)',
  borderRadius: 20,
  padding: '2px 8px',
};

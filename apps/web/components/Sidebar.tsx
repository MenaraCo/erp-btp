'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  LayoutDashboard, CalendarDays, FolderOpen, FileText, BookOpen,
  Layers, Package, Users, Truck, Building2, Receipt, Settings, HardHat,
  CreditCard, Gauge, ChevronsLeft, ChevronsRight, UserCog, Upload, ClipboardCheck,
  LayoutGrid, ArrowLeft, ArrowLeftRight,
} from 'lucide-react';
import { contextualGroups, moduleForPath, sortieDuModule } from '@/lib/modules';

const STORAGE_KEY = 'erp-sidebar-collapsed';

const NAV_ICONS: Record<string, React.ElementType> = {
  '/estimating/tableau-de-bord': LayoutDashboard,
  '/estimating/planning': CalendarDays,
  '/estimating': FolderOpen,
  '/estimating/devis': FileText,
  '/estimating/bibliotheque': BookOpen,
  '/estimating/bibliotheque/ouvrages': Layers,
  '/estimating/bibliotheque/ressources': Package,
  '/estimating/bibliotheque/transfert': ArrowLeftRight,
  '/estimating/imports': Upload,
  '/clients': Users,
  '/suppliers': Truck,
  '/acceptation': ClipboardCheck,
  '/direction': Gauge,
  '/chantiers': Building2,
  '/personnel': CalendarDays,
  '/personnel/planning': CalendarDays,
  '/personnel/conflits': ClipboardCheck,
  '/personnel/salaries': Users,
  '/chantiers/bibliotheque': BookOpen,
  '/invoicing': Receipt,
  '/estimating/parametres': Settings,
  '/chantiers/parametres': Settings,
  '/params': Settings,
  '/users': UserCog,
  '/abonnement': CreditCard,
};

/** Icônes du sous-menu contextuel, repérées par le dernier segment de l'URL. */
const CONTEXT_ICONS: Record<string, React.ElementType> = {
  '': Building2,
  structure: Layers,
  calendrier: CalendarDays,
  pointages: Users,
  'controle-heures': ClipboardCheck,
  achats: Truck,
  avancement: Gauge,
  mensuel: CalendarDays,
  pilotage: LayoutDashboard,
  situations: FileText,
  avenants: ClipboardCheck,
  dgd: Receipt,
};

/**
 * Une entrée est active quand la page courante lui appartient. Les cas particuliers viennent des
 * routes qui s'imbriquent : « Affaires » (/estimating) est le parent d'URL de presque tout le
 * module, il ne doit pas s'allumer quand on est sur le planning ou la bibliothèque.
 */
function isActive(href: string, pathname: string): boolean {
  const isDevisEditor = /^\/estimating\/[^/]+\/devis\/[^/]+/.test(pathname);
  if (href === '/estimating') {
    return (
      pathname === '/estimating' ||
      (pathname.startsWith('/estimating/') &&
        !isDevisEditor &&
        !pathname.startsWith('/estimating/tableau-de-bord') &&
        !pathname.startsWith('/estimating/planning') &&
        !pathname.startsWith('/estimating/devis') &&
        !pathname.startsWith('/estimating/bibliotheque') &&
        !pathname.startsWith('/estimating/imports') &&
        !pathname.startsWith('/estimating/parametres'))
    );
  }
  if (href === '/estimating/devis') {
    return pathname.startsWith('/estimating/devis') || isDevisEditor;
  }
  if (href === '/estimating/bibliotheque') {
    return pathname === '/estimating/bibliotheque';
  }
  // « Chantiers » désigne la LISTE. Dès qu'un chantier est ouvert, c'est le sous-menu
  // « Chantier ouvert » qui porte la position : garder les deux allumés brouillerait la lecture.
  if (href === '/chantiers') {
    return pathname === '/chantiers';
  }
  // Idem pour « Facturation » : la liste des marchés, pas le marché ouvert.
  if (href === '/invoicing') {
    return pathname === '/invoicing';
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Barre latérale PROPRE AU MODULE où l'on se trouve : on n'y voit que ses fonctions, plus un
 * retour au menu de démarrage. Un écran de chiffrage n'a pas à afficher les entrées de la
 * facturation ; le menu de démarrage, lui, montre la vue d'ensemble.
 */
export function Sidebar() {
  const pathname = usePathname();
  const courant = moduleForPath(pathname);
  const sortie = sortieDuModule(courant);
  const contextes = contextualGroups(pathname);
  const vueCourante = useSearchParams().get('vue');
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'true') setCollapsed(true);
  }, []);

  useEffect(() => {
    document.body.classList.toggle('sidebar-collapsed', collapsed);
    localStorage.setItem(STORAGE_KEY, String(collapsed));
  }, [collapsed]);

  return (
    <nav className="sidebar">
      {/* Brand — le sous-titre nomme le module courant, pour savoir où l'on est. */}
      <div className="brand">
        <div className="brand-logo">
          <HardHat size={17} color="#fff" />
        </div>
        <div className="brand-text">
          <span className="brand-name">ERP BTP</span>
          <span className="brand-sub">{courant?.label ?? 'Menu'}</span>
        </div>
      </div>

      {/*
        Retour — toujours en tête, c'est la sortie du module. Depuis un sous-module (Achats,
        Gestion du personnel), on remonte à SON espace plutôt qu'au menu de démarrage : sauter
        deux niveaux d'un coup ferait perdre le fil de là d'où l'on vient.
      */}
      <Link
        href={sortie}
        className={pathname === '/' ? 'active' : ''}
        title={sortie === '/' ? 'Revenir au menu de démarrage' : 'Revenir à l’espace Chantier'}
        style={{ marginBottom: 4 }}
      >
        {pathname === '/' ? <LayoutGrid size={13} /> : <ArrowLeft size={13} />}
        <span className="nav-label">
          {pathname === '/' ? 'Menu de démarrage' : sortie === '/' ? 'Menu' : 'Espace Chantier'}
        </span>
      </Link>

      {courant && (
        <>
          <div className="nav-section">{courant.label}</div>
          {courant.features.map((f) => {
            const active = isActive(f.href, pathname);
            const Icon = NAV_ICONS[f.href];
            return (
              <div key={f.href} className={f.level ? 'nav-sub' : ''}>
                <Link
                  href={f.href}
                  className={active ? 'active' : ''}
                  title={f.label}
                  style={f.level ? { paddingLeft: 22, fontSize: 10.5, color: active ? 'var(--primary)' : '#64748b' } : undefined}
                >
                  {Icon && <Icon size={f.level ? 11 : 13} />}
                  <span className="nav-label">{f.label}</span>
                </Link>
              </div>
            );
          })}
        </>
      )}

      {/* Sous-menu du chantier / marché ouvert : la navigation reste à gauche, jamais en haut
          de la page — sinon on perd de vue où l'on est. */}
      {contextes.map((contexte) => (
        <div key={contexte.title}>
          <div className="nav-section">{contexte.title}</div>
          {contexte.features.map((f) => {
            const [chemin, requete] = f.href.split('?');
            const vue = requete ? new URLSearchParams(requete).get('vue') : null;
            const dernier = vue ?? chemin.split('/').filter(Boolean).slice(2).join('/');
            const Icon = CONTEXT_ICONS[dernier] ?? FileText;
            // Une vue (?vue=) est active selon le paramètre ; « Situations » est la vue par défaut.
            const active = vue
              ? pathname === chemin && (vueCourante ?? 'situations') === vue
              : pathname === chemin;
            return (
              <div key={f.href} className="nav-sub">
                <Link
                  href={f.href}
                  className={active ? 'active' : ''}
                  title={f.label}
                  style={{ paddingLeft: 22, fontSize: 10.5 }}
                >
                  <Icon size={11} />
                  <span className="nav-label">{f.label}</span>
                </Link>
              </div>
            );
          })}
        </div>
      ))}

      {/* Collapse toggle */}
      <button
        type="button"
        className="sidebar-toggle"
        onClick={() => setCollapsed((v) => !v)}
        title={collapsed ? 'Agrandir le menu' : 'Réduire le menu'}
      >
        {collapsed ? <ChevronsRight size={14} /> : <ChevronsLeft size={14} />}
        <span className="nav-label">Réduire</span>
      </button>
    </nav>
  );
}

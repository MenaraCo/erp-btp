'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface NavItem {
  href: string;
  label: string;
  section: string;
}

const NAV: NavItem[] = [
  { href: '/', label: 'Tableau de bord', section: 'Général' },
  { href: '/directory', label: 'Clients & fournisseurs', section: 'Référentiel' },
  { href: '/estimating', label: 'Études de prix', section: 'Modules' },
  { href: '/chantiers', label: 'Chantiers', section: 'Modules' },
  { href: '/invoicing', label: 'Facturation', section: 'Modules' },
];

export function Sidebar() {
  const pathname = usePathname();
  let lastSection = '';

  return (
    <nav className="sidebar">
      <div className="brand">ERP BTP</div>
      {NAV.map((item) => {
        const showSection = item.section !== lastSection;
        lastSection = item.section;
        const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
        return (
          <div key={item.href}>
            {showSection && <div className="nav-section">{item.section}</div>}
            <Link href={item.href} className={active ? 'active' : ''}>
              {item.label}
            </Link>
          </div>
        );
      })}
    </nav>
  );
}

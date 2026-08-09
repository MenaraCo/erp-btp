'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { PrefsProvider } from '@/lib/preferences';
import { WorkspaceProvider } from '@/lib/workspace';
import { Sidebar } from '@/components/Sidebar';
import { Topbar } from '@/components/Topbar';
import { SplitLayout } from '@/components/SplitLayout';

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (!isAuthenticated) router.replace('/login');
  }, [isAuthenticated, router]);
  if (!isAuthenticated) return null;
  return <>{children}</>;
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // Le menu de démarrage (/) est un lanceur plein écran : pas de barre latérale, elle n'y sert à rien.
  const isMenu = pathname === '/';
  return (
    <PrefsProvider>
      <WorkspaceProvider>
        <AuthGuard>
          <div className={`app-shell${isMenu ? ' app-shell--menu' : ''}`}>
            {!isMenu && <Sidebar />}
            <Topbar />
            <SplitLayout>{children}</SplitLayout>
          </div>
        </AuthGuard>
      </WorkspaceProvider>
    </PrefsProvider>
  );
}

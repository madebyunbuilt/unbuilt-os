import { ConvexProvider } from '@/components/app/convex-provider';
import { NoAccess } from '@/components/app/no-access';
import { ServiceWorker } from '@/components/app/service-worker';
import { SessionBoundary } from '@/components/app/session-boundary';
import { AppShell } from '@/components/app/shell/app-shell';
import { authServer } from '@/lib/auth-server';
import { requireViewer } from '@/lib/viewer';

export default async function TeamLayout({ children }: LayoutProps<'/'>) {
  const { viewer, allowed } = await requireViewer('team');
  if (!allowed) return <NoAccess surface="team" viewer={viewer} />;
  return (
    <ConvexProvider initialToken={await authServer().getToken()}>
      <SessionBoundary>
        <AppShell
          surface="team"
          user={{
            name: viewer.principal?.name ?? viewer.email,
            email: viewer.email,
            roleName: viewer.principal?.roleName ?? '',
          }}
          permissions={viewer.permissions}
        >
          {children}
        </AppShell>
      </SessionBoundary>
      <ServiceWorker />
    </ConvexProvider>
  );
}

import { ConvexProvider } from '@/components/app/convex-provider';
import { NoAccess } from '@/components/app/no-access';
import { ServiceWorker } from '@/components/app/service-worker';
import { SessionBoundary } from '@/components/app/session-boundary';
import { AppShell } from '@/components/app/shell/app-shell';
import { authServer } from '@/lib/auth-server';
import { requireViewer } from '@/lib/viewer';

// Client portal pages. proxy.ts rewrites the portal host into /portal and returns 404 for /portal on the team host.
export default async function PortalLayout({ children }: LayoutProps<'/portal'>) {
  const { viewer, allowed } = await requireViewer('portal');
  if (!allowed) return <NoAccess surface="portal" viewer={viewer} />;
  return (
    <ConvexProvider initialToken={await authServer().getToken()}>
      <SessionBoundary>
        <AppShell
          surface="portal"
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

import { ConvexProvider } from '@/components/app/convex-provider';
import { NoAccess } from '@/components/app/no-access';
import { authServer } from '@/lib/auth-server';
import { requireViewer } from '@/lib/viewer';

export default async function TeamLayout({ children }: LayoutProps<'/'>) {
  const { viewer, allowed } = await requireViewer('team');
  if (!allowed) return <NoAccess surface="team" viewer={viewer} />;
  return <ConvexProvider initialToken={await authServer().getToken()}>{children}</ConvexProvider>;
}

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { TwoFactorSetup } from '@/components/auth/two-factor-setup';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Set up two-factor authentication' };

/** Team members only (the portal host never reaches this path). The one screen a team member without 2FA can use. */
export default async function TwoFactorSetupPage() {
  const viewer = await getViewer();
  if (!viewer) redirect('/sign-in?callbackURL=%2Fsetup%2Ftwo-factor');
  if (!viewer.needsTwoFactorSetup) redirect('/');
  return <TwoFactorSetup email={viewer.email} />;
}

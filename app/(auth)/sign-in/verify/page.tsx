import type { Metadata } from 'next';
import { VerifyForm } from '@/components/auth/verify-form';
import { safeCallbackURL } from '@/lib/auth-urls';

export const metadata: Metadata = { title: 'Confirm it’s you' };

export default async function VerifyPage({ searchParams }: PageProps<'/sign-in/verify'>) {
  const params = await searchParams;
  const method = params.method === 'otp' ? 'otp' : 'totp';
  return <VerifyForm method={method} callbackURL={safeCallbackURL(params.callbackURL)} />;
}

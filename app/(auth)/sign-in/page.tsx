import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { SignInForm } from '@/components/auth/sign-in-form';
import { safeCallbackURL, signInErrorMessage } from '@/lib/auth-urls';
import { currentSurface, getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Sign in' };

export default async function SignInPage({ searchParams }: PageProps<'/sign-in'>) {
  const params = await searchParams;
  const callbackURL = safeCallbackURL(params.callbackURL);
  const error = signInErrorMessage(params.error);

  if (!error && (await getViewer())?.principal) redirect(callbackURL);

  return <SignInForm surface={await currentSurface()} callbackURL={callbackURL} initialError={error} />;
}

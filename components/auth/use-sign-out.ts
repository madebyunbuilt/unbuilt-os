'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { authClient } from '@/lib/auth-client';

export function useSignOut() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const signOut = useCallback(async () => {
    setPending(true);
    await authClient.signOut();
    router.replace('/sign-in');
    router.refresh();
  }, [router]);
  return { signOut, pending };
}

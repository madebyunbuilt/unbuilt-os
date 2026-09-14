'use client';

import { useSignOut } from '@/components/auth/use-sign-out';
import { Button } from '@/components/ui/button';

export function SignOutButton({ variant = 'outline' }: { variant?: 'outline' | 'default' | 'ghost' }) {
  const { signOut, pending } = useSignOut();
  return (
    <Button variant={variant} disabled={pending} onClick={() => void signOut()}>
      {pending ? 'Signing out…' : 'Sign out'}
    </Button>
  );
}

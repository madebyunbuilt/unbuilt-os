'use client';

import { useMutation, useQuery } from 'convex/react';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { MemberAvatar } from '@/components/team/member-avatar';
import { OnboardingChecklist } from '@/components/team/onboarding-checklist';
import { ProfileForm } from '@/components/team/profile-form';
import { RatesForm } from '@/components/team/rates-form';
import { StatusBadge } from '@/components/team/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { errorMessage } from '@/lib/convex-error';

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-4 border-t pt-8">
      <h2 id={id} className="font-display text-xl font-bold">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function MemberProfile({ memberId, permissions }: { memberId: Id<'teamMembers'>; permissions: string[] }) {
  const router = useRouter();
  const member = useQuery(api.team.get, { memberId });
  const me = useQuery(api.team.me);
  const canManage = permissions.includes('team.manage');
  const canTransfer = permissions.includes('owner.transfer') && me?.role?.isOwner === true;

  if (member === undefined || me === undefined) return <p className="text-muted-foreground">Loading…</p>;

  const isSelf = me.id === member.id;
  const targetIsOwner = member.role?.isOwner === true;
  const canChangeAccess = canManage && !isSelf && !targetIsOwner;

  return (
    <div className="space-y-8">
      <Link
        href="/team"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-4" />
        Team
      </Link>

      <header className="flex flex-wrap items-center gap-4">
        <MemberAvatar name={member.name} avatarFileId={member.avatarFileId} size="lg" />
        <div className="min-w-0">
          <h1 className="font-display text-3xl font-bold">{member.name}</h1>
          <p className="text-muted-foreground">
            {[member.title, member.role?.name, member.email].filter(Boolean).join(' · ')}
          </p>
        </div>
        <div className="flex items-center gap-2 sm:ml-auto">
          <StatusBadge member={member} />
          {member.status === 'active' && !member.twoFactorEnabled && (
            <span className="rounded-full bg-attention px-2 py-0.5 text-xs font-medium text-attention-foreground">
              2FA not set up
            </span>
          )}
        </div>
      </header>

      {member.status === 'invited' && canManage && (
        <InvitationActions
          memberId={member.id}
          expired={member.invite === 'expired'}
          expiresAt={member.inviteExpiresAt}
          lastSentAt={member.inviteLastSentAt}
          onCancelled={() => router.push('/team')}
          cancellable={!targetIsOwner}
        />
      )}

      <Section id="profile-heading" title="Profile">
        <ProfileForm member={member} editable={canManage} />
      </Section>

      {member.rates && (
        <Section id="rates-heading" title="Rates">
          <RatesForm memberId={member.id} rates={member.rates} />
        </Section>
      )}

      {member.onboarding && (
        <Section id="onboarding-heading" title="Onboarding">
          <OnboardingChecklist memberId={member.id} items={member.onboarding.items} editable={canManage} />
        </Section>
      )}

      {canChangeAccess && member.status !== 'offboarded' && (
        <Section id="access-heading" title="Access">
          <AccessActions member={member} />
        </Section>
      )}

      {canTransfer && !isSelf && member.status === 'active' && (
        <Section id="ownership-heading" title="Ownership">
          <TransferOwnership memberId={member.id} name={member.name} twoFactorEnabled={member.twoFactorEnabled} />
        </Section>
      )}
    </div>
  );
}

function InvitationActions({
  memberId,
  expired,
  expiresAt,
  lastSentAt,
  cancellable,
  onCancelled,
}: {
  memberId: Id<'teamMembers'>;
  expired: boolean;
  expiresAt?: number;
  lastSentAt?: number;
  cancellable: boolean;
  onCancelled: () => void;
}) {
  const resend = useMutation(api.team.resendInvite);
  const cancel = useMutation(api.team.cancelInvite);
  const [status, setStatus] = useState<string | null>(null);
  const format = (at: number) =>
    new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(at);

  return (
    <div className={expired ? 'rounded-lg bg-attention p-4 text-attention-foreground' : 'rounded-lg border p-4'}>
      <p className="font-medium">{expired ? 'This invitation has expired.' : 'Waiting for them to accept.'}</p>
      <p className="mt-1 text-sm">
        {lastSentAt ? `Last sent ${format(lastSentAt)}. ` : 'The email has not been sent yet. '}
        {expiresAt && !expired ? `Expires ${format(expiresAt)}.` : ''}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          variant={expired ? 'default' : 'outline'}
          onClick={async () => {
            try {
              await resend({ memberId });
              setStatus('Invitation sent again. It is valid for 14 days.');
            } catch (error) {
              setStatus(errorMessage(error));
            }
          }}
        >
          Resend invitation
        </Button>
        {cancellable && (
          <ConfirmDialog
            trigger={<Button variant="ghost">Cancel invitation</Button>}
            title="Cancel this invitation?"
            description="The invitation link stops working and they are removed from the team list."
            confirmLabel="Cancel invitation"
            onConfirm={async () => {
              await cancel({ memberId });
              onCancelled();
            }}
          />
        )}
      </div>
      <p aria-live="polite" className="mt-2 text-sm">
        {status}
      </p>
    </div>
  );
}

function AccessActions({
  member,
}: {
  member: { id: Id<'teamMembers'>; name: string; status: string; role: { id: Id<'roles'>; name: string } | null };
}) {
  const roles = useQuery(api.team.assignableRoles);
  const changeRole = useMutation(api.team.changeRole);
  const suspend = useMutation(api.team.suspend);
  const reactivate = useMutation(api.team.reactivate);
  const offboard = useMutation(api.team.offboard);
  const [roleId, setRoleId] = useState<string>(member.role?.id ?? '');
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const roleAssignable = roles?.some((role) => role.id === member.role?.id) ?? false;
  const invited = member.status === 'invited';

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="space-y-2 sm:w-72">
          <Label htmlFor="member-role">Role</Label>
          <NativeSelect
            id="member-role"
            value={roleId}
            onChange={(event) => setRoleId(event.target.value)}
            disabled={!roles || !roleAssignable}
          >
            {member.role && !roleAssignable && <option value={member.role.id}>{member.role.name}</option>}
            {roles?.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button
          variant="outline"
          disabled={!roleAssignable || roleId === member.role?.id}
          onClick={async () => {
            try {
              await changeRole({ memberId: member.id, roleId: roleId as Id<'roles'> });
              setMessage({
                ok: true,
                text: invited
                  ? 'Role changed. The email they already have names the old role; resend the invitation to update it.'
                  : 'Role changed.',
              });
            } catch (error) {
              setMessage({ ok: false, text: errorMessage(error) });
            }
          }}
        >
          Change role
        </Button>
      </div>
      {roles && !roleAssignable && (
        <p className="text-sm text-muted-foreground">
          Their role has permissions you do not hold, so you cannot change it.
        </p>
      )}
      <p
        aria-live="polite"
        role={message && !message.ok ? 'alert' : undefined}
        className={message?.ok ? 'text-sm' : 'text-sm text-destructive'}
      >
        {message?.text}
      </p>

      {invited ? (
        <p className="text-sm text-muted-foreground">
          Suspending and offboarding are available once they accept. To stop them joining, cancel the invitation.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {member.status === 'active' ? (
            <ConfirmDialog
              trigger={<Button variant="outline">Suspend</Button>}
              title={`Suspend ${member.name}?`}
              description="They are signed out everywhere at once and cannot sign in until reactivated. Nothing is deleted."
              confirmLabel="Suspend"
              onConfirm={() => suspend({ memberId: member.id })}
            />
          ) : (
            <Button variant="outline" onClick={() => void reactivate({ memberId: member.id })}>
              Reactivate
            </Button>
          )}
          <ConfirmDialog
            trigger={<Button variant="destructive">Offboard</Button>}
            title={`Offboard ${member.name}?`}
            description="They are signed out everywhere at once and lose access for good. Their history stays attributed to them."
            confirmLabel="Offboard"
            canConfirm={/^\d{4}-\d{2}-\d{2}$/.test(endDate)}
            onConfirm={() => offboard({ memberId: member.id, endDate })}
          >
            <div className="space-y-2">
              <Label htmlFor="offboard-end-date">Last day</Label>
              <Input
                id="offboard-end-date"
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
              />
            </div>
          </ConfirmDialog>
        </div>
      )}
    </div>
  );
}

function TransferOwnership({
  memberId,
  name,
  twoFactorEnabled,
}: {
  memberId: Id<'teamMembers'>;
  name: string;
  twoFactorEnabled: boolean;
}) {
  const transfer = useMutation(api.team.transferOwnership);
  const router = useRouter();
  const [confirmation, setConfirmation] = useState('');

  if (!twoFactorEnabled) {
    return (
      <p className="text-sm text-muted-foreground">
        {name} must set up two-factor authentication before they can become Owner.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      <p className="max-w-prose text-sm text-muted-foreground">
        There is one Owner. Transferring makes {name} the Owner and makes you an Admin.
      </p>
      <ConfirmDialog
        trigger={<Button variant="outline">Transfer ownership to {name}</Button>}
        title="Transfer ownership?"
        description={
          <>
            {name} becomes the Owner and you become an Admin. Only the new Owner can give ownership back. Type{' '}
            <strong>{name}</strong> to confirm.
          </>
        }
        confirmLabel="Transfer ownership"
        canConfirm={confirmation.trim() === name}
        onConfirm={async () => {
          await transfer({ toMemberId: memberId });
          router.refresh();
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="transfer-confirmation">Their name</Label>
          <Input
            id="transfer-confirmation"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            autoComplete="off"
          />
        </div>
      </ConfirmDialog>
    </div>
  );
}

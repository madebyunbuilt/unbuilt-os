'use client';

import { useMutation, useQuery } from 'convex/react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ImageUploadField, uploadToStorage } from '@/components/app/image-upload-field';
import { SaveStatus } from '@/components/settings/form-field';
import { MemberAvatar } from '@/components/team/member-avatar';
import { OnboardingChecklist } from '@/components/team/onboarding-checklist';
import { splitSkills } from '@/components/team/profile-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { errorMessage } from '@/lib/convex-error';

/** Your own profile: photo and the contact details you keep up to date yourself. */
export function MyProfile() {
  const me = useQuery(api.team.me);
  if (!me) return <p className="text-muted-foreground">Loading…</p>;
  return <MyProfileForm key={me.id} me={me} />;
}

function MyProfileForm({ me }: { me: NonNullable<typeof api.team.me._returnType> }) {
  const generateUploadUrl = useMutation(api.team.generateAvatarUploadUrl);
  const setAvatar = useMutation(api.team.setAvatar);
  const removeAvatar = useMutation(api.team.removeAvatar);
  const update = useMutation(api.team.updateMyProfile);
  const timezones = useMemo(() => Intl.supportedValuesOf('timeZone'), []);
  const [phone, setPhone] = useState(me.phone ?? '');
  const [whatsapp, setWhatsapp] = useState(me.whatsapp ?? '');
  const [timezone, setTimezone] = useState(me.timezone);
  const [skills, setSkills] = useState(me.skills.join(', '));
  const [status, setStatus] = useState<{ kind: 'idle' } | { kind: 'saved' } | { kind: 'error'; message: string }>({
    kind: 'idle',
  });

  async function save() {
    setStatus({ kind: 'idle' });
    try {
      await update({
        phone: phone || undefined,
        whatsapp: whatsapp || undefined,
        timezone,
        skills: splitSkills(skills),
      });
      setStatus({ kind: 'saved' });
    } catch (error) {
      setStatus({ kind: 'error', message: errorMessage(error) });
    }
  }

  return (
    <div className="space-y-10">
      <header className="flex flex-wrap items-start gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-3xl font-bold">{me.name}</h1>
          <p className="text-muted-foreground">{[me.title, me.role?.name, me.email].filter(Boolean).join(' · ')}</p>
        </div>
        <Link href="/team/time-off" className="text-sm underline underline-offset-4 sm:ml-auto">
          Time off
        </Link>
      </header>

      <section aria-labelledby="photo-heading" className="space-y-4">
        <h2 id="photo-heading" className="font-display text-xl font-bold">
          Photo
        </h2>
        <ImageUploadField
          label="Profile photo"
          help="A square image works best. Up to 10 MB."
          doneMessage="Photo updated."
          hasImage={!!me.avatarFileId}
          preview={<MemberAvatar name={me.name} avatarFileId={me.avatarFileId} size="lg" />}
          upload={async (file) => {
            const storageId = await uploadToStorage(await generateUploadUrl({}), file);
            const result = await setAvatar({
              memberId: me.id,
              storageId: storageId as Id<'_storage'>,
              name: file.name,
              contentType: file.type,
            });
            return result.ok ? { ok: true } : { ok: false, message: result.message };
          }}
          remove={async () => {
            await removeAvatar({ memberId: me.id });
          }}
        />
      </section>

      <section aria-labelledby="contact-heading" className="space-y-4">
        <h2 id="contact-heading" className="font-display text-xl font-bold">
          Contact details
        </h2>
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="me-phone">Phone</Label>
            <Input id="me-phone" type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="me-whatsapp">WhatsApp</Label>
            <Input id="me-whatsapp" type="tel" value={whatsapp} onChange={(event) => setWhatsapp(event.target.value)} />
            <p className="text-sm text-muted-foreground">International format, such as +2348012345678</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="me-timezone">Timezone</Label>
            <NativeSelect id="me-timezone" value={timezone} onChange={(event) => setTimezone(event.target.value)}>
              {timezones.map((zone) => (
                <option key={zone} value={zone}>
                  {zone.replaceAll('_', ' ')}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-2">
            <Label htmlFor="me-skills">Skills</Label>
            <Input id="me-skills" value={skills} onChange={(event) => setSkills(event.target.value)} />
            <p className="text-sm text-muted-foreground">Separate with commas</p>
          </div>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button onClick={() => void save()}>Save details</Button>
          <SaveStatus state={status} />
        </div>
      </section>

      {me.onboarding && (
        <section aria-labelledby="my-onboarding-heading" className="space-y-4">
          <h2 id="my-onboarding-heading" className="font-display text-xl font-bold">
            Onboarding
          </h2>
          <OnboardingChecklist memberId={me.id} items={me.onboarding.items} editable={false} />
        </section>
      )}
    </div>
  );
}

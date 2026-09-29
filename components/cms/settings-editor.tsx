'use client';

import { useMutation, useQuery } from 'convex/react';
import { Plus, Save, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/convex/_generated/api';
import { errorMessage } from '@/lib/convex-error';

// The website's own details (13-cms-and-website.md). Also where the deploy window lives, because how long publishing
// waits before rebuilding is a studio preference rather than a rule.

type Settings = NonNullable<typeof api.cms.settings._returnType>;

export function SettingsEditor({ canManage }: { canManage: boolean }) {
  const settings = useQuery(api.cms.settings, {});
  const update = useMutation(api.cms.updateSettings);
  const setBatch = useMutation(api.cmsPublish.setDeployBatchSeconds);

  const [draft, setDraft] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (settings === undefined) return <p className="text-muted-foreground">Loading…</p>;
  if (settings === null) {
    return (
      <p className="rounded-md border border-dashed p-6 text-muted-foreground">
        Site settings have not been set up on this deployment.
      </p>
    );
  }

  const current = draft ?? settings;
  const set = (changes: Partial<Settings>) => setDraft({ ...current, ...changes });

  return (
    <div className="space-y-8">
      <section className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="site-name">Name</Label>
          <Input
            id="site-name"
            disabled={!canManage}
            value={current.name}
            onChange={(event) => set({ name: event.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="site-url">Address</Label>
          <Input
            id="site-url"
            disabled={!canManage}
            value={current.url}
            onChange={(event) => set({ url: event.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="site-email">Email</Label>
          <Input
            id="site-email"
            disabled={!canManage}
            value={current.email}
            onChange={(event) => set({ email: event.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="site-phone">Phone</Label>
          <Input
            id="site-phone"
            disabled={!canManage}
            value={current.phone}
            onChange={(event) => set({ phone: event.target.value })}
          />
        </div>
      </section>

      <section className="space-y-2">
        <Label htmlFor="site-status">Status line</Label>
        <Input
          id="site-status"
          disabled={!canManage}
          value={current.statusText}
          onChange={(event) => set({ statusText: event.target.value })}
        />
        <p className="text-sm text-muted-foreground">Such as “Taking new work”. It shows on every page.</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Where else Unbuilt is</h2>
        {current.socials.map((social, index) => (
          <div key={index} className="flex flex-wrap gap-2">
            <Input
              aria-label={`Name ${index + 1}`}
              className="sm:max-w-40"
              disabled={!canManage}
              value={social.name}
              onChange={(event) =>
                set({
                  socials: current.socials.map((row, at) =>
                    at === index ? { ...row, name: event.target.value } : row,
                  ),
                })
              }
            />
            <Input
              aria-label={`Handle ${index + 1}`}
              className="sm:max-w-40"
              disabled={!canManage}
              value={social.handle}
              onChange={(event) =>
                set({
                  socials: current.socials.map((row, at) =>
                    at === index ? { ...row, handle: event.target.value } : row,
                  ),
                })
              }
            />
            <Input
              aria-label={`Link ${index + 1}`}
              className="flex-1"
              disabled={!canManage}
              value={social.href}
              onChange={(event) =>
                set({
                  socials: current.socials.map((row, at) =>
                    at === index ? { ...row, href: event.target.value } : row,
                  ),
                })
              }
            />
            {canManage && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove ${index + 1}`}
                onClick={() => set({ socials: current.socials.filter((_, at) => at !== index) })}
              >
                <Trash2 aria-hidden />
              </Button>
            )}
          </div>
        ))}
        {canManage && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => set({ socials: [...current.socials, { name: '', handle: '', href: '' }] })}
          >
            <Plus aria-hidden />
            Add one
          </Button>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-medium">How it reads in search, by default</h2>
        <div className="space-y-2">
          <Label htmlFor="seo-default-title">Title</Label>
          <Input
            id="seo-default-title"
            disabled={!canManage}
            value={current.seoDefaults.title}
            onChange={(event) => set({ seoDefaults: { ...current.seoDefaults, title: event.target.value } })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="seo-default-description">Description</Label>
          <Textarea
            id="seo-default-description"
            rows={3}
            disabled={!canManage}
            value={current.seoDefaults.description}
            onChange={(event) => set({ seoDefaults: { ...current.seoDefaults, description: event.target.value } })}
          />
        </div>
      </section>

      {canManage && (
        <section className="space-y-2">
          <Label htmlFor="deploy-window">Wait before rebuilding</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id="deploy-window"
              type="number"
              className="max-w-28"
              min={5}
              max={900}
              defaultValue={current.deployBatchSeconds ?? 60}
              onBlur={(event) => void setBatch({ seconds: Number(event.target.value) })}
            />
            <span className="text-sm text-muted-foreground">seconds</span>
          </div>
          {/* The reason for a wait at all, so the number is not mistaken for a delay somebody should minimise. */}
          <p className="text-sm text-muted-foreground">
            Publishing waits this long so a run of changes becomes one rebuild instead of one each. Longer batches
            better; shorter puts changes on the website sooner. Between 5 seconds and 15 minutes.
          </p>
        </section>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {canManage && (
        <div className="border-t pt-6">
          <Button
            type="button"
            disabled={saving || draft === null}
            onClick={async () => {
              setSaving(true);
              setError(null);
              try {
                await update({
                  name: current.name,
                  url: current.url,
                  email: current.email,
                  phone: current.phone,
                  socials: current.socials,
                  timeZone: current.timeZone,
                  statusText: current.statusText,
                  seoDefaults: current.seoDefaults,
                });
                setDraft(null);
              } catch (caught) {
                setError(errorMessage(caught));
              } finally {
                setSaving(false);
              }
            }}
          >
            <Save aria-hidden />
            {saving ? 'Saving…' : draft === null ? 'Saved' : 'Save'}
          </Button>
        </div>
      )}
    </div>
  );
}

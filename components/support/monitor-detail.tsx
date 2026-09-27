'use client';

import { useMutation, useQuery } from 'convex/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { FormDialog } from '@/components/app/form-dialog';
import { ToneBadge } from '@/components/team/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Switch } from '@/components/ui/switch';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { errorMessage } from '@/lib/convex-error';
import { ago, formatMoment, type MonitorStatus, monitorStatus, uptime } from '@/lib/support-display';
import { useNow } from '@/lib/use-now';

type Monitor = NonNullable<typeof api.monitors.get._returnType>;

/** Changing what is watched and how often, without losing the history of what it found. */
function EditMonitor({ monitor }: { monitor: Monitor }) {
  const update = useMutation(api.monitors.update);
  const projects = useQuery(api.projects.list, { clientId: monitor.clientId as Id<'clients'> });
  const [name, setName] = useState(monitor.name);
  const [url, setUrl] = useState(monitor.url);
  const [projectId, setProjectId] = useState(monitor.projectId ?? '');
  const [method, setMethod] = useState(monitor.method);
  const [expectedStatus, setExpectedStatus] = useState(String(monitor.expectedStatus));
  const [intervalMinutes, setIntervalMinutes] = useState(String(monitor.intervalMinutes));
  const [timeoutSeconds, setTimeoutSeconds] = useState(String(Math.round(monitor.timeoutMs / 1000)));
  const [production, setProduction] = useState(monitor.production);

  return (
    <FormDialog
      trigger={<Button variant="outline">Change</Button>}
      title={`Change ${monitor.name}`}
      description="The checks already made are kept, so the uptime figure carries on rather than starting again. A different site needs its own monitor."
      submitLabel="Save"
      canSubmit={name.trim().length > 0 && url.trim().length > 0}
      onSubmit={() =>
        update({
          monitorId: monitor.id,
          projectId: projectId ? (projectId as Id<'projects'>) : undefined,
          name,
          url,
          method,
          expectedStatus: Number(expectedStatus),
          intervalMinutes: Number(intervalMinutes),
          timeoutMs: Number(timeoutSeconds) * 1000,
          production,
        })
      }
    >
      <div className="space-y-2">
        <Label htmlFor="edit-monitor-name">What to call it</Label>
        <Input id="edit-monitor-name" value={name} onChange={(event) => setName(event.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="edit-monitor-url">Address</Label>
        <Input id="edit-monitor-url" value={url} onChange={(event) => setUrl(event.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="edit-monitor-project">Project</Label>
        <NativeSelect
          id="edit-monitor-project"
          value={projectId}
          onChange={(event) => setProjectId(event.target.value)}
        >
          <option value="">No particular project</option>
          {(projects ?? []).map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="edit-monitor-interval">How often</Label>
          <NativeSelect
            id="edit-monitor-interval"
            value={intervalMinutes}
            onChange={(event) => setIntervalMinutes(event.target.value)}
          >
            <option value="1">Every minute</option>
            <option value="5">Every 5 minutes</option>
            <option value="15">Every 15 minutes</option>
            <option value="30">Every 30 minutes</option>
            <option value="60">Every hour</option>
          </NativeSelect>
        </div>
        <div className="space-y-2">
          <Label htmlFor="edit-monitor-timeout">Seconds to answer</Label>
          <Input
            id="edit-monitor-timeout"
            type="number"
            min={1}
            max={60}
            value={timeoutSeconds}
            onChange={(event) => setTimeoutSeconds(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="edit-monitor-method">How to ask</Label>
          <NativeSelect
            id="edit-monitor-method"
            value={method}
            onChange={(event) => setMethod(event.target.value as 'GET' | 'HEAD')}
          >
            <option value="GET">Fetch the page (GET)</option>
            <option value="HEAD">Only ask if it answers (HEAD)</option>
          </NativeSelect>
          <p className="text-xs text-muted-foreground">
            Asking only is lighter on the client&rsquo;s server, but some servers refuse it and look down when they are
            not.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="edit-monitor-status">Answer that means healthy</Label>
          <Input
            id="edit-monitor-status"
            type="number"
            value={expectedStatus}
            onChange={(event) => setExpectedStatus(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            200 for a normal page. Use 204 for a health check that returns nothing, or 301 if the address redirects.
            Anything else counts as a failure.
          </p>
        </div>
      </div>
      <div className="flex items-start justify-between gap-3 rounded-md border p-3">
        <div>
          <Label htmlFor="edit-monitor-production">This is the live site</Label>
          <p className="text-xs text-muted-foreground">A live site going down raises a P1 rather than a P2.</p>
        </div>
        <Switch id="edit-monitor-production" checked={production} onCheckedChange={setProduction} />
      </div>
    </FormDialog>
  );
}

// One monitor (09-support-and-sla.md). What it is watching, whether it answered, and what happened the last time it
// did not — with the ticket each incident raised, because that is where the work of fixing it lives.

export function MonitorDetail({ monitorId }: { monitorId: Id<'monitors'> }) {
  const monitor = useQuery(api.monitors.get, { monitorId });
  const setPaused = useMutation(api.monitors.setPaused);
  const remove = useMutation(api.monitors.remove);
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const now = useNow();

  if (monitor === undefined) return <p className="text-muted-foreground">Loading…</p>;
  if (monitor === null) {
    return (
      <div className="space-y-3">
        <Link href="/support/monitors" className="text-sm underline">
          ← Monitors
        </Link>
        <p className="rounded-md border border-dashed p-6 text-muted-foreground">That monitor is not here.</p>
      </div>
    );
  }

  const run = async (work: Promise<unknown>) => {
    setError(null);
    try {
      await work;
    } catch (caught) {
      setError(errorMessage(caught));
      throw caught;
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <Link href="/support/monitors" className="text-sm underline">
          ← Monitors
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display text-3xl font-bold">{monitor.name}</h1>
            <p className="mt-1 truncate text-muted-foreground">
              {monitor.clientName} ·{' '}
              <a href={monitor.url} target="_blank" rel="noreferrer" className="underline">
                {monitor.url}
              </a>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {monitor.production && <ToneBadge label="Live site" tone="draft" />}
            <ToneBadge {...monitorStatus(monitor.status as MonitorStatus)} />
          </div>
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-md border border-destructive/50 p-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <dl className="grid gap-4 rounded-lg border p-4 sm:grid-cols-3">
        <div>
          <dt className="text-xs text-muted-foreground">Uptime, last 30 days</dt>
          <dd className="mt-1 text-lg font-medium tabular-nums">{uptime(monitor.uptimeBps)}</dd>
          <dd className="text-xs text-muted-foreground">
            {monitor.checksInWindow} check{monitor.checksInWindow === 1 ? '' : 's'}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Last checked</dt>
          <dd className="mt-1 text-lg font-medium">{ago(monitor.lastCheckedAt, now)}</dd>
          <dd className="text-xs text-muted-foreground">
            {monitor.status === 'paused' ? 'Not being checked' : `Every ${monitor.intervalMinutes} minutes`}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Healthy answer</dt>
          <dd className="mt-1 text-lg font-medium tabular-nums">{monitor.expectedStatus}</dd>
          <dd className="text-xs text-muted-foreground">
            {monitor.method === 'HEAD' ? 'Asks only' : 'Fetches the page'} · {Math.round(monitor.timeoutMs / 1000)}s to
            answer
          </dd>
        </div>
      </dl>

      <div className="flex flex-wrap gap-2">
        <EditMonitor monitor={monitor} />
        <Button
          variant="outline"
          onClick={() => void run(setPaused({ monitorId, paused: monitor.status !== 'paused' }))}
        >
          {monitor.status === 'paused' ? 'Start checking' : 'Stop checking'}
        </Button>
        <ConfirmDialog
          trigger={<Button variant="outline">Remove</Button>}
          title={`Remove ${monitor.name}`}
          description="Unbuilt stops checking it, and its check history goes too. Any tickets it raised stay."
          confirmLabel="Remove"
          onConfirm={async () => {
            await run(remove({ monitorId }));
            router.push('/support/monitors');
          }}
        />
      </div>

      <section aria-labelledby="incidents" className="space-y-3">
        <h2 id="incidents" className="font-display text-xl font-bold">
          When it was down
        </h2>
        {monitor.incidents.length === 0 ? (
          <p className="rounded-md border border-dashed p-6 text-muted-foreground">
            It has not gone down since Unbuilt started watching.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {monitor.incidents.map((incident) => (
              <li key={incident.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="font-medium">{incident.summary}</p>
                  <p className="text-sm text-muted-foreground">
                    {formatMoment(incident.startedAt)}
                    {incident.resolvedAt
                      ? ` · back after ${Math.max(1, Math.round((incident.resolvedAt - incident.startedAt) / 60_000))} min`
                      : ' · still down'}
                  </p>
                </div>
                {incident.ticketId && (
                  <Link href={`/support/tickets/${incident.ticketId}`} className="text-sm underline">
                    Its ticket
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="checks" className="space-y-3">
        <h2 id="checks" className="font-display text-xl font-bold">
          Recent checks
        </h2>
        {monitor.checks.length === 0 ? (
          <p className="rounded-md border border-dashed p-6 text-muted-foreground">
            Nothing yet. The first check happens within {monitor.intervalMinutes} minutes of starting.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border text-sm">
            {monitor.checks.map((check) => (
              <li key={check.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                <span className="tabular-nums">{formatMoment(check.checkedAt)}</span>
                <span className="text-muted-foreground">
                  {check.ok
                    ? `${check.statusCode ?? 'answered'}${check.latencyMs === undefined ? '' : ` in ${check.latencyMs} ms`}`
                    : (check.error ?? `returned ${check.statusCode ?? 'nothing'}`)}
                </span>
                <ToneBadge {...(check.ok ? { label: 'OK', tone: 'built' } : { label: 'Failed', tone: 'attention' })} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

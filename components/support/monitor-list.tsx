'use client';

import { useMutation, useQuery } from 'convex/react';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { FormDialog } from '@/components/app/form-dialog';
import { ToneBadge } from '@/components/team/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Switch } from '@/components/ui/switch';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { ago, type MonitorStatus, monitorStatus } from '@/lib/support-display';
import { useNow } from '@/lib/use-now';

// Uptime monitors (09-support-and-sla.md). Whatever is down comes first: a list that ordered by name would bury the
// one thing on the page that needs somebody.

function NewMonitor() {
  const create = useMutation(api.monitors.create);
  const clients = useQuery(api.clients.list, {});
  const [clientId, setClientId] = useState('');
  const projects = useQuery(api.projects.list, clientId ? { clientId: clientId as Id<'clients'> } : 'skip');
  const [projectId, setProjectId] = useState('');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [production, setProduction] = useState(true);
  const [intervalMinutes, setIntervalMinutes] = useState('5');

  return (
    <FormDialog
      trigger={
        <Button>
          <Plus aria-hidden />
          Watch a URL
        </Button>
      }
      title="Watch a URL"
      description="Unbuilt checks it on an interval. Two failures in a row open an incident and raise a ticket."
      submitLabel="Start watching"
      canSubmit={Boolean(clientId) && name.trim().length > 0 && url.trim().length > 0}
      onSubmit={() =>
        create({
          clientId: clientId as Id<'clients'>,
          projectId: projectId ? (projectId as Id<'projects'>) : undefined,
          name,
          url,
          production,
          intervalMinutes: Number(intervalMinutes),
        })
      }
    >
      <div className="space-y-2">
        <Label htmlFor="monitor-client">Client</Label>
        <NativeSelect
          id="monitor-client"
          value={clientId}
          onChange={(event) => {
            setClientId(event.target.value);
            setProjectId('');
          }}
        >
          <option value="">Choose a client</option>
          {(clients ?? []).map((client) => (
            <option key={client.id} value={client.id}>
              {client.displayName}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="space-y-2">
        <Label htmlFor="monitor-project">Project</Label>
        <NativeSelect
          id="monitor-project"
          value={projectId}
          disabled={!clientId}
          onChange={(event) => setProjectId(event.target.value)}
        >
          <option value="">No particular project</option>
          {(projects ?? []).map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </NativeSelect>
        {/* Who hears about a failure follows the project, so this is not only filing. */}
        <p className="text-xs text-muted-foreground">A project decides who is told when this stops answering.</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="monitor-name">What to call it</Label>
        <Input id="monitor-name" value={name} onChange={(event) => setName(event.target.value)} required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="monitor-url">Address</Label>
        <Input
          id="monitor-url"
          type="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://example.com/health"
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="monitor-interval">How often</Label>
        <NativeSelect
          id="monitor-interval"
          value={intervalMinutes}
          onChange={(event) => setIntervalMinutes(event.target.value)}
        >
          <option value="1">Every minute</option>
          <option value="5">Every 5 minutes</option>
          <option value="15">Every 15 minutes</option>
          <option value="60">Every hour</option>
        </NativeSelect>
      </div>
      <div className="flex items-start justify-between gap-3 rounded-md border p-3">
        <div>
          <Label htmlFor="monitor-production">This is the live site</Label>
          <p className="text-xs text-muted-foreground">
            A live site going down raises a P1 and messages the admins. Anything else raises a P2.
          </p>
        </div>
        <Switch id="monitor-production" checked={production} onCheckedChange={setProduction} />
      </div>
    </FormDialog>
  );
}

type Monitor = (typeof api.monitors.list._returnType)[number];

/** Down first, then never-checked, then the rest: the order somebody would look in. */
const byUrgency = (a: Monitor, b: Monitor) => {
  const rank = (monitor: Monitor) => (monitor.status === 'down' ? 0 : monitor.status === 'paused' ? 2 : 1);
  return rank(a) - rank(b) || a.name.localeCompare(b.name);
};

export function MonitorList() {
  const monitors = useQuery(api.monitors.list, {});
  const now = useNow();

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <NewMonitor />
      </div>
      {monitors === undefined ? (
        <p className="text-muted-foreground">Loading monitors…</p>
      ) : monitors.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-muted-foreground">
          Nothing is being watched. Add a URL and Unbuilt will tell you when it stops answering.
        </p>
      ) : (
        <ul className="space-y-3">
          {[...monitors].sort(byUrgency).map((monitor) => (
            <li key={monitor.id} className="rounded-lg border p-4">
              <Link href={`/support/monitors/${monitor.id}`} className="block">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{monitor.name}</p>
                    <p className="truncate text-sm text-muted-foreground">
                      {monitor.clientName} · {monitor.url}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Checked {ago(monitor.lastCheckedAt, now)}
                      {monitor.status === 'paused' ? '' : ` · every ${monitor.intervalMinutes} min`}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {monitor.production && <ToneBadge label="Live site" tone="draft" />}
                    <ToneBadge {...monitorStatus(monitor.status as MonitorStatus)} />
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

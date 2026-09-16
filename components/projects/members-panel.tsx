'use client';

import { useMutation, useQuery } from 'convex/react';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { errorMessage } from '@/lib/convex-error';

// Project members (06-projects.md, Members). Being a member is what grants the project's `.assigned` scope, so adding
// and removing someone changes what they can see at once. Project roles are labels only.

export function MembersPanel({ projectId, permissions }: { projectId: Id<'projects'>; permissions: string[] }) {
  const project = useQuery(api.projects.get, { projectId });
  const team = useQuery(api.team.list, permissions.includes('team.view') ? {} : 'skip');
  const add = useMutation(api.projects.addProjectMember);
  const setRole = useMutation(api.projects.setMemberRole);
  const remove = useMutation(api.projects.removeProjectMember);
  const [memberId, setMemberId] = useState('');
  const [role, setRole_] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const canManage = permissions.includes('projects.members.manage');

  if (project === undefined) return <p className="text-muted-foreground">Loading members…</p>;

  const onProject = new Set(project.members.map((member) => member.memberId));
  const candidates = team?.filter((member) => member.status === 'active' && !onProject.has(member.id)) ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-xl font-bold">Members</h2>
        <p className="text-sm text-muted-foreground">
          Members see this project, its files and its vault items. The manager always stays a member.
        </p>
      </div>

      <ul className="space-y-2">
        {project.members.map((member) => (
          <li key={member.memberId} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
            <div className="min-w-0">
              <p className="font-medium">
                {member.name}
                {member.status !== 'active' && <span className="text-muted-foreground"> · {member.status}</span>}
              </p>
              <p className="text-sm text-muted-foreground">
                {[member.isManager ? 'Project manager' : member.projectRole, member.title]
                  .filter(Boolean)
                  .join(' · ') || 'No project role'}
              </p>
            </div>
            {canManage && (
              <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
                {!member.isManager && (
                  <>
                    <Label htmlFor={`project-role-${member.memberId}`} className="sr-only">
                      Project role for {member.name}
                    </Label>
                    <Input
                      id={`project-role-${member.memberId}`}
                      className="sm:w-48"
                      placeholder="Lead developer"
                      defaultValue={member.projectRole ?? ''}
                      onBlur={async (event) => {
                        const next = event.target.value.trim();
                        if (next === (member.projectRole ?? '')) return;
                        setError(null);
                        try {
                          await setRole({
                            projectId,
                            memberId: member.memberId,
                            projectRole: next || undefined,
                          });
                        } catch (caught) {
                          setError(errorMessage(caught));
                        }
                      }}
                    />
                    <ConfirmDialog
                      trigger={
                        <Button variant="ghost" size="sm">
                          Remove
                        </Button>
                      }
                      title={`Remove ${member.name} from this project?`}
                      description="They lose sight of the project at once and come off its tasks. Their logged time stays."
                      confirmLabel="Remove"
                      onConfirm={() => remove({ projectId, memberId: member.memberId })}
                    />
                  </>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      {canManage && (
        <form
          className="flex flex-wrap items-end gap-3 rounded-lg border p-4"
          aria-label="Add a member"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!memberId) {
              setError('Choose someone to add');
              return;
            }
            setSaving(true);
            setError(null);
            try {
              await add({ projectId, memberId: memberId as Id<'teamMembers'>, projectRole: role || undefined });
              setMemberId('');
              setRole_('');
            } catch (caught) {
              setError(errorMessage(caught));
            } finally {
              setSaving(false);
            }
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="project-add-member">Add someone</Label>
            <NativeSelect
              id="project-add-member"
              value={memberId}
              disabled={!team}
              aria-invalid={error !== null && !memberId ? true : undefined}
              onChange={(event) => setMemberId(event.target.value)}
            >
              <option value="">{team ? 'Choose a member' : 'Loading the team…'}</option>
              {candidates.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-2">
            <Label htmlFor="project-add-role">Project role (optional)</Label>
            <Input
              id="project-add-role"
              placeholder="Designer"
              value={role}
              onChange={(event) => setRole_(event.target.value)}
            />
          </div>
          <Button type="submit" disabled={saving}>
            {saving ? 'Adding…' : 'Add to the project'}
          </Button>
        </form>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

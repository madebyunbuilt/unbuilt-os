'use client';

import { useQuery } from 'convex/react';
import { Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { InviteDialog } from '@/components/team/invite-dialog';
import { MemberAvatar } from '@/components/team/member-avatar';
import { StatusBadge } from '@/components/team/status-badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { api } from '@/convex/_generated/api';

export function TeamList({ canInvite }: { canInvite: boolean }) {
  const router = useRouter();
  const [includeOffboarded, setIncludeOffboarded] = useState(false);
  const [search, setSearch] = useState('');
  const members = useQuery(api.team.list, { includeOffboarded });

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!members || !term) return members;
    return members.filter((member) =>
      [member.name, member.email, member.title, member.role?.name].some((value) => value?.toLowerCase().includes(term)),
    );
  }, [members, search]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative sm:w-80">
          <Label htmlFor="team-search" className="sr-only">
            Search the team
          </Label>
          <Search aria-hidden className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="team-search"
            type="search"
            placeholder="Search by name, email, title or role"
            className="pl-9"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          <Switch id="include-offboarded" checked={includeOffboarded} onCheckedChange={setIncludeOffboarded} />
          <Label htmlFor="include-offboarded" className="font-normal">
            Show offboarded
          </Label>
        </div>
        {canInvite && (
          <div className="sm:ml-auto">
            <InviteDialog onInvited={(memberId) => router.push(`/team/${memberId}`)} />
          </div>
        )}
      </div>

      {visible === undefined ? (
        <p className="text-muted-foreground">Loading the team…</p>
      ) : visible.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-muted-foreground">
          {search ? 'Nobody matches that search.' : 'No team members yet.'}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[40rem] text-sm">
            <caption className="sr-only">Team members</caption>
            <thead className="bg-muted text-left">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Name
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Role
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Status
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Type
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((member) => (
                <tr key={member.id} className="border-t hover:bg-accent/50">
                  <td className="px-4 py-3">
                    <Link href={`/team/${member.id}`} className="flex items-center gap-3 rounded-md">
                      <MemberAvatar name={member.name} avatarFileId={member.avatarFileId} size="sm" />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{member.name}</span>
                        <span className="block truncate text-muted-foreground">{member.title ?? member.email}</span>
                      </span>
                    </Link>
                  </td>
                  <td className="px-4 py-3">{member.role?.name ?? '—'}</td>
                  <td className="px-4 py-3">
                    <StatusBadge member={member} />
                  </td>
                  <td className="px-4 py-3 capitalize">{member.employmentType}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

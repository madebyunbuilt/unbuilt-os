import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import { type Id } from './_generated/dataModel';
import { createClientUser, createTeamMember, newTest, type TestConvex } from './test.auth';

async function expectCode(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, `expected ${code}`).toBeInstanceOf(ConvexError);
  expect((error as ConvexError<{ code: string }>).data.code).toBe(code);
}

let t: TestConvex;
let roles: Record<string, Id<'roles'>>;
let admin: Awaited<ReturnType<typeof createTeamMember>>;
let pm: Awaited<ReturnType<typeof createTeamMember>>;
let finance: Awaited<ReturnType<typeof createTeamMember>>;
let dayo: Awaited<ReturnType<typeof createTeamMember>>;
let bisi: Awaited<ReturnType<typeof createTeamMember>>;
let clientId: Id<'clients'>;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.parse('2026-09-15T09:00:00Z'));
  vi.stubEnv('CONVEX_SITE_URL', 'https://example.convex.site');
  vi.stubEnv('FILE_URL_SECRET', 'test-file-url-secret-that-is-long-enough');
  t = newTest();
  await t.mutation(internal.seed.run, {});
  roles = await t.run(async (ctx) =>
    Object.fromEntries((await ctx.db.query('roles').collect()).map((role) => [role.key, role._id])),
  );
  admin = await createTeamMember(t, roles.admin, { email: 'kemi@unbuilt.studio', name: 'Kemi Bello' });
  pm = await createTeamMember(t, roles.project_manager, { email: 'tobi@unbuilt.studio', name: 'Tobi Ade' });
  finance = await createTeamMember(t, roles.finance, { email: 'finance@unbuilt.studio', name: 'Funmi' });
  dayo = await createTeamMember(t, roles.member, { email: 'dayo@unbuilt.studio', name: 'Dayo Ade' });
  bisi = await createTeamMember(t, roles.member, { email: 'bisi@unbuilt.studio', name: 'Bisi Obi' });
  clientId = await pm.as.mutation(api.clients.create, { displayName: 'Glossup', kind: 'company', tags: [] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const templateNamed = async (name: string) =>
  (await pm.as.query(api.projectTemplates.list, {})).find((template) => template.name === name)!;

const newProject = async (overrides: object = {}) =>
  await pm.as.mutation(api.projects.create, {
    clientId,
    name: 'Glossup app',
    type: 'mobile_app' as const,
    billingModel: 'fixed' as const,
    currency: 'NGN' as const,
    startDate: '2026-10-01',
    ...overrides,
  });

describe('projects', () => {
  it('creates a project from a template with dated milestones, deliverables and tasks', async () => {
    const template = await templateNamed('Mobile app');
    const projectId = await newProject({ templateId: template.id, budgetMinor: 1_000_000_000 });

    const project = await pm.as.query(api.projects.get, { projectId });
    expect(project).toMatchObject({
      code: 'UNB-P-0001',
      status: 'planning',
      clientName: 'Glossup',
      managerName: 'Tobi Ade',
      // The last milestone, Launch, is 84 days after the start.
      dueDate: '2026-12-24',
      milestoneProgress: { done: 0, total: 4 },
      nextMilestone: 'Discovery',
      members: [{ name: 'Tobi Ade', isManager: true, projectRole: 'Project manager' }],
    });
    expect(project.tasks.estimateMinutes).toBe((1 + 6 + 16 + 32 + 4 + 80 + 24 + 8) * 60);

    const plan = await pm.as.query(api.milestones.listForProject, { projectId });
    expect(plan.milestones.map((m) => [m.name, m.dueDate, m.deliverables.map((d) => d.title)])).toEqual([
      ['Discovery', '2026-10-01', ['Product brief', 'User flows']],
      ['Design', '2026-10-15', ['Wireframes', 'UI design']],
      ['Build', '2026-11-12', ['Beta build']],
      ['Launch', '2026-12-24', ['Store release', 'Handover documentation']],
    ]);
    const tasks = await pm.as.query(api.tasks.listForProject, { projectId });
    expect(tasks.find((task) => task.title === 'Design the UI')?.milestone?.name).toBe('Design');

    expect(await newProject({ name: 'Second' })).toBeTruthy();
    expect((await pm.as.query(api.projects.list, {})).map((p) => p.code)).toEqual(['UNB-P-0002', 'UNB-P-0001']);
    await expectCode(
      finance.as.mutation(api.projects.create, {
        clientId,
        name: 'X',
        type: 'other',
        billingModel: 'fixed',
        currency: 'NGN',
        startDate: '2026-10-01',
      }),
      'auth.forbidden',
    );
  });

  it('shows Members only the projects they belong to; everything else is not found', async () => {
    const projectId = await newProject({ templateId: (await templateNamed('Web platform')).id });
    const [taskId] = (await pm.as.query(api.tasks.listForProject, { projectId })).map((task) => task.id);
    const plan = await pm.as.query(api.milestones.listForProject, { projectId });
    const deliverableId = plan.milestones[0].deliverables[0].id;

    expect(await dayo.as.query(api.projects.list, {})).toEqual([]);
    await expectCode(dayo.as.query(api.projects.get, { projectId }), 'projects.notFound');
    await expectCode(dayo.as.query(api.tasks.listForProject, { projectId }), 'projects.notFound');
    await expectCode(dayo.as.query(api.milestones.listForProject, { projectId }), 'projects.notFound');
    await expectCode(dayo.as.query(api.deliverables.get, { deliverableId }), 'projects.notFound');
    await expectCode(dayo.as.query(api.comments.list, { target: { table: 'tasks', id: taskId } }), 'projects.notFound');

    await pm.as.mutation(api.projects.addProjectMember, {
      projectId,
      memberId: dayo.memberId,
      projectRole: 'Lead developer',
    });
    expect((await dayo.as.query(api.projects.list, {})).map((p) => p.id)).toEqual([projectId]);
    expect(await dayo.as.query(api.tasks.listForProject, { projectId })).toHaveLength(7);

    // Finance sees every project but manages nothing in it.
    expect(await finance.as.query(api.projects.get, { projectId })).toMatchObject({ isMember: false });
    await expectCode(
      finance.as.mutation(api.tasks.create, { projectId, title: 'X', priority: 'low', assigneeMemberIds: [] }),
      'auth.forbidden',
    );

    const editor = await createTeamMember(t, roles.content_editor, { email: 'cms@unbuilt.studio' });
    await expectCode(editor.as.query(api.projects.list, {}), 'auth.forbidden');
    const portal = await createClientUser(t, roles.client_admin, { clientName: 'Portal Co', email: 'ada@portal.co' });
    await expectCode(portal.as.query(api.projects.list, {}), 'auth.forbidden');
  });

  it('removing a member takes away the project and their tasks at once; the manager cannot be removed', async () => {
    const projectId = await newProject();
    await pm.as.mutation(api.projects.addProjectMember, { projectId, memberId: dayo.memberId });
    const taskId = await dayo.as.mutation(api.tasks.create, {
      projectId,
      title: 'Build the login screen',
      priority: 'high',
      assigneeMemberIds: [dayo.memberId],
      dueDate: '2026-09-20',
    });
    expect((await dayo.as.query(api.tasks.mine, {})).map((task) => task.id)).toEqual([taskId]);

    await expectCode(
      dayo.as.mutation(api.projects.removeProjectMember, { projectId, memberId: dayo.memberId }),
      'auth.forbidden',
    );
    await expectCode(
      pm.as.mutation(api.projects.removeProjectMember, { projectId, memberId: pm.memberId }),
      'projects.manager',
    );
    await pm.as.mutation(api.projects.removeProjectMember, { projectId, memberId: dayo.memberId });
    await expectCode(dayo.as.query(api.projects.get, { projectId }), 'projects.notFound');
    expect(await dayo.as.query(api.tasks.mine, {})).toEqual([]);
    expect((await pm.as.query(api.tasks.listForProject, { projectId }))[0].assignees).toEqual([]);
  });

  it('offboarding removes project memberships', async () => {
    const projectId = await newProject();
    await pm.as.mutation(api.projects.addProjectMember, { projectId, memberId: dayo.memberId });
    await admin.as.mutation(api.team.offboard, { memberId: dayo.memberId, endDate: '2026-09-15' });
    expect((await pm.as.query(api.projects.get, { projectId })).members.map((m) => m.name)).toEqual(['Tobi Ade']);
  });

  it('completes only when every milestone is approved or skipped, moving the client from lead to active to past', async () => {
    const projectId = await newProject({ templateId: (await templateNamed('DevOps setup')).id });
    await pm.as.mutation(api.projects.setStatus, { projectId, status: 'active' });
    expect((await pm.as.query(api.clients.get, { clientId })).status).toBe('active');

    await expectCode(
      pm.as.mutation(api.projects.setStatus, { projectId, status: 'completed' }),
      'projects.milestonesPending',
    );
    const plan = await pm.as.query(api.milestones.listForProject, { projectId });
    for (const milestone of plan.milestones) {
      await pm.as.mutation(api.milestones.setStatus, { milestoneId: milestone.id, status: 'skipped' });
    }
    await pm.as.mutation(api.projects.setStatus, { projectId, status: 'completed', reason: 'Delivered' });
    expect((await pm.as.query(api.clients.get, { clientId })).status).toBe('past');
    expect(await pm.as.query(api.projects.list, {})).toEqual([]);
    expect(await pm.as.query(api.projects.list, { status: 'completed' })).toHaveLength(1);

    await expectCode(
      pm.as.mutation(api.projects.setStatus, { projectId, status: 'planning' }),
      'projects.invalidStatus',
    );
    await expectCode(dayo.as.mutation(api.projects.setStatus, { projectId, status: 'archived' }), 'auth.forbidden');
    await expectCode(
      pm.as.mutation(api.tasks.create, { projectId, title: 'Late task', priority: 'low', assigneeMemberIds: [] }),
      'projects.closed',
    );

    const timeline = await pm.as.query(api.activities.list, {
      subject: { table: 'projects', id: projectId },
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(timeline.page.map((entry) => entry.title)).toEqual([
      'UNB-P-0001 changed from Active to Completed',
      'UNB-P-0001 changed from Planning to Active',
      'Project UNB-P-0001 created from the DevOps setup template',
    ]);
    await expectCode(admin.as.mutation(api.clients.remove, { clientId }), 'crm.hasHistory');
  });

  it('wins a deal by creating its project, or by linking an existing project of the same client', async () => {
    const dealId = await pm.as.mutation(api.deals.create, {
      clientId,
      title: 'Glossup app',
      valueMinor: 900_000_000,
      currency: 'NGN',
      services: ['mobile'],
    });
    const won = (await pm.as.query(api.pipeline.stages, {})).find((stage) => stage.kind === 'won')!;
    await expectCode(pm.as.mutation(api.deals.moveToStage, { dealId, stageId: won.id }), 'crm.wonNeedsProject');

    const projectId = await pm.as.mutation(api.projects.winDealWithNewProject, {
      dealId,
      templateId: (await templateNamed('Mobile app')).id,
      name: 'Glossup app',
      type: 'mobile_app',
      billingModel: 'fixed',
      currency: 'NGN',
      budgetMinor: 900_000_000,
      startDate: '2026-10-01',
    });
    expect(await pm.as.query(api.deals.get, { dealId })).toMatchObject({
      stage: { kind: 'won' },
      probabilityBps: 10_000,
      wonAt: Date.now(),
    });
    expect(await pm.as.query(api.projects.forDeal, { dealId })).toEqual({
      id: projectId,
      code: 'UNB-P-0001',
      name: 'Glossup app',
    });
    expect((await pm.as.query(api.projects.get, { projectId })).dealTitle).toBe('Glossup app');
    await expectCode(
      pm.as.mutation(api.deals.moveToStage, { dealId, stageId: (await pm.as.query(api.pipeline.stages, {}))[0].id }),
      'crm.dealWon',
    );

    const otherClient = await pm.as.mutation(api.clients.create, { displayName: 'Qravit', kind: 'company', tags: [] });
    const secondDeal = await pm.as.mutation(api.deals.create, {
      clientId: otherClient,
      title: 'Phase 2',
      valueMinor: 1,
      currency: 'NGN',
      services: [],
    });
    await expectCode(
      pm.as.mutation(api.projects.winDealWithExistingProject, { dealId: secondDeal, projectId }),
      'projects.invalid',
    );
    const sameClientDeal = await pm.as.mutation(api.deals.create, {
      clientId,
      title: 'Phase 2',
      valueMinor: 1,
      currency: 'NGN',
      services: [],
    });
    await expectCode(
      pm.as.mutation(api.projects.winDealWithExistingProject, { dealId: sameClientDeal, projectId }),
      'projects.invalid',
    );
    const blank = await newProject({ name: 'Maintenance' });
    await pm.as.mutation(api.projects.winDealWithExistingProject, { dealId: sameClientDeal, projectId: blank });
    expect((await pm.as.query(api.deals.get, { dealId: sameClientDeal })).stage?.kind).toBe('won');
  });
});

describe('deliverables', () => {
  async function storeFile(content = 'design') {
    return await t.run((ctx) => ctx.storage.store(new Blob([content], { type: 'application/pdf' })));
  }

  it('submits versions for review and approves the milestone once the client approves every deliverable', async () => {
    const projectId = await newProject({ templateId: (await templateNamed('Mobile app')).id });
    await pm.as.mutation(api.projects.addProjectMember, { projectId, memberId: dayo.memberId });
    const discovery = (await dayo.as.query(api.milestones.listForProject, { projectId })).milestones[0];
    const [brief, flows] = discovery.deliverables;

    const storageId = await storeFile();
    const submitted = await dayo.as.mutation(api.deliverables.submitVersion, {
      deliverableId: brief.id,
      uploads: [{ storageId, name: 'brief.pdf', contentType: 'application/pdf' }],
      links: [{ label: 'Figma', url: 'figma.com/file/abc' }],
      notes: 'First draft',
    });
    expect(submitted).toEqual({ ok: true, version: 1 });
    const detail = await dayo.as.query(api.deliverables.get, { deliverableId: brief.id });
    expect(detail).toMatchObject({
      status: 'in_review',
      milestone: { status: 'awaiting_approval' },
      versions: [{ version: 1, notes: 'First draft', links: [{ label: 'Figma', url: 'https://figma.com/file/abc' }] }],
    });
    const fileId = detail.versions[0].files[0].id;
    expect((await dayo.as.query(api.files.teamDownloadUrl, { fileId })).name).toBe('brief.pdf');
    await expectCode(bisi.as.query(api.files.teamDownloadUrl, { fileId }), 'auth.notFound');
    await expectCode(
      bisi.as.mutation(api.deliverables.submitVersion, {
        deliverableId: flows.id,
        uploads: [],
        links: [{ url: 'x.com' }],
      }),
      'projects.notFound',
    );

    const contactId = await pm.as.mutation(api.contacts.create, {
      clientId,
      name: 'Ada',
      email: 'ada@glossup.com',
      isBilling: true,
    });
    await expectCode(
      t.mutation(internal.deliverables.recordClientDecision, {
        deliverableId: brief.id,
        contactId,
        version: 2,
        decision: 'approved',
      }),
      'projects.staleVersion',
    );
    expect(
      await t.mutation(internal.deliverables.recordClientDecision, {
        deliverableId: brief.id,
        contactId,
        version: 1,
        decision: 'approved',
      }),
    ).toEqual({ milestoneApproved: null });
    await expectCode(
      dayo.as.mutation(api.deliverables.submitVersion, {
        deliverableId: brief.id,
        uploads: [],
        links: [{ url: 'x.com' }],
      }),
      'projects.locked',
    );

    await dayo.as.mutation(api.deliverables.submitVersion, {
      deliverableId: flows.id,
      uploads: [],
      links: [{ url: 'figma.com/flows' }],
    });
    await t.mutation(internal.deliverables.recordClientDecision, {
      deliverableId: flows.id,
      contactId,
      version: 1,
      decision: 'changes_requested',
    });
    await dayo.as.mutation(api.deliverables.submitVersion, {
      deliverableId: flows.id,
      uploads: [],
      links: [{ url: 'figma.com/flows-v2' }],
      notes: 'Fixed the onboarding',
    });
    const result = await t.mutation(internal.deliverables.recordClientDecision, {
      deliverableId: flows.id,
      contactId,
      version: 2,
      decision: 'approved',
    });
    expect(result.milestoneApproved).toBe(discovery.id);
    const plan = await pm.as.query(api.milestones.listForProject, { projectId });
    expect(plan.milestones[0]).toMatchObject({ status: 'approved', approvedAt: Date.now() });
    await expectCode(
      pm.as.mutation(api.deliverables.create, { projectId, title: 'Late', milestoneId: discovery.id }),
      'projects.locked',
    );
  });

  it('refuses versions without content and deliverable changes from people outside the project', async () => {
    const projectId = await newProject();
    const deliverableId = await pm.as.mutation(api.deliverables.create, { projectId, title: 'Logo' });
    await expectCode(
      pm.as.mutation(api.deliverables.submitVersion, { deliverableId, uploads: [], links: [] }),
      'projects.invalid',
    );
    await expectCode(finance.as.mutation(api.deliverables.update, { deliverableId, title: 'X' }), 'auth.forbidden');
    await expectCode(dayo.as.mutation(api.deliverables.remove, { deliverableId }), 'projects.notFound');
    await pm.as.mutation(api.deliverables.remove, { deliverableId });
  });
});

describe('tasks and comments', () => {
  it('assigns only project members and orders tasks within their status', async () => {
    const projectId = await newProject();
    await pm.as.mutation(api.projects.addProjectMember, { projectId, memberId: dayo.memberId });
    await expectCode(
      pm.as.mutation(api.tasks.create, { projectId, title: 'X', priority: 'low', assigneeMemberIds: [bisi.memberId] }),
      'projects.notMember',
    );
    const first = await pm.as.mutation(api.tasks.create, {
      projectId,
      title: 'First',
      priority: 'low',
      assigneeMemberIds: [],
    });
    const second = await pm.as.mutation(api.tasks.create, {
      projectId,
      title: 'Second',
      priority: 'low',
      assigneeMemberIds: [dayo.memberId],
    });
    await dayo.as.mutation(api.tasks.move, { taskId: second, status: 'in_progress' });
    await dayo.as.mutation(api.tasks.move, { taskId: first, status: 'in_progress', index: 0 });
    const tasks = await pm.as.query(api.tasks.listForProject, { projectId });
    expect(
      tasks
        .filter((t) => t.status === 'in_progress')
        .sort((a, b) => a.order - b.order)
        .map((t) => t.title),
    ).toEqual(['First', 'Second']);

    await dayo.as.mutation(api.tasks.move, { taskId: second, status: 'done' });
    expect(
      (await pm.as.query(api.tasks.listForProject, { projectId })).find((task) => task.id === second)?.completedAt,
    ).toBe(Date.now());
    expect(await dayo.as.query(api.tasks.mine, {})).toEqual([]);
    expect(await dayo.as.query(api.tasks.listForProject, { projectId, priority: 'high' })).toEqual([]);
    await expectCode(bisi.as.mutation(api.tasks.remove, { taskId: first }), 'projects.notFound');
  });

  it('keeps internal comments to the team, limits client-visible ones, and notifies mentioned people who can see the project', async () => {
    const projectId = await newProject();
    await pm.as.mutation(api.projects.addProjectMember, { projectId, memberId: dayo.memberId });
    const taskId = await pm.as.mutation(api.tasks.create, {
      projectId,
      title: 'Review copy',
      priority: 'medium',
      assigneeMemberIds: [],
    });
    const target = { table: 'tasks' as const, id: taskId };

    await finance.as.mutation(api.comments.add, {
      target,
      body: `Budget check @[Dayo Ade](member:${dayo.memberId}) @[Bisi Obi](member:${bisi.memberId})`,
      visibility: 'internal',
    });
    await expectCode(
      finance.as.mutation(api.comments.add, { target, body: 'Hello client', visibility: 'client' }),
      'projects.internalOnly',
    );
    await dayo.as.mutation(api.comments.add, { target, body: 'Ready for you to check', visibility: 'client' });

    const notifications = await t.run((ctx) => ctx.db.query('notifications').collect());
    expect(notifications.map((n) => n.recipientId)).toEqual([dayo.memberId]);
    expect(notifications[0]).toMatchObject({
      title: 'Funmi mentioned you on Review copy',
      link: `/projects/${projectId}/tasks?task=${taskId}`,
    });

    const { comments } = await pm.as.query(api.comments.list, { target });
    expect(comments.map((c) => [c.authorName, c.visibility, c.canEdit])).toEqual([
      ['Funmi', 'internal', false],
      ['Dayo Ade', 'client', false],
    ]);
    await expectCode(pm.as.mutation(api.comments.remove, { commentId: comments[1].id }), 'projects.notAuthor');
    await dayo.as.mutation(api.comments.update, { commentId: comments[1].id, body: 'Ready now' });
  });
});

describe('templates', () => {
  it('lets templates.projects.manage edit and retire templates, checked for sense', async () => {
    const template = await templateNamed('Retainer');
    await expectCode(dayo.as.query(api.projectTemplates.list, {}), 'auth.forbidden');
    await expectCode(
      pm.as.mutation(api.projectTemplates.update, {
        templateId: template.id,
        name: template.name,
        type: template.type,
        milestones: [
          { name: 'A', offsetDays: 0, billingPercentBps: 6000, deliverables: [] },
          { name: 'B', offsetDays: 10, billingPercentBps: 5000, deliverables: [] },
        ],
        tasks: [],
      }),
      'projects.invalid',
    );
    await expectCode(
      pm.as.mutation(api.projectTemplates.update, {
        templateId: template.id,
        name: template.name,
        type: template.type,
        milestones: [{ name: 'A', offsetDays: 0, deliverables: [] }],
        tasks: [{ title: 'T', milestoneIndex: 3 }],
      }),
      'projects.invalid',
    );
    await pm.as.mutation(api.projectTemplates.setActive, { templateId: template.id, active: false });
    expect((await pm.as.query(api.projectTemplates.list, {})).map((t) => t.name)).not.toContain('Retainer');
    await expectCode(newProject({ templateId: template.id }), 'projects.invalid');
    await expectCode(
      finance.as.mutation(api.projectTemplates.setActive, { templateId: template.id, active: true }),
      'auth.forbidden',
    );
  });
});

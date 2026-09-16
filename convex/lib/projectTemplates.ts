// Default project templates the seed adds (06-projects.md, Templates). Drafts for the studio to adjust in the app:
// milestones with offsets from the project start, deliverables per milestone and tasks with estimates. Billing
// percentages are left empty until billing schedules exist.

const HOUR = 60;

export const HANDOVER_ITEMS = [
  'Repository ownership transferred',
  'Domains and DNS access transferred',
  'Hosting and third-party accounts transferred',
  'Vault credentials handed over and rotated',
  'App store listings transferred',
  'Documentation delivered',
  'Final invoice paid',
  'Ownership of the work transferred',
  'Handover document signed',
  'Testimonial requested',
  'Case study drafted',
] as const;

type TemplateDraft = {
  name: string;
  type: string;
  description: string;
  milestones: { name: string; offsetDays: number; deliverables: string[] }[];
  tasks: { title: string; milestoneIndex?: number; estimateMinutes?: number }[];
};

export const DEFAULT_PROJECT_TEMPLATES: readonly TemplateDraft[] = [
  {
    name: 'Mobile app',
    type: 'mobile_app',
    description: 'An iOS and Android app from discovery to store release.',
    milestones: [
      { name: 'Discovery', offsetDays: 0, deliverables: ['Product brief', 'User flows'] },
      { name: 'Design', offsetDays: 14, deliverables: ['Wireframes', 'UI design'] },
      { name: 'Build', offsetDays: 42, deliverables: ['Beta build'] },
      { name: 'Launch', offsetDays: 84, deliverables: ['Store release', 'Handover documentation'] },
    ],
    tasks: [
      { title: 'Kick-off call', milestoneIndex: 0, estimateMinutes: 1 * HOUR },
      { title: 'Write the product brief', milestoneIndex: 0, estimateMinutes: 6 * HOUR },
      { title: 'Wireframe key screens', milestoneIndex: 1, estimateMinutes: 16 * HOUR },
      { title: 'Design the UI', milestoneIndex: 1, estimateMinutes: 32 * HOUR },
      { title: 'Set up the repository and CI', milestoneIndex: 2, estimateMinutes: 4 * HOUR },
      { title: 'Build core features', milestoneIndex: 2, estimateMinutes: 80 * HOUR },
      { title: 'QA and bug fixing', milestoneIndex: 2, estimateMinutes: 24 * HOUR },
      { title: 'Submit to the App Store and Play Store', milestoneIndex: 3, estimateMinutes: 8 * HOUR },
    ],
  },
  {
    name: 'Web platform',
    type: 'web_platform',
    description: 'A web application or marketing platform from requirements to launch.',
    milestones: [
      { name: 'Discovery', offsetDays: 0, deliverables: ['Sitemap and requirements'] },
      { name: 'Design', offsetDays: 14, deliverables: ['Page designs'] },
      { name: 'Build', offsetDays: 35, deliverables: ['Staging site'] },
      { name: 'Launch', offsetDays: 70, deliverables: ['Production launch', 'Handover documentation'] },
    ],
    tasks: [
      { title: 'Kick-off call', milestoneIndex: 0, estimateMinutes: 1 * HOUR },
      { title: 'Map pages and requirements', milestoneIndex: 0, estimateMinutes: 8 * HOUR },
      { title: 'Design pages', milestoneIndex: 1, estimateMinutes: 32 * HOUR },
      { title: 'Build the front end', milestoneIndex: 2, estimateMinutes: 60 * HOUR },
      { title: 'Build the back end and integrations', milestoneIndex: 2, estimateMinutes: 40 * HOUR },
      { title: 'QA across browsers and devices', milestoneIndex: 2, estimateMinutes: 12 * HOUR },
      { title: 'Launch and monitor', milestoneIndex: 3, estimateMinutes: 6 * HOUR },
    ],
  },
  {
    name: 'Product design',
    type: 'product_design',
    description: 'Research, wireframes and visual design ready for development.',
    milestones: [
      { name: 'Research', offsetDays: 0, deliverables: ['Research summary'] },
      { name: 'Wireframes', offsetDays: 10, deliverables: ['Wireframes'] },
      { name: 'Visual design', offsetDays: 24, deliverables: ['High-fidelity designs', 'Design system'] },
      { name: 'Handoff', offsetDays: 40, deliverables: ['Developer handoff files'] },
    ],
    tasks: [
      { title: 'Stakeholder interviews', milestoneIndex: 0, estimateMinutes: 6 * HOUR },
      { title: 'Competitor review', milestoneIndex: 0, estimateMinutes: 4 * HOUR },
      { title: 'Wireframe flows', milestoneIndex: 1, estimateMinutes: 20 * HOUR },
      { title: 'Visual design', milestoneIndex: 2, estimateMinutes: 40 * HOUR },
      { title: 'Build the component library', milestoneIndex: 2, estimateMinutes: 16 * HOUR },
      { title: 'Prepare handoff files', milestoneIndex: 3, estimateMinutes: 6 * HOUR },
    ],
  },
  {
    name: 'Backend',
    type: 'backend',
    description: 'APIs and services from architecture to production.',
    milestones: [
      { name: 'Architecture', offsetDays: 0, deliverables: ['Architecture document'] },
      { name: 'API build', offsetDays: 14, deliverables: ['API on staging'] },
      { name: 'Hardening', offsetDays: 42, deliverables: ['Load test report'] },
      { name: 'Launch', offsetDays: 56, deliverables: ['Production deployment', 'API documentation'] },
    ],
    tasks: [
      { title: 'Design the data model', milestoneIndex: 0, estimateMinutes: 8 * HOUR },
      { title: 'Write the architecture document', milestoneIndex: 0, estimateMinutes: 6 * HOUR },
      { title: 'Build endpoints', milestoneIndex: 1, estimateMinutes: 60 * HOUR },
      { title: 'Automated tests', milestoneIndex: 1, estimateMinutes: 20 * HOUR },
      { title: 'Load testing', milestoneIndex: 2, estimateMinutes: 8 * HOUR },
      { title: 'Security review', milestoneIndex: 2, estimateMinutes: 6 * HOUR },
      { title: 'Deploy to production', milestoneIndex: 3, estimateMinutes: 4 * HOUR },
    ],
  },
  {
    name: 'DevOps setup',
    type: 'devops',
    description: 'Infrastructure, pipelines and monitoring for an existing product.',
    milestones: [
      { name: 'Audit', offsetDays: 0, deliverables: ['Infrastructure audit'] },
      { name: 'Setup', offsetDays: 7, deliverables: ['CI/CD pipelines', 'Monitoring and alerts'] },
      { name: 'Handover', offsetDays: 21, deliverables: ['Runbook'] },
    ],
    tasks: [
      { title: 'Audit the current infrastructure', milestoneIndex: 0, estimateMinutes: 8 * HOUR },
      { title: 'Set up CI/CD', milestoneIndex: 1, estimateMinutes: 12 * HOUR },
      { title: 'Set up monitoring and alerts', milestoneIndex: 1, estimateMinutes: 8 * HOUR },
      { title: 'Write the runbook', milestoneIndex: 2, estimateMinutes: 6 * HOUR },
    ],
  },
  {
    name: 'Retainer',
    type: 'retainer',
    description: 'Ongoing support and improvements billed monthly.',
    milestones: [{ name: 'First month', offsetDays: 0, deliverables: ['Monthly report'] }],
    tasks: [
      { title: 'Monthly check-in', milestoneIndex: 0, estimateMinutes: 1 * HOUR },
      { title: 'Prepare the monthly report', milestoneIndex: 0, estimateMinutes: 2 * HOUR },
    ],
  },
];

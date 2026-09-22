/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as activities from "../activities.js";
import type * as auth from "../auth.js";
import type * as authFlows from "../authFlows.js";
import type * as billingChase from "../billingChase.js";
import type * as businessHours from "../businessHours.js";
import type * as clauses from "../clauses.js";
import type * as clients from "../clients.js";
import type * as comments from "../comments.js";
import type * as contacts from "../contacts.js";
import type * as credits from "../credits.js";
import type * as crons from "../crons.js";
import type * as deals from "../deals.js";
import type * as deliverables from "../deliverables.js";
import type * as documentSending from "../documentSending.js";
import type * as documentTemplates from "../documentTemplates.js";
import type * as documents from "../documents.js";
import type * as enquiries from "../enquiries.js";
import type * as files from "../files.js";
import type * as financeDocuments from "../financeDocuments.js";
import type * as financeSending from "../financeSending.js";
import type * as fx from "../fx.js";
import type * as holidays from "../holidays.js";
import type * as http from "../http.js";
import type * as invoiceSending from "../invoiceSending.js";
import type * as invoices from "../invoices.js";
import type * as lib_audit from "../lib/audit.js";
import type * as lib_authEmails from "../lib/authEmails.js";
import type * as lib_authPlugins from "../lib/authPlugins.js";
import type * as lib_businessTime from "../lib/businessTime.js";
import type * as lib_crm from "../lib/crm.js";
import type * as lib_deals from "../lib/deals.js";
import type * as lib_documentBlocks from "../lib/documentBlocks.js";
import type * as lib_documentEmails from "../lib/documentEmails.js";
import type * as lib_documentTemplateSeeds from "../lib/documentTemplateSeeds.js";
import type * as lib_documents from "../lib/documents.js";
import type * as lib_enquiries from "../lib/enquiries.js";
import type * as lib_files from "../lib/files.js";
import type * as lib_financeEmails from "../lib/financeEmails.js";
import type * as lib_functions from "../lib/functions.js";
import type * as lib_holidays from "../lib/holidays.js";
import type * as lib_hosts from "../lib/hosts.js";
import type * as lib_invoiceEmails from "../lib/invoiceEmails.js";
import type * as lib_invoices from "../lib/invoices.js";
import type * as lib_money from "../lib/money.js";
import type * as lib_notify from "../lib/notify.js";
import type * as lib_numbering from "../lib/numbering.js";
import type * as lib_permissions from "../lib/permissions.js";
import type * as lib_principals from "../lib/principals.js";
import type * as lib_projectStatus from "../lib/projectStatus.js";
import type * as lib_projectTemplates from "../lib/projectTemplates.js";
import type * as lib_projects from "../lib/projects.js";
import type * as lib_renderDocumentPdf from "../lib/renderDocumentPdf.js";
import type * as lib_seedData from "../lib/seedData.js";
import type * as lib_settings from "../lib/settings.js";
import type * as lib_signatureEmails from "../lib/signatureEmails.js";
import type * as lib_signatures from "../lib/signatures.js";
import type * as lib_statements from "../lib/statements.js";
import type * as lib_team from "../lib/team.js";
import type * as lib_time from "../lib/time.js";
import type * as lib_timeOff from "../lib/timeOff.js";
import type * as lib_timeOffFormat from "../lib/timeOffFormat.js";
import type * as lib_validation from "../lib/validation.js";
import type * as milestones from "../milestones.js";
import type * as notifications from "../notifications.js";
import type * as payments from "../payments.js";
import type * as pipeline from "../pipeline.js";
import type * as portalInvites from "../portalInvites.js";
import type * as principals from "../principals.js";
import type * as projectTemplates from "../projectTemplates.js";
import type * as projects from "../projects.js";
import type * as rateCard from "../rateCard.js";
import type * as reminderSending from "../reminderSending.js";
import type * as roles from "../roles.js";
import type * as seed from "../seed.js";
import type * as sessionActivity from "../sessionActivity.js";
import type * as settings from "../settings.js";
import type * as signatureCompletion from "../signatureCompletion.js";
import type * as signatureSending from "../signatureSending.js";
import type * as signatures from "../signatures.js";
import type * as signing from "../signing.js";
import type * as statementRendering from "../statementRendering.js";
import type * as statements from "../statements.js";
import type * as tasks from "../tasks.js";
import type * as team from "../team.js";
import type * as teamInvites from "../teamInvites.js";
import type * as time from "../time.js";
import type * as timeOff from "../timeOff.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  activities: typeof activities;
  auth: typeof auth;
  authFlows: typeof authFlows;
  billingChase: typeof billingChase;
  businessHours: typeof businessHours;
  clauses: typeof clauses;
  clients: typeof clients;
  comments: typeof comments;
  contacts: typeof contacts;
  credits: typeof credits;
  crons: typeof crons;
  deals: typeof deals;
  deliverables: typeof deliverables;
  documentSending: typeof documentSending;
  documentTemplates: typeof documentTemplates;
  documents: typeof documents;
  enquiries: typeof enquiries;
  files: typeof files;
  financeDocuments: typeof financeDocuments;
  financeSending: typeof financeSending;
  fx: typeof fx;
  holidays: typeof holidays;
  http: typeof http;
  invoiceSending: typeof invoiceSending;
  invoices: typeof invoices;
  "lib/audit": typeof lib_audit;
  "lib/authEmails": typeof lib_authEmails;
  "lib/authPlugins": typeof lib_authPlugins;
  "lib/businessTime": typeof lib_businessTime;
  "lib/crm": typeof lib_crm;
  "lib/deals": typeof lib_deals;
  "lib/documentBlocks": typeof lib_documentBlocks;
  "lib/documentEmails": typeof lib_documentEmails;
  "lib/documentTemplateSeeds": typeof lib_documentTemplateSeeds;
  "lib/documents": typeof lib_documents;
  "lib/enquiries": typeof lib_enquiries;
  "lib/files": typeof lib_files;
  "lib/financeEmails": typeof lib_financeEmails;
  "lib/functions": typeof lib_functions;
  "lib/holidays": typeof lib_holidays;
  "lib/hosts": typeof lib_hosts;
  "lib/invoiceEmails": typeof lib_invoiceEmails;
  "lib/invoices": typeof lib_invoices;
  "lib/money": typeof lib_money;
  "lib/notify": typeof lib_notify;
  "lib/numbering": typeof lib_numbering;
  "lib/permissions": typeof lib_permissions;
  "lib/principals": typeof lib_principals;
  "lib/projectStatus": typeof lib_projectStatus;
  "lib/projectTemplates": typeof lib_projectTemplates;
  "lib/projects": typeof lib_projects;
  "lib/renderDocumentPdf": typeof lib_renderDocumentPdf;
  "lib/seedData": typeof lib_seedData;
  "lib/settings": typeof lib_settings;
  "lib/signatureEmails": typeof lib_signatureEmails;
  "lib/signatures": typeof lib_signatures;
  "lib/statements": typeof lib_statements;
  "lib/team": typeof lib_team;
  "lib/time": typeof lib_time;
  "lib/timeOff": typeof lib_timeOff;
  "lib/timeOffFormat": typeof lib_timeOffFormat;
  "lib/validation": typeof lib_validation;
  milestones: typeof milestones;
  notifications: typeof notifications;
  payments: typeof payments;
  pipeline: typeof pipeline;
  portalInvites: typeof portalInvites;
  principals: typeof principals;
  projectTemplates: typeof projectTemplates;
  projects: typeof projects;
  rateCard: typeof rateCard;
  reminderSending: typeof reminderSending;
  roles: typeof roles;
  seed: typeof seed;
  sessionActivity: typeof sessionActivity;
  settings: typeof settings;
  signatureCompletion: typeof signatureCompletion;
  signatureSending: typeof signatureSending;
  signatures: typeof signatures;
  signing: typeof signing;
  statementRendering: typeof statementRendering;
  statements: typeof statements;
  tasks: typeof tasks;
  team: typeof team;
  teamInvites: typeof teamInvites;
  time: typeof time;
  timeOff: typeof timeOff;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("../betterAuth/_generated/component.js").ComponentApi<"betterAuth">;
};

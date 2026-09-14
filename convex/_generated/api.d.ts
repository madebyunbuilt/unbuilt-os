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
import type * as businessHours from "../businessHours.js";
import type * as clients from "../clients.js";
import type * as contacts from "../contacts.js";
import type * as crons from "../crons.js";
import type * as files from "../files.js";
import type * as holidays from "../holidays.js";
import type * as http from "../http.js";
import type * as lib_audit from "../lib/audit.js";
import type * as lib_authEmails from "../lib/authEmails.js";
import type * as lib_authPlugins from "../lib/authPlugins.js";
import type * as lib_businessTime from "../lib/businessTime.js";
import type * as lib_crm from "../lib/crm.js";
import type * as lib_files from "../lib/files.js";
import type * as lib_functions from "../lib/functions.js";
import type * as lib_holidays from "../lib/holidays.js";
import type * as lib_hosts from "../lib/hosts.js";
import type * as lib_money from "../lib/money.js";
import type * as lib_notify from "../lib/notify.js";
import type * as lib_numbering from "../lib/numbering.js";
import type * as lib_permissions from "../lib/permissions.js";
import type * as lib_principals from "../lib/principals.js";
import type * as lib_seedData from "../lib/seedData.js";
import type * as lib_settings from "../lib/settings.js";
import type * as lib_team from "../lib/team.js";
import type * as lib_timeOff from "../lib/timeOff.js";
import type * as lib_timeOffFormat from "../lib/timeOffFormat.js";
import type * as lib_validation from "../lib/validation.js";
import type * as notifications from "../notifications.js";
import type * as portalInvites from "../portalInvites.js";
import type * as principals from "../principals.js";
import type * as rateCard from "../rateCard.js";
import type * as roles from "../roles.js";
import type * as seed from "../seed.js";
import type * as sessionActivity from "../sessionActivity.js";
import type * as settings from "../settings.js";
import type * as team from "../team.js";
import type * as teamInvites from "../teamInvites.js";
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
  businessHours: typeof businessHours;
  clients: typeof clients;
  contacts: typeof contacts;
  crons: typeof crons;
  files: typeof files;
  holidays: typeof holidays;
  http: typeof http;
  "lib/audit": typeof lib_audit;
  "lib/authEmails": typeof lib_authEmails;
  "lib/authPlugins": typeof lib_authPlugins;
  "lib/businessTime": typeof lib_businessTime;
  "lib/crm": typeof lib_crm;
  "lib/files": typeof lib_files;
  "lib/functions": typeof lib_functions;
  "lib/holidays": typeof lib_holidays;
  "lib/hosts": typeof lib_hosts;
  "lib/money": typeof lib_money;
  "lib/notify": typeof lib_notify;
  "lib/numbering": typeof lib_numbering;
  "lib/permissions": typeof lib_permissions;
  "lib/principals": typeof lib_principals;
  "lib/seedData": typeof lib_seedData;
  "lib/settings": typeof lib_settings;
  "lib/team": typeof lib_team;
  "lib/timeOff": typeof lib_timeOff;
  "lib/timeOffFormat": typeof lib_timeOffFormat;
  "lib/validation": typeof lib_validation;
  notifications: typeof notifications;
  portalInvites: typeof portalInvites;
  principals: typeof principals;
  rateCard: typeof rateCard;
  roles: typeof roles;
  seed: typeof seed;
  sessionActivity: typeof sessionActivity;
  settings: typeof settings;
  team: typeof team;
  teamInvites: typeof teamInvites;
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

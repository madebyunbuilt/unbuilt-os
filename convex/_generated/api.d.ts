/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as authFlows from "../authFlows.js";
import type * as http from "../http.js";
import type * as lib_audit from "../lib/audit.js";
import type * as lib_authEmails from "../lib/authEmails.js";
import type * as lib_authPlugins from "../lib/authPlugins.js";
import type * as lib_businessTime from "../lib/businessTime.js";
import type * as lib_functions from "../lib/functions.js";
import type * as lib_money from "../lib/money.js";
import type * as lib_numbering from "../lib/numbering.js";
import type * as lib_permissions from "../lib/permissions.js";
import type * as lib_principals from "../lib/principals.js";
import type * as principals from "../principals.js";
import type * as roles from "../roles.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  authFlows: typeof authFlows;
  http: typeof http;
  "lib/audit": typeof lib_audit;
  "lib/authEmails": typeof lib_authEmails;
  "lib/authPlugins": typeof lib_authPlugins;
  "lib/businessTime": typeof lib_businessTime;
  "lib/functions": typeof lib_functions;
  "lib/money": typeof lib_money;
  "lib/numbering": typeof lib_numbering;
  "lib/permissions": typeof lib_permissions;
  "lib/principals": typeof lib_principals;
  principals: typeof principals;
  roles: typeof roles;
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

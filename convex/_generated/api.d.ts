/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as apiKeys from "../apiKeys.js";
import type * as auth from "../auth.js";
import type * as companion from "../companion.js";
import type * as crons from "../crons.js";
import type * as http from "../http.js";
import type * as labels from "../labels.js";
import type * as lib_apiKeyHash from "../lib/apiKeyHash.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_validateSecret from "../lib/validateSecret.js";
import type * as memberships from "../memberships.js";
import type * as organizations from "../organizations.js";
import type * as pendingApprovals from "../pendingApprovals.js";
import type * as promptHistory from "../promptHistory.js";
import type * as promptTemplates from "../promptTemplates.js";
import type * as repos from "../repos.js";
import type * as seeds from "../seeds.js";
import type * as sessionEvents from "../sessionEvents.js";
import type * as sessionMessages from "../sessionMessages.js";
import type * as sessions from "../sessions.js";
import type * as subtasks from "../subtasks.js";
import type * as tasks from "../tasks.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  apiKeys: typeof apiKeys;
  auth: typeof auth;
  companion: typeof companion;
  crons: typeof crons;
  http: typeof http;
  labels: typeof labels;
  "lib/apiKeyHash": typeof lib_apiKeyHash;
  "lib/auth": typeof lib_auth;
  "lib/validateSecret": typeof lib_validateSecret;
  memberships: typeof memberships;
  organizations: typeof organizations;
  pendingApprovals: typeof pendingApprovals;
  promptHistory: typeof promptHistory;
  promptTemplates: typeof promptTemplates;
  repos: typeof repos;
  seeds: typeof seeds;
  sessionEvents: typeof sessionEvents;
  sessionMessages: typeof sessionMessages;
  sessions: typeof sessions;
  subtasks: typeof subtasks;
  tasks: typeof tasks;
  users: typeof users;
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

export declare const components: {};

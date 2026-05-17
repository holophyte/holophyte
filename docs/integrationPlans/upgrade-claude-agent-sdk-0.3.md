# Prompt: Upgrade `@anthropic-ai/claude-agent-sdk` to `0.3.143`

Upgrade Holophyte from `@anthropic-ai/claude-agent-sdk@0.2.141` to the latest `0.3.x` release.

Before starting, run `npm info @anthropic-ai/claude-agent-sdk dist-tags.latest` to get the current latest version and use that instead of the `0.3.143` referenced below (the SDK ships patches frequently).

Context:
- The current dependency-upgrade branch has already upgraded compatible dependencies and added security overrides.
- `@anthropic-ai/claude-agent-sdk@0.3.142` includes documented breaking changes:
  - Removed deprecated v2 session APIs: `unstable_v2_createSession`, `unstable_v2_resumeSession`, `unstable_v2_prompt`, `SDKSession`, and `SDKSessionOptions`.
  - MCP servers connect in the background by default. Sessions may start before slow MCP servers are ready, with pending status in `init`.
  - Headless and SDK sessions use Task tools (`TaskCreate`, `TaskUpdate`, `TaskGet`, `TaskList`) instead of `TodoWrite`.
  - `@anthropic-ai/sdk` and `@modelcontextprotocol/sdk` are peer dependencies in `0.3.143`, though runtime remains bundled according to the changelog.

Tasks:
1. Update `@anthropic-ai/claude-agent-sdk` to `0.3.143`.
2. Inspect all direct imports and type usages:
   - `src/claude/manager.ts`
   - `src/claude/manager.test.ts`
   - `src/frontend/hooks/useHolophyteChat.ts`
   - `src/frontend/hooks/useSession.ts`
   - `src/frontend/lib/sdkToUIMessages.ts`
   - related tests under `src/frontend/**`
3. Verify Holophyte does not use removed v2 session APIs. If it does, migrate to `query()` with `options.resume` or an `AsyncIterable<SDKUserMessage>`.
4. Update SDK event parsing for Task tools if any code assumes `TodoWrite` snapshot semantics.
5. Review MCP status handling for non-blocking connection startup. Preserve existing user-facing behavior where possible.
6. Keep the security overrides only where still necessary after the upgrade.
7. Run:
   - `bun audit`
   - `bun run lint`
   - `bunx tsc --noEmit`
   - `bunx vitest run src/claude src/frontend/lib src/frontend/hooks`
   - Full `bun run test` if focused tests pass

Acceptance criteria:
- No TypeScript errors.
- Existing Claude session manager tests pass.
- SDK message rendering tests pass.
- `bun audit` reports no vulnerabilities.
- Any behavioral changes from the SDK 0.3 migration are documented in the final response.

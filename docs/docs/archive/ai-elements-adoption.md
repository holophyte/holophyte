**Status: shipped.** This proposal was implemented across PRs #240, #241, #242, and #243. Kept for historical context.

---

# AI Elements Adoption Plan

Proposal to adopt [AI Elements](https://elements.ai-sdk.dev/) as the component library for all AI-related UI in Holophyte, replacing the current assistant-ui primitives and custom components.

## Decisions

- **UI components**: AI Elements via shadcn registry + post-install import fix script
- **Data layer**: `useHolophyteChat` hook — returns same shape as `useChat`, normalizes Convex session data so Elements components work unmodified
- **AI SDK**: Adopt for non-session AI features (inline chat, smart task creation, etc.)
- **AI provider routing**: Vercel AI Gateway (`AI_GATEWAY_API_KEY`) — unified API key, built-in observability (cost, latency, token usage), same model selection as OpenRouter
- **Framework**: Stay on Bun.serve() SPA. No Next.js migration — our app is real-time/SPA-shaped, not SSR-shaped. Migration is straightforward if ever needed.
- **Companion server**: Stays on Bun.serve() regardless — needs local machine access

## Motivation

The current session UI is functional but visually rough:

- Bash/tool results render as plain `<pre>` text with no ANSI support
- Code blocks use basic rehype-highlight — no copy button, language label, or line numbers
- File paths from Glob/Read display as flat text
- Thinking state is a minimal "Thinking... Ns" indicator
- Tool calls use custom expandable boxes that work but lack polish
- Approval UI is functional but basic

AI Elements provides polished, composable components purpose-built for AI interfaces that would significantly upgrade the session experience.

## Key Finding: No AI SDK Lock-in

Despite being part of the Vercel AI SDK ecosystem, **every Elements component we need is purely prop-driven** with zero hard dependencies on AI SDK hooks.

### Installation Model

Elements uses the **shadcn registry pattern** — the `ai-elements` CLI is a thin wrapper around `shadcn add` pointing to `https://elements.ai-sdk.dev/api/registry/`. Each component is a JSON file containing the full source, dependencies, and target path.

```bash
# Install a component
bunx shadcn add https://elements.ai-sdk.dev/api/registry/terminal.json

# Install all
bunx shadcn add https://elements.ai-sdk.dev/api/registry/all.json
```

The copied source uses `@repo/shadcn-ui` imports that need remapping. A post-install script handles this:

```bash
# scripts/fix-elements-imports.sh
# Run after any shadcn add from the Elements registry
find src/frontend/components/ai-elements -name '*.tsx' \
  -exec sed -i '' \
    -e 's|@repo/shadcn-ui/components/ui/|@/frontend/components/ui/|g' \
    -e 's|@repo/shadcn-ui/lib/utils|@/frontend/lib/utils|g' \
    {} +
```

**Updating components:** Re-run `shadcn add` for the component, run the import fix script, `git diff` to review changes, commit. No fork to maintain.

### Component Dependencies

The components import:

| Import | What it is | We have? |
|---|---|---|
| `@repo/shadcn-ui/components/ui/*` | shadcn components (Button, Badge, etc.) | Yes — `@/frontend/components/ui/` |
| `@repo/shadcn-ui/lib/utils` | `cn()` helper | Yes — `@/frontend/lib/utils` |
| `lucide-react` | Icons | Yes |
| `ai` (types only) | `ToolUIPart`, `UIMessage` | Comes with AI SDK adoption |
| `streamdown` + plugins | Markdown rendering | Replaces react-markdown + rehype-highlight |
| `ansi-to-react` | ANSI terminal colors | New dep |
| `shiki` | Syntax highlighting | Replaces rehype-highlight |
| `use-stick-to-bottom` | Auto-scroll | Replaces custom scroll logic |
| `class-variance-authority` | Component variants | Already using |

**No component calls `useChat()`.** The `ai` package import is type-only (`import type { ToolUIPart }`) — used for the tool state enum and message role type. Since we're adopting the AI SDK for layer 2 features anyway, these types come for free.

### Component Audit

| Component | AI SDK hooks? | Props-only? | Replaces |
|-----------|:---:|:---:|---|
| Terminal | None | Yes | Bash tool result (`<pre>` blocks) |
| CodeBlock | None | Yes | rehype-highlight code blocks |
| Tool | None | Yes | `ToolCallDisplay` + `ToolCallFallback` |
| Message | None | Yes | `CustomAssistantMessage` / `CustomUserMessage` |
| MessageResponse | None | Yes | `MarkdownText` (react-markdown) |
| Confirmation | None | Yes | `ApprovalButtons` |
| FileTree | None | Yes | Glob/Read results (flat text) |
| ChainOfThought | None | Yes | `ThinkingIndicator` |
| Queue | None | Yes | Queued session warning banner |
| Reasoning | Has `useReasoning()` context | Yes (controllable via props) | No equivalent yet |
| Conversation | None | Yes | `SessionThread` scroll/auto-stick behavior |
| Prompt Input | None | Yes | `SessionComposer` — has built-in Command palette for slash commands, file attachments, model selector, auto-resize. We add: up-arrow message history, stop-on-enter. |
| Suggestion | None | Yes | No equivalent yet — horizontal row of clickable prompt chips (quick actions, prompt template shortcuts, follow-up suggestions) |
| Checkpoint | None | Yes | No equivalent yet — visual conversation breakpoints with restore capability. For sessions: manual save points before risky approvals, visual markers for session milestones. |

#### Future Pass Components

Not part of the initial migration, but worth adopting as we build out session features:

| Component | Use in Holophyte | Notes |
|-----------|-----------------|-------|
| Commit | Display git commits made during sessions | Hash, author, color-coded file changes (added/modified/deleted), line counts |
| Plan | Display ExitPlanMode plans for user approval | Collapsible with streaming shimmer. Maps to the "Plan mode" backlog task |
| TestResults | Render vitest/playwright output from sessions | Pass/fail/skip counts, progress bar, collapsible suites, error + stack trace per test |
| StackTrace | Render errors from test runs / build failures | Parses JS/Node stack traces, dims internal frames, clickable file paths |
| Image | Render screenshots/images in session messages | |
| SpeechInput | Voice-to-text prompt input (accessibility) | Web Speech API + MediaRecorder fallback, cross-browser. Slots into PromptInput toolbar |
| AudioPlayer | TTS playback of assistant responses (accessibility) | Composable controls (play, seek, volume). Pair with AI SDK speechSynth |
| Transcription | Live captions / read-along for audio (accessibility) | Click-to-seek, auto-highlights active segment. Pairs with AudioPlayer |
| Sources / InlineCitation | Reference links in AI responses | |
| Artifact | Display generated files as standalone artifacts | |
| Shimmer | Loading states throughout the app | |
| Connection | Companion connection status indicator | |

### Source Verification

Components were verified by reading source from [github.com/vercel/ai-elements](https://github.com/vercel/ai-elements) (`packages/elements/src/`). Key findings:

- **Terminal** (`terminal.tsx`): Pure React context + props. Uses `ansi-to-react` for ANSI rendering, internal context for output/streaming state. Zero external hook dependencies.
- **Tool** (`tool.tsx`): Built on Radix `Collapsible`. Uses `import type { ToolUIPart } from 'ai'` for state types only. Renders CodeBlock for JSON input/output.
- **Message** (`message.tsx`): Uses `import type { UIMessage } from 'ai'` for the `from` role type only. Renders markdown via `Streamdown` (not react-markdown).
- **Confirmation** (`confirmation.tsx`): Uses `import type { ToolUIPart } from 'ai'` for state enum only. Internal context for approval state, conditional rendering based on props.

## Architecture: Dual Data Source Model

Holophyte has two distinct AI data flows that need different transport but the same visual components:

### 1. Companion Sessions (existing)

Claude Agent SDK events persisted to Convex, consumed via real-time queries.

```
Claude Agent SDK → Convex mutations → real-time queries → React
```

This is persistent, resumable, multi-session, and multi-client. The AI SDK's `useChat` (HTTP streaming) is not a fit here — Convex real-time is fundamentally better for this use case.

### 2. Future AI Features (planned)

Standalone AI interactions not tied to companion sessions — inline chat, smart task creation, AI search, prompt suggestions. Standard request/response pattern.

```
Frontend → useChat() → Bun.serve() route → AI SDK streamText() → AI Gateway → model
```

These map perfectly to the AI SDK's intended usage. AI Gateway handles provider routing (Anthropic, OpenAI, Google, etc.) with a single API key and provides observability (cost tracking, latency, token counts) in the Vercel dashboard.

### Unified Hook: `useHolophyteChat`

Rather than wrapping every component, a single `useHolophyteChat` hook normalizes Convex session data into the same shape that `useChat` returns. Components don't care where data comes from — they get the same props either way:

```tsx
// AI SDK features — native hook
const chat = useChat({ api: '/api/chat' });

// Session panel — same shape, different source
const chat = useHolophyteChat({ sessionId });

// Both work identically with Elements components
<Message from={msg.role}>
  <MessageResponse>{msg.content}</MessageResponse>
</Message>
```

This replaces the current `SessionRuntimeProvider` + `sdkToThreadMessages` pipeline. The conversion logic already exists — it just needs to target `UIMessage[]` (AI SDK type) instead of `ThreadMessageLike[]` (assistant-ui type).

#### API Surface Mapping

| `useChat` return | What it does | `useHolophyteChat` equivalent |
|---|---|---|
| `messages` | `UIMessage[]` — the conversation | `sdkToThreadMessages()` reshaped to `UIMessage[]` |
| `status` | `'ready' \| 'submitted' \| 'streaming' \| 'error'` | Map from session status: `idle`→`ready`, `queued`→`submitted`, `running`→`streaming` |
| `id` | Chat session ID | `sessionId` from Convex |
| `error` | Error if request failed | Session error state from Convex |
| `sendMessage` | Send a new message | Existing `sendMessage()` from `SessionActionsContext` |
| `stop` | Stop streaming | Existing `handleStop()` |
| `setMessages` | Local optimistic update | Existing `addOptimisticMessage()` |
| `addToolApprovalResponse` | Respond to tool approval | Existing `approve()` / `deny()` |
| `addToolOutput` | Record tool execution results | N/A — companion handles tool execution |
| `regenerate` | Recreate last response | N/A — doesn't apply to Agent SDK sessions |
| `resumeStream` | Resume after disconnect | N/A — Convex handles reconnection |
| `clearError` | Clear error state | Could implement if needed |

The core overlap is strong — `messages`, `status`, `sendMessage`, `stop`, `addToolApprovalResponse`, and `setMessages` all map directly. Methods that don't apply (`regenerate`, `addToolOutput`) would be no-ops.

This approach means:
- **One hook to maintain** instead of N component wrappers
- **Elements components work unmodified** with either data source
- **Incremental migration** — build the hook, swap it in, components don't change
- **If `useChat` API evolves**, update one hook instead of every wrapper

## Migration Scope

### What Changes

**Remove:**
- `@assistant-ui/react` dependency and all `*Primitive` usage (`MessagePrimitive`, `ThreadPrimitive`, `ComposerPrimitive`)
- `makeAssistantToolUI` registration pattern
- Custom `ToolCallDisplay`, `ToolCallFallback`, `ApprovalButtons`, `ThinkingIndicator`, `MarkdownText`
- `react-markdown`, `rehype-highlight`, `remark-gfm` (replaced by Streamdown)

**Add:**
- Copied Elements component files (adapted imports)
- `ai`, `@ai-sdk/react`, `@ai-sdk/anthropic` (or gateway provider)
- `streamdown`, `@streamdown/code`, `@streamdown/math`, `@streamdown/cjk`, `@streamdown/mermaid`
- `ansi-to-react`, `shiki`, `use-stick-to-bottom`

**Rewrite:**
- `SessionRuntimeProvider` + `sdkToThreadMessages` → `useHolophyteChat` hook (returns `useChat`-compatible shape, normalizes Convex session data to `UIMessage[]`)
- `SessionThread` — replace `ThreadPrimitive.Viewport` / `ThreadPrimitive.Messages` with Elements' `Conversation` / `ConversationContent`
- `SessionComposer` → Elements `PromptInput` with `PromptInputCommand*` sub-components for slash commands. Add custom up-arrow message history hook and stop-on-enter keyboard handling.

**Keep as-is:**
- `useSession` hook (Convex subscriptions)
- `SessionActionsContext` (approve/deny/stop actions)
- Convex data flow and companion polling
- Slash command menu (Holophyte-specific)
- Bun.serve() server (companion + frontend)

### New Capabilities

Components that add functionality we don't have today:

- **Terminal**: ANSI color rendering, streaming cursor, clear button
- **FileTree**: Interactive expand/collapse tree with file icons and selection
- **ChainOfThought**: Step-by-step reasoning display with status indicators (complete/active/pending)
- **Reasoning**: Collapsible thinking blocks with duration and streaming state
- **Queue**: Structured queue visualization (replaces plain warning banner)
- **Conversation**: Sticky scroll with auto-hide scroll button (replaces custom scroll logic)
- **CodeBlock**: Shiki syntax highlighting with copy button, language label, line numbers, light/dark theme switching

## Elements Component API Reference

Quick reference for the components we'd adopt. All are composable (sub-components) following shadcn/ui conventions.

### Terminal

```tsx
<Terminal output={ansiString} isStreaming={true} autoScroll={true}>
  <TerminalHeader>
    <TerminalTitle>bash</TerminalTitle>
    <TerminalActions><TerminalCopyButton /></TerminalActions>
  </TerminalHeader>
  <TerminalContent />
</Terminal>
```

Props: `output` (string w/ ANSI), `isStreaming`, `autoScroll`, `onClear`, `className`

### CodeBlock

```tsx
<CodeBlock code={code} language="typescript" showLineNumbers>
  <CodeBlockHeader>
    <CodeBlockTitle><CodeBlockFilename>utils.ts</CodeBlockFilename></CodeBlockTitle>
    <CodeBlockActions><CodeBlockCopyButton /></CodeBlockActions>
  </CodeBlockHeader>
</CodeBlock>
```

Props: `code`, `language` (Shiki BundledLanguage), `showLineNumbers`, `className`
Uses Shiki for syntax highlighting with automatic light/dark theme switching.

### Tool

```tsx
<Tool defaultOpen>
  <ToolHeader
    type="tool-bash"
    state="output-available"  // or "approval-requested", "output-error", etc.
    title="Running command"
  />
  <ToolContent>
    <ToolInput input={{ command: "ls -la" }} />
    <ToolOutput output={<Terminal output={result} />} />
  </ToolContent>
</Tool>
```

States: `input-streaming` | `input-available` | `approval-requested` | `approval-responded` | `output-available` | `output-error` | `output-denied`

### Confirmation

```tsx
<Confirmation approval={approval} state="approval-requested">
  <ConfirmationTitle>Tool requires approval</ConfirmationTitle>
  <ConfirmationRequest>Run bash command?</ConfirmationRequest>
  <ConfirmationActions>
    <ConfirmationAction onClick={approve}>Allow</ConfirmationAction>
    <ConfirmationAction onClick={deny} variant="outline">Deny</ConfirmationAction>
  </ConfirmationActions>
  <ConfirmationAccepted>Approved</ConfirmationAccepted>
  <ConfirmationRejected>Denied</ConfirmationRejected>
</Confirmation>
```

Renders conditionally based on `approval` existence and `state` value.

### FileTree

```tsx
<FileTree
  selectedPath={selected}
  onSelect={setSelected}
  defaultExpanded={new Set(['/src'])}
>
  <FileTreeFolder path="/src" name="src">
    <FileTreeFile path="/src/index.ts" name="index.ts" />
    <FileTreeFile path="/src/utils.ts" name="utils.ts" />
  </FileTreeFolder>
</FileTree>
```

Props: `expanded`, `defaultExpanded` (Set), `selectedPath`, `onSelect`, `onExpandedChange`

### ChainOfThought

```tsx
<ChainOfThought defaultOpen>
  <ChainOfThoughtHeader>Reasoning</ChainOfThoughtHeader>
  <ChainOfThoughtContent>
    <ChainOfThoughtStep label="Analyzing" status="complete" />
    <ChainOfThoughtStep label="Planning" status="active" />
    <ChainOfThoughtStep label="Implementing" status="pending" />
  </ChainOfThoughtContent>
</ChainOfThought>
```

Step status: `complete` | `active` | `pending`

### Reasoning

```tsx
<Reasoning isStreaming={true} duration={12} defaultOpen>
  <ReasoningTrigger />
  <ReasoningContent>Thinking about the approach...</ReasoningContent>
</Reasoning>
```

Props: `isStreaming`, `duration` (seconds), `open`/`defaultOpen`/`onOpenChange`
Has `useReasoning()` context hook but fully controllable via props.

### Message

```tsx
<Message from="assistant">
  <MessageResponse components={{ code: CustomCode }}>
    {markdownContent}
  </MessageResponse>
  <MessageActions>
    <MessageAction label="Copy" tooltip="Copy message" onClick={copy} />
  </MessageActions>
</Message>
```

`MessageResponse` uses Streamdown with plugins (code, math, CJK, mermaid). Accepts custom `components` for markdown elements. Requires Streamdown CSS import.

### Conversation

```tsx
<Conversation>
  <ConversationContent>
    {messages.map(m => <Message key={m.id} ... />)}
  </ConversationContent>
  <ConversationScrollButton />
</Conversation>
```

Handles auto-scroll-to-bottom with a scroll button that appears when user scrolls up.

## Sequencing

**Phase 1: Adopt for a new AI feature (low risk)**
Pick one of the planned non-session AI features (e.g., inline AI chat). Use AI SDK + AI Gateway + Elements natively. Validates the library in the happy path, establishes patterns. Set up `AI_GATEWAY_API_KEY` and verify observability in Vercel dashboard.

**Phase 2: Migrate session panel (medium effort)**
Replace assistant-ui primitives with Elements components. Biggest chunk of work is rewiring `SessionRuntimeProvider` and `sdkToThreadMessages`. Visual upgrade is immediate.

**Phase 3: Expand component usage**
Add FileTree rendering for Glob/Read results, Terminal for Bash output, ChainOfThought for reasoning steps. These are incremental improvements on top of the Phase 2 foundation.

## Why Not Next.js

Evaluated thoroughly and decided against. Full analysis below.

### What Next.js would give us

1. **preloadQuery for initial page loads** — Convex data on first paint instead of spinners. But: the board route is where users spend 95% of their time, the spinner is a one-time cost per session, and Convex SSR is still beta (two `preloadQuery` calls aren't guaranteed consistent).
2. **Vercel-native preview deployments** — Automatic deploy URLs per PR/branch. But: Vercel preview deployments work for any framework, not just Next.js. We already get preview URLs.
3. **Middleware for auth redirects** — Redirect before page renders. But: our client-side auth flow with `Authenticated`/`Unauthenticated` wrappers and auto-login already handles this.
4. **Built-in image optimization, metadata, analytics** — Real features, but Holophyte is an authenticated dashboard. No public pages, no SEO, no marketing landing page.

### What Next.js would cost us

1. **`use client` everywhere** — 27+ component files use Convex `useQuery`/`useMutation`. Nearly every non-trivial component needs a persistent WebSocket (Client Component). We'd be writing `'use client'` on almost every file — the exact experience that's frustrating at work.
2. **Loss of server simplicity** — `server.ts` is 80 lines with 4 routes. Next.js replaces this with `next.config.js` rewrites, API routes, and file-based routing. The companion server must stay on Bun regardless, so we'd end up running two servers in development.
3. **TanStack Router regression** — We have type-safe route params (`$repoId`, `$taskId`) with compile-time validation in a single 66-line file. Next.js replaces this with 6+ directories of `page.tsx` files and loosely typed params. File-based routing is a daily friction point.
4. **Build pipeline rework** — `scripts/build.ts` handles Convex preview deploys, auth key setup, and config generation in one coordinated script. Next.js doesn't simplify the Convex deployment choreography; it relocates it.
5. **E2E test infrastructure** — Playwright currently starts Bun.serve() directly. Would need rework to start a Next.js dev server with different startup characteristics and env var loading.
6. **Companion co-location loss** — Currently SPA + local routes + companion polling run in one process. Elegant. Next.js splits this into two servers with a more complex frontend-backend boundary.

### Conclusion

The cost-benefit doesn't justify migration. We'd pay real costs (migration effort, two servers, file-based routing friction, E2E rework) for marginal benefits (slightly faster initial loads on a dashboard that stays open in a tab). Every tool we're adopting (AI Elements, AI SDK, AI Gateway) is framework-agnostic.

If the calculus changes later (public-facing pages, Convex SSR leaving beta, hiring devs who expect Next.js), the migration path is clean — our React + Convex + Zustand code is framework-agnostic. We're not accumulating debt by staying on Bun.serve().

## Open Questions

- **Prompt Input**: ~~Need to evaluate Elements' prompt input component against our `SessionComposer`.~~ **Resolved**: Elements' `PromptInput` has built-in `PromptInputCommand*` sub-components (wrapping cmdk) for slash commands, plus file attachments, model selector, auto-resize, and screenshot capture. We adopt it and add two custom behaviors: up-arrow message history and stop-on-enter during streaming.
- **Streamdown CSS**: `MessageResponse` requires a Streamdown CSS import (`@source "../node_modules/streamdown/dist/*.js"`). Need to verify compatibility with our Tailwind v4 / bun-plugin-tailwind setup.
- **Shiki bundle size**: CodeBlock uses Shiki instead of rehype-highlight. Shiki is heavier but more accurate — need to check impact on bundle.
- **Package stability**: AI Elements is new. Need to evaluate release cadence, breaking change policy, and whether we'd pin to a specific version.
- **assistant-ui removal**: Confirm no other parts of the app depend on assistant-ui before removing.
- **Cross-component imports**: Some Elements components import others (e.g., Tool imports CodeBlock). Need to verify these resolve correctly after the import fix script runs.

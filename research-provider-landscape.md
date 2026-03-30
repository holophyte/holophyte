# AI Coding Agent Provider Landscape

Research on CLI tools, SDKs, and programmatic integration paths for potential multi-provider support in Holophyte.

## Integration Tiers

| Tier | Criteria | Providers |
|--|--|--|
| **Tier 1** | Full SDK or API with per-tool approval, session management, streaming events | Claude Code, Codex (app-server), Kilo |
| **Tier 2** | SDK exists or coming, structured output, but missing key features | Gemini CLI |
| **Tier 3** | CLI with structured output but closed source or limited | Cursor |
| **Not viable** | No SDK, no structured output, or no CLI at all | Crush, Aider, Goose, Qwen/GLM/Kimi (API-only) |

---

## Tier 1: Full Integration Possible

### Claude Code (Current)

- **Package:** `@anthropic-ai/claude-agent-sdk`
- **Integration:** SDK spawns `cli.js` (Claude Code) as subprocess, provides typed async iterator
- **Approval:** `canUseTool` callback — per-tool-call, programmatic
- **Session resume:** `options.resume` with `session_id` from `system/init` event
- **Model switching:** `iterator.setModel()` mid-session
- **MCP control:** Full — `setMcpServers()`, `reconnectMcpServer()`, `toggleMcpServer()`, `mcpServerStatus()`
- **Skill discovery:** `supportedCommands()`, `supportedModels()`, `supportedAgents()`
- **Subagent observation:** Hooks, `parent_tool_use_id`
- **Open source:** Partial (SDK on GitHub)
- **Auth:** `CLAUDE_CODE_OAUTH_TOKEN` (subscription) or `ANTHROPIC_API_KEY` (pay-per-token)
- **Status:** Currently integrated in Holophyte

### OpenAI Codex (Planned)

- **Integration path:** `codex app-server` (JSON-RPC 2.0 over stdio), NOT `@openai/codex-sdk`
- **Client library:** `codex-app-server-client` (npm, zero deps, typed)
- **Approval:** `item/requestApproval` JSON-RPC server requests — per-tool-call
- **Session resume:** `thread/resume` with threadId
- **Model switching:** Via JSON-RPC protocol (not mid-session in SDK, but available in app-server)
- **MCP:** CLI config only, no programmatic management
- **Skills:** `.agents/skills/` directories with `SKILL.md`, `$skill-name` invocation (CLI only, not via SDK)
- **Multi-agent:** Built-in (max_threads: 6, configurable roles), but opaque to SDK
- **Open source:** Yes, Apache-2.0 (github.com/openai/codex, 68k stars, Rust core)
- **Auth:** `CODEX_API_KEY` env var or existing `codex login` credentials (`~/.codex/auth.json`)
- **Status:** Planned — see `research.md` for full integration plan

### Kilo (KiloCode) — New Finding

- **Repo:** [Kilo-Org/kilocode](https://github.com/Kilo-Org/kilocode) (17,350 stars, MIT)
- **Package:** `@kilocode/sdk` (v7.1.9, ~153K weekly downloads), `@kilocode/cli` (~33K/week)
- **What it is:** Open-source AI coding agent platform, fork of Roo Code (which forked from Cline). VS Code extension + CLI + SDK.
- **Claims:** "1.5M+ Kilo Coders, 25T+ tokens processed, #1 coding agent on OpenRouter"

#### SDK Architecture

Unlike Claude (async iterator over stdio) and Codex (JSON-RPC over stdio), Kilo uses a **REST API** pattern:

```typescript
import { createKilo } from '@kilocode/sdk';

const kilo = await createKilo({
  port: 4096,
  config: { /* provider keys, modes, MCP servers */ }
});

// kilo.client gives you a typed API client
// kilo.server manages the underlying kilo process
```

`createKilo()` spawns `kilo serve` (a local HTTP server) and returns a typed client generated from an OpenAPI spec.

#### API Surface (107 endpoints)

**Sessions:**
- `POST /session` — create session
- `POST /session/{id}/message` — send message (streams response)
- `GET /session/{id}/message` — retrieve messages
- `POST /session/{id}/abort` — abort
- `POST /session/{id}/fork` — fork session
- `POST /session/{id}/summarize` — summarize context

**Permissions (Per-Tool Approval):**
- `GET /permission` — list pending permission requests across all sessions
- `POST /permission/{id}/reply` — approve or deny
- `POST /permission/{id}/always-rules` — persistent allow rules
- `POST /session/{id}/permissions/{permissionID}` — per-session permission

**Config:**
- `GET /config` / `PATCH /config` — read/update configuration
- `GET /config/providers` — list available providers

**MCP:**
- `GET /mcp` / `POST /mcp` — list/configure MCP servers
- `POST /mcp/{name}/connect` / `POST /mcp/{name}/disconnect`

**Files:**
- `GET /file` — list files
- `GET /file/content` — read file content
- `GET /file/status` — git status

**PTY (Terminal):**
- `GET /pty` / `POST /pty` — list/create terminals
- `GET /pty/{id}/connect` — WebSocket terminal connection

**Cloud/Auth:**
- `PUT /auth/{providerID}` — set provider credentials
- `POST /provider/{id}/oauth/authorize` / `/oauth/callback` — OAuth flows
- `POST /kilo/organization` — cloud organization management

#### Model Support (400+)

- **Anthropic:** Claude 4 Sonnet, Claude 4 Opus
- **OpenAI:** GPT-5, GPT-4o
- **Google:** Gemini 2.5 Pro
- **Groq, Ollama, LM Studio** (local models)
- **OpenRouter** (any model)
- **BYOK:** Bring your own API keys for any provider
- **Kilo Credits:** Optional built-in credits system

#### Why It's Interesting for Holophyte

1. **REST API fits our architecture** — HTTP calls from companion → Convex mutations is simpler than stdio JSON-RPC or async iterators. No need for in-process event loops or subprocess management.
2. **Multi-model out of the box** — One integration gives us 400+ models across all major providers. No need for separate Claude/Codex/Gemini adapters.
3. **Per-tool approval via REST** — `GET /permission` + `POST /permission/{id}/reply` maps directly to our `pendingApprovals` table pattern.
4. **Session management** — create, fork, resume, abort, summarize via simple REST calls.
5. **MCP management** — configure MCP servers programmatically.
6. **153K weekly npm downloads** — real adoption, not vaporware.

#### Concerns

1. **Abstraction layer** — we'd be depending on Kilo's model routing instead of talking to providers directly. If Kilo has bugs with a specific model, we're blocked.
2. **Startup overhead** — spawning a `kilo serve` HTTP server per workspace vs direct subprocess communication.
3. **Auth complexity** — Kilo has its own auth/credits system on top of provider API keys.
4. **Trust** — Kilo is a fork of a fork (Cline → Roo → Kilo). Fast-moving but fragmentation risk.
5. **Different from Claude SDK** — we'd lose Claude-specific features like `setModel()`, `supportedAgents()`, MCP management. The Kilo API is provider-agnostic but less deep.
6. **BYOK only** — no subscription auth passthrough (can't use your Claude Max or ChatGPT Pro subscription through Kilo, only API keys).

#### Potential Approaches

#### Decision: Kilo as a First-Class Provider

Kilo is not just a model router — it's a full agent harness with its own session management, approval flow, tool execution, and MCP layer. It should be treated as its own provider (`provider: 'kilo'`), not as an "other" catch-all.

Three first-class providers, each with their own session manager and auth story:

| Provider | Auth | Integration | Models |
|--|--|--|--|
| **Claude** | Subscription (OAuth token) | Native SDK (`@anthropic-ai/claude-agent-sdk`) | Claude family |
| **Codex** | Subscription (`codex login`) or API key | App-server JSON-RPC (`codex-app-server-client`) | GPT/Codex family |
| **Kilo** | BYOK API keys per model provider | REST API (`@kilocode/sdk`) | 400+ (Anthropic, OpenAI, Google, Groq, Ollama, OpenRouter, etc.) |

Claude and Codex are first-class with subscription auth passthrough — zero friction for users already paying for Claude Max or ChatGPT Pro. Kilo fills the BYOK gap for everything else: Gemini, Ollama, local models, OpenRouter, etc. Users who want to use a model not covered by Claude or Codex subscriptions go through Kilo with their own API keys.

The session schema would be: `provider: 'claude' | 'codex' | 'kilo'`

For Kilo sessions, the UI needs a deeper config surface: pick provider (OpenAI, Google, Groq, etc.) → pick model → provide API key (stored per-provider in settings, set once). This is a UI design problem, not a technical one — the Kilo REST API handles model routing.

---

## Tier 2: Worth Watching

### Gemini CLI (Google)

- **Repo:** [google-gemini/gemini-cli](https://github.com/google-gemini/gemini-cli) (99.5k stars, Apache-2.0)
- **Package:** `@google/gemini-cli` on npm (v0.35.3)
- **SDK:** `@google/gemini-cli-sdk` exists in source (`packages/sdk`) but **not published to npm**
- **SDK design:** `GeminiCliAgent` class with `session.sendStream()` returning `AsyncGenerator<ServerGeminiStreamEvent>` — mirrors Claude Agent SDK pattern
- **Session resume:** `agent.resumeSession(sessionId)`
- **Custom tools:** `tool()` helper with Zod schemas
- **Per-tool approval:** Not in SDK (defaults to allow-all)
- **MCP:** Disabled in SDK currently
- **Hooks/Subagents:** Designed but not implemented
- **Non-interactive mode:** `STREAM_JSON` / `JSON` output formats for headless use
- **Auth:** Google Account OAuth (free: 60 req/min, 1000 req/day), `GEMINI_API_KEY`, or Vertex AI
- **A2A server:** `packages/a2a-server` in monorepo suggests Agent-to-Agent protocol work
- **Status:** Wait for `@google/gemini-cli-sdk` to ship on npm. Once published, integration would be straightforward.

---

## Tier 3: Limited Integration

### Cursor

- **What it is:** Proprietary AI code editor (VS Code fork) with headless CLI (`cursor-agent`)
- **Open source:** No. Closed source, proprietary binary.
- **CLI:** `cursor-agent` binary, downloaded from `downloads.cursor.com/lab`
- **Headless mode:** `-p` flag with `--output-format stream-json` (NDJSON streaming)
- **Third-party SDK:** `@nothumanwork/cursor-agents-sdk` on npm — wraps CLI with `CursorAgent.stream()` async iterator
- **Session resume:** `--resume <session-id>`
- **Per-tool approval:** No — `--force` is all-or-nothing for file writes
- **Auth:** `CURSOR_API_KEY` env var, requires Cursor subscription (Pro/Business)
- **BYOK:** Limited — agent mode locked to Cursor's model routing, BYOK only for chat
- **Models:** Claude 4 Sonnet/Opus, GPT-5, o-series, Gemini (all via Cursor's routing)
- **MCP:** Full support with OAuth

**Why not viable for Holophyte:**
- Closed source, proprietary binary — can't fork or customize
- Subscription-locked — every user needs Cursor Pro/Business
- No per-tool approval in headless mode
- BYOK crippled for agent features
- Third-party SDK is unofficial

---

## Not Viable

### Crush (formerly OpenCode)

- **Repo:** [charmbracelet/crush](https://github.com/charmbracelet/crush) (22.2k stars)
- **License:** FSL-1.1-MIT (NOT open source — restricts competing commercial use)
- **Type:** TUI only (Go, Bubble Tea). No SDK, no API, no headless mode.
- **Predecessor:** `opencode-ai/opencode` (archived, MIT) — was Go CLI with `-p` non-interactive mode
- **Not viable:** No programmatic interface, restrictive license

### Aider

- **Repo:** [Aider-AI/aider](https://github.com/Aider-AI/aider) (~30k stars, Apache-2.0)
- **Type:** Python CLI. Very mature, supports any OpenAI-compatible model.
- **Not viable:** No SDK, no structured output, no API. CLI-only with terminal UI.

### Goose (Block/Square)

- **Repo:** [block/goose](https://github.com/block/goose) (~10k stars, Apache-2.0)
- **Type:** Python CLI with plugin system.
- **Not viable:** No programmatic SDK or API.

### Chinese AI Models (Qwen, GLM, Kimi)

These are **models and APIs**, not coding agent harnesses:
- **Qwen (Alibaba):** OpenAI-compatible API at `dashscope.aliyuncs.com`. IDE extension (Tongyi Lingma), no CLI agent.
- **GLM/ChatGLM (Zhipu AI):** OpenAI-compatible API. CodeGeeX IDE extension, no CLI agent.
- **Kimi (Moonshot AI):** OpenAI-compatible API at `api.moonshot.cn`. No coding tools.

All three can be used as **model providers** through Kilo, OpenRouter, or any OpenAI-compatible tool — but they don't provide agent harnesses themselves.

---

## Summary: Holophyte Multi-Provider Roadmap

**Phase 1 (Current):** Claude Code via `@anthropic-ai/claude-agent-sdk` — subscription auth
**Phase 2 (Planned):** Codex via `codex app-server` + `codex-app-server-client` — subscription auth
**Phase 3 (Evaluate):** Kilo as third first-class provider via `@kilocode/sdk` — BYOK auth, 400+ models
**Phase 4 (Watch):** Gemini CLI SDK when published to npm (may become its own provider or fold into Kilo)
**Not planned:** Cursor (closed source), Crush (restrictive license), Aider/Goose (no SDK)

Schema: `provider: 'claude' | 'codex' | 'kilo'` on the sessions table. Each provider gets its own session manager in the companion. All normalize events into the shared `sessionEvents` Convex table.

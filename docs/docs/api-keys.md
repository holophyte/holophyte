---
sidebar_position: 4
title: API Keys
---

# API Keys

API keys let external tools — primarily the companion process and the MCP server — authenticate with Holophyte without going through the browser OAuth flow. They are the preferred auth method for headless and scripted environments.

Currently the only supported scope is `mcp`, which authorizes a key to validate against the `/api/keys/exchange` endpoint used by `setup:companion` and the MCP server.

## How It Works

```text
Web UI → generates key → stores SHA-256 hash in Convex
Companion / MCP server → reads key from ~/.holophyte/api-key
                       → POSTs { apiKey, scope } to /api/keys/exchange
                       → receives { userId } on success
                       → proceeds with normal token-based Convex auth
```

The raw key is only ever held in memory during generation and returned once to the browser. After the dialog is closed, no party — including the server — can recover it. The Convex database stores only the SHA-256 hash.

## Generating a Key

1. Open the Holophyte web UI and go to **Settings**.
2. In the **API Keys** section, click **Generate Key**.
3. Enter a descriptive name (e.g. `My MCP client`).
4. Check the **MCP** scope (currently the only scope available).
5. Click **Generate Key**.
6. A dialog shows the raw key with a copy button.

**Copy the key immediately** — the dialog warns that it cannot be shown again. After closing the dialog, the raw key is gone. If you lose it, revoke the old key and generate a new one.

Key format: `holo_` followed by 64 lowercase hex characters (69 characters total).

```text
holo_4a3bc1d2e5f60789abcd1234ef567890abcd1234ef567890abcd1234ef567890
```

## Using the Key with setup:companion

Run the companion setup script and choose the **API Key** option:

```bash
bun run setup:companion
```

When prompted, select option **3** (API Key) or pass `apikey` as an argument:

```bash
bun run setup:companion apikey
```

Paste the key when prompted. The script validates the key against the `/api/keys/exchange` endpoint and writes it to `~/.holophyte/api-key` with `0o600` permissions (owner read/write only).

```text
Holophyte Setup — Companion Authentication

ℹ Convex URL: https://your-deployment.convex.cloud
ℹ Deployment: prod:your-deployment
Select an authentication provider:
  1) GitHub
  2) Google
  3) API Key (paste a key generated from the web UI)

Choice [1]: 3
ℹ Provider: apikey
ℹ Convex Site URL: https://your-deployment.convex.site

Paste your API key: holo_4a3bc...
ℹ Validating API key...
✔ API key saved to /Users/you/.holophyte/api-key
```

The companion and MCP server read `~/.holophyte/api-key` automatically on startup. No environment variable needs to be set.

## Using the Key with the MCP Server

The MCP server checks `~/.holophyte/api-key` before falling back to the stored OAuth token. If an API key is present and valid, the server validates it on startup and proceeds.

If the key is revoked or invalid, the MCP server **refuses to start** rather than silently falling back to a different identity. This is intentional — a revoked key should not quietly grant access under a different credential.

Auth priority order in the MCP server:

1. API key file (`~/.holophyte/api-key`)
2. Stored OAuth token (`~/.holophyte/tokens.json` keyed by `CONVEX_DEPLOYMENT`)
3. Anonymous fallback (only when `ALLOW_ANONYMOUS_AUTH=1`, for local dev)

If you have both an API key file and a stored token, the API key takes precedence. The MCP server will still use the stored token for Convex client auth after API key validation (the exchange endpoint validates identity but does not itself issue a Convex JWT).

To register the MCP server in Claude Code, see the [MCP Server](mcp-server) page.

## Key Management

### Listing Keys

The **Settings > API Keys** page lists all your keys with:

- **Name** — the label you gave the key
- **Status** — `active` or `revoked`
- **Scopes** — badges showing which scopes the key is authorized for
- **Created** — creation date
- **Last used** — timestamp of the most recent successful `/api/keys/exchange` call

### Revoking a Key

Click **Revoke** next to any active key on the Settings page. Revocation is immediate and permanent — the `revokedAt` timestamp is set on the database record and the key will be rejected on the next validation attempt.

Revoked keys remain visible in the list so you have an audit trail. They cannot be un-revoked; generate a new key if needed.

### Rotating a Key

There is no in-place rotation. To rotate:

1. Generate a new key from the Settings page.
2. Run `bun run setup:companion apikey` and paste the new key (or write it manually to `~/.holophyte/api-key`).
3. Revoke the old key from the Settings page.

## Security Considerations

**The key is shown once.** After the generation dialog is closed, the raw key is unrecoverable. The Convex database stores only the SHA-256 hash. Even database access does not reveal the original key.

**File permissions.** `setup:companion` writes `~/.holophyte/api-key` with mode `0o600` (owner read/write). The `~/.holophyte/` directory itself is created with `0o700`. Do not change these permissions or add the file to version control.

**Scope enforcement.** Each key is issued with a specific set of scopes. The `/api/keys/exchange` endpoint checks that the requested scope is in the key's scope list — a key without the `mcp` scope will be rejected with a `401` even if the key itself is valid.

**Hash algorithm.** Keys are hashed with SHA-256 using the Web Crypto API (`crypto.subtle.digest`). The hash is stored as a 64-character lowercase hex string. The `by_hashed_key` index on the `apiKeys` table makes lookups O(log n).

**Treat the key like a password.** It grants full access to your Holophyte account from any machine that can reach the Convex site URL. Store it in a password manager or secrets manager, not in plaintext config files or shell history.

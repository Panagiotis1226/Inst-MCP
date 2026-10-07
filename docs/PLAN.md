# inst-mcp: Implementation Plan

Goal: an MCP server that exposes **every** Instagram Platform API capability to Claude (and any
other MCP client). It must be packaged so anyone can install it on any machine in one step.

The full endpoint inventory, with one-line descriptions, is in [ENDPOINTS.md](./ENDPOINTS.md).
This document covers how to build, package and ship it.

---

## 0. TL;DR: the key decisions

| Decision | Choice | Why |
|---|---|---|
| Language / runtime | **TypeScript on Node 22+** | Claude Desktop ships Node, so a `.mcpb` bundle runs with no install. `npx` works everywhere. Official Tier-1 MCP SDK |
| MCP SDK | `@modelcontextprotocol/sdk` 1.32.x + `zod` 4 | Current stable (checked 2026-10-07); supports the 2026-07-28 spec |
| Transports | **stdio** (local, default) + **Streamable HTTP** (remote/hosted) | stdio is for Desktop/Code/Cursor; HTTP is for a hosted claude.ai connector |
| Login modes | Both **Instagram Login** and **Facebook Login**, chosen per install (`IG_AUTH_MODE`) | A Meta app can use only one. IG Login is simpler (no FB Page). FB Login unlocks the full feature set |
| Tool surface | About 95 tools grouped into **toolsets**, a sensible default set, plus a raw `ig_graph_request` escape hatch | Every endpoint is covered without flooding the model's context |
| Writes | High-level "do the whole thing" tools (e.g. `ig_publish_reel`) **plus** low-level primitives | LLMs work best with one-call tasks; power users still get full control |
| Media | Publish from **public URLs** (plus local **video** via Meta's direct upload). **No object storage in v1** | Local-photo publishing is deferred to a later optional adapter (§8) |
| Distribution | npm (`npx -y inst-mcp`), `.mcpb` bundle, Claude Code plugin marketplace, Docker image, MCP Registry entry. **Model A**: each installer uses their own Meta app (§7.2) | Covers every Claude surface and every other MCP client, with no Meta App Review |
| Package name | `inst-mcp` (free on npm as of 2026-10-07) | Matches the repo |

> **Most important constraint.** "Every endpoint" requires **Facebook Login mode**: the Instagram
> professional account must be linked to a Facebook Page. Hashtag search, business discovery, product
> tagging, collaboration, likes, media delete, audio, events, creator marketplace and conversation
> routing are **FB-Login only**. IG-Login mode still covers profile, media, publishing, comments,
> mentions, insights and DMs.

---

## 1. Scope

**In scope**
- Every REST endpoint in ENDPOINTS.md §1–15.
- Token lifecycle, including automatic refresh.
- Media upload from local files.
- An optional webhook receiver that turns real-time events into MCP-readable data.
- Packaging for all major MCP clients.

**Out of scope**
- Mobile share intents and the manual embed button (they are not APIs).
- Deprecated v1.0 endpoints.
- The Marketing API: ads and partnership-ad creation. This can be a later add-on toolset.

**Non-goal: scraping or unofficial APIs.** Everything goes through Meta's official Graph API, so
accounts are not put at risk.

---

## 2. Meta-side constraints that shape the design

1. **Professional accounts only.** The target account must be an Instagram Business or Creator
   account. Personal accounts cannot use any of this.
2. **One login type per Meta app.**
   - IG Login uses `graph.instagram.com` with an Instagram User token.
   - FB Login uses `graph.facebook.com` with a Facebook User or Page token.

   The server abstracts both behind one client. Tools that the active mode cannot serve are **not
   registered**, so Claude never sees tools that will fail.
3. **Access levels.**
   - *Standard Access* (no review): works for accounts that have a role on your Meta app. This is
     enough for "I install it for my own accounts".
   - *Advanced Access*: needs **App Review + Business Verification**. Required before strangers can
     log in through *your* app. It drives the distribution model in §7.
4. **Media must be fetched from a public URL.** The exception is video sent through the resumable
   upload host `rupload.facebook.com`. Local images therefore need a temporary public host (§8).
5. **Publishing is asynchronous.** You create a container, poll it until `FINISHED`, then publish.
   Containers expire after 24h.
6. **Webhooks need a public HTTPS endpoint**, a Live app and Business Verification. A pure stdio
   server cannot receive them, which is why §9 has a companion receiver.
7. **DM policy.**
   - The user must message first, then you have a 24h window (7 days with `HUMAN_AGENT`).
   - A human escalation path is required.
   - Bot disclosure is required in some jurisdictions.

   Tools enforce or document these rules so Claude does not violate them.
8. **Doc inconsistencies found during research.** These are resolved by the Phase 0 probe; see §15.
   - Publishing cap: 50 vs 100 per 24h.
   - Collaborator limit: 3 vs 5.
   - Product-tag limit: 5 vs 20.
   - API version: v25 vs v26.
   - Which endpoints work under IG Login: marked "FB (IG?)" in ENDPOINTS.md.

---

## 3. Architecture

```
            ┌───────────────── MCP client (Claude Desktop / Code / claude.ai / Cursor …) ─────────────────┐
            │                                                                                              │
            ▼ stdio  (local install)                                     Streamable HTTP + OAuth 2.1 (hosted)▼
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ inst-mcp                                                                                                 │
│  ┌──────────────┐   ┌────────────────────┐   ┌──────────────────────┐   ┌─────────────────────────────┐  │
│  │ CLI entry     │──▶│ MCP server         │──▶│ Toolsets (zod schemas,│──▶│ Graph client                │  │
│  │ serve|auth|   │   │ tools/resources/   │   │ annotations, output   │   │ • host + version per mode   │  │
│  │ doctor|webhook│   │ prompts registry   │   │ shaping)              │   │ • retries / backoff         │  │
│  └──────────────┘   └────────────────────┘   └──────────────────────┘   │ • BUC rate-limit tracking   │  │
│                                                                          │ • error → actionable hints  │  │
│  ┌──────────────┐   ┌────────────────────┐   ┌──────────────────────┐   │ • pagination helpers        │  │
│  │ Token store   │◀─▶│ Auth (IG / FB      │   │ Media validator       │   └──────────────┬──────────────┘  │
│  │ (file 0600 /  │   │ OAuth, refresh)    │   │ (storage: later)      │                  │                 │
│  │  encrypted DB)│   └────────────────────┘   └──────────────────────┘                  │                 │
│  └──────────────┘                                                                        │                 │
│  ┌──────────────────────────────┐                                                        │                 │
│  │ Webhook receiver (optional)   │── events.jsonl / DB ──▶ ig_events_list tool           │                 │
│  └──────────────────────────────┘                                                        │                 │
└──────────────────────────────────────────────────────────────────────────────────────────┼─────────────────┘
                                                                                           ▼
                             graph.instagram.com · graph.facebook.com · rupload.facebook.com · api.instagram.com
```

One codebase serves both deployment shapes. `inst-mcp` with no arguments runs stdio.
`inst-mcp serve --http` runs the hosted variant.

---

## 4. Tech stack

| Concern | Choice | Notes / tradeoff |
|---|---|---|
| Runtime | Node ≥ 22 (built-in `fetch`, `FormData`, `Blob`) | No HTTP dependency needed |
| SDK | `@modelcontextprotocol/sdk` (`McpServer`, `StdioServerTransport`, `StreamableHTTPServerTransport`) | Pin a minor version and let Renovate bump it |
| Schemas | `zod` for tool input and output schemas (`outputSchema` + `structuredContent`) | The same schemas drive the docs generator |
| Build | `tsup` (esbuild) producing a single bundled `dist/index.js` | Small `.mcpb`, fast `npx` start, no `node_modules` shipped in the bundle |
| Lint/format | Biome | One tool, fast |
| Tests | Vitest + MSW (mocked Graph API from recorded fixtures) | Plus gated live smoke tests |
| Image checks | `image-size` (pure JS) for validating type, size and aspect ratio | **No native deps** (e.g. `sharp`), which keeps the `.mcpb` cross-platform. Optional JPEG conversion via pure-JS `jimp`, behind a flag |
| Object storage | **Not in v1.** A future adapter would use a hand-rolled SigV4 presigned PUT or `aws4fetch` | Avoids the large AWS SDK when it is added |
| Logging | stderr only (stdout is the MCP channel); `IG_LOG_LEVEL` | Never log tokens |

---

## 5. Configuration

Configuration is resolved in this order: environment variables, then `~/.config/inst-mcp/config.json`
(Windows: `%APPDATA%\inst-mcp\config.json`), then defaults. Everything is validated with zod at startup.
`inst-mcp doctor` prints the resolved config with secrets redacted, then checks token validity,
granted scopes, the linked IG account and the publishing quota.

| Variable | Default | Purpose |
|---|---|---|
| `IG_AUTH_MODE` | `facebook` | `facebook` (FB Login, full feature set) or `instagram` (IG Login, no Page needed) |
| `IG_ACCESS_TOKEN` | — | Long-lived IG User token (IG mode), or a Page / System-User token (FB mode) |
| `IG_USER_ID` | auto via `/me` or `/me/accounts` | Instagram professional account ID |
| `IG_PAGE_ID` | auto (FB mode) | Page used for messaging and handover |
| `IG_APP_ID` / `IG_APP_SECRET` | — | Only needed for `auth login` and token exchange (never for normal calls) |
| `IG_API_VERSION` | `v25.0` (bumped per release after a probe run) | Graph API version |
| `IG_TOOLSETS` | `account,media,publish,comments,mentions,insights,messaging` | Comma list, or `all` |
| `IG_READ_ONLY` | `false` | Registers only read tools |
| `IG_EVENTS_FILE` | `~/.config/inst-mcp/events.jsonl` | Where the webhook receiver writes events |
| `IG_STATE_DIR` | `~/.config/inst-mcp/` | Refreshed tokens (`0600`), cached IDs |

---

## 6. MCP surface design

### 6.1 Principles
- **Naming:** `ig_<area>_<action>` in snake_case, e.g. `ig_comment_reply` or `ig_insights_account`.
- **Annotations on every tool:** `readOnlyHint`, `destructiveHint` (delete, hide, block, publish), `idempotentHint` and `openWorldHint: true`. Clients use these to decide when to ask the user for confirmation.
- **Workflow-level tools for multi-step flows.**
  - `ig_publish_reel` validates the media, uploads it if it is local, creates the container, polls status with backoff, publishes, and returns the permalink.
  - Every write tool accepts `dry_run: true`, which returns the exact requests without sending them.
- **Compact output by default.** Each tool requests a curated `fields` set. Any tool accepts `fields` to override it.
  - Lists return `{items, next_cursor}`, and every list tool accepts `cursor` and `limit`.
  - Responses include both a short text summary and `structuredContent`.
- **Actionable errors.** Meta `code`/`error_subcode` pairs (ENDPOINTS.md §17, PLAN §13) map to plain-English fixes.
  - Example: `9004/2207052`: "Meta couldn't download the media URL — use a public, direct link (not localhost, a private Drive link or a login-protected page)."
  - Error responses use `isError: true`.
- **Rate-limit awareness.**
  - The client parses `X-Business-Use-Case-Usage` / `X-App-Usage`.
  - Above 90% usage it returns a warning in the result; at 100% it refuses with a "retry after" hint.
  - Local token buckets enforce the hard limits: likes 50/5s, Send API, Conversations 2/s, hashtags 30 per 7 days (the hashtag count persists in the state dir).
- **Mode gating.** Each tool declares `modes: ['instagram','facebook']` and its required scopes. Registration is skipped when the active mode does not support the tool. `doctor` lists the reason for each skipped tool.

### 6.2 Toolsets and tools

✱ = enabled by default. **FB** = Facebook-Login mode only. Ⓦ = write; Ⓓ = destructive.

| Toolset | Tools |
|---|---|
| **account** ✱ | `ig_get_account`, `ig_list_linked_accounts` (FB), `ig_get_publishing_limit`, `ig_token_status`, `ig_token_refresh` Ⓦ |
| **media** ✱ | `ig_media_list`, `ig_media_get`, `ig_stories_list`, `ig_live_list` (FB), `ig_media_set_comments_enabled` Ⓦ, `ig_media_delete` Ⓓ (FB), `ig_media_check_copyright` (FB) |
| **publish** ✱ | `ig_publish_image` Ⓦ, `ig_publish_carousel` Ⓦ, `ig_publish_reel` Ⓦ (incl. trial reels), `ig_publish_story` Ⓦ, `ig_container_create` Ⓦ, `ig_container_status`, `ig_container_publish` Ⓦ, `ig_upload_video` Ⓦ, `ig_audio_search` (FB), `ig_audio_get` (FB), `ig_audio_find_replacement` (FB) |
| **comments** ✱ | `ig_comments_list`, `ig_comment_get`, `ig_comment_replies_list`, `ig_comment_create` Ⓦ, `ig_comment_reply` Ⓦ, `ig_comment_hide` Ⓓ, `ig_comment_delete` Ⓓ, `ig_comment_private_reply` Ⓦ, `ig_like` Ⓦ (FB), `ig_unlike` Ⓦ (FB) |
| **mentions** ✱ | `ig_tagged_media_list`, `ig_mention_get_media`, `ig_mention_get_comment`, `ig_mention_reply` Ⓦ |
| **insights** ✱ | `ig_insights_account`, `ig_insights_media`, `ig_insights_summary` (composite: last-N-days overview + top posts) |
| **messaging** ✱ | `ig_dm_conversations_list`, `ig_dm_conversation_get`, `ig_dm_message_get`, `ig_dm_user_profile`, `ig_dm_send` Ⓦ (text / media / post share / sticker / reply_to / HUMAN_AGENT), `ig_dm_send_quick_replies` Ⓦ, `ig_dm_send_template` Ⓦ (generic / button / product), `ig_dm_react` Ⓦ, `ig_dm_sender_action` Ⓦ, `ig_dm_send_self` Ⓦ, `ig_dm_upload_attachment` Ⓦ (FB), `ig_dm_moderate` Ⓓ (FB) |
| **inbox_config** | `ig_dm_ice_breakers_get` / `_set` Ⓦ / `_delete` Ⓓ, `ig_dm_menu_get` / `_set` Ⓦ / `_delete` Ⓓ, `ig_dm_welcome_flows_list`, `ig_dm_welcome_flow_upsert` Ⓦ, `ig_dm_welcome_flow_delete` Ⓓ, `ig_dm_build_link` |
| **routing** (FB) | `ig_dm_thread_owner`, `ig_dm_thread_pass` Ⓦ, `ig_dm_thread_take` Ⓦ, `ig_dm_thread_release` Ⓦ, `ig_dm_thread_request` Ⓦ, `ig_dm_thread_extend` Ⓦ, `ig_dm_routing_status` |
| **hashtags** (FB) | `ig_hashtag_search`, `ig_hashtag_media`, `ig_hashtag_recent_searches` |
| **discovery** | `ig_business_discovery` (FB), `ig_oembed` |
| **collaboration** (FB) | `ig_collab_invites_list`, `ig_collab_invite_respond` Ⓦ, `ig_collab_media_list`, `ig_collab_media_collaborators` |
| **shopping** (FB) | `ig_shop_check_eligibility`, `ig_shop_catalogs`, `ig_shop_product_search`, `ig_shop_tags_get`, `ig_shop_tags_set` Ⓦ, `ig_shop_appeal_status`, `ig_shop_appeal` Ⓦ |
| **events** (FB) | `ig_events_list`, `ig_event_create` Ⓦ, `ig_event_update` Ⓦ |
| **creators** (FB) | `ig_creators_search`, `ig_creator_get`, `ig_creators_brand_audiences` |
| **threads** (FB) | `ig_threads_get_user`, `ig_threads_create_backed_user` Ⓦ, `ig_list_ad_partners` |
| **webhooks** | `ig_activity_check` (polling; no webhook setup needed), `ig_webhooks_subscribe` Ⓦ, `ig_webhooks_status`, `ig_events_list`, `ig_events_ack` |
| **raw** | `ig_graph_request`: any method/path on the configured host. GET only when `IG_READ_ONLY`; otherwise marked destructive. Covers new or unmodelled endpoints on day one |

That is about 95 tools in total, and the default set is about 45. In Claude Code, tool search
keeps even `IG_TOOLSETS=all` cheap. In Claude Desktop, users enable only the toolsets they need.

### 6.3 Resources (read-only context the client can attach)
- `instagram://account`: profile and counts.
- `instagram://quota`: publishing quota, BUC usage and hashtag-search budget.
- `instagram://media/{id}`: one post with its insights.
- `instagram://events/recent`: latest webhook events.
- `instagram://capabilities`: active mode, granted scopes, enabled tools, and skipped tools with reasons.

### 6.4 Prompts (user-invocable templates)
- `weekly_report`: insights summary, top and bottom posts, and recommendations.
- `triage_comments`: find unanswered or negative comments, draft replies, hide spam (with confirmation).
- `inbox_zero`: list DMs inside the 24h window and draft replies.
- `plan_and_publish`: caption plus hashtags, validate media, dry-run, then publish.
- `competitor_snapshot`: business discovery on N handles (FB mode).

---

## 7. Auth, tokens and the three distribution models

### 7.1 Token handling (local installs)

**IG mode**
1. The user pastes a long-lived token, or runs `npx inst-mcp auth login` (see below).
2. On every start, and every 24h while running, the server checks the token age and calls
   `refresh_access_token` once the token is older than 7 days. Refresh is allowed from 24h of age;
   tokens live 60 days.
3. The refreshed token is written to `IG_STATE_DIR/tokens.json` (mode `0600`). It takes precedence
   over the configured token whenever it is newer.

As a result, a token that keeps being used never expires.

**FB mode.** Prefer one of these, because neither expires:
- A **Page access token** derived from a long-lived user token.
- A **System User token** from Business Manager. This is best for a business's own accounts.

User tokens (60 days, no programmatic refresh) are supported, but `doctor` warns about them.

**`inst-mcp auth login`**
1. Runs a local OAuth flow: opens the browser to the Instagram or Facebook authorize URL, catches the redirect on a loopback port, exchanges the code, converts to a long-lived token, and stores it.
2. Facebook Login allows `localhost` redirects in dev mode.
3. Whether Instagram Business Login accepts `https://localhost` has **not been verified**; Phase 0 checks it.
4. If it does not, the fallback is the App Dashboard **"Generate token"** button, which issues a 60-day IG token directly. The README walks through that path with screenshots.

### 7.2 Who owns the Meta app? This decides how "anyone" installs it

| Model | How it works | Meta review needed? | User effort | When |
|---|---|---|---|---|
| **A. Bring-your-own app** ✅ **chosen** | Each installer creates their own Meta app (about 10 min, guided by `docs/SETUP.md`), adds their IG account as a tester, generates a token, and installs the package | **No** (Standard Access) | Medium, one-time | v1. Works today for you and anyone technical |
| **B. Shared app, local server** | You publish one Meta app ID; `auth login` uses it; secrets are kept out of the bundle by using a token-exchange endpoint you host (the secret never ships) | **Yes**: App Review + Business Verification for every permission used | Low | After v1 if non-technical users matter |
| **C. Hosted remote connector** | `inst-mcp serve --http` runs on Cloudflare Workers or Fly.io. Users paste one URL into **claude.ai → Settings → Connectors → Add custom connector**, sign in with Instagram or Facebook, and it works on web, desktop and mobile | **Yes** (same as B), plus a privacy policy, data-deletion callback and hosted infrastructure | Lowest | Not planned (optional Phase 7) |

**Model A in practice (decided)**
- **Your own use, plus people you can name:** one Meta app (yours). Add teammates or managed accounts as app roles (Admin, Developer or Tester). They log in through your app, and no review is needed.
- **Anyone else who installs the package:** they follow `docs/SETUP.md` and create their own Meta app (a Business-type app with Facebook Login for Business plus the Instagram product). Then they generate a token and paste it into the install.
- The package never contains an app ID or secret; each install brings its own token.
- `docs/SETUP.md` is a first-class deliverable: screenshots for app creation, linking the IG account to a Page, generating a non-expiring Page or System-User token, and running `inst-mcp doctor`.

Model C details (kept for reference only; not planned):
- It implements MCP authorization (OAuth 2.1 + PKCE).
- Client registration supports both Client ID Metadata Documents (preferred in the 2026-07-28 spec) and Dynamic Client Registration (still used by many clients).
- Meta Login is the upstream identity provider.
- Per-user Meta tokens are stored encrypted (AES-GCM, key in KMS or Workers secrets) and refreshed by a cron job.
- Statelessness in the new spec means any instance can serve any request.

---

## 8. Media handling (decided: no storage in v1)

Instagram has no photo-upload endpoint. For images, Meta **downloads the file from a URL you give it**.
v1 therefore ships the full publishing feature set, but media must already be online. The only
exception is video, which Meta accepts as direct bytes.

| Input | v1 behaviour |
|---|---|
| Image / carousel image / story image | `url` (public, direct link) **only** |
| Reel / story video / carousel video | `url`, **or** `file_path`, uploaded directly via the resumable upload API (no storage needed). FB mode is documented; IG mode is confirmed in Phase 0 |
| Local image `file_path` | Rejected with a clear message: "host it publicly or use the Instagram app". The future storage adapter slots in here |

Pipeline in `ig_publish_*`:
1. **Validate**: pure JS, so you get a clear error before any quota is spent.
   - Image: JPEG, ≤ 8MB, aspect 4:5–1.91:1. Checked via a ranged GET.
   - Reel: MP4/MOV, ≤ 300MB.
   - Story video: ≤ 100MB.
   - Caption: ≤ 2200 chars, ≤ 30 hashtags, ≤ 20 @mentions.
   - Carousel: 2–10 items.
2. **Deliver**
   - `url`: passed through.
   - Video `file_path`: resumable upload to `rupload.facebook.com`. It sends the `offset`, `file_size` and `Authorization: OAuth` headers, and resumes from `bytes_transferred` if interrupted.
3. **Poll** the container until `FINISHED`. Backoff runs from 2s to 30s, up to about 5 min for images and 15 min for video. `ERROR` subcodes are shown in plain English.
4. **Publish**, then return `{media_id, permalink, quota_remaining}`.

Publishing still gives you more than the Instagram app offers. Examples:
- "post this product photo from our site with this caption at 9am" (scheduling done by the client)
- trial reels
- collaborators and product tags
- alt text

You can also keep posting manually in the app and use the server for everything else.

**Later (optional):** an `IG_MEDIA_HOST=s3` adapter for local photos, using any S3-compatible bucket such as Cloudflare R2. It uploads the photo, hands Meta a temporary URL, and deletes the object after publishing. No other code changes are needed.

---

## 9. Webhooks / real-time events (optional component)

A stdio server cannot receive HTTP callbacks, so this is a separate opt-in command:

```
npx inst-mcp webhook serve --port 8787 --verify-token <random>
```

- It handles the `hub.challenge` verification GET and checks `X-Hub-Signature-256` (HMAC-SHA256 with the app secret) on every POST. Bad signatures are rejected.
- It deduplicates retries (Meta retries for up to 36h) and appends normalized events to `IG_EVENTS_FILE`. A SQLite option is available.
- It needs public HTTPS. Documented options: Cloudflare Tunnel or ngrok for local use, or deploying the same receiver next to the remote server.
- The MCP side provides:
  - `ig_events_list(since, types)`: newest unacknowledged events.
  - `ig_events_ack(ids)`: mark events as handled.
  - `ig_webhooks_subscribe(fields)`: calls `subscribed_apps`.

  This enables flows like "check new comments and DMs and draft replies".
- In hosted mode (Model C), the receiver is built in and events are per-user.

**Model A caveat.** Meta only delivers webhooks to apps that are **Live** and have completed **Business Verification**. Comment webhooks also need Advanced Access. For your own business that is achievable: it is verification, not a public App Review. Until then, v1 ships a **polling fallback**:
- `ig_activity_check(since)` fetches new comments on recent media plus updated DM conversations since the last check.
- It stores a cursor in `IG_STATE_DIR`, so "what's new since this morning?" works with no webhook setup at all.

---

## 10. Packaging and distribution

All artifacts come from one build. A tag push (`v*`) triggers the release workflow.

| Channel | Artifact | User install |
|---|---|---|
| **npm** | `inst-mcp` (bin: `inst-mcp`), published with `--provenance` | Any client: `npx -y inst-mcp` |
| **Claude Desktop** | `inst-mcp-<ver>.mcpb`, attached to the GitHub Release, built with `@anthropic-ai/mcpb` | Double-click the file. Settings UI is generated from `user_config`; the token and secret are marked `sensitive` and stored in the OS keychain |
| **Claude Code plugin** | This repo doubles as a plugin marketplace: `.claude-plugin/marketplace.json` + `plugin.json` + `.mcp.json`, optionally bundling skills such as "weekly report" | `/plugin marketplace add Panagiotis1226/Inst-MCP` then `/plugin install inst-mcp` |
| **Docker** | `ghcr.io/panagiotis1226/inst-mcp:<ver>`, multi-arch | `docker run -i --rm -e IG_ACCESS_TOKEN=… ghcr.io/panagiotis1226/inst-mcp` (stdio), or `serve --http` |
| **MCP Registry** | `server.json` published to the official registry | Shows up in clients and directories that read the registry |
| **Hosted** (Phase 7) | `https://mcp.<your-domain>/mcp` | claude.ai → Connectors → Add custom connector |

**Install snippets for the README:**

```bash
# Claude Code
claude mcp add instagram -e IG_AUTH_MODE=facebook -e IG_ACCESS_TOKEN=EAA... -- npx -y inst-mcp
```

```jsonc
// Claude Desktop (manual config) / Cursor / VS Code / Windsurf
{
  "mcpServers": {
    "instagram": {
      "command": "npx",
      "args": ["-y", "inst-mcp"],
      "env": { "IG_AUTH_MODE": "facebook", "IG_ACCESS_TOKEN": "EAA..." }
    }
  }
}
```

**MCPB `manifest.json` sketch:**

```jsonc
{
  "manifest_version": "0.3",
  "name": "inst-mcp",
  "display_name": "Instagram",
  "version": "0.1.0",
  "description": "Manage Instagram publishing, comments, DMs and insights via the official Graph API",
  "author": { "name": "Panagiotis" },
  "server": {
    "type": "node",
    "entry_point": "dist/index.js",
    "mcp_config": {
      "command": "node",
      "args": ["${__dirname}/dist/index.js"],
      "env": {
        "IG_AUTH_MODE": "${user_config.auth_mode}",
        "IG_ACCESS_TOKEN": "${user_config.access_token}",
        "IG_TOOLSETS": "${user_config.toolsets}",
        "IG_READ_ONLY": "${user_config.read_only}"
      }
    }
  },
  "user_config": {
    "auth_mode":    { "type": "string",  "title": "Login type (facebook|instagram)", "default": "facebook", "required": true },
    "access_token": { "type": "string",  "title": "Access token", "sensitive": true, "required": true },
    "toolsets":     { "type": "string",  "title": "Toolsets", "default": "account,media,publish,comments,mentions,insights,messaging" },
    "read_only":    { "type": "boolean", "title": "Read-only mode", "default": false }
  },
  "compatibility": { "platforms": ["darwin", "win32", "linux"], "runtimes": { "node": ">=22" } }
}
```

Check the exact `manifest_version` and field names against the MCPB `MANIFEST.md` when implementing.

---

## 11. Repository layout

```
inst-mcp/
├─ package.json  tsconfig.json  tsup.config.ts  biome.json  vitest.config.ts
├─ manifest.json            # MCPB
├─ server.json              # MCP Registry
├─ Dockerfile
├─ .claude-plugin/          # marketplace.json, plugin.json
├─ .mcp.json                # used by the Claude Code plugin
├─ src/
│  ├─ index.ts              # CLI: (default) stdio | serve --http | auth login | doctor | webhook serve
│  ├─ server.ts             # builds McpServer, registers toolsets per config + mode
│  ├─ config.ts             # zod config loader
│  ├─ graph/
│  │  ├─ client.ts          # request(), host/version per mode, retries, BUC headers
│  │  ├─ errors.ts          # code/subcode → hint table
│  │  ├─ paginate.ts
│  │  ├─ rate-limit.ts      # token buckets + persisted hashtag budget
│  │  └─ rupload.ts         # resumable upload
│  ├─ auth/                 # tokens.ts (load/refresh/persist), oauth-instagram.ts, oauth-facebook.ts
│  ├─ media/                # validate.ts (storage adapter added later)
│  ├─ tools/                # one file per toolset (account.ts, media.ts, publish.ts, …, raw.ts)
│  │  └─ define.ts          # defineTool({name, modes, scopes, annotations, input, output, handler})
│  ├─ resources/  prompts/
│  ├─ http/                 # Streamable HTTP transport + OAuth AS (Phase 7)
│  └─ webhook/              # receiver, signature check, event store
├─ scripts/
│  ├─ probe.ts              # Phase 0 capability probe → capability-matrix.json
│  └─ gen-docs.ts           # generates docs/TOOLS.md from tool definitions
├─ test/  unit/  fixtures/  live/  evals/
└─ docs/  PLAN.md  ENDPOINTS.md  SETUP.md  TOOLS.md (generated)  PRIVACY.md
```

`defineTool` is the core abstraction. Each endpoint becomes about 20–40 lines of declarative
code, so ~95 tools stay maintainable, and `gen-docs.ts` keeps TOOLS.md in sync automatically.

---

## 12. Testing and quality

1. **Unit tests** for every tool, run against MSW with recorded Graph responses. They cover the happy path, pagination, each mapped error subcode, mode gating and `dry_run`.
2. **Contract tests.** Every tool's zod output schema is validated against fixtures. When Meta changes a response shape, a test fails and nothing breaks silently.
3. **Capability probe** (`scripts/probe.ts`). Run it against a real test account in each mode. It calls every read endpoint and safe write endpoint (comment on own post → delete, hide → unhide, ice breakers set → delete, container create without publish) and emits `capability-matrix.json`. It is re-run before each release and whenever `IG_API_VERSION` is bumped.
4. **MCP Inspector** (`npx @modelcontextprotocol/inspector node dist/index.js`) for manual checks.
5. **LLM evals.** About 15 realistic tasks (e.g. "which of my last 10 reels had the best average watch time?", "hide all comments containing a URL on my latest post") run through Claude with the server attached. Score correctness and the number of tool calls. This catches bad tool descriptions.
6. **CI (GitHub Actions)**
   - On PR: biome, tsc, vitest, build, `mcpb pack` dry-run.
   - On tag: npm publish with provenance, `.mcpb` attached to the Release, multi-arch Docker to GHCR, MCP Registry publish.
   - Renovate keeps the SDK and dependencies current.

---

## 13. Security and compliance

- **Secrets**
  - Never logged.
  - Redacted in errors.
  - Tokens are sent as an `Authorization: Bearer` header, not in query strings.
  - The state file is `0600`.
  - MCPB `sensitive` fields go to the OS keychain.
- **App secret** is never bundled; it is needed only for `auth login`. In Models B and C, token exchange happens server-side.
- **Webhook security:** HMAC verified with a constant-time compare; strict body size limit.
- **Destructive safety**
  - Destructive annotations on every risky tool.
  - `IG_READ_ONLY` mode.
  - `dry_run` on every write.
  - `ig_graph_request` is restricted to the two Graph hosts, so it cannot become an SSRF proxy.
- **Prompt-injection hygiene.** Comment text, DM text and captions are third-party content. They are returned inside clearly delimited fields, and tool descriptions say so, so the model treats them as data, not instructions.
- **Meta policy:** DM 24h/7d rules are enforced in `ig_dm_send` where detectable, the bot-disclosure note is in docs, the data-deletion callback is implemented for Model C, and there is a privacy policy in `docs/PRIVACY.md`.
- **License:** MIT (decided; see `LICENSE`).

---

## 14. Roadmap

Each phase ends with a tagged, installable release, so the package is usable from Phase 1 onward.

| Phase | Deliverables | Exit criteria |
|---|---|---|
| **0. Meta setup + probe** (S) | Two Meta apps (IG Login and FB Login), a test Business account linked to a Page, `scripts/probe.ts` skeleton, `docs/SETUP.md` | All "FB (IG?)" rows, the publishing cap, collaborator and tag limits, v25 vs v26, and localhost redirect support are resolved and recorded |
| **1. Skeleton + read-only core** (M) | Repo scaffolding, config, Graph client (errors, retries, BUC, pagination), token refresh, `doctor`, toolsets **account, media, insights** (read), resources, CI, npm `0.1.0`, first `.mcpb` | `npx -y inst-mcp` works in Claude Desktop and Claude Code; tests green |
| **2. Publishing + community** (L) | **publish** (all 4 high-level tools + primitives, resumable video upload, validation), **comments**, **mentions**, likes, media delete, `ig_activity_check` | Publishes an image, carousel, reel, trial reel and story from public URLs, and a reel from a local video file; moderates comments end to end |
| **3. Messaging** (L) | **messaging**, **inbox_config**, **routing**; HUMAN_AGENT; attachment upload | Read and reply to DMs, set ice breakers and menu, hand over threads |
| **4. FB-only extensions** (M) | **hashtags, discovery, collaboration, shopping, events, creators, threads, audio**, `ig_oembed`, `ig_graph_request` | Every row in ENDPOINTS.md has a tool, or is explicitly marked out of scope |
| **5. Distribution polish** (S) | Claude Code plugin marketplace + skills, Docker image, MCP Registry entry, generated TOOLS.md, README with install buttons and screenshots, evals | A fresh machine installs via each channel in under 5 min following the README |
| **6. Real-time** (M, needs a Live app + Business Verification) | Webhook receiver, `ig_events_*`, `ig_webhooks_*`, `instagram://events/recent`, prompts | New comment or DM shows up in `ig_events_list` within seconds |
| **7. Hosted connector** (L, *optional, not planned*) | `serve --http`, OAuth 2.1 AS (CIMD + DCR) federated to Meta Login, encrypted token vault, multi-tenant webhooks, privacy policy and data deletion, **Meta App Review + Business Verification** | A stranger adds the URL in claude.ai and uses it on web and mobile |

Sizes: S ≈ a few days, M ≈ 1–2 weeks, L ≈ 2–3 weeks of focused work. These are rough estimates, not commitments. Meta App Review turnaround is outside our control.

---

## 15. Open questions and risks

| Item | Risk | Mitigation |
|---|---|---|
| Docs contradict each other on caps (50 vs 100 posts, 3 vs 5 collaborators, 5 vs 20 product tags) | Wrong validation | Validate against the runtime value (`content_publishing_limit`); otherwise let Meta reject and map the error. The probe records the truth |
| Several endpoints documented only for FB Login | IG-mode users see fewer tools | The probe decides; mode gating hides what doesn't work |
| Instagram Login may not accept localhost redirects | `auth login` friction in IG mode | Dashboard "Generate token" fallback, documented |
| Local photos can't be published in v1 | Feature gap | Decided: post photos manually or from public URLs; optional storage adapter later (§8) |
| Meta deprecations (e.g. insights metrics churn every few months) | Tools break | Contract tests, probe on every version bump, `ig_graph_request` as escape hatch, changelog watch |
| Webhooks need a Live app + Business Verification even under Model A | Real-time events unavailable at first | `ig_activity_check` polling fallback; verify your business when ready for Phase 6 |
| Large tool count | Context bloat in some clients | Toolsets, read-only mode, concise descriptions |
| MCP spec churn (2026-07-28 went stateless) | Transport breakage | Rely on the SDK; pin and bump deliberately; the stateless design already suits Model C |

**Decisions**
1. ✅ Default login mode: **Facebook Login**. IG Login stays supported as a secondary mode.
2. ✅ License: **MIT**.
3. ✅ Distribution: **Model A**, bring-your-own Meta app; teammates are added as app testers (§7.2). No App Review.
4. ✅ No object storage in v1. Publishing works from public URLs and local video; the storage adapter is a later option (§8).

---

## 16. Sources

- Instagram Platform docs index: <https://developers.facebook.com/documentation/instagram-platform/llms.txt> (all linked pages read, 2026-10-07)
- Instagram Messaging (Messenger Platform): <https://developers.facebook.com/documentation/business-messaging/instagram-messaging>
- User Likes API: <https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/user-likes>
- MCP spec 2026-07-28 announcement: <https://blog.modelcontextprotocol.io/posts/2026-07-28/>
- MCPB (desktop extensions): <https://claude.com/docs/connectors/building/mcpb>, <https://github.com/modelcontextprotocol/mcpb>
- npm registry: `@modelcontextprotocol/sdk` 1.32.1, `@anthropic-ai/mcpb` 2.1.2, `zod` 4.6.5 (checked 2026-10-07)

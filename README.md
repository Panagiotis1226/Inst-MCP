# Inst-MCP

An MCP (Model Context Protocol) server that gives Claude and other MCP clients access to the full
official Instagram Platform API. It covers publishing, comments, mentions, DMs, insights, hashtag
search, business discovery, collaboration, shopping, creator marketplace and webhooks.

> **Status: planning.** No code yet. Start with these:
>
> - [`docs/PLAN.md`](docs/PLAN.md): architecture, auth, tool design, packaging and the phased roadmap
> - [`docs/ENDPOINTS.md`](docs/ENDPOINTS.md): every Instagram API endpoint with a one-line description and the MCP tool planned for it

## Planned install options

| Client | How |
|---|---|
| Any MCP client | `npx -y inst-mcp` |
| Claude Desktop | Double-click `inst-mcp.mcpb` from Releases |
| Claude Code | `claude mcp add instagram -e IG_ACCESS_TOKEN=... -- npx -y inst-mcp`, or install it as a plugin |
| Docker | `docker run -i --rm -e IG_ACCESS_TOKEN=... ghcr.io/panagiotis1226/inst-mcp` |
| claude.ai (web/mobile) | Hosted connector URL (later phase) |

Requires an Instagram **Business or Creator** account. The full feature set needs that account to be
linked to a Facebook Page (Facebook Login mode).

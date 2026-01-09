# Claude Agent SDK + Cloudflare Containers Template

Opinionated boilerplate for running Claude Agents in Cloudflare Containers with a React frontend.

## Features

- **Session Pooling** - Pre-warmed sessions for low-latency responses
- **Multi-User Isolation** - Durable Objects provide per-user containers
- **Streaming Responses** - Real-time WebSocket-to-HTTP streaming
- **Modern Stack** - React 19, Tailwind v4, Hono, Vite, TypeScript

## Quick Start

```bash
# Clone template
git clone https://github.com/simonlee2/claude-agent-cloudflare.git my-agent
cd my-agent

# Install deps
pnpm install
cd container && pnpm install && cd ..

# Configure Cloudflare secrets
npx wrangler secret put ANTHROPIC_API_KEY

# Run locally
pnpm dev

# Deploy
pnpm deploy
```

## Architecture

```
┌─────────────────┐
│  React Frontend │  ← Sessions, Chat UI
└────────┬────────┘
         │ HTTP
┌────────▼────────┐
│ Cloudflare Worker│  ← Hono API, container orchestration
└────────┬────────┘
         │ WebSocket
┌────────▼────────┐
│ Docker Container │  ← Session pool, Claude Agent SDK
└────────┬────────┘
         │
┌────────▼────────┐
│   Claude API    │
└─────────────────┘
```

## Configuration

### Environment Variables

**Required:**
```env
ANTHROPIC_API_KEY=sk-ant-...
```

**Optional:**
```env
MODEL=claude-haiku-4-5       # Default model
POOL_SIZE=3                  # Session pool size
SESSION_TIMEOUT_MS=1500000   # 25 minutes
```

### Container Settings (wrangler.jsonc)

```jsonc
{
  "containers": [{
    "max_instances": 6,      // Max concurrent containers
    "instance_type": "basic" // Or "premium" for more resources
  }]
}
```

## Customization

### Adding Skills

1. Create `container/.claude/skills/your-skill/SKILL.md`
2. Follow [Agent Skills Specification](https://agentskills.io)
3. Skills auto-discovered on container start

### Adding MCP Servers

1. Copy `container/.mcp.json.example` to `container/.mcp.json`
2. Add MCP server configs
3. Update `/config` endpoint in `worker/index.ts` to advertise them

### Custom Environment Variables

1. Add to `container/.env.example`
2. Pass in `worker/index.ts` AgentContainer constructor
3. Access in `container/server.ts` via `process.env`

## Project Structure

```
├── container/           # Docker container (Agent SDK)
│   ├── server.ts       # Session pool + WebSocket server
│   ├── .claude/        # Skills and CLAUDE.md
│   └── .mcp.json       # MCP server config
├── src/                # React frontend
│   └── pages/          # Sessions, Chat pages
├── worker/             # Cloudflare Worker
│   └── index.ts        # Hono API
├── Dockerfile
├── wrangler.jsonc
└── package.json
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/query` | POST | Send prompt, get streaming response |
| `/warmup` | POST | Pre-warm container |
| `/pool-status` | GET | Session pool readiness |
| `/config` | GET | Available skills/MCP servers |
| `/health` | GET | Health check |

## License

MIT

# Claude Agent SDK - Container Context

This container runs the Claude Agent SDK with session pooling and optional skills/MCP servers.

## Adding Skills

Create skills in `.claude/skills/your-skill/SKILL.md` following the Agent Skills spec.

Skills are auto-discovered when `settingSources: ['project']` is configured.

## Adding MCP Servers

Copy `.mcp.json.example` to `.mcp.json` and add your MCP server configs.

## Environment Variables

- `ANTHROPIC_API_KEY` - Required. Claude API key
- `MODEL` - Optional. Defaults to claude-haiku-4-5
- `POOL_SIZE` - Optional. Session pool size (default: 3)
- `SESSION_TIMEOUT_MS` - Optional. Session timeout (default: 25min)

## Architecture

The agent runs in this container with access to:
- Built-in tools: Read, Edit, Bash, Glob, Grep, etc.
- MCP servers configured in `.mcp.json`
- Skills from `.claude/skills/`

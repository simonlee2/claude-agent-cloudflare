# Claude Agent SDK Container

This is a Node.js server that provides HTTP and WebSocket interfaces to the Claude Agent SDK.

## Features

- **HTTP API**: POST to `/run` endpoint for single-shot queries
- **WebSocket API**: Connect for streaming responses with session management
- **Session Management**: Maintains conversation history across multiple messages
- **Health Check**: GET `/healthz` for service health monitoring

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create a `.env` file with your Anthropic API key:
```
ANTHROPIC_API_KEY=your_api_key_here
MODEL=claude-haiku-4-5
```

3. Build the server:
```bash
npm run build
```

4. Run the server:
```bash
npm start
```

The server will start on port 8081.

## API Usage

### HTTP Endpoint

```bash
curl -X POST http://localhost:8081/run \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Hello, Claude!"}'
```

### WebSocket Endpoint

Connect to `ws://localhost:8081` and send messages in the format:
```json
{
  "prompt": "Your message here",
  "sessionId": "optional-session-id"
}
```

The server will stream responses back with various message types including:
- `session_created`: Sent when a new session is created
- `text_chunk`: Streaming text responses
- `complete`: Final response with full text

## Environment Variables

- `ANTHROPIC_API_KEY` (required): Your Anthropic API key
- `MODEL` (optional): Claude model to use (default: claude-haiku-4-5)

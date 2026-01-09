import { Hono } from "hono";
import { Container } from "@cloudflare/containers";

// Helper to get timestamp with milliseconds
const timestamp = () => new Date().toISOString().replace('T', ' ').replace('Z', '');

export class AgentContainer extends Container {
  defaultPort = 8081;
  sleepAfter = "30m";

  constructor(ctx: DurableObjectState<object>, env: Env) {
    super(ctx, env);
    // Pass environment variables to the container
    // Add custom env vars here as needed for your skills
    this.envVars = {
      ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY || "",
      MODEL: env.MODEL || "claude-haiku-4-5",
    };
  }

  override onStart() {
    console.log("[Container] Started", {
      timestamp: new Date().toISOString(),
      port: this.defaultPort,
      sleepAfter: this.sleepAfter
    });
  }

  override onStop(): void {
    console.log("[Container] Stopped", {
      timestamp: new Date().toISOString()
    });
  }

  override onError(error: unknown) {
    console.error("[Container] Error", {
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString()
    });
  }
}

const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) => {
  return c.json({
    status: "healthy",
    hasApiKey: !!c.env?.ANTHROPIC_API_KEY,
    hasContainer: !!c.env?.AGENT_CONTAINER,
    timestamp: new Date().toISOString(),
  });
});

app.get("/config", (c) => {
  // Customize this endpoint to advertise your skills and MCP servers
  return c.json({
    requiresApiKey: !c.env?.ANTHROPIC_API_KEY,
    skills: [],      // Add your skills here
    mcpServers: [],  // Add your MCP servers here
  });
});

app.post("/warmup", async (c) => {
  try {
    const startTime = Date.now();
    const body = await c.req.json().catch(() => ({}));
    const accountId = body.accountId || `warmup-${crypto.randomUUID()}`;
    const id = c.env.AGENT_CONTAINER.idFromName(accountId);
    const instance = c.env.AGENT_CONTAINER.get(id);

    console.log(`[${timestamp()}] [Warmup] Pre-warming container for account: ${accountId}`);

    await instance.startAndWaitForPorts({
      ports: [8081],
      startOptions: {
        envVars: {
          ANTHROPIC_API_KEY: c.env.ANTHROPIC_API_KEY || "",
          MODEL: c.env.MODEL || "claude-haiku-4-5",
          // Add custom env vars here as needed
        },
      },
    });

    const duration = Date.now() - startTime;
    console.log(`[${timestamp()}] [Warmup] Container ready in ${duration}ms`);

    return c.json({
      success: true,
      message: "Container warmed up successfully",
      duration,
      accountId
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[${timestamp()}] [Warmup Error]`, errorMessage);
    return c.json({ error: errorMessage }, 500);
  }
});

app.get("/pool-status", async (c) => {
  try {
    const accountId = c.req.query('accountId') || `status-check-${crypto.randomUUID()}`;
    const id = c.env.AGENT_CONTAINER.idFromName(accountId);
    const instance = c.env.AGENT_CONTAINER.get(id);

    // Check if container is running and get pool stats from /ready endpoint
    try {
      const port = await instance.getPort(8081);
      if (port) {
        const response = await fetch(`http://${port.hostname}:${port.port}/ready`);
        if (response.ok) {
          const data = await response.json();
          return c.json({
            containerRunning: true,
            poolReady: data.ready && data.available > 0,
            poolSize: data.poolSize || 0,
            available: data.available || 0,
            uptime: data.uptime || 0
          });
        }
      }
    } catch (err) {
      // Container not running or not ready yet
    }

    return c.json({
      containerRunning: false,
      poolReady: false,
      poolSize: 0,
      available: 0,
      uptime: 0
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return c.json({ error: errorMessage }, 500);
  }
});

app.post("/query", async (c) => {
  try {
    const queryStartTime = Date.now();
    console.log(`[${timestamp()}] [Query] Incoming request`);
    const body = await c.req.json().catch(() => ({}));
    const prompt = body.query || body.prompt;
    const accountId = body.accountId || `anonymous-${crypto.randomUUID()}`;
    let sessionId = body.sessionId;

    // Check for API key from environment
    const apiKey = c.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return c.json({ error: "ANTHROPIC_API_KEY must be configured" }, 400);
    }

    if (!prompt) {
      return c.json({ error: "No prompt provided" }, 400);
    }

    const id = c.env.AGENT_CONTAINER.idFromName(accountId);
    console.log(`[${timestamp()}] [Query] Using account ID: ${accountId}`);
    const instance = c.env.AGENT_CONTAINER.get(id);

    const containerStartTime = Date.now();
    console.log(`[${timestamp()}] [Query] Starting container...`);

    await instance.startAndWaitForPorts({
      ports: [8081],
      startOptions: {
        envVars: {
          ANTHROPIC_API_KEY: apiKey,
          MODEL: c.env.MODEL || "claude-haiku-4-5",
          // Add custom env vars here as needed
        },
      },
    });

    const containerDuration = Date.now() - containerStartTime;
    console.log(`[${timestamp()}] [Query] Container ready in ${containerDuration}ms`);
    console.log(`[${timestamp()}] [Query] Starting WebSocket connection`);

    // Create a ReadableStream that connects to WebSocket and streams responses
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const containerUrl = "http://container.internal/ws";
          
          // Use Cloudflare Workers WebSocket API
          const resp = await instance.fetch(containerUrl, {
            headers: {
              Upgrade: "websocket",
            },
          });
          
          // If the WebSocket handshake completed successfully, then the
          // response has a `webSocket` property.
          const ws = resp.webSocket;
          if (!ws) {
            throw new Error("server didn't accept WebSocket");
          }
          
          // Call accept() to indicate that you'll be handling the socket here
          ws.accept();
          
          const closeStream = (error?: Error) => {
            try{
              if (error) {
                controller.enqueue(encoder.encode(JSON.stringify({ error: error.message }) + "\n"));
              }
              controller.close();
              ws.close();
            }
            catch{
              console.log("Close stream error");
            }
          };

          console.log(`[${timestamp()}] [Query] WebSocket connected to container`);
          ws.send(JSON.stringify({ prompt, sessionId }));

          ws.addEventListener("message", (event) => {
            try {
              const message = JSON.parse(event.data);

              // Only log non-verbose messages
              if (message.type === 'text_chunk' || message.type === 'complete') {
                console.log(`[${timestamp()}] [Query] ${message.type}`);
              } else {
                console.log(`[${timestamp()}] [Query] Message:`, message);
              }
              
              if (message.error) {
                closeStream(new Error(message.error));
                return;
              }

              // Capture session ID from first session_created message
              if (message.type === "session_created" && message.claudeSessionId) {
                sessionId = message.claudeSessionId;
              }

              // Stream each message as a JSON line
              controller.enqueue(encoder.encode(JSON.stringify(message) + "\n"));

              if (message.type === "complete") {
                closeStream();
              }
            } catch (e) {
              console.error(`[${timestamp()}] [Query] Failed to parse message:`, e);
            }
          });

          ws.addEventListener("close", () => {
            console.log(`[${timestamp()}] [Query] WebSocket closed`);
            if (controller.desiredSize !== null) {
              closeStream();
            }
          });

          ws.addEventListener("error", (event) => {
            console.error(`[${timestamp()}] [Query] WebSocket error:`, event);
            closeStream(new Error("WebSocket connection failed"));
          });

          // Timeout after 5 minutes
          setTimeout(() => {
            closeStream(new Error("Query timeout"));
          }, 5 * 60 * 1000);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error(`[${timestamp()}] [Query Stream Error]`, errorMessage);
          controller.enqueue(encoder.encode(JSON.stringify({ error: errorMessage }) + "\n"));
          controller.close();
        }
      },
    });

    return c.newResponse(stream, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Transfer-Encoding": "chunked",
      },
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[${timestamp()}] [Query Error]`, errorMessage);
    return c.json({ error: errorMessage }, 500);
  }
});

export default app;

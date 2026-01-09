const startTime = Date.now();
console.log("[Startup] Starting server with session pooling...");

import "dotenv/config";
console.log(`[Startup] dotenv loaded (+${Date.now() - startTime}ms)`);

import { unstable_v2_createSession } from "@anthropic-ai/claude-agent-sdk";
import type { SDKSessionOptions, SDKSession } from "@anthropic-ai/claude-agent-sdk";
console.log(`[Startup] Agent SDK imported (+${Date.now() - startTime}ms)`);

import http from "node:http";
import { WebSocketServer } from "ws";
import { readFileSync } from "node:fs";
import { join } from "node:path";
console.log(`[Startup] Core modules loaded (+${Date.now() - startTime}ms)`);

const PORT = 8081;

// Session pool for pre-warmed sessions
interface PooledSession {
  session: SDKSession;
  sessionId: string;
  createdAt: number;
  lastUsed: number;
  inUse: boolean;
}

const sessionPool = new Map<string, PooledSession>();

// Session pool configuration - customize via environment variables
const POOL_SIZE = Number(process.env.POOL_SIZE) || 3;
const SESSION_TIMEOUT = Number(process.env.SESSION_TIMEOUT_MS) || 25 * 60 * 1000;
const PREWARM_DELAY = Number(process.env.PREWARM_DELAY_MS) || 2000;

// Check for MCP configuration (Claude Code will discover it automatically)
try {
  const mcpConfigPath = join(process.cwd(), ".mcp.json");
  const mcpConfig = JSON.parse(readFileSync(mcpConfigPath, "utf-8"));
  const mcpServers = mcpConfig.mcpServers || {};
  console.log(`[Startup] Found .mcp.json with servers: ${Object.keys(mcpServers).join(", ")}`);
} catch (error) {
  console.warn("[Startup] No .mcp.json found - MCP servers will not be available");
}

const SESSION_OPTIONS: SDKSessionOptions = {
  model: process.env.MODEL || "claude-haiku-4-5",
  env: {
    ...process.env,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "",
  }
};

// Pre-warm a session (create it but don't send any messages yet)
async function prewarmSession(options: SDKSessionOptions): Promise<PooledSession | null> {
  try {
    console.log(`[SessionPool] Pre-warming session...`);
    const prewarmStart = Date.now();

    const session = unstable_v2_createSession(options);

    // Generate a temporary session ID (will be replaced with real one after first message)
    const tempSessionId = `prewarm-${crypto.randomUUID()}`;

    const initTime = Date.now() - prewarmStart;
    console.log(`[SessionPool] ✓ Session ${tempSessionId.substring(0, 8)} created in ${initTime}ms`);

    return {
      session,
      sessionId: tempSessionId,
      createdAt: Date.now(),
      lastUsed: Date.now(),
      inUse: false
    };
  } catch (error) {
    console.error("[SessionPool] Failed to prewarm session:", error);
    return null;
  }
}

// Track original Map key for each session (to handle re-keying)
const sessionKeyMap = new Map<PooledSession, string>();

// Get or create a session from the pool
async function getSession(userSessionId?: string): Promise<PooledSession | null> {
  // If user has an existing session, try to reuse it
  if (userSessionId && sessionPool.has(userSessionId)) {
    const pooled = sessionPool.get(userSessionId)!;
    if (!pooled.inUse) {
      pooled.inUse = true;
      pooled.lastUsed = Date.now();
      console.log(`[SessionPool] Reusing existing session ${userSessionId.substring(0, 8)}`);
      return pooled;
    }
  }

  // Find any available session
  for (const [id, pooled] of sessionPool.entries()) {
    if (!pooled.inUse) {
      pooled.inUse = true;
      pooled.lastUsed = Date.now();
      sessionKeyMap.set(pooled, id); // Track current key
      console.log(`[SessionPool] Assigned session ${id.substring(0, 8)}`);
      return pooled;
    }
  }

  // No available session, create new one
  console.log(`[SessionPool] No available sessions, creating new session...`);
  const newSession = await prewarmSession(SESSION_OPTIONS);

  // Add to pool so it can be tracked and reused
  if (newSession) {
    sessionPool.set(newSession.sessionId, newSession);
    sessionKeyMap.set(newSession, newSession.sessionId);
    console.log(`[SessionPool] Added on-demand session ${newSession.sessionId.substring(0, 8)} to pool (${sessionPool.size} total)`);
  }

  return newSession;
}

// Update session key in pool when real ID is received from SDK
function updateSessionKey(session: PooledSession, newSessionId: string) {
  const oldKey = sessionKeyMap.get(session);
  if (oldKey && oldKey !== newSessionId) {
    sessionPool.delete(oldKey);
    sessionPool.set(newSessionId, session);
    sessionKeyMap.set(session, newSessionId);
    console.log(`[SessionPool] Re-keyed session ${oldKey.substring(0, 8)} → ${newSessionId.substring(0, 8)}`);
  }
  session.sessionId = newSessionId;
}

// Release session back to pool
function releaseSession(session: PooledSession) {
  session.inUse = false;
  session.lastUsed = Date.now();
  console.log(`[SessionPool] Released session ${session.sessionId.substring(0, 8)}`);
}

// Cleanup old sessions
function cleanupSessions() {
  const now = Date.now();
  for (const [id, pooled] of sessionPool.entries()) {
    if (now - pooled.lastUsed > SESSION_TIMEOUT) {
      try {
        pooled.session.close();
        sessionPool.delete(id);
        sessionKeyMap.delete(pooled);
        console.log(`[SessionPool] Cleaned up session ${id.substring(0, 8)}`);
      } catch (err) {
        console.error(`[SessionPool] Error cleaning up session:`, err);
      }
    }
  }

  // Maintain pool size
  const availableCount = Array.from(sessionPool.values()).filter(p => !p.inUse).length;
  if (availableCount < POOL_SIZE) {
    const needed = POOL_SIZE - availableCount;
    console.log(`[SessionPool] Pool low (${availableCount}/${POOL_SIZE}), pre-warming ${needed} sessions...`);

    // Pre-warm more sessions (async, don't wait)
    for (let i = 0; i < needed; i++) {
      prewarmSession(SESSION_OPTIONS).then(pooled => {
        if (pooled) {
          sessionPool.set(pooled.sessionId, pooled);
        }
      });
    }
  }
}

// Run cleanup every 5 minutes
setInterval(cleanupSessions, 5 * 60 * 1000);

console.log(`[Startup] Creating HTTP server (+${Date.now() - startTime}ms)`);

let serverReady = false;

const server = http.createServer(async (req, res) => {
  if (req.url === "/healthz" && req.method === "GET") {
    res.writeHead(200, { "content-type": "text/plain" });
    return res.end("ok");
  }

  if (req.url === "/ready" && req.method === "GET") {
    const poolStats = {
      ready: serverReady,
      uptime: Date.now() - startTime,
      poolSize: sessionPool.size,
      available: Array.from(sessionPool.values()).filter(p => !p.inUse).length
    };
    res.writeHead(serverReady ? 200 : 503, { "content-type": "application/json" });
    return res.end(JSON.stringify(poolStats));
  }

  res.writeHead(404, { "content-type": "text/plain" });
  res.end("Not Found");
});

console.log(`[Startup] Creating WebSocket server (+${Date.now() - startTime}ms)`);

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  console.log("[WebSocket] Client connected");

  ws.on("message", async (data) => {
    let assignedSession: PooledSession | null = null;

    try {
      const message = JSON.parse(data.toString());
      const { prompt, sessionId: incomingSessionId } = message;

      if (!prompt) {
        ws.send(JSON.stringify({ error: "No prompt provided" }));
        return;
      }

      console.log("[WebSocket] Received prompt:", prompt);
      console.log("[WebSocket] Prompt type:", typeof prompt);
      console.log("[WebSocket] Prompt length:", prompt?.length);
      console.log("[WebSocket] Full message:", JSON.stringify(message));

      ws.send(JSON.stringify({ type: "metadata", message: `Prompt received` }));

      const queryStart = Date.now();

      // Get session from pool
      assignedSession = await getSession(incomingSessionId);

      if (!assignedSession) {
        ws.send(JSON.stringify({ error: "Failed to get session" }));
        return;
      }

      // Get a fresh stream for this request BEFORE sending
      const stream = assignedSession.session.stream();

      // Send the message
      await assignedSession.session.send(prompt);

      let fullResponse = "";
      let realSessionId = assignedSession.sessionId;

      // Stream response
      for await (const msg of stream) {
        // Capture the real session ID from the init message and re-key the pool
        if (msg.type === "system" && msg.subtype === "init") {
          realSessionId = (msg as any).session_id;
          updateSessionKey(assignedSession, realSessionId);

          // Send session ID to client
          ws.send(JSON.stringify({
            type: "session_created",
            claudeSessionId: realSessionId
          }));
        }

        // Stream message to client
        ws.send(JSON.stringify({
          type: "message",
          messageType: msg.type,
          data: msg
        }));

        // Collect text response
        if (msg.type === "assistant") {
          const assistantMsg = msg as any;
          if (assistantMsg.message?.content) {
            for (const block of assistantMsg.message.content) {
              if (block.type === "text") {
                fullResponse += block.text;
                ws.send(JSON.stringify({
                  type: "text_chunk",
                  content: block.text
                }));
              }
            }
          }
        }

        // Log performance
        if (msg.type === "result") {
          const totalTime = Date.now() - queryStart;
          console.log(`[Performance] Total time: ${totalTime}ms (session ${realSessionId.substring(0, 8)})`);
          break;
        }
      }

      // Send completion
      ws.send(JSON.stringify({
        type: "complete",
        response: fullResponse,
        claudeSessionId: realSessionId
      }));

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error("[WebSocket Error]", errorMessage);
      ws.send(JSON.stringify({ error: errorMessage }));
    } finally {
      // Release session back to pool
      if (assignedSession) {
        releaseSession(assignedSession);
      }
    }
  });

  ws.on("close", () => {
    console.log("[WebSocket] Client disconnected");
  });

  ws.on("error", (error) => {
    console.error("[WebSocket Error]", error.message);
  });
});

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("[FATAL] ANTHROPIC_API_KEY environment variable not set");
  process.exit(1);
}

console.log(`[Startup] Starting server on port ${PORT} (+${Date.now() - startTime}ms)`);

server.listen(PORT, () => {
  serverReady = true;
  const startupTime = Date.now() - startTime;
  console.log(`[Startup] ✓ Server ready in ${startupTime}ms`);
  console.log(`Claude Agent SDK container listening on port ${PORT}`);
  console.log(`Session pooling enabled: pre-warming ${POOL_SIZE} sessions`);

  // Pre-warm initial pool after a short delay
  setTimeout(() => {
    console.log(`[SessionPool] Starting initial pool warmup...`);
    for (let i = 0; i < POOL_SIZE; i++) {
      prewarmSession(SESSION_OPTIONS).then(pooled => {
        if (pooled) {
          sessionPool.set(pooled.sessionId, pooled);
          console.log(`[SessionPool] Added session ${pooled.sessionId.substring(0, 8)} to pool (${sessionPool.size}/${POOL_SIZE})`);
        }
      });
    }
  }, PREWARM_DELAY);

  // Keepalive
  setInterval(() => {
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    if (uptime % 60 === 0) {
      const available = Array.from(sessionPool.values()).filter(p => !p.inUse).length;
      console.log(`[Keepalive] Uptime: ${uptime}s, Pool: ${available}/${sessionPool.size} available`);
    }
  }, 10000);
});

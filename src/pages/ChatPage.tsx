import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button, Tooltip } from '@base-ui/react';
import { MessageCircle } from 'lucide-react';

interface TextMessage {
  type: 'text';
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

interface ToolCallMessage {
  type: 'tool_call';
  role: 'assistant';
  toolName: string;
  input: Record<string, unknown>;
  timestamp: number;
}

interface SkillInvocationMessage {
  type: 'skill_invocation';
  role: 'assistant';
  command: string;
  timestamp: number;
}

interface SystemMessage {
  type: 'system';
  content: string;
  timestamp: number;
}

type Message = TextMessage | ToolCallMessage | SkillInvocationMessage | SystemMessage;

interface Session {
  id: string;
  createdAt: number;
  messageCount: number;
  preview: string;
}

export function ChatPage() {
  const navigate = useNavigate();
  const { sessionId } = useParams();
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(sessionId || null);
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingMessage, setStreamingMessage] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skills, setSkills] = useState<{ name: string; description: string }[]>([]);
  const [mcpServers, setMcpServers] = useState<{ name: string; description: string }[]>([]);
  const [poolStatus, setPoolStatus] = useState<{ ready: boolean; available: number } | null>(null);

  const getAccountId = () => {
    let accountId = localStorage.getItem('agentAccountId');
    if (!accountId) {
      accountId = `user-${crypto.randomUUID()}`;
      localStorage.setItem('agentAccountId', accountId);
    }
    return accountId;
  };

  // Check server config
  useEffect(() => {
    const checkConfig = async () => {
      try {
        const res = await fetch('/config');
        const data = await res.json();
        setSkills(data.skills || []);
        setMcpServers(data.mcpServers || []);
      } catch (err) {
        console.error('Failed to check config:', err);
      }
    };
    checkConfig();
  }, []);

  // Pre-warm container
  useEffect(() => {
    const warmupContainer = async () => {
      try {
        console.log('[Warmup] Pre-warming container...');
        await fetch('/warmup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accountId: getAccountId() })
        });
        console.log('[Warmup] Container ready');
      } catch (err) {
        console.log('[Warmup] Failed (non-critical):', err);
      }
    };
    const timer = setTimeout(warmupContainer, 0);
    return () => clearTimeout(timer);
  }, []);

  // Poll pool status
  useEffect(() => {
    let pollInterval: NodeJS.Timeout;

    const checkPoolStatus = async () => {
      try {
        const response = await fetch(`/pool-status?accountId=${getAccountId()}`);
        if (response.ok) {
          const data = await response.json();
          setPoolStatus({ ready: data.poolReady, available: data.available });
          if (data.poolReady && data.available > 0) {
            clearInterval(pollInterval);
          }
        }
      } catch (err) {
        console.log('[PoolStatus] Check failed:', err);
      }
    };

    checkPoolStatus();
    pollInterval = setInterval(checkPoolStatus, 2000);

    const stopTimeout = setTimeout(() => clearInterval(pollInterval), 15000);
    return () => {
      clearInterval(pollInterval);
      clearTimeout(stopTimeout);
    };
  }, []);

  // Load session history
  useEffect(() => {
    if (sessionId) {
      loadSessionHistory(sessionId);
    }
  }, [sessionId]);

  const loadSessions = () => {
    try {
      const savedSessions = localStorage.getItem('agentSessions');
      if (savedSessions) {
        return JSON.parse(savedSessions) as Session[];
      }
    } catch (err) {
      console.error('Failed to load sessions:', err);
    }
    return [];
  };

  const loadSessionHistory = (id: string) => {
    try {
      const key = `agentSessionHistory_${id}`;
      const history = localStorage.getItem(key);
      if (history) {
        setMessages(JSON.parse(history) as TextMessage[]);
      } else {
        setMessages([]);
      }
    } catch (err) {
      console.error('Failed to load session history:', err);
      setMessages([]);
    }
  };

  const saveSessionHistory = (id: string, msgs: TextMessage[]) => {
    try {
      localStorage.setItem(`agentSessionHistory_${id}`, JSON.stringify(msgs));
    } catch (err) {
      console.error('Failed to save session history:', err);
    }
  };

  // Session expires after container timeout
  const isSessionArchived = (): boolean => {
    if (messages.length === 0) return false;
    const lastMessage = messages[messages.length - 1];
    const minutesElapsed = (Date.now() - lastMessage.timestamp) / 1000 / 60;
    return minutesElapsed > 30;
  };

  const handleQuery = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!prompt.trim()) {
      setError('Please enter a prompt');
      return;
    }

    if (isSessionArchived()) {
      setError('This session has expired. Please start a new chat.');
      return;
    }

    const now = Date.now();
    const userMessage: TextMessage = { type: 'text', role: 'user', content: prompt, timestamp: now };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setPrompt('');
    setLoading(true);
    setError(null);
    setStreamingMessage('');

    try {
      const res = await fetch('/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          sessionId: selectedSessionId,
          accountId: getAccountId(),
        }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || `HTTP ${res.status}`);
      }

      let assistantTextContent = '';
      const responseMessages: Message[] = [];
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split('\n').filter(line => line.trim());

          for (const line of lines) {
            try {
              const msg = JSON.parse(line);

              if (msg.type === 'session_created' && msg.claudeSessionId) {
                setSelectedSessionId(msg.claudeSessionId);
                localStorage.setItem('agentCurrentSessionId', msg.claudeSessionId);
              }

              if (msg.type === 'text_chunk') {
                assistantTextContent += msg.content;
                setStreamingMessage(assistantTextContent);
              }

              if (msg.type === 'skill_invocation') {
                const skillMsg: SkillInvocationMessage = {
                  type: 'skill_invocation',
                  role: 'assistant',
                  command: msg.command,
                  timestamp: Date.now()
                };
                responseMessages.push(skillMsg);
                setMessages(prev => [...prev, skillMsg]);
              }

              if (msg.type === 'message' && msg.data?.type === 'assistant') {
                const assistantData = msg.data;
                if (assistantData.message?.content) {
                  for (const block of assistantData.message.content) {
                    if (block.type === 'tool_use') {
                      const toolMsg: ToolCallMessage = {
                        type: 'tool_call',
                        role: 'assistant',
                        toolName: block.name,
                        input: block.input,
                        timestamp: Date.now()
                      };
                      responseMessages.push(toolMsg);
                      setMessages(prev => [...prev, toolMsg]);
                    }
                  }
                }
              }
            } catch (e) {
              console.error('Failed to parse message:', e);
            }
          }
        }
      }

      if (assistantTextContent) {
        const assistantMsg: TextMessage = {
          type: 'text',
          role: 'assistant',
          content: assistantTextContent,
          timestamp: Date.now()
        };
        responseMessages.push(assistantMsg);
        setMessages(prev => [...prev, assistantMsg]);
      }

      const allMessages = [...updatedMessages, ...responseMessages];

      if (selectedSessionId) {
        const textOnlyMessages = allMessages.filter(msg => msg.type === 'text') as TextMessage[];
        saveSessionHistory(selectedSessionId, textOnlyMessages);

        const allSessions = loadSessions();
        const existing = allSessions.find(s => s.id === selectedSessionId);
        let updated;
        if (existing) {
          updated = allSessions.map(s =>
            s.id === selectedSessionId
              ? { ...s, messageCount: allMessages.length, preview: assistantTextContent.substring(0, 50) + (assistantTextContent.length > 50 ? '...' : '') }
              : s
          );
        } else {
          const newSession: Session = {
            id: selectedSessionId,
            createdAt: Date.now(),
            messageCount: allMessages.length,
            preview: assistantTextContent.substring(0, 50) + (assistantTextContent.length > 50 ? '...' : '')
          };
          updated = [newSession, ...allSessions];
        }
        localStorage.setItem('agentSessions', JSON.stringify(updated));
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      console.error('Query error:', err);
    } finally {
      setLoading(false);
      setStreamingMessage('');
    }
  };

  return (
    <Tooltip.Provider>
      <div className="w-full h-full flex flex-col bg-gray-50">
        {/* Header */}
        <div className="border-b border-gray-300 bg-white px-6 py-4">
          <div className="max-w-6xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button
                onClick={() => navigate('/')}
                className="p-2 hover:text-gray-900 transition-colors duration-200 cursor-pointer bg-transparent border-0"
              >
                <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </Button>
              <div>
                <h1 className="text-2xl font-mono font-bold uppercase text-gray-900">Claude Agent Template</h1>
                <p className="font-mono text-xs text-gray-600 mt-1">
                  Session: {selectedSessionId?.substring(0, 8) || 'new'}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          <div className="max-w-6xl mx-auto space-y-4">
            {messages.length === 0 && !error && (
              <div className="text-center py-12">
                <div className="text-gray-400 mb-4">
                  <MessageCircle size={64} className="mx-auto opacity-50" strokeWidth={1.5} />
                </div>
                <p className="font-mono text-sm text-gray-600">
                  Start a conversation by typing your prompt below
                </p>
              </div>
            )}

            {messages.map((message, idx) => {
              if (message.type === 'text') {
                return (
                  <div
                    key={idx}
                    className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-2xl px-4 py-3 ${
                        message.role === 'user'
                          ? 'bg-gray-900 text-white'
                          : 'bg-white text-gray-900 border border-gray-300'
                      }`}
                    >
                      <p className="font-mono text-xs text-gray-500 mb-2">
                        {new Date(message.timestamp).toLocaleTimeString()}
                      </p>
                      <p className="font-mono text-sm leading-relaxed whitespace-pre-wrap break-word">
                        {message.content}
                      </p>
                    </div>
                  </div>
                );
              }

              if (message.type === 'tool_call') {
                return (
                  <div key={idx} className="flex justify-start">
                    <div className="max-w-2xl px-4 py-3 bg-blue-50 text-gray-900 border border-blue-300 rounded">
                      <p className="font-mono text-xs font-bold uppercase text-blue-900 mb-2">
                        Tool Call
                      </p>
                      <p className="font-mono text-xs text-blue-700 mb-2">
                        <span className="font-bold">Tool:</span> {message.toolName}
                      </p>
                      <pre className="font-mono text-xs text-blue-700 mt-2 bg-white p-2 rounded border border-blue-200 overflow-x-auto">
                        {JSON.stringify(message.input, null, 2)}
                      </pre>
                    </div>
                  </div>
                );
              }

              if (message.type === 'skill_invocation') {
                return (
                  <div key={idx} className="flex justify-start">
                    <div className="max-w-2xl px-4 py-3 bg-purple-50 text-gray-900 border border-purple-300 rounded">
                      <p className="font-mono text-xs font-bold uppercase text-purple-900 mb-2">
                        Skill Invocation
                      </p>
                      <p className="font-mono text-sm text-purple-700">
                        Command: <span className="font-bold">{message.command}</span>
                      </p>
                    </div>
                  </div>
                );
              }

              if (message.type === 'system') {
                return (
                  <div key={idx} className="flex justify-center">
                    <div className="max-w-2xl px-4 py-2 bg-gray-100 text-gray-600 border border-gray-300 rounded text-center">
                      <p className="font-mono text-xs">{message.content}</p>
                    </div>
                  </div>
                );
              }

              return null;
            })}

            {streamingMessage && (
              <div className="flex justify-start">
                <div className="max-w-2xl px-4 py-3 bg-white text-gray-900 border border-gray-300">
                  <p className="font-mono text-xs text-gray-500 mb-2">Streaming...</p>
                  <p className="font-mono text-sm leading-relaxed whitespace-pre-wrap break-word">
                    {streamingMessage}
                  </p>
                </div>
              </div>
            )}

            {loading && !streamingMessage && (
              <div className="flex justify-start">
                <div className="bg-white text-gray-900 border border-gray-300 px-4 py-3">
                  <div className="flex gap-2">
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
                  </div>
                </div>
              </div>
            )}

            {error && (
              <div className="flex justify-center">
                <div className="max-w-2xl w-full bg-white border border-gray-300 text-gray-900 px-4 py-3">
                  <p className="font-mono text-xs font-bold uppercase text-gray-900">Error</p>
                  <p className="font-mono text-xs mt-2 text-gray-600">{error}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Input Area */}
        <div className="border-t border-gray-300 bg-white px-6 py-4">
          <div className="max-w-6xl mx-auto">
            {isSessionArchived() && (
              <div className="mb-4 p-4 border border-gray-300 bg-gray-50">
                <div className="flex items-start gap-3">
                  <div className="shrink-0 w-5 h-5 rounded-full bg-gray-300 text-gray-700 flex items-center justify-center font-mono text-xs font-bold">
                    i
                  </div>
                  <div className="flex-1">
                    <p className="font-mono text-xs font-bold uppercase text-gray-900 mb-2">Session Archived</p>
                    <p className="font-mono text-xs text-gray-600">
                      This session expired after container timeout. Start a new chat to continue.
                    </p>
                  </div>
                </div>
              </div>
            )}
            <form onSubmit={handleQuery} className="space-y-3">
              <div className="flex gap-3">
                <div className="flex-1">
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && e.ctrlKey) {
                        const fakeEvent = new Event('submit') as unknown as React.FormEvent;
                        handleQuery(fakeEvent);
                      }
                    }}
                    placeholder="Type your prompt here... (Ctrl+Enter to send)"
                    rows={3}
                    disabled={loading || isSessionArchived()}
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-300 text-gray-900 placeholder-gray-600 font-mono text-sm focus:outline-none focus:border-gray-900 disabled:opacity-50 disabled:cursor-not-allowed resize-none transition-colors duration-200"
                  />
                </div>
              </div>
              <div className="flex justify-between items-center">
                <div className="flex flex-wrap gap-2 items-center">
                  {skills.map((skill) => (
                    <Tooltip.Root key={skill.name}>
                      <Tooltip.Trigger className="px-2 py-0.5 bg-purple-50 text-purple-700 border border-purple-200 font-mono text-[10px] font-bold uppercase cursor-help hover:bg-purple-100 transition-colors">
                        ⚡ {skill.name}
                      </Tooltip.Trigger>
                      <Tooltip.Portal>
                        <Tooltip.Positioner side="top" sideOffset={8}>
                          <Tooltip.Popup className="bg-white text-gray-900 px-3 py-1.5 font-mono text-[10px] font-bold uppercase border border-gray-300 shadow-xl z-[100]">
                            <span className="text-purple-700 mr-2">SKILL:</span>
                            {skill.description}
                          </Tooltip.Popup>
                        </Tooltip.Positioner>
                      </Tooltip.Portal>
                    </Tooltip.Root>
                  ))}
                  {mcpServers.map((mcp) => (
                    <Tooltip.Root key={mcp.name}>
                      <Tooltip.Trigger className="px-2 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 font-mono text-[10px] font-bold uppercase cursor-help hover:bg-blue-100 transition-colors">
                        🔌 {mcp.name}
                      </Tooltip.Trigger>
                      <Tooltip.Portal>
                        <Tooltip.Positioner side="top" sideOffset={8}>
                          <Tooltip.Popup className="bg-white text-gray-900 px-3 py-1.5 font-mono text-[10px] font-bold uppercase border border-gray-300 shadow-xl z-[100]">
                            <span className="text-blue-700 mr-2">MCP:</span>
                            {mcp.description}
                          </Tooltip.Popup>
                        </Tooltip.Positioner>
                      </Tooltip.Portal>
                    </Tooltip.Root>
                  ))}
                  {poolStatus !== null && !poolStatus.ready && (
                    <Tooltip.Root>
                      <Tooltip.Trigger className="px-2 py-0.5 bg-yellow-50 text-yellow-700 border border-yellow-200 font-mono text-[10px] font-bold uppercase cursor-help animate-pulse">
                        ⏳ WARMING UP
                      </Tooltip.Trigger>
                      <Tooltip.Portal>
                        <Tooltip.Positioner side="top" sideOffset={8}>
                          <Tooltip.Popup className="bg-white text-gray-900 px-3 py-1.5 font-mono text-[10px] font-bold uppercase border border-gray-300 shadow-xl z-[100]">
                            <span className="text-yellow-700 mr-2">SESSION POOL:</span>
                            Preparing sessions for faster responses
                          </Tooltip.Popup>
                        </Tooltip.Positioner>
                      </Tooltip.Portal>
                    </Tooltip.Root>
                  )}
                  {prompt.length > 0 && (
                    <span className="font-mono text-[10px] text-gray-400 uppercase ml-1">
                      {prompt.length} chars
                    </span>
                  )}
                </div>
                <Button
                  type="submit"
                  disabled={loading || !prompt.trim() || isSessionArchived()}
                  className="px-6 py-2 font-mono font-bold uppercase text-xs bg-gray-900 text-white border border-gray-900 hover:bg-white hover:text-gray-900 transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {loading ? (
                    <span className="flex items-center gap-2">
                      <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Processing
                    </span>
                  ) : (
                    '→ Send'
                  )}
                </Button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </Tooltip.Provider>
  );
}

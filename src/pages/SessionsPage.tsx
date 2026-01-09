import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@base-ui/react';
import { MessageSquare } from 'lucide-react';

interface Session {
  id: string;
  createdAt: number;
  messageCount: number;
  preview: string;
}

export function SessionsPage() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  useEffect(() => {
    loadSessions();
  }, []);

  const loadSessions = () => {
    try {
      const savedSessions = localStorage.getItem('agentSessions');
      if (savedSessions) {
        const parsed = JSON.parse(savedSessions) as Session[];
        setSessions(parsed.sort((a, b) => b.createdAt - a.createdAt));
      }
    } catch (err) {
      console.error('Failed to load sessions:', err);
    }
  };

  const createNewSession = () => {
    navigate('/chat');
  };

  const selectSession = (sessionId: string) => {
    navigate(`/chat/${sessionId}`);
  };

  const deleteSession = (sessionId: string) => {
    const updatedSessions = sessions.filter(s => s.id !== sessionId);
    setSessions(updatedSessions);
    localStorage.setItem('agentSessions', JSON.stringify(updatedSessions));
    localStorage.removeItem(`agentSessionHistory_${sessionId}`);
  };

  // Sessions expire after container timeout (default 30m, configurable)
  const isSessionArchived = (session: Session): boolean => {
    const minutesElapsed = (Date.now() - session.createdAt) / 1000 / 60;
    return minutesElapsed > 30;
  };

  return (
    <div className="w-full h-full flex flex-col bg-gray-50">
      {/* Header */}
      <div className="border-b border-gray-300 bg-white px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-mono font-bold uppercase text-gray-900">Claude Agent Template</h1>
            <p className="font-mono text-xs text-gray-600 mt-1">
              Claude Agent SDK + Cloudflare Containers
            </p>
          </div>
          <Button
            onClick={createNewSession}
            className="px-6 py-2 font-mono font-bold uppercase text-xs bg-gray-900 text-white border border-gray-900 hover:bg-white hover:text-gray-900 transition-colors duration-200 cursor-pointer flex items-center gap-2"
          >
            <MessageSquare size={14} />
            New Chat
          </Button>
        </div>
      </div>

      {/* Sessions Grid */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="max-w-6xl mx-auto">
          {sessions.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <div className="max-w-lg text-center">
                <div className="text-gray-400 mb-6">
                  <svg
                    className="w-16 h-16 mx-auto opacity-50"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8m0 8l-4-2m4 2l4-2"
                    />
                  </svg>
                </div>

                <div className="border border-gray-300 bg-white">
                  <div className="border-b border-gray-300 bg-gray-100 px-4 py-3">
                    <h2 className="text-xs font-mono font-bold uppercase text-gray-900">No Sessions</h2>
                  </div>
                  <div className="p-4 space-y-4">
                    <p className="font-mono text-sm text-gray-600">
                      Create your first session to start chatting with Claude Agent.
                    </p>
                    <Button
                      onClick={createNewSession}
                      className="w-full px-6 py-3 font-mono font-bold uppercase text-xs bg-gray-900 text-white border border-gray-900 hover:bg-white hover:text-gray-900 transition-colors duration-200 cursor-pointer"
                    >
                      → Create First Session
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {sessions.map((session) => (
                <div
                  key={session.id}
                  className="bg-white border border-gray-300 flex flex-col overflow-hidden"
                >
                  <div className="flex items-center justify-between px-3 py-2 border-b border-gray-300 bg-gray-100">
                    <div className="flex items-center gap-2">
                      <p className="font-mono text-xs text-gray-600">
                        {new Date(session.createdAt).toLocaleDateString()} {new Date(session.createdAt).toLocaleTimeString()}
                      </p>
                      {isSessionArchived(session) && (
                        <span
                          className="font-mono text-xs bg-gray-300 text-gray-900 px-2 py-0.5 cursor-help"
                          title="Session expired after container timeout"
                        >
                          archived
                        </span>
                      )}
                    </div>
                    <Button
                      onClick={() => setDeleteConfirm(session.id)}
                      className="p-1 hover:text-gray-900 transition-colors duration-200 cursor-pointer text-gray-600 bg-transparent border-0"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </Button>
                  </div>

                  <Button
                    onClick={() => selectSession(session.id)}
                    className={`flex-1 text-left p-3 transition-colors duration-200 cursor-pointer ${
                      isSessionArchived(session)
                        ? 'bg-gray-50 opacity-60 hover:bg-gray-50'
                        : 'hover:bg-gray-50'
                    }`}
                  >
                    <p className="font-mono text-sm text-gray-900 line-clamp-2 mb-1">
                      {session.preview || 'New conversation'}
                    </p>
                    <p className="font-mono text-xs text-gray-600">
                      {session.messageCount} messages
                    </p>
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-gray-900/50 z-40 flex items-center justify-center">
          <div className="max-w-sm mx-4 z-50">
            <div className="bg-white border border-gray-300">
              <div className="border-b border-gray-300 bg-gray-100 px-4 py-3">
                <h2 className="text-xs font-mono font-bold uppercase text-gray-900">Delete Session?</h2>
              </div>
              <div className="p-4">
                <p className="font-mono text-sm text-gray-600 mb-4">
                  This will permanently delete this session and all its messages.
                </p>
                <div className="flex gap-3">
                  <Button
                    onClick={() => setDeleteConfirm(null)}
                    className="flex-1 px-4 py-2 font-mono font-bold uppercase text-xs bg-gray-100 text-gray-900 border border-gray-300 hover:bg-gray-200 hover:border-gray-900 transition-colors duration-200 cursor-pointer"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={() => {
                      deleteSession(deleteConfirm);
                      setDeleteConfirm(null);
                    }}
                    className="flex-1 px-4 py-2 font-mono font-bold uppercase text-xs bg-gray-900 text-white border border-gray-900 hover:bg-white hover:text-gray-900 transition-colors duration-200 cursor-pointer"
                  >
                    Delete
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

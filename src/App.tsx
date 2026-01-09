import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { SessionsPage } from './pages/SessionsPage'
import { ChatPage } from './pages/ChatPage'

function App() {
  return (
    <Router>
      <div className="h-screen w-screen overflow-hidden bg-gray-50">
        <Routes>
          <Route path="/" element={<SessionsPage />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/chat/:sessionId" element={<ChatPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </Router>
  )
}

export default App


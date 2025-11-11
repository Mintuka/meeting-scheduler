import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Dashboard } from './components/Dashboard';
import { NotificationComponent } from './components/NotificationComponent';
import { AuthProvider } from './context/AuthContext';
import { OAuthCallback } from './pages/OAuthCallback';
import { PollPage } from './pages/PollPage';
import './App.css';

function App() {
  return (
    <AuthProvider>
      <Router>
        <div className="App">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/oauth/callback" element={<OAuthCallback />} />
            <Route path="/poll/:pollId" element={<PollPage />} />
          </Routes>
          <NotificationComponent position="top-right" maxNotifications={5} />
        </div>
      </Router>
    </AuthProvider>
  );
}

export default App;

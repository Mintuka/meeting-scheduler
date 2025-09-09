import React from 'react';
import { Dashboard } from './components/Dashboard';
import { NotificationComponent } from './components/NotificationComponent';
import './App.css';

function App() {
  return (
    <div className="App">
      <Dashboard />
      <NotificationComponent position="top-right" maxNotifications={5} />
    </div>
  );
}

export default App;

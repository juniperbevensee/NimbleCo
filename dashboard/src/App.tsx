import { useState } from 'react';
import './App.css';
import Dashboard from './pages/Dashboard';
import InvocationStats from './pages/InvocationStats';
import AgentStatus from './pages/AgentStatus';
import ToolUsage from './pages/ToolUsage';

type TabId = 'dashboard' | 'invocations' | 'agents' | 'tools';

function App() {
  const [activeTab, setActiveTab] = useState<TabId>('dashboard');

  return (
    <div className="app">
      <header className="header">
        <h1>NimbleCo Admin Dashboard</h1>
        <p className="subtitle">Self-hosted agent orchestration monitoring</p>
      </header>

      <nav className="tabs">
        <button
          className={activeTab === 'dashboard' ? 'active' : ''}
          onClick={() => setActiveTab('dashboard')}
        >
          Dashboard
        </button>
        <button
          className={activeTab === 'invocations' ? 'active' : ''}
          onClick={() => setActiveTab('invocations')}
        >
          Invocations
        </button>
        <button
          className={activeTab === 'agents' ? 'active' : ''}
          onClick={() => setActiveTab('agents')}
        >
          Agents
        </button>
        <button
          className={activeTab === 'tools' ? 'active' : ''}
          onClick={() => setActiveTab('tools')}
        >
          Tools & LLMs
        </button>
      </nav>

      <main className="content">
        {activeTab === 'dashboard' && <Dashboard />}
        {activeTab === 'invocations' && <InvocationStats />}
        {activeTab === 'agents' && <AgentStatus />}
        {activeTab === 'tools' && <ToolUsage />}
      </main>

      <footer className="footer">
        <p>
          NimbleCo v0.1.0 | Powered by{' '}
          <a href="https://github.com/juniperbevensee/NimbleCo" target="_blank" rel="noopener noreferrer">
            GitHub
          </a>
        </p>
      </footer>
    </div>
  );
}

export default App;

import { useEffect, useState } from 'react';

interface Agent {
  id: string;
  name: string;
  type: string;
  status: string;
  last_seen: string;
  total_executions: number;
  avg_duration_ms: string;
  total_cost_usd: string;
}

function AgentStatus() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000); // Refresh every 10s
    return () => clearInterval(interval);
  }, []);

  const fetchData = async () => {
    try {
      const response = await fetch('/api/agents/status');
      if (!response.ok) {
        throw new Error('Failed to fetch agent status');
      }

      const data = await response.json();
      setAgents(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="loading">Loading agent status...</div>;
  }

  if (error) {
    return <div className="error">Error: {error}</div>;
  }

  const getHealthStatus = (lastSeen: string) => {
    const lastSeenDate = new Date(lastSeen);
    const now = new Date();
    const diffMinutes = (now.getTime() - lastSeenDate.getTime()) / 1000 / 60;

    if (diffMinutes < 5) return 'healthy';
    if (diffMinutes < 30) return 'warning';
    return 'offline';
  };

  return (
    <div className="agent-status">
      <h2>Agent Status</h2>

      <div className="agents-grid">
        {agents.map((agent) => {
          const healthStatus = getHealthStatus(agent.last_seen);
          return (
            <div key={agent.id} className={`agent-card ${healthStatus}`}>
              <div className="agent-header">
                <h3>{agent.name}</h3>
                <span className={`health-indicator ${healthStatus}`}>
                  {healthStatus === 'healthy' && '●'}
                  {healthStatus === 'warning' && '◐'}
                  {healthStatus === 'offline' && '○'}
                </span>
              </div>

              <div className="agent-details">
                <div className="detail-row">
                  <span className="label">ID:</span>
                  <span className="value">{agent.id}</span>
                </div>
                <div className="detail-row">
                  <span className="label">Type:</span>
                  <span className="value">{agent.type}</span>
                </div>
                <div className="detail-row">
                  <span className="label">Status:</span>
                  <span className={`value status-${agent.status}`}>
                    {agent.status}
                  </span>
                </div>
                <div className="detail-row">
                  <span className="label">Last Seen:</span>
                  <span className="value">
                    {new Date(agent.last_seen).toLocaleString()}
                  </span>
                </div>
              </div>

              <div className="agent-stats">
                <h4>Last 24h Statistics</h4>
                <div className="stat-row">
                  <span>Executions:</span>
                  <span className="stat-value">{agent.total_executions}</span>
                </div>
                <div className="stat-row">
                  <span>Avg Duration:</span>
                  <span className="stat-value">
                    {agent.avg_duration_ms
                      ? `${(parseFloat(agent.avg_duration_ms) / 1000).toFixed(2)}s`
                      : 'N/A'}
                  </span>
                </div>
                <div className="stat-row">
                  <span>Total Cost:</span>
                  <span className="stat-value">
                    ${parseFloat(agent.total_cost_usd || '0').toFixed(4)}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {agents.length === 0 && (
        <div className="empty-state">
          <p>No agents found. Make sure agents are running and connected to the coordinator.</p>
        </div>
      )}
    </div>
  );
}

export default AgentStatus;

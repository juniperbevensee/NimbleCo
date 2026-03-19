import { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface SystemMetrics {
  totalInvocations: number;
  todayInvocations: number;
  activeAgents: number;
  totalCostToday: number;
  avgResponseTime: number | null;
}

interface InvocationStat {
  date: string;
  total_invocations: number;
  completed: number;
  failed: number;
  total_cost_usd: string;
}

function Dashboard() {
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [stats, setStats] = useState<InvocationStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, []);

  const fetchData = async () => {
    try {
      const [metricsRes, statsRes] = await Promise.all([
        fetch('/api/system/metrics'),
        fetch('/api/invocations/stats?days=7'),
      ]);

      if (!metricsRes.ok || !statsRes.ok) {
        throw new Error('Failed to fetch data');
      }

      const metricsData = await metricsRes.json();
      const statsData = await statsRes.json();

      setMetrics(metricsData);
      setStats(statsData.reverse()); // Reverse for chronological order
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="loading">Loading dashboard...</div>;
  }

  if (error) {
    return <div className="error">Error: {error}</div>;
  }

  return (
    <div className="dashboard">
      <h2>System Overview</h2>

      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-label">Total Invocations</div>
          <div className="metric-value">{metrics?.totalInvocations.toLocaleString()}</div>
        </div>

        <div className="metric-card">
          <div className="metric-label">Today's Invocations</div>
          <div className="metric-value">{metrics?.todayInvocations.toLocaleString()}</div>
        </div>

        <div className="metric-card">
          <div className="metric-label">Active Agents</div>
          <div className="metric-value">{metrics?.activeAgents}</div>
        </div>

        <div className="metric-card">
          <div className="metric-label">Cost Today</div>
          <div className="metric-value">
            ${metrics?.totalCostToday.toFixed(4)}
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-label">Avg Response Time</div>
          <div className="metric-value">
            {metrics?.avgResponseTime
              ? `${(metrics.avgResponseTime / 1000).toFixed(2)}s`
              : 'N/A'}
          </div>
        </div>
      </div>

      <div className="chart-section">
        <h3>7-Day Invocation Trend</h3>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={stats}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" />
            <YAxis domain={[0, (dataMax: number) => Math.ceil(dataMax * 1.2)]} />
            <Tooltip />
            <Legend />
            <Line
              type="monotone"
              dataKey="total_invocations"
              stroke="#8884d8"
              name="Total"
            />
            <Line
              type="monotone"
              dataKey="completed"
              stroke="#82ca9d"
              name="Completed"
            />
            <Line
              type="monotone"
              dataKey="failed"
              stroke="#ff6b6b"
              name="Failed"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="chart-section">
        <h3>7-Day Cost Trend</h3>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={stats}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" />
            <YAxis domain={[0, (dataMax: number) => Math.ceil(dataMax * 1.2 * 100) / 100]} />
            <Tooltip />
            <Legend />
            <Line
              type="monotone"
              dataKey="total_cost_usd"
              stroke="#ffc658"
              name="Cost (USD)"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default Dashboard;

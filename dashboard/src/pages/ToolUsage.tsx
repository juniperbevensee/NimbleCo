import { useEffect, useState } from 'react';
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface ToolStat {
  tool_name: string;
  total_calls: string;
  successful_calls: string;
  failed_calls: string;
  avg_duration_ms: string;
  last_used_at: string;
}

interface LLMStat {
  provider: string;
  model: string;
  total_calls: string;
  total_input_tokens: string;
  total_output_tokens: string;
  total_cost_usd: string;
  avg_duration_ms: string;
}

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8', '#82CA9D'];

function ToolUsage() {
  const [toolStats, setToolStats] = useState<ToolStat[]>([]);
  const [llmStats, setLLMStats] = useState<LLMStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  const fetchData = async () => {
    try {
      const [toolsRes, llmRes] = await Promise.all([
        fetch('/api/tools/stats?days=7'),
        fetch('/api/llm/stats?days=7'),
      ]);

      if (!toolsRes.ok || !llmRes.ok) {
        throw new Error('Failed to fetch data');
      }

      const toolsData = await toolsRes.json();
      const llmData = await llmRes.json();

      setToolStats(toolsData);
      setLLMStats(llmData);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="loading">Loading tool usage...</div>;
  }

  if (error) {
    return <div className="error">Error: {error}</div>;
  }

  // Prepare data for pie chart
  const toolPieData = toolStats.slice(0, 6).map((tool) => ({
    name: tool.tool_name,
    value: parseInt(tool.total_calls, 10),
  }));

  // Prepare data for bar chart with numeric values
  const toolBarData = toolStats.slice(0, 10).map((tool) => ({
    tool_name: tool.tool_name,
    successful_calls: parseInt(tool.successful_calls, 10),
    failed_calls: parseInt(tool.failed_calls, 10),
  }));

  return (
    <div className="tool-usage">
      <h2>Tool & LLM Usage</h2>

      {toolStats.length > 0 && (
        <div className="section">
          <h3>Tool Usage Distribution (Last 7 Days)</h3>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))',
            gap: '2rem'
          }}>
            <div style={{ minHeight: '400px' }}>
              <h4 style={{ marginBottom: '1rem', color: '#dddddd' }}>Usage by Tool</h4>
              {toolPieData.length > 0 ? (
                <ResponsiveContainer width="100%" height={350}>
                  <PieChart>
                    <Pie
                      data={toolPieData}
                      cx="50%"
                      cy="50%"
                      labelLine={true}
                      label={(entry) => `${entry.name} (${entry.value})`}
                      outerRadius={100}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {toolPieData.map((_entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ backgroundColor: '#1b2c3e', border: '1px solid #4a5664', color: '#dddddd' }} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div style={{ color: '#dddddd', padding: '2rem', textAlign: 'center' }}>No data available</div>
              )}
            </div>

            <div style={{ minHeight: '450px' }}>
              <h4 style={{ marginBottom: '1rem', color: '#dddddd' }}>Success vs Failed</h4>
              <ResponsiveContainer width="100%" height={450}>
                <BarChart data={toolBarData} margin={{ bottom: 120, left: 20, right: 20, top: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#4a5664" />
                  <XAxis
                    dataKey="tool_name"
                    angle={-45}
                    textAnchor="end"
                    height={140}
                    interval={0}
                    tick={{ fill: '#dddddd', fontSize: 12 }}
                  />
                  <YAxis tick={{ fill: '#dddddd' }} />
                  <Tooltip contentStyle={{ backgroundColor: '#1b2c3e', border: '1px solid #4a5664', color: '#dddddd' }} />
                  <Legend wrapperStyle={{ paddingTop: '20px' }} />
                  <Bar dataKey="successful_calls" stackId="a" fill="#65dcc8" name="Success" />
                  <Bar dataKey="failed_calls" stackId="a" fill="#ff6461" name="Failed" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      <div className="section">
        <h3>Tool Statistics</h3>
        <div className="table-container">
          <table className="stats-table">
            <thead>
              <tr>
                <th>Tool Name</th>
                <th>Total Calls</th>
                <th>Success Rate</th>
                <th>Avg Duration</th>
                <th>Last Used</th>
              </tr>
            </thead>
            <tbody>
              {toolStats.map((tool) => {
                const successRate = (parseInt(tool.successful_calls, 10) / parseInt(tool.total_calls, 10)) * 100;
                return (
                  <tr key={tool.tool_name}>
                    <td className="tool-name">{tool.tool_name}</td>
                    <td>{tool.total_calls}</td>
                    <td>
                      <span className={successRate >= 90 ? 'success' : 'warning'}>
                        {successRate.toFixed(1)}%
                      </span>
                    </td>
                    <td>
                      {tool.avg_duration_ms
                        ? `${(parseFloat(tool.avg_duration_ms) / 1000).toFixed(2)}s`
                        : 'N/A'}
                    </td>
                    <td>{new Date(tool.last_used_at).toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="section">
        <h3>LLM Usage Statistics</h3>
        <div className="table-container">
          <table className="stats-table">
            <thead>
              <tr>
                <th>Provider</th>
                <th>Model</th>
                <th>Calls</th>
                <th>Input Tokens</th>
                <th>Output Tokens</th>
                <th>Total Cost</th>
                <th>Avg Duration</th>
              </tr>
            </thead>
            <tbody>
              {llmStats.map((llm, index) => (
                <tr key={`${llm.provider}-${llm.model}-${index}`}>
                  <td className="provider">{llm.provider}</td>
                  <td className="model">{llm.model}</td>
                  <td>{llm.total_calls}</td>
                  <td>{parseInt(llm.total_input_tokens, 10).toLocaleString()}</td>
                  <td>{parseInt(llm.total_output_tokens, 10).toLocaleString()}</td>
                  <td>${parseFloat(llm.total_cost_usd).toFixed(4)}</td>
                  <td>
                    {llm.avg_duration_ms
                      ? `${(parseFloat(llm.avg_duration_ms) / 1000).toFixed(2)}s`
                      : 'N/A'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {toolStats.length === 0 && llmStats.length === 0 && (
        <div className="empty-state">
          <p>No tool or LLM usage data available for the last 7 days.</p>
        </div>
      )}
    </div>
  );
}

export default ToolUsage;

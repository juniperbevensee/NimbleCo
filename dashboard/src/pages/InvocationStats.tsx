import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface UserStat {
  trigger_user_id: string;
  total_invocations: number;
  completed: number;
  failed: number;
  total_cost_usd: string;
  avg_duration_ms: string;
  last_invocation_at: string;
}

interface RecentInvocation {
  id: string;
  trigger_user_id: string;
  input_message: string;
  status: string;
  started_at: string;
  completed_at: string;
  duration_ms: number;
  total_cost_usd: string;
  error: string | null;
  channel_id: string | null;
}

interface UserInfo {
  id: string;
  username: string | null;
  display_name: string | null;
}

interface ChannelInfo {
  id: string;
  name: string | null;
  display_name: string | null;
}

function InvocationStats() {
  const [userStats, setUserStats] = useState<UserStat[]>([]);
  const [recentInvocations, setRecentInvocations] = useState<RecentInvocation[]>([]);
  const [userInfo, setUserInfo] = useState<Record<string, UserInfo>>({});
  const [channelInfo, setChannelInfo] = useState<Record<string, ChannelInfo>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [filterUser, setFilterUser] = useState<string>('');
  const [filterChannel, setFilterChannel] = useState<string>('');

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [filterUser, filterChannel]);

  const fetchData = async () => {
    try {
      // Build query params for filters
      const params = new URLSearchParams();
      params.append('limit', '20');
      if (filterUser) params.append('user', filterUser);
      if (filterChannel) params.append('channel', filterChannel);

      const [usersRes, recentRes] = await Promise.all([
        fetch('/api/invocations/users?days=7'),
        fetch(`/api/invocations/recent?${params.toString()}`),
      ]);

      if (!usersRes.ok || !recentRes.ok) {
        throw new Error('Failed to fetch data');
      }

      const usersData = await usersRes.json();
      const recentData = await recentRes.json();

      setUserStats(usersData);
      setRecentInvocations(recentData);

      // Fetch user info for all unique user IDs
      const allUserIds = new Set<string>();
      usersData.forEach((stat: UserStat) => allUserIds.add(stat.trigger_user_id));
      recentData.forEach((inv: RecentInvocation) => allUserIds.add(inv.trigger_user_id));

      // Fetch channel info for all unique channel IDs
      const allChannelIds = new Set<string>();
      recentData.forEach((inv: RecentInvocation) => {
        if (inv.channel_id) allChannelIds.add(inv.channel_id);
      });

      const promises = [];

      if (allUserIds.size > 0) {
        promises.push(
          fetch('/api/mattermost/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_ids: Array.from(allUserIds) }),
          }).then(res => res.ok ? res.json() : {})
        );
      } else {
        promises.push(Promise.resolve({}));
      }

      if (allChannelIds.size > 0) {
        promises.push(
          fetch('/api/mattermost/channels', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ channel_ids: Array.from(allChannelIds) }),
          }).then(res => res.ok ? res.json() : {})
        );
      } else {
        promises.push(Promise.resolve({}));
      }

      const [userInfoData, channelInfoData] = await Promise.all(promises);
      setUserInfo(userInfoData);
      setChannelInfo(channelInfoData);

      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const getUserDisplay = (userId: string) => {
    const info = userInfo[userId];
    if (info?.display_name) {
      return `${info.display_name} (${userId.substring(0, 8)}...)`;
    }
    return userId;
  };

  const getChannelDisplay = (channelId: string | null) => {
    if (!channelId) return 'N/A';
    const info = channelInfo[channelId];
    if (info?.display_name) {
      return info.display_name;
    }
    return channelId.substring(0, 12) + '...';
  };

  if (loading) {
    return <div className="loading">Loading invocation stats...</div>;
  }

  if (error) {
    return <div className="error">Error: {error}</div>;
  }

  // Get unique users and channels for filters
  const uniqueUsers = Array.from(new Set(recentInvocations.map(inv => inv.trigger_user_id)));
  const uniqueChannels = Array.from(new Set(recentInvocations.map(inv => inv.channel_id).filter(Boolean)));

  // Transform user stats to include display names for the chart
  const userStatsWithNames = userStats.slice(0, 10).map(stat => ({
    ...stat,
    user_display: userInfo[stat.trigger_user_id]?.display_name ||
                  userInfo[stat.trigger_user_id]?.username ||
                  stat.trigger_user_id.substring(0, 12) + '...',
  }));

  return (
    <div className="invocation-stats">
      <h2>Invocation Statistics</h2>

      <div className="section">
        <h3>Total Invocations by User (Last 7 Days)</h3>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={userStatsWithNames}>
            <CartesianGrid strokeDasharray="3 3" stroke="#4a5664" />
            <XAxis
              dataKey="user_display"
              angle={-45}
              textAnchor="end"
              height={100}
              tick={{ fill: '#dddddd', fontSize: 11 }}
            />
            <YAxis domain={[0, (dataMax: number) => Math.ceil(dataMax * 1.2)]} tick={{ fill: '#dddddd' }} />
            <Tooltip contentStyle={{ backgroundColor: '#1b2c3e', border: '1px solid #4a5664', color: '#dddddd' }} />
            <Legend />
            <Bar dataKey="total_invocations" fill="#4cbba4" name="Total Invocations" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="section">
        <h3>Success vs Failure by User (Last 7 Days)</h3>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={userStatsWithNames}>
            <CartesianGrid strokeDasharray="3 3" stroke="#4a5664" />
            <XAxis
              dataKey="user_display"
              angle={-45}
              textAnchor="end"
              height={100}
              tick={{ fill: '#dddddd', fontSize: 11 }}
            />
            <YAxis domain={[0, (dataMax: number) => Math.ceil(dataMax * 1.2)]} tick={{ fill: '#dddddd' }} />
            <Tooltip contentStyle={{ backgroundColor: '#1b2c3e', border: '1px solid #4a5664', color: '#dddddd' }} />
            <Legend />
            <Bar dataKey="completed" fill="#65dcc8" name="Completed" />
            <Bar dataKey="failed" fill="#ff6461" name="Failed" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="section">
        <h3>User Statistics Table</h3>
        <div className="table-container">
          <table className="stats-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Total</th>
                <th>Completed</th>
                <th>Failed</th>
                <th>Avg Duration</th>
                <th>Total Cost</th>
                <th>Last Invocation</th>
              </tr>
            </thead>
            <tbody>
              {userStats.map((stat) => (
                <tr key={stat.trigger_user_id}>
                  <td className="user-id">{getUserDisplay(stat.trigger_user_id)}</td>
                  <td>{stat.total_invocations}</td>
                  <td className="success">{stat.completed}</td>
                  <td className="error">{stat.failed}</td>
                  <td>
                    {stat.avg_duration_ms
                      ? `${(parseFloat(stat.avg_duration_ms) / 1000).toFixed(2)}s`
                      : 'N/A'}
                  </td>
                  <td>${parseFloat(stat.total_cost_usd).toFixed(4)}</td>
                  <td>{new Date(stat.last_invocation_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="section">
        <h3>Recent Invocations</h3>

        {/* Filter Controls */}
        <div style={{ marginBottom: '1rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <label style={{ color: '#dddddd', fontSize: '0.9rem' }}>User:</label>
            <select
              value={filterUser}
              onChange={(e) => setFilterUser(e.target.value)}
              style={{
                padding: '0.5rem',
                borderRadius: '4px',
                border: '1px solid #4a5664',
                backgroundColor: '#2f3e4e',
                color: '#dddddd',
                fontSize: '0.9rem'
              }}
            >
              <option value="">All Users</option>
              {uniqueUsers.map((userId) => (
                <option key={userId} value={userId}>
                  {getUserDisplay(userId)}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <label style={{ color: '#dddddd', fontSize: '0.9rem' }}>Channel:</label>
            <select
              value={filterChannel}
              onChange={(e) => setFilterChannel(e.target.value)}
              style={{
                padding: '0.5rem',
                borderRadius: '4px',
                border: '1px solid #4a5664',
                backgroundColor: '#2f3e4e',
                color: '#dddddd',
                fontSize: '0.9rem'
              }}
            >
              <option value="">All Channels</option>
              {uniqueChannels.map((channelId) => (
                <option key={channelId as string} value={channelId as string}>
                  {getChannelDisplay(channelId as string)}
                </option>
              ))}
            </select>
          </div>

          {(filterUser || filterChannel) && (
            <button
              onClick={() => {
                setFilterUser('');
                setFilterChannel('');
              }}
              style={{
                padding: '0.5rem 1rem',
                borderRadius: '4px',
                border: '1px solid #4a5664',
                backgroundColor: '#4cbba4',
                color: '#ffffff',
                cursor: 'pointer',
                fontSize: '0.9rem'
              }}
            >
              Clear Filters
            </button>
          )}
        </div>

        <div className="table-container">
          <table className="stats-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>User</th>
                <th>Channel</th>
                <th>Input</th>
                <th>Status</th>
                <th>Duration</th>
                <th>Cost</th>
              </tr>
            </thead>
            <tbody>
              {recentInvocations.map((inv) => (
                <tr key={inv.id}>
                  <td>{new Date(inv.started_at).toLocaleString()}</td>
                  <td className="user-id">{getUserDisplay(inv.trigger_user_id)}</td>
                  <td>
                    {getChannelDisplay(inv.channel_id)}
                  </td>
                  <td className="message-preview">
                    {inv.input_message?.substring(0, 50)}
                    {inv.input_message?.length > 50 ? '...' : ''}
                  </td>
                  <td>
                    <span className={`status-badge ${inv.status}`}>
                      {inv.status}
                    </span>
                  </td>
                  <td>
                    {inv.duration_ms
                      ? `${(inv.duration_ms / 1000).toFixed(2)}s`
                      : 'N/A'}
                  </td>
                  <td>${parseFloat(inv.total_cost_usd || '0').toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default InvocationStats;

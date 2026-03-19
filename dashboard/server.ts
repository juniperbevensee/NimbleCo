import express from 'express';
import cors from 'cors';
import { Pool } from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Get directory name in ES module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from parent directory
dotenv.config({ path: path.join(__dirname, '../../.env') });

const app = express();
const port = 3001;

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://agent:password@localhost:5432/nimbleco',
});

app.use(cors());
app.use(express.json());

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Get invocation statistics (daily breakdown)
app.get('/api/invocations/stats', async (req, res) => {
  try {
    const days = parseInt(req.query.days as string) || 7;
    const botId = req.query.bot_id as string | undefined;
    const botFilter = botId ? `AND bot_id = '${botId}'` : '';

    const query = `
      SELECT
        DATE(started_at) as date,
        COUNT(*) as total_invocations,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
        COUNT(CASE WHEN status = 'running' THEN 1 END) as running,
        SUM(total_input_tokens) as total_input_tokens,
        SUM(total_output_tokens) as total_output_tokens,
        SUM(total_cost_usd) as total_cost_usd,
        AVG(duration_ms) as avg_duration_ms
      FROM invocations
      WHERE started_at >= NOW() - INTERVAL '${days} days' ${botFilter}
      GROUP BY DATE(started_at)
      ORDER BY date DESC
    `;

    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching invocation stats:', error);
    res.status(500).json({ error: 'Failed to fetch invocation stats' });
  }
});

// Get per-user breakdown of invocations
app.get('/api/invocations/users', async (req, res) => {
  try {
    const days = parseInt(req.query.days as string) || 7;
    const botId = req.query.bot_id as string | undefined;
    const botFilter = botId ? `AND bot_id = '${botId}'` : '';

    const query = `
      SELECT
        trigger_user_id,
        COUNT(*) as total_invocations,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
        SUM(total_input_tokens) as total_input_tokens,
        SUM(total_output_tokens) as total_output_tokens,
        SUM(total_cost_usd) as total_cost_usd,
        AVG(duration_ms) as avg_duration_ms,
        MAX(started_at) as last_invocation_at
      FROM invocations
      WHERE started_at >= NOW() - INTERVAL '${days} days' ${botFilter}
      GROUP BY trigger_user_id
      ORDER BY total_invocations DESC
    `;

    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching user stats:', error);
    res.status(500).json({ error: 'Failed to fetch user stats' });
  }
});

// Get recent invocations
app.get('/api/invocations/recent', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const userFilter = req.query.user as string | undefined;
    const channelFilter = req.query.channel as string | undefined;
    const botFilter = req.query.bot_id as string | undefined;

    let query = `
      SELECT
        i.id,
        i.trigger_user_id,
        i.input_message,
        i.status,
        i.started_at,
        i.completed_at,
        i.duration_ms,
        i.total_input_tokens,
        i.total_output_tokens,
        i.total_cost_usd,
        i.error,
        i.bot_id,
        c.room_id as channel_id
      FROM invocations i
      LEFT JOIN conversations c ON i.conversation_id = c.id
      WHERE 1=1
    `;

    const params: any[] = [];
    let paramCount = 1;

    if (userFilter) {
      query += ` AND i.trigger_user_id = $${paramCount}`;
      params.push(userFilter);
      paramCount++;
    }

    if (channelFilter) {
      query += ` AND c.room_id = $${paramCount}`;
      params.push(channelFilter);
      paramCount++;
    }

    if (botFilter) {
      query += ` AND i.bot_id = $${paramCount}`;
      params.push(botFilter);
      paramCount++;
    }

    query += ` ORDER BY i.started_at DESC LIMIT $${paramCount}`;
    params.push(limit);

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching recent invocations:', error);
    res.status(500).json({ error: 'Failed to fetch recent invocations' });
  }
});

// Get Mattermost user info
app.post('/api/mattermost/users', async (req, res) => {
  try {
    const { user_ids } = req.body;

    if (!Array.isArray(user_ids)) {
      return res.status(400).json({ error: 'user_ids must be an array' });
    }

    const mattermostUrl = process.env.MATTERMOST_URL;
    const botToken = process.env.MATTERMOST_BOT_TOKEN;

    if (!mattermostUrl || !botToken) {
      return res.status(500).json({ error: 'Mattermost not configured' });
    }

    // Fetch user info for each ID
    const userInfoPromises = user_ids.map(async (userId: string) => {
      try {
        const response = await fetch(`${mattermostUrl}/api/v4/users/${userId}`, {
          headers: {
            'Authorization': `Bearer ${botToken}`,
          },
        });

        if (!response.ok) {
          console.error(`Failed to fetch user ${userId}: ${response.status} ${response.statusText}`);
          return { id: userId, username: null, display_name: null };
        }

        const user = await response.json() as any;
        return {
          id: userId,
          username: user.username,
          display_name: user.first_name && user.last_name
            ? `${user.first_name} ${user.last_name}`
            : user.username,
        };
      } catch (err) {
        console.error(`Error fetching user ${userId}:`, err instanceof Error ? err.message : err);
        return { id: userId, username: null, display_name: null };
      }
    });

    const userInfo = await Promise.all(userInfoPromises);

    // Return as a map for easy lookup
    const userMap = userInfo.reduce((acc, user) => {
      acc[user.id] = user;
      return acc;
    }, {} as Record<string, any>);

    res.json(userMap);
  } catch (error) {
    console.error('Error fetching Mattermost users:', error);
    res.status(500).json({ error: 'Failed to fetch user info' });
  }
});

// Get Mattermost channel info
app.post('/api/mattermost/channels', async (req, res) => {
  try {
    const { channel_ids } = req.body;

    if (!Array.isArray(channel_ids)) {
      return res.status(400).json({ error: 'channel_ids must be an array' });
    }

    const mattermostUrl = process.env.MATTERMOST_URL;
    const botToken = process.env.MATTERMOST_BOT_TOKEN;

    if (!mattermostUrl || !botToken) {
      return res.status(500).json({ error: 'Mattermost not configured' });
    }

    // Fetch channel info for each ID
    const channelInfoPromises = channel_ids.map(async (channelId: string) => {
      try {
        const response = await fetch(`${mattermostUrl}/api/v4/channels/${channelId}`, {
          headers: {
            'Authorization': `Bearer ${botToken}`,
          },
        });

        if (!response.ok) {
          console.error(`Failed to fetch channel ${channelId}: ${response.status} ${response.statusText}`);
          return { id: channelId, name: null, display_name: null };
        }

        const channel = await response.json() as any;
        return {
          id: channelId,
          name: channel.name,
          display_name: channel.display_name || channel.name,
        };
      } catch (err) {
        console.error(`Error fetching channel ${channelId}:`, err instanceof Error ? err.message : err);
        return { id: channelId, name: null, display_name: null };
      }
    });

    const channelInfo = await Promise.all(channelInfoPromises);

    // Return as a map for easy lookup
    const channelMap = channelInfo.reduce((acc, channel) => {
      acc[channel.id] = channel;
      return acc;
    }, {} as Record<string, any>);

    res.json(channelMap);
  } catch (error) {
    console.error('Error fetching Mattermost channels:', error);
    res.status(500).json({ error: 'Failed to fetch channel info' });
  }
});

// Get agent status (from database)
app.get('/api/agents/status', async (req, res) => {
  try {
    const query = `
      SELECT
        a.id,
        a.name,
        a.type,
        a.status,
        a.last_seen,
        COUNT(e.id) as total_executions,
        AVG(e.duration_ms) as avg_duration_ms,
        SUM(e.cost_usd) as total_cost_usd
      FROM agents a
      LEFT JOIN agent_executions e ON a.id = e.agent_id
        AND e.created_at > NOW() - INTERVAL '24 hours'
      GROUP BY a.id, a.name, a.type, a.status, a.last_seen
      ORDER BY a.name
    `;

    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching agent status:', error);
    res.status(500).json({ error: 'Failed to fetch agent status' });
  }
});

// Get tool usage statistics
app.get('/api/tools/stats', async (req, res) => {
  try {
    const days = parseInt(req.query.days as string) || 7;

    const query = `
      SELECT
        tool_name,
        COUNT(*) as total_calls,
        COUNT(CASE WHEN status = 'success' THEN 1 END) as successful_calls,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_calls,
        AVG(duration_ms) as avg_duration_ms,
        MAX(started_at) as last_used_at
      FROM tool_calls
      WHERE started_at >= NOW() - INTERVAL '${days} days'
      GROUP BY tool_name
      ORDER BY total_calls DESC
    `;

    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching tool stats:', error);
    res.status(500).json({ error: 'Failed to fetch tool stats' });
  }
});

// Get LLM usage statistics
app.get('/api/llm/stats', async (req, res) => {
  try {
    const days = parseInt(req.query.days as string) || 7;

    const query = `
      SELECT
        provider,
        model,
        COUNT(*) as total_calls,
        SUM(input_tokens) as total_input_tokens,
        SUM(output_tokens) as total_output_tokens,
        SUM(cost_usd) as total_cost_usd,
        AVG(duration_ms) as avg_duration_ms
      FROM llm_calls
      WHERE started_at >= NOW() - INTERVAL '${days} days'
      GROUP BY provider, model
      ORDER BY total_calls DESC
    `;

    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching LLM stats:', error);
    res.status(500).json({ error: 'Failed to fetch LLM stats' });
  }
});

// Get cost overview
app.get('/api/costs/overview', async (req, res) => {
  try {
    const query = `
      SELECT
        date,
        total_cost_usd,
        total_tokens,
        total_executions,
        ROUND(total_cost_usd / NULLIF(total_executions, 0), 4) as avg_cost_per_execution
      FROM daily_costs
      ORDER BY date DESC
      LIMIT 30
    `;

    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching cost overview:', error);
    res.status(500).json({ error: 'Failed to fetch cost overview' });
  }
});

// Get list of all bots
app.get('/api/bots', async (req, res) => {
  try {
    const query = `
      SELECT DISTINCT
        bot_id,
        COUNT(DISTINCT i.id) as total_invocations,
        MAX(i.started_at) as last_active
      FROM invocations i
      WHERE bot_id IS NOT NULL
      GROUP BY bot_id
      ORDER BY bot_id
    `;

    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching bots:', error);
    res.status(500).json({ error: 'Failed to fetch bots' });
  }
});

// Get system metrics
app.get('/api/system/metrics', async (req, res) => {
  try {
    const botId = req.query.bot_id as string | undefined;
    const botFilter = botId ? `AND bot_id = '${botId}'` : '';

    const queries = {
      totalInvocations: `SELECT COUNT(*) as count FROM invocations WHERE 1=1 ${botFilter}`,
      todayInvocations: `SELECT COUNT(*) as count FROM invocations WHERE DATE(started_at) = CURRENT_DATE ${botFilter}`,
      activeAgents: `SELECT COUNT(*) as count FROM agents WHERE status = 'active'`,
      totalCostToday: `SELECT COALESCE(SUM(total_cost_usd), 0) as cost FROM invocations WHERE DATE(started_at) = CURRENT_DATE ${botFilter}`,
      avgResponseTime: `SELECT AVG(duration_ms) as avg_ms FROM invocations WHERE completed_at >= NOW() - INTERVAL '1 hour' ${botFilter}`,
    };

    const results = await Promise.all([
      pool.query(queries.totalInvocations),
      pool.query(queries.todayInvocations),
      pool.query(queries.activeAgents),
      pool.query(queries.totalCostToday),
      pool.query(queries.avgResponseTime),
    ]);

    res.json({
      totalInvocations: parseInt(results[0].rows[0].count),
      todayInvocations: parseInt(results[1].rows[0].count),
      activeAgents: parseInt(results[2].rows[0].count),
      totalCostToday: parseFloat(results[3].rows[0].cost),
      avgResponseTime: results[4].rows[0].avg_ms ? parseFloat(results[4].rows[0].avg_ms) : null,
    });
  } catch (error) {
    console.error('Error fetching system metrics:', error);
    res.status(500).json({ error: 'Failed to fetch system metrics' });
  }
});

// Rate limit statistics (placeholder - will be populated when rate limiting is implemented)
app.get('/api/rate-limits/stats', async (req, res) => {
  try {
    // For now, calculate from invocations
    const query = `
      SELECT
        trigger_user_id,
        COUNT(*) as requests_today,
        MAX(started_at) as last_request
      FROM invocations
      WHERE DATE(started_at) = CURRENT_DATE
      GROUP BY trigger_user_id
      ORDER BY requests_today DESC
    `;

    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching rate limit stats:', error);
    res.status(500).json({ error: 'Failed to fetch rate limit stats' });
  }
});

app.listen(port, () => {
  console.log(`Dashboard API server running on http://localhost:${port}`);
  console.log(`Database: ${process.env.DATABASE_URL?.replace(/:[^:@]+@/, ':****@') || 'Not configured'}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing database connection...');
  await pool.end();
  process.exit(0);
});

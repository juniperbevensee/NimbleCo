-- Multi-bot support - allow multiple bot instances with separate identities
-- Each bot can have different personas, tools, and team memberships

-- Add bot_id to conversations
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS bot_id VARCHAR(100);
CREATE INDEX IF NOT EXISTS idx_conversations_bot_id ON conversations(bot_id);

-- Add bot_id to invocations
ALTER TABLE invocations ADD COLUMN IF NOT EXISTS bot_id VARCHAR(100);
CREATE INDEX IF NOT EXISTS idx_invocations_bot_id ON invocations(bot_id);

-- Add bot configuration table
CREATE TABLE IF NOT EXISTS bot_configs (
  id VARCHAR(100) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  identity_file VARCHAR(255),
  mattermost_team VARCHAR(255),
  enabled_tools JSONB DEFAULT '[]',
  status VARCHAR(20) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

COMMENT ON TABLE bot_configs IS 'Configuration for each bot instance';
COMMENT ON COLUMN conversations.bot_id IS 'Which bot handled this conversation';
COMMENT ON COLUMN invocations.bot_id IS 'Which bot handled this invocation';

-- Update the agents view to show bot-specific stats
DROP VIEW IF EXISTS v_agent_performance;
CREATE VIEW v_agent_performance AS
SELECT
  a.id,
  a.name,
  i.bot_id,
  COUNT(DISTINCT i.id) as total_invocations,
  AVG(i.duration_ms) as avg_duration_ms,
  SUM(i.total_cost_usd) as total_cost_usd,
  SUM(i.total_input_tokens + i.total_output_tokens) as total_tokens
FROM agents a
LEFT JOIN invocations i ON a.id = i.trigger_user_id -- This is a bit of a hack, will be improved
WHERE i.started_at > NOW() - INTERVAL '24 hours'
GROUP BY a.id, a.name, i.bot_id;

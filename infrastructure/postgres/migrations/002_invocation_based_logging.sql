-- Invocation-based logging structure
-- Inspired by conversation analysis patterns - easy for agents to navigate
--
-- Structure:
--   conversations (rooms)
--     -> invocations (each @mention/task)
--       -> tool_calls, llm_calls, messages (siblings)

-- Invocations table - each agent invocation (task, @mention, DM)
CREATE TABLE IF NOT EXISTS invocations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,

  -- Context
  trigger_user_id VARCHAR(255) NOT NULL,
  trigger_event_id VARCHAR(255),
  input_message TEXT,

  -- Result
  status VARCHAR(20) DEFAULT 'running', -- running, completed, failed
  output_message TEXT,
  error TEXT,

  -- Metadata
  task_type VARCHAR(50), -- pr-review, custom, etc.
  model VARCHAR(100),

  -- Timing
  started_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP,
  duration_ms INTEGER,

  -- Costs
  total_input_tokens INTEGER DEFAULT 0,
  total_output_tokens INTEGER DEFAULT 0,
  total_cost_usd DECIMAL(10, 6) DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_invocations_conversation ON invocations(conversation_id);
CREATE INDEX IF NOT EXISTS idx_invocations_user ON invocations(trigger_user_id);
CREATE INDEX IF NOT EXISTS idx_invocations_started ON invocations(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_invocations_status ON invocations(status);

-- Tool calls - sibling to messages within an invocation
CREATE TABLE IF NOT EXISTS tool_calls (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invocation_id UUID REFERENCES invocations(id) ON DELETE CASCADE,

  tool_name VARCHAR(100) NOT NULL,
  input JSONB,
  output JSONB,
  error TEXT,

  status VARCHAR(20) DEFAULT 'running', -- running, success, failed

  started_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP,
  duration_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_tool_calls_invocation ON tool_calls(invocation_id);
CREATE INDEX IF NOT EXISTS idx_tool_calls_tool_name ON tool_calls(tool_name);
CREATE INDEX IF NOT EXISTS idx_tool_calls_started ON tool_calls(started_at DESC);

-- LLM calls - track each LLM API call
CREATE TABLE IF NOT EXISTS llm_calls (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invocation_id UUID REFERENCES invocations(id) ON DELETE CASCADE,

  provider VARCHAR(50), -- anthropic, ollama, google-ai, etc.
  model VARCHAR(100),

  input_messages JSONB,
  output_content TEXT,
  tool_use JSONB, -- tool calls made by LLM

  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cost_usd DECIMAL(10, 6) DEFAULT 0,

  started_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP,
  duration_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_llm_calls_invocation ON llm_calls(invocation_id);
CREATE INDEX IF NOT EXISTS idx_llm_calls_provider ON llm_calls(provider);
CREATE INDEX IF NOT EXISTS idx_llm_calls_model ON llm_calls(model);
CREATE INDEX IF NOT EXISTS idx_llm_calls_started ON llm_calls(started_at DESC);

-- Link messages to invocations (messages are the conversation, invocations are the work)
ALTER TABLE messages ADD COLUMN IF NOT EXISTS invocation_id UUID REFERENCES invocations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_messages_invocation ON messages(invocation_id);

-- Views for easy querying

-- Recent invocations with summary
CREATE OR REPLACE VIEW v_recent_invocations AS
SELECT
  i.id,
  i.conversation_id,
  c.room_id,
  i.trigger_user_id,
  i.input_message,
  i.status,
  i.output_message,
  i.error,
  i.started_at,
  i.completed_at,
  i.duration_ms,
  i.total_input_tokens,
  i.total_output_tokens,
  i.total_cost_usd,
  (SELECT COUNT(*) FROM tool_calls WHERE invocation_id = i.id) as tool_call_count,
  (SELECT COUNT(*) FROM llm_calls WHERE invocation_id = i.id) as llm_call_count
FROM invocations i
LEFT JOIN conversations c ON i.conversation_id = c.id
ORDER BY i.started_at DESC;

-- Tool usage statistics
CREATE OR REPLACE VIEW v_tool_usage_stats AS
SELECT
  tool_name,
  COUNT(*) as total_calls,
  COUNT(CASE WHEN status = 'success' THEN 1 END) as successful_calls,
  COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_calls,
  AVG(duration_ms) as avg_duration_ms,
  MAX(started_at) as last_used_at
FROM tool_calls
WHERE started_at > NOW() - INTERVAL '7 days'
GROUP BY tool_name
ORDER BY total_calls DESC;

-- LLM usage by model
CREATE OR REPLACE VIEW v_llm_usage_stats AS
SELECT
  provider,
  model,
  COUNT(*) as total_calls,
  SUM(input_tokens) as total_input_tokens,
  SUM(output_tokens) as total_output_tokens,
  SUM(cost_usd) as total_cost_usd,
  AVG(duration_ms) as avg_duration_ms
FROM llm_calls
WHERE started_at > NOW() - INTERVAL '7 days'
GROUP BY provider, model
ORDER BY total_calls DESC;

COMMENT ON TABLE invocations IS 'Each agent invocation - a task, @mention, or DM that triggers work';
COMMENT ON TABLE tool_calls IS 'Individual tool executions within an invocation';
COMMENT ON TABLE llm_calls IS 'LLM API calls with token usage and costs';
COMMENT ON COLUMN invocations.trigger_user_id IS 'User who triggered this invocation (Matrix user ID)';
COMMENT ON COLUMN invocations.trigger_event_id IS 'Matrix event ID that triggered this invocation';

-- NimbleCo Database Schema
-- PostgreSQL initialization script

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Tasks table
CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type VARCHAR(50) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  priority INTEGER DEFAULT 0,
  payload JSONB,
  result JSONB,
  error TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  started_at TIMESTAMP,
  completed_at TIMESTAMP
);

CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_priority ON tasks(priority DESC);
CREATE INDEX idx_tasks_created ON tasks(created_at DESC);

-- Agents table
CREATE TABLE agents (
  id VARCHAR(100) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  type VARCHAR(50) NOT NULL,
  status VARCHAR(20) DEFAULT 'active',
  config JSONB,
  last_seen TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Agent executions log
CREATE TABLE agent_executions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id VARCHAR(100) REFERENCES agents(id),
  task_id UUID REFERENCES tasks(id),
  status VARCHAR(20),
  duration_ms INTEGER,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cost_usd DECIMAL(10, 6) DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_executions_agent ON agent_executions(agent_id);
CREATE INDEX idx_executions_task ON agent_executions(task_id);
CREATE INDEX idx_executions_created ON agent_executions(created_at DESC);

-- Cost tracking
CREATE TABLE daily_costs (
  date DATE PRIMARY KEY,
  total_cost_usd DECIMAL(10, 2) DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  total_executions INTEGER DEFAULT 0,
  breakdown JSONB
);

-- Conversations (for multi-turn interactions)
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id VARCHAR(255),
  title TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Messages
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL,
  content TEXT NOT NULL,
  agent_id VARCHAR(100),
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at);

-- Insert default agents
INSERT INTO agents (id, name, type, status) VALUES
  ('code-review-1', 'Code Review Agent', 'code-review', 'active'),
  ('security-1', 'Security Scanner', 'security', 'active'),
  ('test-runner-1', 'Test Runner', 'test-runner', 'active'),
  ('coordinator', 'Coordinator', 'coordinator', 'active');

-- Function to update daily costs
CREATE OR REPLACE FUNCTION update_daily_cost()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO daily_costs (date, total_cost_usd, total_tokens, total_executions)
  VALUES (
    CURRENT_DATE,
    NEW.cost_usd,
    NEW.input_tokens + NEW.output_tokens,
    1
  )
  ON CONFLICT (date) DO UPDATE
  SET
    total_cost_usd = daily_costs.total_cost_usd + EXCLUDED.total_cost_usd,
    total_tokens = daily_costs.total_tokens + EXCLUDED.total_tokens,
    total_executions = daily_costs.total_executions + 1;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_daily_cost
AFTER INSERT ON agent_executions
FOR EACH ROW
EXECUTE FUNCTION update_daily_cost();

-- Views for monitoring
CREATE VIEW v_agent_performance AS
SELECT
  a.id,
  a.name,
  COUNT(e.id) as total_executions,
  AVG(e.duration_ms) as avg_duration_ms,
  SUM(e.cost_usd) as total_cost_usd,
  SUM(e.input_tokens + e.output_tokens) as total_tokens
FROM agents a
LEFT JOIN agent_executions e ON a.id = e.agent_id
WHERE e.created_at > NOW() - INTERVAL '24 hours'
GROUP BY a.id, a.name;

CREATE VIEW v_daily_summary AS
SELECT
  date,
  total_cost_usd,
  total_tokens,
  total_executions,
  ROUND(total_cost_usd / NULLIF(total_executions, 0), 4) as avg_cost_per_execution
FROM daily_costs
ORDER BY date DESC;

COMMENT ON TABLE tasks IS 'High-level tasks submitted to the system';
COMMENT ON TABLE agents IS 'Registry of all agents in the system';
COMMENT ON TABLE agent_executions IS 'Log of every agent execution with cost tracking';
COMMENT ON TABLE daily_costs IS 'Aggregated cost data per day';

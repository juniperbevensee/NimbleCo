-- Message Bus Logging
-- Captures all NATS messages for analysis of inter-agent communication patterns

CREATE TABLE IF NOT EXISTS message_bus_log (
  id BIGSERIAL PRIMARY KEY,
  subject TEXT NOT NULL,
  data JSONB NOT NULL,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  sender TEXT,
  recipient TEXT,
  message_type TEXT
);

-- Indexes for common query patterns
CREATE INDEX idx_message_bus_subject ON message_bus_log(subject);
CREATE INDEX idx_message_bus_timestamp ON message_bus_log(timestamp DESC);
CREATE INDEX idx_message_bus_sender ON message_bus_log(sender);
CREATE INDEX idx_message_bus_type ON message_bus_log(message_type);
CREATE INDEX idx_message_bus_data ON message_bus_log USING GIN(data);

-- Automatic cleanup: delete logs older than 30 days
-- (Run this periodically via cron or scheduled task)
-- DELETE FROM message_bus_log WHERE timestamp < NOW() - INTERVAL '30 days';

COMMENT ON TABLE message_bus_log IS 'Logs all NATS message bus activity for analysis of inter-agent communication patterns and emergent behaviors';
COMMENT ON COLUMN message_bus_log.subject IS 'NATS subject (e.g., tasks.from-mattermost, messages.to-mattermost)';
COMMENT ON COLUMN message_bus_log.data IS 'Full message payload as JSON';
COMMENT ON COLUMN message_bus_log.sender IS 'Extracted sender identifier (user_id, agent_id, etc)';
COMMENT ON COLUMN message_bus_log.recipient IS 'Inferred recipient based on subject';
COMMENT ON COLUMN message_bus_log.message_type IS 'Classified message type (task, update, result, etc)';

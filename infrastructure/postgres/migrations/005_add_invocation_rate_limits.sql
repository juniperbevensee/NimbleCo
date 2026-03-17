-- Rate limiting tables for Audrey invocations
-- Tracks per-user, per-platform, and global invocation counts by day

-- User-level rate limits (per user, per platform, per day)
CREATE TABLE IF NOT EXISTS invocation_rate_limits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id VARCHAR(255) NOT NULL,
  platform VARCHAR(50) NOT NULL, -- 'mattermost', 'matrix', etc.
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  invocation_count INTEGER DEFAULT 0,
  bot_invocation_count INTEGER DEFAULT 0, -- Separate counter for bot-to-bot invocations
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  -- Ensure one record per user per platform per day
  UNIQUE(user_id, platform, date)
);

-- Global rate limits (per platform, per day)
CREATE TABLE IF NOT EXISTS global_invocation_limits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  platform VARCHAR(50) NOT NULL,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  total_invocations INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  -- Ensure one record per platform per day
  UNIQUE(platform, date)
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_invocation_rate_limits_user_platform_date
  ON invocation_rate_limits(user_id, platform, date DESC);

CREATE INDEX IF NOT EXISTS idx_invocation_rate_limits_date
  ON invocation_rate_limits(date DESC);

CREATE INDEX IF NOT EXISTS idx_global_invocation_limits_platform_date
  ON global_invocation_limits(platform, date DESC);

CREATE INDEX IF NOT EXISTS idx_global_invocation_limits_date
  ON global_invocation_limits(date DESC);

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_rate_limit_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers to update updated_at
CREATE TRIGGER trigger_update_invocation_rate_limits_timestamp
BEFORE UPDATE ON invocation_rate_limits
FOR EACH ROW
EXECUTE FUNCTION update_rate_limit_timestamp();

CREATE TRIGGER trigger_update_global_invocation_limits_timestamp
BEFORE UPDATE ON global_invocation_limits
FOR EACH ROW
EXECUTE FUNCTION update_rate_limit_timestamp();

-- View for rate limit monitoring
CREATE OR REPLACE VIEW v_rate_limit_stats AS
SELECT
  date,
  platform,
  COUNT(DISTINCT user_id) as unique_users,
  SUM(invocation_count) as total_user_invocations,
  SUM(bot_invocation_count) as total_bot_invocations,
  MAX(invocation_count) as max_user_invocations,
  AVG(invocation_count) as avg_user_invocations
FROM invocation_rate_limits
WHERE date > CURRENT_DATE - INTERVAL '7 days'
GROUP BY date, platform
ORDER BY date DESC, platform;

-- View for users approaching limits
CREATE OR REPLACE VIEW v_rate_limit_warnings AS
SELECT
  user_id,
  platform,
  date,
  invocation_count,
  bot_invocation_count,
  CASE
    WHEN invocation_count >= 25 THEN 'User limit warning (25+/30)'
    WHEN bot_invocation_count >= 15 THEN 'Bot limit warning (15+/20)'
    ELSE 'OK'
  END as warning_level
FROM invocation_rate_limits
WHERE date = CURRENT_DATE
  AND (invocation_count >= 25 OR bot_invocation_count >= 15)
ORDER BY invocation_count DESC, bot_invocation_count DESC;

-- Comments
COMMENT ON TABLE invocation_rate_limits IS 'Per-user rate limits for bot invocations, tracked daily by platform';
COMMENT ON TABLE global_invocation_limits IS 'Global rate limits across all users, tracked daily by platform';
COMMENT ON COLUMN invocation_rate_limits.invocation_count IS 'Total invocations by this user today (all types)';
COMMENT ON COLUMN invocation_rate_limits.bot_invocation_count IS 'Bot-to-bot invocations by this user today';
COMMENT ON COLUMN global_invocation_limits.total_invocations IS 'Total invocations across all users today';

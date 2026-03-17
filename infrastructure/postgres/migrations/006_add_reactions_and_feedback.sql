-- Add response post IDs to invocations so we can map reactions
ALTER TABLE invocations ADD COLUMN IF NOT EXISTS response_post_id VARCHAR(255);
CREATE INDEX IF NOT EXISTS idx_invocations_response_post ON invocations(response_post_id);

-- Reaction tracking for training data signals
-- Captures emoji reactions on Audrey's messages

CREATE TABLE IF NOT EXISTS message_reactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Link to invocation (if we can map it)
  invocation_id UUID REFERENCES invocations(id) ON DELETE CASCADE,

  -- Message details
  post_id VARCHAR(255) NOT NULL,
  channel_id VARCHAR(255) NOT NULL,

  -- Reaction details
  emoji_name VARCHAR(100) NOT NULL,
  user_id VARCHAR(255) NOT NULL,

  -- Training signal categorization
  is_positive_signal BOOLEAN, -- true for thumbs up, false for thumbs down, null for neutral

  created_at TIMESTAMP DEFAULT NOW(),
  removed_at TIMESTAMP, -- null if still active

  UNIQUE(post_id, emoji_name, user_id)
);

CREATE INDEX IF NOT EXISTS idx_reactions_invocation ON message_reactions(invocation_id);
CREATE INDEX IF NOT EXISTS idx_reactions_post ON message_reactions(post_id);
CREATE INDEX IF NOT EXISTS idx_reactions_emoji ON message_reactions(emoji_name);
CREATE INDEX IF NOT EXISTS idx_reactions_created ON message_reactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reactions_training_signal ON message_reactions(is_positive_signal) WHERE is_positive_signal IS NOT NULL;

-- Follow-up detection for correction tracking
-- Detects when user sends another message shortly after Audrey responds
CREATE TABLE IF NOT EXISTS invocation_followups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  invocation_id UUID REFERENCES invocations(id) ON DELETE CASCADE,

  -- Follow-up message details
  post_id VARCHAR(255) NOT NULL,
  user_id VARCHAR(255) NOT NULL,
  message_text TEXT,

  -- Timing (how quickly did they follow up?)
  seconds_after_response INTEGER,

  -- Classification
  is_correction BOOLEAN, -- detected correction words
  is_refinement BOOLEAN, -- asking for more detail
  is_new_task BOOLEAN, -- separate new request

  created_at TIMESTAMP DEFAULT NOW(),

  UNIQUE(invocation_id, post_id)
);

CREATE INDEX IF NOT EXISTS idx_followups_invocation ON invocation_followups(invocation_id);
CREATE INDEX IF NOT EXISTS idx_followups_is_correction ON invocation_followups(is_correction) WHERE is_correction = true;
CREATE INDEX IF NOT EXISTS idx_followups_timing ON invocation_followups(seconds_after_response);

-- View for training data: invocations with their feedback signals
CREATE OR REPLACE VIEW v_invocation_feedback AS
SELECT
  i.id as invocation_id,
  i.conversation_id,
  i.trigger_user_id,
  i.input_message,
  i.output_message,
  i.status,
  i.started_at,
  i.duration_ms,
  i.total_cost_usd,

  -- Reaction signals
  COUNT(CASE WHEN r.is_positive_signal = true THEN 1 END) as thumbs_up_count,
  COUNT(CASE WHEN r.is_positive_signal = false THEN 1 END) as thumbs_down_count,
  COUNT(CASE WHEN r.is_positive_signal IS NULL THEN 1 END) as other_reaction_count,

  -- Follow-up signals
  COUNT(CASE WHEN f.is_correction = true THEN 1 END) as correction_count,
  COUNT(CASE WHEN f.is_refinement = true THEN 1 END) as refinement_count,
  MIN(f.seconds_after_response) as fastest_followup_seconds,

  -- Overall quality score (simple heuristic for now)
  CASE
    WHEN COUNT(CASE WHEN r.is_positive_signal = false THEN 1 END) > 0 THEN -1 -- any thumbs down = negative
    WHEN COUNT(CASE WHEN f.is_correction = true THEN 1 END) > 0 THEN -1 -- any correction = negative
    WHEN COUNT(CASE WHEN r.is_positive_signal = true THEN 1 END) > 0 THEN 1 -- thumbs up = positive
    ELSE 0 -- no feedback = neutral
  END as simple_quality_score

FROM invocations i
LEFT JOIN message_reactions r ON i.id = r.invocation_id
LEFT JOIN invocation_followups f ON i.id = f.invocation_id
WHERE i.status = 'completed'
GROUP BY i.id
ORDER BY i.started_at DESC;

COMMENT ON TABLE message_reactions IS 'Emoji reactions on Audrey messages - training data signals';
COMMENT ON TABLE invocation_followups IS 'User follow-up messages after Audrey responds - potential corrections';
COMMENT ON COLUMN message_reactions.is_positive_signal IS 'true=thumbs up, false=thumbs down, null=fun emoji';
COMMENT ON COLUMN invocation_followups.is_correction IS 'Detected correction keywords like "no", "wrong", "actually"';

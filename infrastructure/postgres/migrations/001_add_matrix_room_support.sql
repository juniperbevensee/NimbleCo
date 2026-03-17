-- Add Matrix room support to conversations and messages

-- Add room_id to conversations table
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS room_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS platform VARCHAR(50) DEFAULT 'matrix';

-- Create index for room lookups
CREATE INDEX IF NOT EXISTS idx_conversations_room ON conversations(room_id);
CREATE INDEX IF NOT EXISTS idx_conversations_platform ON conversations(platform);

-- Add event_id to messages for Matrix event tracking
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS event_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS sender_id VARCHAR(255);

-- Create index for event lookups
CREATE INDEX IF NOT EXISTS idx_messages_event ON messages(event_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);

-- Comment updates
COMMENT ON COLUMN conversations.room_id IS 'Matrix room ID or channel ID from other platforms';
COMMENT ON COLUMN conversations.platform IS 'Platform: matrix, mattermost, signal, etc.';
COMMENT ON COLUMN messages.event_id IS 'Matrix event ID for tracking';
COMMENT ON COLUMN messages.sender_id IS 'Matrix user ID or platform-specific sender ID';

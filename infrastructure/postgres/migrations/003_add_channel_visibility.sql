-- Add channel visibility tracking for permission system

-- Add channel_type to conversations table
-- For Mattermost: 'O' = Open/Public, 'P' = Private, 'D' = Direct Message, 'G' = Group Message
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS channel_type VARCHAR(10);

-- Create index for channel type lookups
CREATE INDEX IF NOT EXISTS idx_conversations_channel_type ON conversations(channel_type);

-- Add unique constraint to prevent duplicate room entries
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_room_platform ON conversations(room_id, platform);

COMMENT ON COLUMN conversations.channel_type IS 'Channel type: O=Open/Public, P=Private, D=DM, G=Group (Mattermost), or platform-specific values';

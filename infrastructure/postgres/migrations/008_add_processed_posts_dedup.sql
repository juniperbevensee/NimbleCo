-- Migration: 008_add_processed_posts_dedup
-- Purpose: Add database-backed deduplication for Mattermost posts
-- This ensures only ONE coordinator instance processes each post, even with multiple instances running

-- Create table for tracking processed posts
-- Uses INSERT ON CONFLICT to atomically claim posts
CREATE TABLE IF NOT EXISTS processed_posts (
    post_id TEXT PRIMARY KEY,
    coordinator_id TEXT NOT NULL,  -- Which coordinator instance claimed this
    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for cleanup of old posts
CREATE INDEX IF NOT EXISTS idx_processed_posts_time ON processed_posts (processed_at);

-- Automatically clean up posts older than 24 hours
-- This keeps the table small while still preventing duplicates for reasonable time windows
CREATE OR REPLACE FUNCTION cleanup_old_processed_posts() RETURNS void AS $$
BEGIN
    DELETE FROM processed_posts WHERE processed_at < NOW() - INTERVAL '24 hours';
END;
$$ LANGUAGE plpgsql;

-- Add comment explaining the purpose
COMMENT ON TABLE processed_posts IS 'Deduplication table for Mattermost posts - ensures only one coordinator instance processes each post';

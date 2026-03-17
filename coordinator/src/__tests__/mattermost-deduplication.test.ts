/**
 * Test NATS message deduplication in MattermostListener
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('MattermostListener NATS Deduplication', () => {
  let mockPostToChannel: ReturnType<typeof vi.fn>;
  let mockReplyToPost: ReturnType<typeof vi.fn>;
  let processedMessages: Set<string>;

  beforeEach(() => {
    mockPostToChannel = vi.fn().mockResolvedValue('post_123');
    mockReplyToPost = vi.fn().mockResolvedValue('reply_123');
    processedMessages = new Set();
  });

  // Simulate the deduplication logic from mattermost-listener.ts
  function simulateHandleMattermostMessage(data: any): boolean {
    const { channel_id, root_id, message, is_final } = data;

    if (!channel_id || !message) {
      return false;
    }

    // Deduplicate NATS messages to prevent spam
    const messageKey = `${channel_id}:${root_id || 'top'}:${is_final}:${message.substring(0, 100)}`;
    if (processedMessages.has(messageKey)) {
      console.log(`⏭️  Skipping duplicate NATS message for channel ${channel_id.substring(0, 8)}`);
      return false; // Skipped
    }

    processedMessages.add(messageKey);

    // Simulate posting
    if (is_final) {
      mockPostToChannel(channel_id, message);
    } else {
      mockReplyToPost(channel_id, root_id, message);
    }

    return true; // Processed
  }

  it('should deduplicate identical "Working on it..." messages', () => {
    const message1 = {
      channel_id: 'channel_abc',
      root_id: 'root_123',
      message: '🤖 Working on it...',
      is_final: false,
    };

    const message2 = { ...message1 }; // Exact duplicate
    const message3 = { ...message1 }; // Another duplicate

    // First message should be processed
    expect(simulateHandleMattermostMessage(message1)).toBe(true);
    expect(mockReplyToPost).toHaveBeenCalledTimes(1);

    // Duplicates should be skipped
    expect(simulateHandleMattermostMessage(message2)).toBe(false);
    expect(simulateHandleMattermostMessage(message3)).toBe(false);
    expect(mockReplyToPost).toHaveBeenCalledTimes(1); // Still only 1
  });

  it('should allow different messages to the same channel', () => {
    const message1 = {
      channel_id: 'channel_abc',
      root_id: 'root_123',
      message: '🤖 Working on it...',
      is_final: false,
    };

    const message2 = {
      channel_id: 'channel_abc',
      root_id: 'root_123',
      message: '✅ Task completed!',
      is_final: true,
    };

    expect(simulateHandleMattermostMessage(message1)).toBe(true);
    expect(simulateHandleMattermostMessage(message2)).toBe(true);

    expect(mockReplyToPost).toHaveBeenCalledTimes(1);
    expect(mockPostToChannel).toHaveBeenCalledTimes(1);
  });

  it('should distinguish between threaded and top-level messages', () => {
    const threadedMessage = {
      channel_id: 'channel_abc',
      root_id: 'root_123',
      message: 'Hello',
      is_final: false,
    };

    const topLevelMessage = {
      channel_id: 'channel_abc',
      root_id: null, // Top-level
      message: 'Hello',
      is_final: true,
    };

    expect(simulateHandleMattermostMessage(threadedMessage)).toBe(true);
    expect(simulateHandleMattermostMessage(topLevelMessage)).toBe(true);

    expect(mockReplyToPost).toHaveBeenCalledTimes(1);
    expect(mockPostToChannel).toHaveBeenCalledTimes(1);
  });

  it('should handle messages to different channels', () => {
    const message1 = {
      channel_id: 'channel_abc',
      root_id: 'root_123',
      message: '🤖 Working on it...',
      is_final: false,
    };

    const message2 = {
      channel_id: 'channel_xyz', // Different channel
      root_id: 'root_123',
      message: '🤖 Working on it...',
      is_final: false,
    };

    expect(simulateHandleMattermostMessage(message1)).toBe(true);
    expect(simulateHandleMattermostMessage(message2)).toBe(true);

    expect(mockReplyToPost).toHaveBeenCalledTimes(2);
  });

  it('should deduplicate 10+ identical spam messages', () => {
    const spamMessage = {
      channel_id: 'channel_abc',
      root_id: 'root_123',
      message: '🤖 Working on it...',
      is_final: false,
    };

    let processedCount = 0;
    for (let i = 0; i < 15; i++) {
      if (simulateHandleMattermostMessage({ ...spamMessage })) {
        processedCount++;
      }
    }

    // Only first message should be processed
    expect(processedCount).toBe(1);
    expect(mockReplyToPost).toHaveBeenCalledTimes(1);
  });
});

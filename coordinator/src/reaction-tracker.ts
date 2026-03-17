/**
 * Reaction and Follow-up Tracker
 *
 * Captures emoji reactions and follow-up messages for training data
 */

import { Pool } from 'pg';

const CORRECTION_KEYWORDS = [
  'no', 'nope', 'wrong', 'incorrect', 'actually', 'not what i meant',
  'that\'s not', 'not right', 'fix', 'mistake', 'error', 'oops'
];

const REFINEMENT_KEYWORDS = [
  'can you', 'could you', 'also', 'additionally', 'more detail',
  'what about', 'how about', 'expand on'
];

export class ReactionTracker {
  constructor(private db: Pool) {}

  /**
   * Store response post ID for an invocation
   */
  async linkResponseToInvocation(invocationId: string, responsePostId: string): Promise<void> {
    try {
      await this.db.query(
        'UPDATE invocations SET response_post_id = $1 WHERE id = $2',
        [responsePostId, invocationId]
      );
    } catch (error) {
      console.error('Error linking response to invocation:', error);
    }
  }

  /**
   * Log a reaction to Audrey's message
   */
  async logReaction(
    postId: string,
    emojiName: string,
    userId: string,
    channelId: string
  ): Promise<void> {
    try {
      // Find invocation for this post
      const invResult = await this.db.query(
        'SELECT id FROM invocations WHERE response_post_id = $1 LIMIT 1',
        [postId]
      );

      const invocationId = invResult.rows[0]?.id;

      // Only track thumbs up/down for training signals
      let isPositiveSignal: boolean | null = null;
      const emoji = emojiName.toLowerCase();

      if (emoji.includes('thumbsup') || emoji.includes('+1') || emoji === '👍') {
        isPositiveSignal = true;
      } else if (emoji.includes('thumbsdown') || emoji.includes('-1') || emoji === '👎') {
        isPositiveSignal = false;
      } else {
        // Not a training signal emoji, don't store it
        console.log(`😊 Emoji reaction: ${emojiName} (not tracked for training)`);
        return;
      }

      // Store reaction
      await this.db.query(
        `INSERT INTO message_reactions
         (invocation_id, post_id, channel_id, emoji_name, user_id, is_positive_signal)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (post_id, emoji_name, user_id)
         DO UPDATE SET removed_at = NULL`,
        [invocationId, postId, channelId, emojiName, userId, isPositiveSignal]
      );

      console.log(`📊 Training signal: ${isPositiveSignal ? '👍' : '👎'} on invocation ${invocationId?.substring(0, 8)}`);
    } catch (error) {
      console.error('Error logging reaction:', error);
    }
  }

  /**
   * Mark a reaction as removed
   */
  async removeReaction(
    postId: string,
    emojiName: string,
    userId: string
  ): Promise<void> {
    try {
      await this.db.query(
        `UPDATE message_reactions
         SET removed_at = NOW()
         WHERE post_id = $1 AND emoji_name = $2 AND user_id = $3`,
        [postId, emojiName, userId]
      );
    } catch (error) {
      console.error('Error removing reaction:', error);
    }
  }

  /**
   * Detect and log a follow-up message
   */
  async logFollowUp(
    invocationId: string,
    postId: string,
    userId: string,
    message: string,
    secondsAfterResponse: number
  ): Promise<void> {
    try {
      const lowerMessage = message.toLowerCase();

      // Classify the follow-up
      const isCorrection = CORRECTION_KEYWORDS.some(kw => lowerMessage.includes(kw));
      const isRefinement = REFINEMENT_KEYWORDS.some(kw => lowerMessage.includes(kw));

      // If it's asking about something completely different, might be a new task
      const isNewTask = !isCorrection && !isRefinement && secondsAfterResponse > 300; // 5+ minutes

      await this.db.query(
        `INSERT INTO invocation_followups
         (invocation_id, post_id, user_id, message_text, seconds_after_response,
          is_correction, is_refinement, is_new_task)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (invocation_id, post_id) DO NOTHING`,
        [invocationId, postId, userId, message, secondsAfterResponse,
         isCorrection, isRefinement, isNewTask]
      );

      if (isCorrection) {
        console.log(`📊 Correction detected for invocation ${invocationId.substring(0, 8)}`);
      } else if (isRefinement) {
        console.log(`📊 Refinement detected for invocation ${invocationId.substring(0, 8)}`);
      }
    } catch (error) {
      console.error('Error logging follow-up:', error);
    }
  }

  /**
   * Check if a message is a follow-up to an invocation
   * Returns invocation ID and seconds since response if it's a follow-up
   */
  async checkForFollowUp(
    rootPostId: string,
    userId: string,
    timestamp: number
  ): Promise<{ invocationId: string; secondsAfter: number } | null> {
    try {
      // Find if the root post was an invocation response
      const result = await this.db.query(
        `SELECT i.id, i.completed_at
         FROM invocations i
         WHERE i.response_post_id = $1
         AND i.trigger_user_id = $2
         AND i.status = 'completed'
         LIMIT 1`,
        [rootPostId, userId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const invocation = result.rows[0];
      const completedAt = new Date(invocation.completed_at).getTime();
      const secondsAfter = Math.floor((timestamp - completedAt) / 1000);

      // Only consider it a follow-up if it's within 10 minutes
      if (secondsAfter > 600) {
        return null;
      }

      return {
        invocationId: invocation.id,
        secondsAfter
      };
    } catch (error) {
      console.error('Error checking for follow-up:', error);
      return null;
    }
  }
}

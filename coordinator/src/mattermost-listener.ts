/**
 * Mattermost Listener
 *
 * Listens for @mentions of the bot in Mattermost and routes them to the coordinator
 * Supports natural language task requests like:
 * "@audrey-bot spin up a 5 agent swarm to redesign the homepage"
 */

import { WebSocket } from 'ws';
import { NatsConnection, StringCodec } from 'nats';
import { LLMRouter, LLMMessage } from '@nimbleco/llm-adapters';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { checkInvocationLimit, checkCircuitBreaker } from './rate-limiter';
import { ReactionTracker } from './reaction-tracker';

const sc = StringCodec();

interface MattermostMessage {
  event: string;
  data: {
    post?: string;
    channel_id?: string;
    channel_display_name?: string;
    mentions?: string;
  };
  broadcast: {
    channel_id: string;
  };
}

interface Post {
  id: string;
  message: string;
  channel_id: string;
  user_id: string;
  create_at: number;
  root_id?: string; // If this is a reply, the ID of the root post
  file_ids?: string[]; // Array of attached file IDs
  metadata?: {
    files?: Array<{
      id: string;
      name: string;
      extension: string;
      size: number;
      mime_type: string;
    }>;
  };
}

interface ThreadContext {
  root_post: {
    id: string;
    message: string;
    user_id: string;
    create_at: number;
  };
  recent_replies: Array<{
    id: string;
    message: string;
    user_id: string;
    create_at: number;
  }>;
}

export class MattermostListener {
  private ws?: WebSocket;
  private botUserId?: string;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 5000;
  private pingInterval?: NodeJS.Timeout;
  private adminUsers: string[];
  private allowedUsers: string[];
  private blockDMs: boolean;
  private db: Pool | null = null;
  private logAllMessages: boolean;
  private reactionTracker?: ReactionTracker;
  private processedPosts: Set<string> = new Set(); // Track processed post IDs (local cache)
  private processedNatsMessages: Set<string> = new Set(); // Track processed NATS messages to prevent duplicates
  private coordinatorId: string; // Unique ID for this coordinator instance
  private botUsernames: Set<string> = new Set(); // Cache of bot usernames to strip from mentions
  private botId: string; // Bot identifier for multi-bot routing

  constructor(
    private mattermostUrl: string,
    private botToken: string,
    private nc: NatsConnection,
    private llmRouter: LLMRouter,
    adminUsers?: string[],
    allowedUsers?: string[],
    blockDMs?: boolean,
    logAllMessages?: boolean
  ) {
    this.adminUsers = adminUsers || [];
    this.allowedUsers = allowedUsers || [];
    this.blockDMs = blockDMs !== false; // Default to true (block DMs unless disabled)
    this.logAllMessages = logAllMessages !== false; // Default to true
    // Generate unique coordinator ID for deduplication
    this.coordinatorId = `coord-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    // Bot ID for multi-bot NATS message routing
    this.botId = process.env.BOT_ID || 'default';
  }

  async start() {
    // Clear ALL post claims on startup - we're the only coordinator now
    // This prevents stale claims from crashed coordinators blocking new ones
    try {
      const db = this.getDB();
      const result = await db.query(`DELETE FROM processed_posts RETURNING post_id`);
      if (result.rowCount && result.rowCount > 0) {
        console.log(`🧹 Cleared ${result.rowCount} post claim(s) from previous session`);
      }
    } catch (error) {
      // Table might not exist yet, ignore
    }

    // Get bot user ID
    this.botUserId = await this.getBotUserId();
    console.log(`🤖 Bot user ID: ${this.botUserId}`);

    // Fetch bot usernames to filter from mentions (prevents infinite loops)
    await this.fetchBotUsernames();

    // Initialize reaction tracker
    const db = this.getDB();
    this.reactionTracker = new ReactionTracker(db);

    // Subscribe to messages from coordinator
    // NOTE: No queue group - all listeners receive all messages and filter by bot_id
    // This is necessary for multi-bot setups where each bot needs to post its own responses
    this.nc.subscribe('messages.to-mattermost', {
      callback: async (err, msg) => {
        if (err) {
          console.error('Error receiving message:', err);
          return;
        }
        try {
          const data = JSON.parse(sc.decode(msg.data));
          await this.handleMattermostMessage(data);
        } catch (error) {
          console.error('Error handling message:', error);
        }
      },
    });

    await this.connect();
  }

  private async getBotUserId(): Promise<string> {
    const response = await fetch(`${this.mattermostUrl}/api/v4/users/me`, {
      headers: {
        'Authorization': `Bearer ${this.botToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get bot user: ${response.statusText}`);
    }

    const user = await response.json() as any;
    return user.id;
  }

  private async isUserBot(userId: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.mattermostUrl}/api/v4/users/${userId}`, {
        headers: {
          'Authorization': `Bearer ${this.botToken}`,
        },
      });

      if (!response.ok) {
        console.warn(`⚠️  Could not fetch user info for ${userId}, assuming not a bot`);
        return false;
      }

      const user = await response.json() as any;
      return user.is_bot === true;
    } catch (error) {
      console.warn(`⚠️  Error checking if user is bot:`, error);
      return false;
    }
  }

  // Fetch all bot usernames from Mattermost to prevent tagging them in replies
  private async fetchBotUsernames(): Promise<void> {
    try {
      // Fetch users with is_bot role - Mattermost API doesn't have a direct filter,
      // so we fetch active users and filter. For large teams, this could be optimized.
      const response = await fetch(`${this.mattermostUrl}/api/v4/users?per_page=200&active=true`, {
        headers: {
          'Authorization': `Bearer ${this.botToken}`,
        },
      });

      if (!response.ok) {
        console.warn('⚠️  Could not fetch users for bot detection');
        return;
      }

      const users = await response.json() as any[];
      for (const user of users) {
        if (user.is_bot === true && user.username) {
          this.botUsernames.add(user.username.toLowerCase());
        }
      }

      if (this.botUsernames.size > 0) {
        console.log(`🤖 Loaded ${this.botUsernames.size} bot username(s) for mention filtering`);
      }
    } catch (error) {
      console.warn('⚠️  Error fetching bot usernames:', error);
    }
  }

  // Get username for a user ID
  private async getUsername(userId: string): Promise<string> {
    try {
      const response = await fetch(`${this.mattermostUrl}/api/v4/users/${userId}`, {
        headers: { 'Authorization': `Bearer ${this.botToken}` },
      });
      if (!response.ok) return userId;
      const user = await response.json() as any;
      return user.username || userId;
    } catch {
      return userId;
    }
  }

  // Strip @mentions of bot accounts from messages to prevent infinite loops
  private stripBotMentions(message: string): string {
    if (this.botUsernames.size === 0) {
      return message;
    }

    // Match @username patterns and remove if they're bot usernames
    return message.replace(/@(\w+)/g, (match, username) => {
      if (this.botUsernames.has(username.toLowerCase())) {
        // Keep the username but remove the @ to avoid triggering the bot
        return username;
      }
      return match;
    });
  }

  private async connect() {
    const wsUrl = this.mattermostUrl.replace(/^http/, 'ws') + '/api/v4/websocket';

    console.log(`📡 Connecting to Mattermost websocket...`);

    this.ws = new WebSocket(wsUrl);

    this.ws.on('open', () => {
      console.log('✅ Connected to Mattermost websocket');
      this.reconnectAttempts = 0;

      // Authenticate
      this.ws?.send(JSON.stringify({
        seq: 1,
        action: 'authentication_challenge',
        data: {
          token: this.botToken,
        },
      }));

      // Start ping interval to keep connection alive
      this.pingInterval = setInterval(() => {
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({
            seq: Date.now(),
            action: 'ping',
          }));
        }
      }, 30000);
    });

    this.ws.on('message', async (data: Buffer) => {
      try {
        const message: MattermostMessage = JSON.parse(data.toString());
        await this.handleMessage(message);
      } catch (error) {
        console.error('Error handling websocket message:', error);
      }
    });

    this.ws.on('error', (error) => {
      console.error('Websocket error:', error);
    });

    this.ws.on('close', () => {
      console.log('❌ Mattermost websocket closed');
      if (this.pingInterval) {
        clearInterval(this.pingInterval);
      }
      this.attemptReconnect();
    });
  }

  private attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnect attempts reached. Giving up.');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * this.reconnectAttempts;

    console.log(`🔄 Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);

    setTimeout(() => {
      this.connect();
    }, delay);
  }

  private async handleMessage(message: MattermostMessage) {
    // Handle reactions
    if (message.event === 'reaction_added') {
      await this.handleReactionAdded(message);
      return;
    }

    if (message.event === 'reaction_removed') {
      await this.handleReactionRemoved(message);
      return;
    }

    // Only handle posted messages
    if (message.event !== 'posted') {
      return;
    }

    if (!message.data.post) {
      return;
    }

    const post: Post = JSON.parse(message.data.post);

    // Ignore our own messages
    if (post.user_id === this.botUserId) {
      return;
    }

    // Check if bot was mentioned
    const mentions = message.data.mentions ? JSON.parse(message.data.mentions) : [];
    if (!mentions.includes(this.botUserId)) {
      return;
    }

    // Check if this is a DM and DMs are blocked
    if (this.blockDMs) {
      const channelType = await this.getChannelType(post.channel_id);
      if (channelType === 'D') {
        // DM detected - check if user is allowed
        const isAllowed = this.allowedUsers.includes(post.user_id);
        if (!isAllowed) {
          console.log(`🚫 Blocked DM from non-whitelisted user: ${post.user_id}`);
          // Optionally send a polite response
          await this.replyToPost(
            post.channel_id,
            post.id,
            `👋 Hi! I'm configured to only respond in public channels. Please mention me in a team channel instead.`
          );
          return;
        }
        console.log(`✅ Allowed DM from whitelisted user: ${post.user_id}`);
      }
    }

    console.log(`\n🗣️ Received mention in channel: ${message.data.channel_display_name}`);
    console.log(`   Message: ${post.message.substring(0, 100)}${post.message.length > 100 ? '...' : ''}`);

    // Send "typing" indicator
    await this.sendTypingIndicator(post.channel_id);

    // Process the request in parallel (don't await - allows multiple requests to process simultaneously)
    // Each request gets its own async context and won't block other requests
    this.processRequest(post).catch((error) => {
      console.error(`❌ Error processing post ${post.id}:`, error);
      // Try to notify user of error
      this.replyToPost(post.channel_id, post.id, `❌ An error occurred: ${error.message}`).catch(() => {});
    });
  }

  /**
   * Try to claim a post for processing using database-backed deduplication.
   * Returns true if THIS instance should process the post, false if another instance already claimed it.
   * Uses INSERT ON CONFLICT to atomically claim posts across multiple coordinator instances.
   */
  private async tryClaimPost(postId: string): Promise<boolean> {
    try {
      const db = this.getDB();

      // Atomically try to insert - if another coordinator already claimed it, we'll get 0 rows
      const result = await db.query(
        `INSERT INTO processed_posts (post_id, coordinator_id)
         VALUES ($1, $2)
         ON CONFLICT (post_id) DO NOTHING
         RETURNING post_id`,
        [postId, this.coordinatorId]
      );

      // If we got a row back, we claimed it successfully
      const claimed = result.rowCount !== null && result.rowCount > 0;

      if (claimed) {
        console.log(`🔐 Claimed post ${postId.substring(0, 8)} for processing`);
      } else {
        console.log(`⏭️  Post ${postId.substring(0, 8)} already claimed (duplicate event or multiple coordinators)`);
      }

      return claimed;
    } catch (error) {
      // If database fails, fall back to local Set deduplication
      // This ensures we don't completely break if DB is unavailable
      console.warn(`⚠️  Database deduplication failed, using local fallback:`, error);

      if (this.processedPosts.has(postId)) {
        return false;
      }
      this.processedPosts.add(postId);
      return true;
    }
  }

  private async processRequest(post: Post) {
    try {
      // DATABASE-BACKED DEDUPLICATION
      // This ensures only ONE coordinator instance processes each post,
      // even when multiple instances are running (PM2, Docker, zombies, etc.)
      console.log(`🔍 Checking post ${post.id} for deduplication...`);

      // Quick local cache check first (avoids unnecessary DB queries)
      if (this.processedPosts.has(post.id)) {
        console.log(`⏭️  Skipping duplicate post ${post.id} (local cache)`);
        return;
      }

      // Try to claim the post in the database
      const claimed = await this.tryClaimPost(post.id);
      if (!claimed) {
        console.log(`⏭️  Skipping duplicate post ${post.id.substring(0, 8)} (already processing or processed)`);
        return;
      }

      // Add to local cache as well
      this.processedPosts.add(post.id);

      // Clean up local cache (keep last 1000)
      if (this.processedPosts.size > 1000) {
        const toDelete = Array.from(this.processedPosts).slice(0, this.processedPosts.size - 1000);
        toDelete.forEach(id => this.processedPosts.delete(id));
      }

      // Remove bot mention from message
      let message = post.message.replace(/<@[A-Z0-9]+>/g, '').trim();

      console.log(`\n📨 Message in channel ${post.channel_id}`);
      console.log(`   From: ${post.user_id}`);
      console.log(`   Message: ${message.substring(0, 100)}`);

      // Check if sender is admin and/or bot
      const isAdmin = this.adminUsers.includes(post.user_id);
      const isBot = await this.isUserBot(post.user_id);

      // FIRST: Check circuit breaker (applies to EVERYONE including admins)
      const circuitBreakerResult = await checkCircuitBreaker(
        post.user_id,
        'mattermost',
        20,  // Max 20 requests
        60   // In 60 seconds
      );

      if (!circuitBreakerResult.allowed) {
        console.log(`   🚨 Circuit breaker triggered: ${circuitBreakerResult.reason}`);
        await this.replyToPost(
          post.channel_id,
          post.id,
          `${circuitBreakerResult.reason}`
        );
        return;
      }

      console.log(`   ✅ Circuit breaker check passed (${circuitBreakerResult.recentCount}/20 in last 60s)`);

      // SECOND: Check rate limits (admins bypass daily limits, but not circuit breaker)
      const rateLimitResult = await checkInvocationLimit(
        post.user_id,
        'mattermost',
        isAdmin,
        isBot
      );

      if (!rateLimitResult.allowed) {
        console.log(`   ⛔ Rate limit exceeded: ${rateLimitResult.reason}`);
        await this.replyToPost(
          post.channel_id,
          post.id,
          `⛔ ${rateLimitResult.reason}`
        );
        return;
      }

      // Log rate limit status with daily usage
      if (rateLimitResult.remaining === undefined) {
        // Admin - show global usage only
        console.log(`   ✅ Rate limit check passed (admin - unlimited)`);
        console.log(`   📊 Global usage today: ${rateLimitResult.globalCount}/${rateLimitResult.globalLimit}`);
      } else {
        // Regular user - show both user and global usage
        console.log(`   ✅ Rate limit check passed (${rateLimitResult.remaining} remaining${isBot ? ' for bot' : ''})`);
        console.log(`   📊 Your usage today: ${rateLimitResult.userCount}/${rateLimitResult.userLimit}`);
        console.log(`   📊 Global usage today: ${rateLimitResult.globalCount}/${rateLimitResult.globalLimit}`);
      }

      // Send warning if approaching limits
      if (rateLimitResult.warningLevel === 'critical') {
        const userPercent = Math.round((rateLimitResult.remaining! / rateLimitResult.userLimit!) * 100);
        const globalPercent = Math.round(((rateLimitResult.globalLimit! - rateLimitResult.globalCount!) / rateLimitResult.globalLimit!) * 100);

        if (userPercent <= 10) {
          await this.replyToPost(post.channel_id, post.id,
            `⚠️ Warning: You have only ${rateLimitResult.remaining} invocation${rateLimitResult.remaining === 1 ? '' : 's'} remaining today (${userPercent}% of your daily limit).`);
        }

        if (globalPercent <= 10) {
          await this.replyToPost(post.channel_id, post.id,
            `🚨 Global rate limit warning: The system has ${rateLimitResult.globalLimit! - rateLimitResult.globalCount!} invocations remaining today (${globalPercent}% of daily capacity).`);
        }
      } else if (rateLimitResult.warningLevel === 'low' && rateLimitResult.remaining! <= 5) {
        // Only warn about user limit if they have 5 or fewer remaining
        await this.replyToPost(post.channel_id, post.id,
          `⚠️ You have ${rateLimitResult.remaining} invocation${rateLimitResult.remaining === 1 ? '' : 's'} remaining today.`);
      }

      // Check for attachments
      const attachments = post.file_ids || [];
      if (attachments.length > 0) {
        console.log(`   📎 ${attachments.length} attachment(s): ${post.metadata?.files?.map(f => f.name).join(', ')}`);
      }

      // Detect model preference in message
      const modelPreference = this.detectModelPreference(message);
      if (modelPreference) {
        console.log(`   🎯 Model preference detected: ${modelPreference}`);
      }

      // Classify message with LLM
      const { classification, model } = await this.classifyMessage(message);
      console.log(`   Classification: ${classification} (model: ${model})`);

      // Fetch thread context if this is a reply
      let threadContext: ThreadContext | null = null;
      if (post.root_id) {
        console.log(`   🧵 This is a reply to thread ${post.root_id.substring(0, 8)}...`);
        threadContext = await this.getThreadContext(post.root_id, post.id);
        if (threadContext) {
          console.log(`   📜 Thread context: root + ${threadContext.recent_replies.length} recent replies`);
        }
      }

      // Fetch last channel exchange for conversational context (when not in a thread)
      let lastExchange: { user_message: string; user_id: string; assistant_response?: string } | null = null;
      if (!post.root_id) {
        console.log(`   🔍 Fetching last exchange for channel ${post.channel_id.substring(0, 8)}...`);
        lastExchange = await this.getLastChannelExchange(post.channel_id, post.id);
        if (lastExchange) {
          console.log(`   💬 Last exchange found:`);
          console.log(`      User msg: "${lastExchange.user_message.substring(0, 80)}..."`);
          console.log(`      Assistant: ${lastExchange.assistant_response ? `"${lastExchange.assistant_response.substring(0, 80)}..."` : 'NONE'}`);
        } else {
          console.log(`   ⚠️  No last exchange found for this channel`);
        }
      } else {
        console.log(`   🧵 In thread ${post.root_id.substring(0, 8)}, skipping channel context`);
      }

      // Log user message to database
      await this.logMessage(post, 'user', message);

      // Dispatch to coordinator via NATS (both chat and task)
      // (coordinator will send progress updates)
      const taskId = randomUUID();

      // Get sender username for bot awareness
      const senderUsername = await this.getUsername(post.user_id);

      const task = {
        id: taskId,
        type: 'custom',
        payload: {
          description: message,
          mattermost_channel: post.channel_id,
          mattermost_thread: post.root_id || post.id, // Use root_id if replying, otherwise this post starts the thread
          mattermost_user: post.user_id,
          is_admin: isAdmin,
          sender_is_bot: isBot, // For multi-agent awareness
          sender_username: senderUsername, // For multi-agent awareness
          known_bots: Array.from(this.botUsernames), // List of bot usernames
          classification, // 'chat' or 'task'
          model_preference: modelPreference, // User-requested model
          attachments: attachments.length > 0 ? {
            file_ids: attachments,
            files: post.metadata?.files || [],
          } : undefined,
          thread_context: threadContext ? {
            root_message: threadContext.root_post.message,
            root_user: threadContext.root_post.user_id,
            recent_replies: threadContext.recent_replies.map(r => ({
              message: r.message,
              user_id: r.user_id,
            })),
          } : undefined,
          last_exchange: lastExchange || undefined,
        },
        created_at: Date.now(),
      };

      console.log(`📤 Dispatching ${classification} to coordinator: ${taskId}`);
      console.log(`   User: ${post.user_id}${isAdmin ? ' (admin)' : ''}`);
      console.log(`   Bot: ${this.botId}`);

      // Publish to NATS on bot-specific subject to ensure correct coordinator processes it
      // Using shared subject would cause any coordinator to process it (wrong bot_id in response)
      this.nc.publish(`tasks.from-mattermost.${this.botId}`, sc.encode(JSON.stringify(task)));

      console.log(`✅ Task dispatched`);

    } catch (error) {
      console.error('Error processing request:', error);
      await this.replyToPost(post.channel_id, post.id,
        `❌ Sorry, I encountered an error processing your request: ${error}`);
    }
  }

  private detectModelPreference(message: string): string | undefined {
    const lowerMessage = message.toLowerCase();

    // Check for explicit model mentions
    // Pattern: "use [model]" or "with [model]" or "using [model]"
    const patterns = [
      /(?:use|using|with)\s+(?:the\s+)?(?:your\s+)?(?:small\s+)?(?:local\s+)?(qwen|ollama|bedrock|claude|anthropic|vertex|google)(?:\s+model)?/i,
    ];

    for (const pattern of patterns) {
      const match = lowerMessage.match(pattern);
      if (match) {
        const modelName = match[1];

        // Map common names to adapter names
        const modelMap: Record<string, string> = {
          'qwen': 'ollama-quick',  // Qwen 3.5 9B is the default quick model
          'ollama': 'ollama-code',  // Qwen 2.5 Coder 32B for code tasks
          'bedrock': 'bedrock',
          'claude': 'anthropic',
          'anthropic': 'anthropic',
          'vertex': 'vertex',
          'google': 'google-ai',
        };

        const mappedName = modelMap[modelName.toLowerCase()];
        if (mappedName) {
          return mappedName;
        }
      }
    }

    return undefined;
  }

  private async classifyMessage(message: string): Promise<{ classification: 'chat' | 'task'; model: string }> {
    const prompt = `Classify this message as either "chat" (greeting/small talk) or "task" (work request):

Message: "${message}"

Respond with ONLY one word: chat or task`;

    try {
      const response = await this.llmRouter.chat('quick', [
        { role: 'user', content: prompt },
      ]);

      const classification = response.content.toLowerCase().trim();
      return {
        classification: classification === 'task' ? 'task' : 'chat',
        model: response.model || 'unknown',
      };
    } catch (error) {
      console.error('⚠️ LLM classification failed, defaulting to task:', error);
      return { classification: 'task', model: 'fallback' };
    }
  }

  private getDB(): Pool {
    if (!this.db) {
      const connectionString = process.env.DATABASE_URL;
      if (!connectionString) {
        throw new Error('DATABASE_URL not set - cannot log messages to database');
      }
      this.db = new Pool({
        connectionString,
        max: 5,
        idleTimeoutMillis: 30000,
      });
    }
    return this.db;
  }

  /**
   * Fetch channel info from Mattermost API to get channel type
   */
  private async getChannelType(channelId: string): Promise<string | null> {
    try {
      const response = await fetch(`${this.mattermostUrl}/api/v4/channels/${channelId}`, {
        headers: {
          'Authorization': `Bearer ${this.botToken}`,
        },
      });

      if (!response.ok) {
        console.warn(`⚠️  Could not fetch channel info for ${channelId}`);
        return null;
      }

      const channel = await response.json() as any;
      return channel.type || null; // 'O' = Open/Public, 'P' = Private, 'D' = DM, 'G' = Group
    } catch (error) {
      console.warn(`⚠️  Error fetching channel type:`, error);
      return null;
    }
  }

  /**
   * Fetch a single post by ID
   */
  private async getPost(postId: string): Promise<Post | null> {
    try {
      const response = await fetch(`${this.mattermostUrl}/api/v4/posts/${postId}`, {
        headers: {
          'Authorization': `Bearer ${this.botToken}`,
        },
      });

      if (!response.ok) {
        console.warn(`⚠️  Could not fetch post ${postId}`);
        return null;
      }

      return await response.json() as Post;
    } catch (error) {
      console.warn(`⚠️  Error fetching post:`, error);
      return null;
    }
  }

  /**
   * Fetch thread context for a reply
   * Returns the root post and recent replies (up to 10) for context
   */
  private async getThreadContext(rootId: string, currentPostId: string): Promise<ThreadContext | null> {
    try {
      const response = await fetch(`${this.mattermostUrl}/api/v4/posts/${rootId}/thread`, {
        headers: {
          'Authorization': `Bearer ${this.botToken}`,
        },
      });

      if (!response.ok) {
        console.warn(`⚠️  Could not fetch thread for ${rootId}`);
        return null;
      }

      const thread = await response.json() as any;
      const posts: Post[] = Object.values(thread.posts || {});

      // Sort by create_at ascending
      posts.sort((a, b) => a.create_at - b.create_at);

      // Find the root post
      const rootPost = posts.find(p => p.id === rootId);
      if (!rootPost) {
        return null;
      }

      // Get replies (excluding root and current post), take last 10
      const replies = posts
        .filter(p => p.id !== rootId && p.id !== currentPostId)
        .slice(-10)
        .map(p => ({
          id: p.id,
          message: p.message,
          user_id: p.user_id,
          create_at: p.create_at,
        }));

      return {
        root_post: {
          id: rootPost.id,
          message: rootPost.message,
          user_id: rootPost.user_id,
          create_at: rootPost.create_at,
        },
        recent_replies: replies,
      };
    } catch (error) {
      console.warn(`⚠️  Error fetching thread context:`, error);
      return null;
    }
  }

  /**
   * Fetch the last message exchange in this channel for conversational context
   * Returns the most recent user message and Audrey's response (if any)
   *
   * NOTE: Uses retry logic to handle race condition where a concurrent request's
   * assistant message INSERT may not have committed yet.
   */
  private async getLastChannelExchange(channelId: string, currentPostId: string, retryCount = 0): Promise<{ user_message: string; user_id: string; assistant_response?: string } | null> {
    if (!this.logAllMessages) {
      console.log(`   [getLastChannelExchange] logAllMessages is disabled`);
      return null;
    }

    try {
      const db = this.getDB();

      // Find the conversation for this channel
      const convResult = await db.query(
        'SELECT id FROM conversations WHERE room_id = $1 AND platform = \'mattermost\' LIMIT 1',
        [channelId]
      );

      const conversationId = convResult.rows[0]?.id;
      if (!conversationId) {
        console.log(`   [getLastChannelExchange] No conversation found for channel ${channelId.substring(0, 8)}`);
        return null;
      }
      console.log(`   [getLastChannelExchange] Found conversation ${conversationId.substring(0, 8)} for channel`);

      // Get the last 4 messages to better handle race conditions
      // We may need more context to find the last complete exchange
      const messagesResult = await db.query(
        `
        SELECT role, content, sender_id, created_at
        FROM messages
        WHERE conversation_id = $1 AND event_id != $2
        ORDER BY created_at DESC
        LIMIT 4
        `,
        [conversationId, currentPostId]
      );

      console.log(`   [getLastChannelExchange] Found ${messagesResult.rows.length} messages in conversation`);
      if (messagesResult.rows.length === 0) {
        console.log(`   [getLastChannelExchange] No messages found (excluding current post)`);
        return null;
      }

      // Log what we found for debugging
      for (const msg of messagesResult.rows) {
        console.log(`   [getLastChannelExchange] - ${msg.role}: "${(msg.content || '').substring(0, 50)}..."`);
      }

      // Find the most recent user message and optional assistant response
      const messages = messagesResult.rows;
      let userMessage = messages.find((m: any) => m.role === 'user');
      let assistantMessage = messages.find((m: any) => m.role === 'assistant');

      if (!userMessage) {
        console.log(`   [getLastChannelExchange] No user message found in recent messages`);
        return null;
      }

      // Race condition detection: If we have a user message but no assistant response,
      // and the user message is very recent (< 5 seconds old), the assistant response
      // INSERT might still be in flight. Retry once after a short delay.
      if (!assistantMessage && retryCount < 1) {
        const messageAge = Date.now() - new Date(userMessage.created_at).getTime();
        if (messageAge < 5000) { // Message is less than 5 seconds old
          console.log(`   ⏳ Context race condition detected, waiting for assistant message...`);
          await new Promise(resolve => setTimeout(resolve, 200)); // Wait 200ms
          return this.getLastChannelExchange(channelId, currentPostId, retryCount + 1);
        }
      }

      return {
        user_message: userMessage.content,
        user_id: userMessage.sender_id,
        assistant_response: assistantMessage?.content,
      };
    } catch (error) {
      console.warn(`⚠️  Error fetching last channel exchange:`, error);
      return null;
    }
  }

  /**
   * Log a message to the database for conversation history
   */
  private async logMessage(post: Post, role: 'user' | 'assistant', message: string) {
    console.log(`📝 [logMessage] Logging ${role} message to channel ${post.channel_id.substring(0, 8)}...`);
    if (!this.logAllMessages) {
      console.log(`📝 [logMessage] SKIPPED - logAllMessages is disabled`);
      return;
    }

    try {
      const db = this.getDB();

      // Fetch channel type for permission checking
      const channelType = await this.getChannelType(post.channel_id);

      // Get or create conversation
      const convResult = await db.query(
        `
        INSERT INTO conversations (room_id, platform, user_id, title, channel_type)
        VALUES ($1, 'mattermost', $2, $3, $4)
        ON CONFLICT (room_id, platform)
        DO UPDATE SET updated_at = NOW(), channel_type = EXCLUDED.channel_type
        RETURNING id
        `,
        [post.channel_id, post.user_id, `Mattermost ${post.channel_id.substring(0, 20)}`, channelType]
      );

      const conversationId = convResult.rows[0]?.id || (
        await db.query('SELECT id FROM conversations WHERE room_id = $1 AND platform = \'mattermost\' LIMIT 1', [post.channel_id])
      ).rows[0]?.id;

      if (!conversationId) {
        console.warn('⚠️  Could not create/find conversation for message logging');
        return;
      }

      // Insert message
      await db.query(
        `
        INSERT INTO messages (conversation_id, role, content, event_id, sender_id, metadata)
        VALUES ($1, $2, $3, $4, $5, $6)
        `,
        [conversationId, role, message, post.id, role === 'user' ? post.user_id : this.botUserId, { channel_id: post.channel_id }]
      );
      console.log(`📝 [logMessage] SUCCESS - logged ${role} message to conversation ${conversationId.substring(0, 8)}`);
    } catch (error) {
      console.error(`📝 [logMessage] FAILED - ${error}`);
      // Don't throw - message logging shouldn't break the bot
    }
  }

  /**
   * Log an assistant message to an existing conversation
   * Uses RETURNING to ensure the INSERT is fully committed before returning.
   */
  private async logAssistantMessage(channelId: string, messageId: string, message: string) {
    console.log(`📝 [logAssistantMessage] Logging assistant message to channel ${channelId.substring(0, 8)}...`);

    if (!this.logAllMessages) {
      console.log(`📝 [logAssistantMessage] SKIPPED - logAllMessages is disabled`);
      return;
    }

    try {
      const db = this.getDB();

      // Find existing conversation
      const convResult = await db.query(
        'SELECT id FROM conversations WHERE room_id = $1 AND platform = \'mattermost\' LIMIT 1',
        [channelId]
      );

      const conversationId = convResult.rows[0]?.id;

      if (!conversationId) {
        console.warn('⚠️  [logAssistantMessage] No conversation found for channel - cannot log assistant message');
        return;
      }

      console.log(`📝 [logAssistantMessage] Found conversation ${conversationId.substring(0, 8)}`);

      // Insert assistant message with RETURNING to ensure commit
      const insertResult = await db.query(
        `
        INSERT INTO messages (conversation_id, role, content, event_id, sender_id, metadata)
        VALUES ($1, 'assistant', $2, $3, $4, $5)
        RETURNING id
        `,
        [conversationId, message, messageId, this.botUserId, { channel_id: channelId }]
      );

      if (insertResult.rowCount === 0) {
        console.warn('⚠️  [logAssistantMessage] INSERT returned no rows');
      } else {
        console.log(`📝 [logAssistantMessage] SUCCESS - logged assistant message ${insertResult.rows[0].id.substring(0, 8)}`);
      }
    } catch (error) {
      console.error('⚠️  [logAssistantMessage] Failed to log assistant message:', error);
      // Don't throw - message logging shouldn't break the bot
    }
  }

  private async sendTypingIndicator(channelId: string) {
    if (!this.botUserId) return;

    await fetch(`${this.mattermostUrl}/api/v4/users/${this.botUserId}/typing`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channel_id: channelId,
      }),
    }).catch(() => {}); // Ignore errors
  }

  private async handleMattermostMessage(data: any) {
    const { bot_id, channel_id, root_id, message, is_final, invocation_id } = data;

    // Multi-bot routing: only process messages intended for this bot
    // If bot_id is specified and doesn't match, skip (another listener will handle it)
    if (bot_id && bot_id !== this.botId) {
      return; // Silent skip - not for this bot
    }

    if (!channel_id || !message) {
      console.error('Message missing required fields:', data);
      return;
    }

    // Deduplicate NATS messages to prevent spam
    const messageKey = `${channel_id}:${root_id || 'top'}:${is_final}:${message.substring(0, 100)}`;
    if (this.processedNatsMessages.has(messageKey)) {
      console.log(`⏭️  Skipping duplicate NATS message for channel ${channel_id.substring(0, 8)}`);
      return;
    }

    this.processedNatsMessages.add(messageKey);

    // Clean up old message keys (keep last 1000)
    if (this.processedNatsMessages.size > 1000) {
      const toDelete = Array.from(this.processedNatsMessages).slice(0, this.processedNatsMessages.size - 1000);
      toDelete.forEach(key => this.processedNatsMessages.delete(key));
    }

    if (is_final) {
      // Final result: post at top level (not threaded)
      console.log(`📬 Posting final result to channel ${channel_id}`);
      const postId = await this.postToChannel(channel_id, message);
      if (postId) {
        await this.logAssistantMessage(channel_id, postId, message);

        // Link response post to invocation for reaction tracking
        if (invocation_id && this.reactionTracker) {
          await this.reactionTracker.linkResponseToInvocation(invocation_id, postId);
          console.log(`🔗 Linked response post ${postId.substring(0, 8)} to invocation ${invocation_id.substring(0, 8)}`);
        }
      }
    } else {
      // Update/progress: post as threaded reply
      console.log(`📬 Posting update to thread in channel ${channel_id}`);
      const postId = await this.replyToPost(channel_id, root_id, message);
      if (postId) {
        await this.logAssistantMessage(channel_id, postId, message);

        // Also link threaded replies to invocation for reaction tracking
        if (invocation_id && this.reactionTracker) {
          await this.reactionTracker.linkResponseToInvocation(invocation_id, postId);
        }
      }
    }
  }

  // Post a threaded reply to a specific post
  private async replyToPost(channelId: string, rootId: string, message: string): Promise<string | null> {
    // Strip @mentions of bot accounts to prevent infinite loops
    const filteredMessage = this.stripBotMentions(message);

    try {
      const response = await fetch(`${this.mattermostUrl}/api/v4/posts`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          channel_id: channelId,
          root_id: rootId,
          message: filteredMessage,
        }),
      });

      if (!response.ok) {
        console.error('Failed to post reply:', response.statusText);
        return null;
      }

      const postData = await response.json() as any;
      return postData.id || null;
    } catch (error) {
      console.error('Error posting reply:', error);
      return null;
    }
  }

  // Post a top-level message to channel (not threaded)
  private async postToChannel(channelId: string, message: string): Promise<string | null> {
    // Strip @mentions of bot accounts to prevent infinite loops
    const filteredMessage = this.stripBotMentions(message);

    try {
      const response = await fetch(`${this.mattermostUrl}/api/v4/posts`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          channel_id: channelId,
          message: filteredMessage,
        }),
      });

      if (!response.ok) {
        console.error('Failed to post message:', response.statusText);
        return null;
      }

      const postData = await response.json() as any;
      return postData.id || null;
    } catch (error) {
      console.error('Error posting message:', error);
      return null;
    }
  }

  // Add emoji reaction to a post
  async addReaction(postId: string, emojiName: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.mattermostUrl}/api/v4/reactions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          user_id: this.botUserId,
          post_id: postId,
          emoji_name: emojiName,
        }),
      });

      if (!response.ok) {
        console.error('Failed to add reaction:', response.statusText);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error adding reaction:', error);
      return false;
    }
  }

  // Download file attachment from Mattermost
  async downloadFile(fileId: string): Promise<{ filename: string; data: Buffer } | null> {
    try {
      // Get file info first
      const infoResponse = await fetch(`${this.mattermostUrl}/api/v4/files/${fileId}/info`, {
        headers: {
          'Authorization': `Bearer ${this.botToken}`,
        },
      });

      if (!infoResponse.ok) {
        console.error('Failed to get file info:', infoResponse.statusText);
        return null;
      }

      const fileInfo = await infoResponse.json() as any;
      const filename = fileInfo.name || 'unknown';

      // Download file content
      const fileResponse = await fetch(`${this.mattermostUrl}/api/v4/files/${fileId}`, {
        headers: {
          'Authorization': `Bearer ${this.botToken}`,
        },
      });

      if (!fileResponse.ok) {
        console.error('Failed to download file:', fileResponse.statusText);
        return null;
      }

      const data = Buffer.from(await fileResponse.arrayBuffer());

      return { filename, data };
    } catch (error) {
      console.error('Error downloading file:', error);
      return null;
    }
  }

  // Upload file and get file ID for attaching to message
  async uploadFile(filename: string, data: Buffer, channelId: string): Promise<string | null> {
    try {
      const formData = new FormData();
      formData.append('files', new Blob([data]), filename);
      formData.append('channel_id', channelId);

      const response = await fetch(`${this.mattermostUrl}/api/v4/files`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.botToken}`,
        },
        body: formData,
      });

      if (!response.ok) {
        console.error('Failed to upload file:', response.statusText);
        return null;
      }

      const result = await response.json() as any;
      return result.file_infos?.[0]?.id || null;
    } catch (error) {
      console.error('Error uploading file:', error);
      return null;
    }
  }

  // Post message with file attachment
  async postWithAttachment(channelId: string, message: string, fileIds: string[]): Promise<string | null> {
    try {
      const response = await fetch(`${this.mattermostUrl}/api/v4/posts`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          channel_id: channelId,
          message,
          file_ids: fileIds,
        }),
      });

      if (!response.ok) {
        console.error('Failed to post with attachment:', response.statusText);
        return null;
      }

      const postData = await response.json() as any;
      return postData.id || null;
    } catch (error) {
      console.error('Error posting with attachment:', error);
      return null;
    }
  }

  async stop() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }
    if (this.ws) {
      this.ws.close();
    }
    if (this.db) {
      await this.db.end();
    }
    console.log('👋 Mattermost listener stopped');
  }

  private async handleReactionAdded(message: MattermostMessage) {
    if (!this.reactionTracker) return;

    try {
      const data = message.data as any;
      const reaction = JSON.parse(data.reaction || '{}');

      await this.reactionTracker.logReaction(
        reaction.post_id,
        reaction.emoji_name,
        reaction.user_id,
        message.broadcast.channel_id // Channel ID is in broadcast, not data
      );
    } catch (error) {
      console.error('Error handling reaction_added:', error);
    }
  }

  private async handleReactionRemoved(message: MattermostMessage) {
    if (!this.reactionTracker) return;

    try {
      const data = message.data as any;
      const reaction = JSON.parse(data.reaction || '{}');

      await this.reactionTracker.removeReaction(
        reaction.post_id,
        reaction.emoji_name,
        reaction.user_id
      );
    } catch (error) {
      console.error('Error handling reaction_removed:', error);
    }
  }
}

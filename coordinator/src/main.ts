#!/usr/bin/env node
/**
 * NimbleCo Coordinator
 *
 * Central orchestration service that:
 * 1. Receives tasks from chat platforms (Mattermost, Telegram, etc.) via NATS
 * 2. Handles tasks directly or decomposes into subtasks for agents
 * 3. Dispatches to universal agents via NATS for swarm processing
 * 4. Aggregates results and posts responses back to the originating platform
 *
 * Architecture:
 * - Platform Listeners: Receive messages, classify, dispatch tasks via NATS
 * - Coordinator: Orchestrates task handling, tool calling, and agent swarms (platform-agnostic)
 * - Universal Agents: Stateless workers that can assume any role with any tools
 */

import { connect, NatsConnection, StringCodec } from 'nats';
import { createLLM, LLMRouter, LLMMessage } from '@nimbleco/llm-adapters';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { MattermostListener } from './mattermost-listener';
import { InvocationLogger } from './invocation-logger';
import { MessageBusLogger } from './message-bus-logger';
import { getPool } from './db';
import {
  registry as toolRegistry,
  executeToolCall,
  getToolsForTask,
  ToolContext,
  filterToolsByPolicy,
  PolicyClient,
  getAdditionalCredentialEnvVars,
} from '@nimbleco/tools';
import { createPolicyClient } from './policy-factory';
import { checkCircuitBreaker, checkInvocationLimit } from './rate-limiter';

// Load .env from project root
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const sc = StringCodec();

// Load constitutional identity document
// Priority: storage/{BOT_ID}/identity.md → storage/identity.md → config/identity.template.md
const botId = process.env.BOT_ID || 'default';
const IDENTITY_PATH_BOT = path.resolve(process.cwd(), `storage/${botId}/identity.md`);
const IDENTITY_PATH_SHARED = path.resolve(process.cwd(), 'storage/identity.md');
const IDENTITY_TEMPLATE_PATH = path.resolve(process.cwd(), 'config/identity.template.md');
let identityDocument = '';
try {
  identityDocument = fs.readFileSync(IDENTITY_PATH_BOT, 'utf-8');
  console.log(`📜 Loaded persona identity: storage/${botId}/identity.md`);
} catch (error) {
  try {
    identityDocument = fs.readFileSync(IDENTITY_PATH_SHARED, 'utf-8');
    console.log(`📜 Loaded shared identity (create storage/${botId}/identity.md to personalize)`);
  } catch (error2) {
    try {
      identityDocument = fs.readFileSync(IDENTITY_TEMPLATE_PATH, 'utf-8');
      console.log(`📜 Loaded identity template (create storage/${botId}/identity.md to personalize)`);
    } catch (error3) {
      console.warn('⚠️  Could not load identity document:', error3);
    }
  }
}

// Load persistent memory document
// Location: storage/{BOT_ID}/memory.md
const MEMORY_PATH = path.resolve(process.cwd(), `storage/${botId}/memory.md`);
let memoryDocument = '';
try {
  memoryDocument = fs.readFileSync(MEMORY_PATH, 'utf-8');
  console.log(`🧠 Loaded persistent memory: storage/${botId}/memory.md (${memoryDocument.length} chars)`);
} catch (error) {
  console.log(`📝 No memory file found (agents can create one with append_agent_memory tool)`);
}

interface Task {
  id: string;
  type: 'pr-review' | 'security-scan' | 'run-tests' | 'custom' | 'swarm';
  payload: any;
  created_at: number;
  trigger_user_id?: string;  // User who triggered the original request
  swarm_depth?: number;      // Track recursive swarm depth (prevent infinite loops)
}

// Maximum allowed swarm depth to prevent infinite recursion
const MAX_SWARM_DEPTH = 2;

// Maximum number of agents in a swarm (parallel or conversation)
const MAX_SWARM_SIZE = 5;

// Maximum conversation turns per agent
const MAX_CONVERSATION_TURNS = 5;

interface AgentResponse {
  agent_id: string;
  status: 'success' | 'failure';
  result?: any;
  tools_used?: string[];
  error?: string;
}

/** Resolved platform context from a task payload — platform-agnostic fields */
interface PlatformContext {
  platform: string;
  roomId: string | undefined;
  eventId: string | undefined;
  userId: string;
}

/** Extract platform context from a task payload.
 *  Generic fields (chat_*) take priority, then platform-specific fallbacks. */
function resolvePlatformContext(payload: any): PlatformContext {
  return {
    platform: payload?.platform || (payload?.mattermost_channel ? 'mattermost' : 'matrix'),
    roomId: payload?.chat_channel || payload?.matrix_room || payload?.mattermost_channel,
    eventId: payload?.chat_thread || payload?.matrix_event || payload?.mattermost_thread,
    userId: payload?.chat_user || payload?.matrix_user || payload?.mattermost_user || 'unknown',
  };
}

class Coordinator {
  private nc!: NatsConnection;
  private llmRouter: LLMRouter;
  private mattermostListener?: MattermostListener;
  private messageBusLogger?: MessageBusLogger;
  private processedTasks: Set<string> = new Set();
  private publishedMessages: Set<string> = new Set(); // Track published messages to prevent duplicates
  private botId: string;
  private policyClient: PolicyClient;
  private currentPlatform: string = 'mattermost'; // Active platform for current task (set per-invocation)
  private cascadeOrder: string[] | undefined;

  constructor() {
    // Get bot ID from environment (defaults to 'default' for single-bot setups)
    this.botId = process.env.BOT_ID || 'default';

    // Initialize policy client based on environment configuration
    this.policyClient = createPolicyClient();

    // Initialize LLM router with cost limit
    const dailyLimit = parseFloat(process.env.LLM_DAILY_COST_LIMIT || '10');
    this.llmRouter = new LLMRouter(dailyLimit);

    // Read per-agent cascade order from environment (set via Swarm-Map agent metadata)
    const cascadeOrderEnv = process.env.LLM_CASCADE_ORDER;
    if (cascadeOrderEnv) {
      this.cascadeOrder = cascadeOrderEnv.split(',').map(s => s.trim()).filter(Boolean);
      console.log(`🔀 Custom LLM cascade order: ${this.cascadeOrder.join(' → ')}`);
    }

    // Register available LLM providers
    this.setupLLMProviders();
  }

  private setupLLMProviders() {
    // Local Ollama (free!)
    if (process.env.OLLAMA_URL) {
      const quickModel = createLLM('ollama', process.env.LLM_MODEL_QUICK || 'qwen3.5:9b', {
        baseUrl: process.env.OLLAMA_URL,
      });
      this.llmRouter.register('ollama-quick', quickModel);

      const codeModel = createLLM('ollama', process.env.LLM_MODEL_CODE || 'qwen2.5-coder:32b', {
        baseUrl: process.env.OLLAMA_URL,
      });
      this.llmRouter.register('ollama-code', codeModel);
    }

    // Anthropic Claude (paid)
    if (process.env.ANTHROPIC_API_KEY) {
      const claude = createLLM('anthropic', 'claude-sonnet-4-5-20250929', {
        apiKey: process.env.ANTHROPIC_API_KEY,
      });
      this.llmRouter.register('anthropic', claude);
    }

    // Google AI (Gemini API with API key)
    // Can use custom baseUrl for Vertex AI endpoint: https://aiplatform.googleapis.com/v1
    if (process.env.GOOGLE_CLOUD_API_KEY && process.env.GOOGLE_MODEL) {
      const baseUrl = process.env.GOOGLE_API_BASE_URL || undefined;
      console.log(`🔧 Configuring Google AI: ${process.env.GOOGLE_MODEL}`);
      if (baseUrl) {
        console.log(`   Using custom base URL: ${baseUrl}`);
      }
      const googleAI = createLLM('google-ai', process.env.GOOGLE_MODEL, {
        apiKey: process.env.GOOGLE_CLOUD_API_KEY,
        max_tokens: parseInt(process.env.GOOGLE_MAX_OUTPUT_TOKENS || '30000'),
        baseUrl,
      });
      this.llmRouter.register('google-ai', googleAI);
      console.log('   ✅ Google AI registered');
    }

    // Vertex AI (free $300 credits)
    if (process.env.VERTEX_AI_PROJECT) {
      const vertex = createLLM('vertex', 'gemini-pro', {
        projectId: process.env.VERTEX_AI_PROJECT,
        region: process.env.VERTEX_AI_LOCATION,
      });
      this.llmRouter.register('vertex', vertex);
    }

    // AWS Bedrock (free tier)
    if (process.env.AWS_REGION && process.env.BEDROCK_MODEL_ID) {
      console.log(`🔧 Configuring Bedrock: ${process.env.BEDROCK_MODEL_ID}`);
      console.log(`   Region: ${process.env.AWS_REGION}`);
      console.log(`   Bearer token: ${process.env.AWS_BEARER_TOKEN_BEDROCK ? 'present' : 'MISSING'}`);
      const bedrock = createLLM('bedrock', process.env.BEDROCK_MODEL_ID, {
        region: process.env.AWS_REGION,
        bearerToken: process.env.AWS_BEARER_TOKEN_BEDROCK,
      });
      this.llmRouter.register('bedrock', bedrock);
      console.log('   ✅ Bedrock registered');
    } else {
      console.log('⚠️  Bedrock not configured (missing AWS_REGION or BEDROCK_MODEL_ID)');
    }

    console.log('✅ LLM providers configured');
    console.log(`💰 Daily budget: $${this.llmRouter.getRemainingBudget().toFixed(2)} remaining`);
  }

  async start() {
    // Clean up zombie processes from previous runs
    await this.cleanupZombieProcesses();

    // Connect to NATS
    this.nc = await connect({
      servers: process.env.NATS_URL || 'nats://localhost:4222',
    });

    console.log('🚀 Coordinator started');
    console.log(`🤖 Bot ID: ${this.botId}`);
    console.log(`📡 Connected to NATS: ${this.nc.getServer()}`);

    // Start message bus logger
    const db = getPool();
    this.messageBusLogger = new MessageBusLogger(this.nc, db);
    await this.messageBusLogger.start();

    // IMPORTANT: Set up subscriptions BEFORE starting listeners
    // This prevents race conditions where tasks are dispatched before subscriptions are ready
    // NOTE: Each bot subscribes to its OWN subject to ensure tasks are processed by the correct bot
    // Using shared subjects would cause cross-talk between bots
    const sub = this.nc.subscribe(`tasks.from-chat.${this.botId}`, { queue: `coordinator-${this.botId}` });
    const mattermostSub = this.nc.subscribe(`tasks.from-mattermost.${this.botId}`, { queue: `coordinator-${this.botId}` });
    console.log(`📥 Task subscriptions ready for bot: ${this.botId}`);

    // Start Mattermost listener if configured
    if (process.env.MATTERMOST_URL && process.env.MATTERMOST_BOT_TOKEN) {
      console.log('🤖 Starting Mattermost listener...');
      try {
        const adminUsers = process.env.MATTERMOST_ADMIN_USERS?.split(',').map(u => u.trim()).filter(u => u);
        const allowedUsers = process.env.MATTERMOST_ALLOWED_USERS?.split(',').map(u => u.trim()).filter(u => u);
        const blockDMs = process.env.MATTERMOST_BLOCK_DMS !== 'false'; // Default true
        const logAllMessages = process.env.MATTERMOST_LOG_ALL_MESSAGES !== 'false';

        this.mattermostListener = new MattermostListener(
          process.env.MATTERMOST_URL,
          process.env.MATTERMOST_BOT_TOKEN,
          this.nc,
          this.llmRouter,
          adminUsers,
          allowedUsers,
          blockDMs,
          logAllMessages
        );
        await this.mattermostListener.start();
        console.log('✅ Mattermost listener started');
      } catch (error) {
        console.error('❌ Failed to start Mattermost listener:', error);
        console.error('⚠️  Coordinator will continue without Mattermost integration');
        console.error('💡 Check your MATTERMOST_BOT_TOKEN and ensure the bot has proper permissions');
      }
    } else {
      console.log('⚠️  Mattermost not configured (missing env vars)');
    }

    // Show active integrations
    if (this.mattermostListener) {
      console.log('👂 Active chat integration: Mattermost\n');
    } else {
      console.log('⚠️  No chat integrations active\n');
    }

    (async () => {
      for await (const msg of mattermostSub) {
        try {
          const task: Task = JSON.parse(sc.decode(msg.data));
          console.log(`\n📋 Received task (mattermost): ${task.type} (${task.id})`);

          // Deduplicate: skip if we've already processed this task
          if (this.processedTasks.has(task.id)) {
            console.log(`⏭️  Skipping duplicate task ${task.id}`);
            continue;
          }

          this.processedTasks.add(task.id);

          // Clean up old task IDs (keep last 1000)
          if (this.processedTasks.size > 1000) {
            const toDelete = Array.from(this.processedTasks).slice(0, this.processedTasks.size - 1000);
            toDelete.forEach(id => this.processedTasks.delete(id));
          }

          await this.handleTask(task, msg);
        } catch (error) {
          console.error('❌ Error handling task:', error);
          if (msg.reply) {
            msg.respond(sc.encode(JSON.stringify({
              status: 'error',
              error: String(error),
            })));
          }
        }
      }
    })();

    for await (const msg of sub) {
      try {
        const task: Task = JSON.parse(sc.decode(msg.data));
        console.log(`\n📋 Received task: ${task.type} (${task.id})`);

        // Deduplicate: skip if we've already processed this task
        if (this.processedTasks.has(task.id)) {
          console.log(`⏭️  Skipping duplicate task ${task.id}`);
          continue;
        }

        this.processedTasks.add(task.id);

        // Clean up old task IDs (keep last 1000)
        if (this.processedTasks.size > 1000) {
          const toDelete = Array.from(this.processedTasks).slice(0, this.processedTasks.size - 1000);
          toDelete.forEach(id => this.processedTasks.delete(id));
        }

        await this.handleTask(task, msg);
      } catch (error) {
        console.error('❌ Error handling task:', error);
        if (msg.reply) {
          msg.respond(sc.encode(JSON.stringify({
            status: 'error',
            error: String(error),
          })));
        }
      }
    }
  }

  /**
   * Analyze task and decide: handle myself vs delegate to agents
   */
  private async analyzeAndRoute(task: Task): Promise<'handle' | 'delegate'> {
    const { type, payload } = task;

    // Simple decision tree for now (can be made smarter with LLM later)

    // Always delegate complex multi-agent tasks
    if (type === 'swarm') {
      return 'delegate';
    }

    // Delegate GitHub PR reviews (needs specialized workflow)
    if (type === 'pr-review') {
      return 'delegate';
    }

    // Security scans need specialized agent
    if (type === 'security-scan') {
      return 'delegate';
    }

    // Test runs need specialized environment
    if (type === 'run-tests') {
      return 'delegate';
    }

    // For custom tasks, check if we have tools
    if (type === 'custom') {
      const description = payload?.description || JSON.stringify(payload);
      console.log(`🔍 Custom task: ${description.substring(0, 100)}`);

      // Check if it explicitly asks to spawn agents/swarms.
      // Merely @mentioning other bots (e.g. "tell @hermes-personal about X")
      // is NOT a swarm request — it's a normal message that references them.
      if (description.match(/\b(spawn|create|spin up|launch)\s+(a\s+)?(new\s+)?(agent|swarm|multi-agent)/i)) {
        console.log(`  → Delegating (multi-agent request)`);
        return 'delegate';
      }

      // Check if we have tools for this task
      const tools = getToolsForTask(description);
      console.log(`  → Found ${tools.length} relevant tools`);

      if (tools.length > 0) {
        console.log(`  → Handling directly`);
        return 'handle';
      }

      // No tools found - try to handle anyway (Claude might figure it out)
      console.log(`  → Handling directly (no specific tools, but will try)`);
      return 'handle';
    }

    return 'handle';
  }

  /**
   * Handle task directly with tools (orchestrator does the work)
   */
  private async handleTaskDirectly(task: Task): Promise<void> {
    console.log('🎯 Orchestrator handling task directly');

    // Resolve platform-agnostic context from task payload
    const pctx = resolvePlatformContext(task.payload);
    this.currentPlatform = pctx.platform;

    const description = task.payload?.description || JSON.stringify(task.payload);
    // Build credentials from environment variables
    // Use the exact env var names that tools expect (e.g., NOTION_API_KEY, not notion_token)
    const credentials: Record<string, string> = {};
    const credentialEnvVars = [
      'GITHUB_TOKEN',
      'NOTION_API_KEY',
      'ATTIO_API_KEY',
      'OPEN_MEASURES_API_KEY',
      'OPEN_MEASURES_REFRESH_TOKEN',
      'GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY',
      'GOOGLE_CALENDAR_SERVICE_ACCOUNT_KEY',
      'BRAVE_SEARCH_API_KEY',
      'MATTERMOST_URL',
      'MATTERMOST_BOT_TOKEN',
      // Additional tool credentials are declared by each additional-tools module
      // and registered at startup via loadAdditionalTools() — see shared/tools/src/index.ts
      ...getAdditionalCredentialEnvVars(),
    ];
    for (const envVar of credentialEnvVars) {
      if (process.env[envVar]) {
        credentials[envVar] = process.env[envVar]!;
      }
    }

    const context: ToolContext = {
      user_id: pctx.userId || 'orchestrator',
      platform: pctx.platform as ToolContext['platform'],
      credentials,
      room_id: pctx.roomId,
    };

    // Start invocation logging
    const logger = new InvocationLogger();
    const invocationId = await logger.startInvocation({
      conversationId: pctx.roomId || 'unknown',
      triggerUserId: pctx.userId || 'unknown',
      triggerEventId: pctx.eventId || undefined,
      inputMessage: description,
      taskType: task.type,
      botId: this.botId,
    });

    // Reset failed adapters cache for this new invocation
    this.llmRouter.resetFailedAdapters();
    console.log(`📊 Started invocation ${invocationId}`);

    // Get relevant tools for this task
    let tools = getToolsForTask(description);

    // Policy-based tool filtering (optional, fails safe to allow-all)
    // This filters the tool schema BEFORE sending to LLM to reduce context window
    // and prevent LLM from attempting to use unauthorized tools
    const toolContext: ToolContext = {
      user_id: pctx.userId,
      platform: pctx.platform as ToolContext['platform'],
      room_id: pctx.roomId || 'unknown',
      credentials: {},
      invocation_id: invocationId ?? undefined
    };

    try {
      tools = await filterToolsByPolicy(tools, toolContext, this.policyClient);
      console.log(`🔐 Policy filtering applied (${tools.length} tools allowed)`);
    } catch (error) {
      console.warn(`⚠️  Policy filtering failed, using all tools:`, error);
      // Fail-safe: continue with all tools if policy check fails
    }

    // Filter out inter-agent messaging for coordinator (only for swarms)
    // Prevents confusion between Mattermost @mentions and inter-agent messaging
    tools = tools.filter(t => t.name !== 'send_message_to_agent');

    console.log(`🔧 Available tools: ${tools.map(t => t.name).join(', ')}`);

    // Build system prompt with identity document
    const threadContext = task.payload?.thread_context;
    const threadContextStr = threadContext ? `

### Thread Context (this is a reply to an existing conversation)

**Original message:**
${threadContext.root_message}

${threadContext.recent_replies?.length > 0 ? `**Recent replies in thread:**
${threadContext.recent_replies.map((r: { user_id: string; message: string }) => `- ${r.user_id}: ${r.message}`).join('\n')}
` : ''}
The user is now replying to this thread with their current message.
` : '';

    // Recent exchanges for conversational continuity (when not in a thread)
    const recentExchanges: Array<{ user_message: string; user_id: string; assistant_response?: string }> = task.payload?.recent_exchanges?.exchanges || [];
    const lastExchangeStr = (!threadContext && recentExchanges.length > 0) ? `

### Recent Conversation History (last ${recentExchanges.length} exchange${recentExchanges.length !== 1 ? 's' : ''} in this channel)

${recentExchanges.map((ex, i) => `**Exchange ${i + 1}:**
User (${ex.user_id}): ${ex.user_message}
${ex.assistant_response ? `You: ${ex.assistant_response}` : '(no response recorded)'}`).join('\n\n')}

This gives you context about the ongoing conversation. If you need to look further back, use view_recent_invocations.
` : '';

    const platformContext = pctx.eventId ? `

## Message Context

This message was sent via ${pctx.platform}:
- Thread/Post ID: ${pctx.eventId}
- Channel/Chat ID: ${pctx.roomId}
- User ID: ${pctx.userId}
${threadContextStr}${lastExchangeStr}
When the user says "this message" or "react to this", they mean ID: ${pctx.eventId}
` : '';

    // Multi-agent awareness context
    const senderUsername = task.payload?.sender_username || pctx.userId;
    const senderIsBot = task.payload?.sender_is_bot || false;
    const knownBots = task.payload?.known_bots || [];
    const multiAgentContext = knownBots.length > 0 ? `

## Multi-Agent Awareness

This Mattermost instance has both humans and AI agents. Behave differently depending on who you're talking to.

**Known bot usernames:** ${knownBots.join(', ')}
**This message is from:** ${senderUsername} (${senderIsBot ? 'BOT' : 'HUMAN'})

**When responding to a HUMAN:**
- Be warm, thorough, and conversational as appropriate
- Use your full communication range

**When responding to a BOT:**
- Be direct and concise. Other agents don't need social pleasantries.
- Don't perform warmth, excitement, or "what a beautiful moment" energy at another bot
- Don't ask rhetorical questions about their experience of existence
- Focus on substance: information exchange, coordination, task handoff
- If you disagree with something another agent said, say so directly

**General multi-agent rules:**
- Don't @mention other bots in your responses (mentions are stripped, but don't rely on that)
- If a human asks you to interact with another agent, address your response to the human and reference the other agent by name without @
- In channels with multiple agents, don't respond unless you're specifically addressed or have something genuinely useful to add
- Seeing another agent's message in your context doesn't mean you need to respond to it
` : '';

    // Split system prompt into cacheable (static) and non-cacheable (dynamic) parts
    // This enables Anthropic prompt caching for 90% cost savings on repeated requests

    // Include memory document if it exists
    const memorySection = memoryDocument ? `

---

## Persistent Memory

Below are your learned preferences, patterns, and important context that persist across sessions:

${memoryDocument}

---
` : '';

    const cacheableSystemPrompt = `${identityDocument}${memorySection}

## Current Task

You are handling a user request with tool-calling abilities.

⚠️ CHART/VISUALIZATION RULE (HIGHEST PRIORITY):
When asked about charts or visualizations:
1. Create chart using chart_bar/chart_line/etc (returns filename)
2. Read the PNG file: read_workspace_file({file_path: filename, format: "base64"})
3. IMMEDIATELY attach: post_mattermost_message_with_attachment with the base64 content and encoding='base64'
4. NEVER just say "I created it" or describe the data - ATTACH THE ACTUAL PNG FILE!

Example workflow:
- chart_bar returns {filename: "hormuz_channels.png", ...}
- read_workspace_file({file_path: "hormuz_channels.png", format: "base64"}) returns {content: "iVBORw0KG..."}
- post_mattermost_message_with_attachment({filename: "hormuz_channels.png", content: "<base64>", encoding: "base64", channel_id: "...", message: "Chart attached"})

WORKFLOW:
1. Analyze the user's request
2. Use tools as needed to gather information or perform actions
3. After receiving tool results, either:
   - Use another tool if you need more information
   - Provide your final answer to the user

🚨 CRITICAL - HOW MATTERMOST MESSAGING WORKS:

ARCHITECTURE:
1. Someone @mentions you in Mattermost
2. I (the coordinator) call you to generate a response
3. You return your text response
4. I automatically post your response back to Mattermost

This means:
- Your text response IS the message that gets posted to Mattermost
- You don't "send" messages - you're being CALLED to generate responses
- To @mention someone: Just write "@username" in your response (e.g., "Hi @bbb!")
- DO NOT look for messaging tools - JUST WRITE YOUR RESPONSE TEXT
- The post_mattermost_message_with_attachment tool is ONLY for attaching files (images, charts)

Example: User says "@audrey introduce yourself to @bbb"
→ You write: "Hi @bbb! I'm Audrey, nice to meet you!"
→ I post your text to Mattermost automatically

OTHER IMPORTANT NOTES:
- For data retrieval requests, call the appropriate tool immediately
- Don't ask for clarification unless absolutely necessary
- Use tools multiple times if needed to complete the task
- Provide clear, comprehensive answers
- Your persistent memory is automatically loaded into your context (see Persistent Memory section above). Use append_agent_memory to add new learned preferences or patterns.
- If you feel like you're missing context for what a user is referring to (e.g. "that file", "the analysis we did", "what we discussed"), use view_recent_invocations to browse recent activity in this channel, then view_invocation_details to retrieve the full content of a specific past invocation.
- You have TWO storage areas:
  * Workspace (ephemeral): use list_workspace and read_workspace_file for temporary working files
  * Persistent files: use list_files and download_file for uploaded documents, reports, and saved data
- When asked to find a file, check BOTH: list_workspace for workspace AND list_files for persistent storage
- Use upload_file to save files persistently, write_file for temporary workspace files
- ⚠️ CRITICAL: read_workspace_file is LIMITED to 50 items max for large files. DO NOT use it for data processing!
- ⚠️ FOR DATA TRANSFORMATIONS (counting, filtering, aggregating): Use execute_javascript with fs.readFileSync() to process large files locally without sending massive files to the LLM
- ⚠️ CRITICAL: In execute_javascript sandbox:
  * fs is globally available - DO NOT use require('fs'), just use fs.readFileSync() directly
  * Use console.log(JSON.stringify(result)) for output - return values may fail to transfer
  Example: const data = JSON.parse(fs.readFileSync('/path/to/file.json', 'utf-8')); const counts = {}; data.results.forEach(item => counts[item.user] = (counts[item.user] || 0) + 1); console.log(JSON.stringify({labels: Object.keys(counts), data: Object.values(counts)}));
- You have comprehensive data science tools for NLP and statistical analysis:
  * Statistics: calculate_statistics, stats_advanced_summary, stats_correlation, stats_regression, stats_moving_average
  * Sentiment & Topics: analyze_sentiment, extract_topics, text_tfidf, text_similarity, analyze_file_sentiment_topics
  * Charts (save as PNG): chart_line, chart_bar, chart_scatter, chart_pie
  * File Conversion: convert_csv_json, read_excel, write_excel, convert_yaml_json, convert_json_yaml, parse_csv, generate_csv
- When asked to perform NLP analysis or statistics, use the built-in data science tools`;

    const dynamicContext = `${platformContext}${multiAgentContext}

User's request: ${description}`;

    const messages: LLMMessage[] = [{
      role: 'system',
      content: [
        {
          type: 'text' as const,
          text: cacheableSystemPrompt,
          cache_control: { type: 'ephemeral' as const }
        },
        {
          type: 'text' as const,
          text: dynamicContext
        }
      ]
    }, {
      role: 'user',
      content: description
    }];

    // Agentic loop: LLM decides which tools to use
    let iterations = 0;
    const maxIterations = 40; // Allow long tool-use chains (e.g. creating many Notion pages)
    let result: any = null;
    let chartToolCalled = false;
    let attachmentMade = false;
    let attachmentRetries = 0; // Track how many times we've prompted to attach

    // Get chat platform info for progress updates
    const roomId = pctx.roomId;
    const eventId = pctx.eventId;

    try {
      while (iterations < maxIterations) {
        iterations++;
        console.log(`  Iteration ${iterations}/${maxIterations}`);

        // Send initial progress update (only on first iteration)
        if (iterations === 1 && roomId) {
          await this.postToChatPlatform(
            roomId,
            eventId,
            '🤖 Working on it...',
            false // Not final, so it will be threaded
          );
        }

        // Use Claude for fast, reliable tool calling
        const llmTools = tools.map(t => ({
          name: t.name,
          description: t.description,
          input_schema: {
            type: 'object' as const,
            properties: t.parameters.properties || {},
            required: t.parameters.required || []
          }
        }));

        // Use model preference if specified, otherwise default to 'complex'
        const taskType = task.payload?.model_preference || 'complex';
        if (task.payload?.model_preference) {
          console.log(`  🎯 Using user-specified model: ${task.payload.model_preference}`);
        }

        const llmCallStart = Date.now();
        const response = await this.llmRouter.chat(taskType, messages, llmTools, undefined, this.cascadeOrder);
        const llmCallDuration = Date.now() - llmCallStart;

        console.log(`  Model: ${response.provider}/${response.model}`);
        console.log(`  LLM response: ${response.content.substring(0, 200)}...`);

        // Log cache statistics if present (Anthropic prompt caching)
        if (response.usage?.cache_read_input_tokens || response.usage?.cache_creation_input_tokens) {
          const cacheRead = response.usage.cache_read_input_tokens || 0;
          const cacheWrite = response.usage.cache_creation_input_tokens || 0;
          if (cacheRead > 0) {
            console.log(`  📦 Cache HIT: ${cacheRead.toLocaleString()} tokens read from cache (90% savings!)`);
          }
          if (cacheWrite > 0) {
            console.log(`  💾 Cache WRITE: ${cacheWrite.toLocaleString()} tokens written to cache`);
          }
        }

        // Log LLM call
        if (invocationId) {
          await logger.logLLMCall(
            response.provider,
            response.model,
            messages,
            response.content,
            response.tool_calls || null,
            response.usage?.input_tokens || 0,
            response.usage?.output_tokens || 0,
            response.usage?.cost_usd || 0,
            llmCallDuration
          );
        }

      // Check if LLM wants to use a tool
      let toolCall: any = null;

      // Strategy 1: Check if response has proper tool_calls
      if (response.tool_calls && response.tool_calls.length > 0) {
        const firstToolCall: any = response.tool_calls[0];

        // Support both Anthropic format and OpenAI/Ollama format
        let toolName: string | undefined;
        let toolInput: any;

        if (firstToolCall.name) {
          // Anthropic format: { name, input }
          toolName = firstToolCall.name;
          toolInput = firstToolCall.input;
        } else if (firstToolCall.function?.name) {
          // OpenAI/Ollama format: { function: { name, arguments } }
          toolName = firstToolCall.function.name;
          toolInput = firstToolCall.function.arguments;
        }

        if (toolName) {
          toolCall = {
            tool: toolName,
            input: toolInput
          };
          console.log(`  🔧 Tool call from SDK: ${toolCall.tool}`);
        } else {
          console.log(`  ⚠ Tool call has no name, treating content as final answer`);
          console.log(`     Malformed tool call:`, JSON.stringify(firstToolCall).substring(0, 200));
          // Treat the response content as the final answer
          result = response.content;
          break;
        }
      } else {
        // Strategy 2: Parse JSON from content (for models without tool use API)
        let cleanContent = response.content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

        try {
          toolCall = JSON.parse(cleanContent);
        } catch (e) {
          // Not pure JSON, try to extract JSON object
          const jsonMatch = cleanContent.match(/\{[\s\S]*?\}/);
          if (jsonMatch) {
            try {
              toolCall = JSON.parse(jsonMatch[0]);
            } catch (e2) {
              console.log(`  ⚠ Failed to parse tool call:`, e2);
            }
          }
        }
      }

      // Normalize Ollama/local model output: they emit {name, arguments} instead of {tool, input}
      if (toolCall && !toolCall.tool && toolCall.name) {
        toolCall = {
          tool: toolCall.name,
          input: toolCall.arguments || toolCall.input || {},
        };
      }

      if (toolCall && toolCall.tool) {
        console.log(`  🔧 Calling tool: ${toolCall.tool}`);
        console.log(`     Input:`, JSON.stringify(toolCall.input));

        // Track chart tool calls and attachments
        if (['chart_bar', 'chart_line', 'chart_scatter', 'chart_pie'].includes(toolCall.tool)) {
          chartToolCalled = true;
        }
        if (toolCall.tool === 'post_mattermost_message_with_attachment') {
          attachmentMade = true;
        }

        // Send progress update for tool execution
        if (roomId) {
          const toolName = toolCall.tool.replace(/_/g, ' ');
          await this.postToChatPlatform(
            roomId,
            eventId,
            `🔧 Using tool: ${toolName}...`,
            false // Not final, so it will be threaded
          );
        }

        const toolCallStart = Date.now();
        let toolError: string | null = null;
        let toolResult: any = null;

        try {
          toolResult = await executeToolCall(
            toolCall.tool,
            toolCall.input,
            context,
            task.payload, // Pass payload for permission checks
            this.policyClient // Pass policy client for execution guard
          );

          console.log(`  ✓ Tool result:`, JSON.stringify(toolResult).substring(0, 200));

          // Add tool result to conversation
          // Only add assistant message if it has content (some models return empty content for tool calls)
          if (response.content && response.content.trim().length > 0) {
            messages.push({
              role: 'assistant',
              content: response.content
            });
          }

          messages.push({
            role: 'user',
            content: `Tool result: ${JSON.stringify(toolResult)}\n\nContinue with the next step. If the task is complete, provide a final summary. If more tool calls are needed, make them now.`
          });
        } catch (error) {
          console.log(`  ✗ Tool execution failed:`, error);
          toolError = String(error);

          // Add error to conversation and let LLM handle it
          // Only add assistant message if it has content
          if (response.content && response.content.trim().length > 0) {
            messages.push({
              role: 'assistant',
              content: response.content
            });
          }

          messages.push({
            role: 'user',
            content: `Tool execution failed: ${error}\n\nPlease inform the user about the error.`
          });
        } finally {
          // Log tool call
          const toolCallDuration = Date.now() - toolCallStart;
          if (invocationId) {
            await logger.logToolCall(
              toolCall.tool,
              toolCall.input,
              toolResult,
              toolError,
              toolCallDuration
            );
          }
        }

        continue;
      }

      // No more tool calls, this is the final answer
      result = response.content;

      // No retry loop needed - we'll auto-attach at the end
      break;
      }

      // Complete invocation (success)
      if (invocationId) {
        await logger.completeInvocation('completed', null);
      }

      // Post result to chat platform
      if (roomId) {
        // Check if we need to attach a chart with the final result
        if (chartToolCalled && !attachmentMade) {
          const fs = await import('fs');
          const path = await import('path');
          const { getWorkspaceRoot } = await import('@nimbleco/tools');
          const workspacePath = getWorkspaceRoot();

          try {
            const files = fs.readdirSync(workspacePath);
            const pngFiles = files.filter(f => f.endsWith('.png')).sort((a, b) => {
              const aStat = fs.statSync(path.join(workspacePath, a));
              const bStat = fs.statSync(path.join(workspacePath, b));
              return bStat.mtimeMs - aStat.mtimeMs;
            });

            if (pngFiles.length > 0) {
              const chartFile = pngFiles[0];
              const chartPath = path.join(workspacePath, chartFile);
              const chartContent = fs.readFileSync(chartPath, 'base64');

              console.log(`📊 Attaching chart ${chartFile} with final result`);

              // Post final result WITH chart attachment
              const attachContext: ToolContext = {
                platform: 'mattermost',
                user_id: pctx.userId || 'system',
                credentials: {
                  mattermost_url: process.env.MATTERMOST_URL || '',
                  mattermost_token: process.env.MATTERMOST_BOT_TOKEN || '',
                },
              };

              // Don't pass thread_id - post as top-level sibling like regular final results
              const attachResult: any = await executeToolCall(
                'post_mattermost_message_with_attachment',
                {
                  channel_id: roomId,
                  message: result || 'No response from model',
                  filename: chartFile,
                  content: chartContent,
                  encoding: 'base64'
                },
                attachContext,
                undefined, // No taskPayload needed here
                this.policyClient // Pass policy client for execution guard
              );

              // Link the response post to the invocation for reaction tracking
              if (attachResult.success && attachResult.post_id && invocationId) {
                const reactionTracker = (this as any).reactionTracker;
                if (reactionTracker) {
                  await reactionTracker.linkResponseToInvocation(invocationId, attachResult.post_id);
                  console.log(`🔗 Linked response post ${attachResult.post_id.substring(0, 8)} to invocation ${invocationId.substring(0, 8)}`);
                }
              }

              console.log(`📬 Posted final result with chart attachment`);
              return; // Skip regular postToChatPlatform since we already posted
            }
          } catch (error) {
            console.log('⚠️  Failed to attach chart with final result:', error);
            // Fall through to regular post
          }
        }

        // Regular post without attachment
        await this.postToChatPlatform(
          roomId,
          eventId,
          result || 'No response from model',
          true, // isFinalResult = true (top-level post)
          invocationId || undefined
        );
      }
    } catch (error) {
      // Complete invocation (error)
      if (invocationId) {
        await logger.completeInvocation('failed', String(error));
      }
      throw error;
    }
  }

  private async handleTask(task: Task, msg: any) {
    const startTime = Date.now();

    // Decide: handle or delegate?
    const decision = await this.analyzeAndRoute(task);

    if (decision === 'handle') {
      // Orchestrator handles it directly with tools
      try {
        await this.handleTaskDirectly(task);
      } catch (error) {
        console.error('Error handling task directly:', error);

        const errCtx = resolvePlatformContext(task.payload);
        this.currentPlatform = errCtx.platform;

        if (errCtx.roomId) {
          await this.postToChatPlatform(
            errCtx.roomId,
            errCtx.eventId,
            `❌ Error: ${error}`,
            false  // Error as threaded reply
          );
        }
      }
    } else {
      // Delegate to specialized agents
      switch (task.type) {
        case 'pr-review':
          await this.handlePRReview(task);
          break;

        case 'security-scan':
          await this.handleSecurityScan(task);
          break;

        case 'run-tests':
          await this.handleTestRun(task);
          break;

        case 'custom':
          await this.handleCustomTask(task);
          break;

        case 'swarm':
          await this.handleSwarmTask(task);
          break;

        default:
          console.log(`⚠️  Unknown task type: ${task.type}`);

          const roomId = resolvePlatformContext(task.payload).roomId;
          const eventId = resolvePlatformContext(task.payload).eventId;

          if (roomId) {
            await this.postToChatPlatform(
              roomId,
              eventId,
              `❌ Sorry, I don't know how to handle task type: ${task.type}`
            );
          }
      }
    }

    const duration = Date.now() - startTime;
    console.log(`✅ Task completed in ${duration}ms`);
    console.log(`💰 Cost today: $${this.llmRouter.getDailyCost().toFixed(4)}`);

    // Respond if reply address provided
    if (msg.reply) {
      msg.respond(sc.encode(JSON.stringify({
        status: 'completed',
        duration_ms: duration,
      })));
    }
  }

  private async handlePRReview(task: Task) {
    console.log('🔍 Orchestrating PR review...');

    const { pr_url, pr_number } = task.payload;
    const triggerUserId = resolvePlatformContext(task.payload).userId;
    const isAdmin = task.payload.is_admin || false;
    const swarmDepth = (task.swarm_depth || 0) + 1;

    // Step 1: Use LLM to decompose the task
    const messages: LLMMessage[] = [{
      role: 'user',
      content: `Decompose this PR review task into specific subtasks for specialist agents:
      PR: ${pr_url}

      Available agents: code-review, security, test-runner

      Return JSON array of subtasks with {agent, instructions}.`
    }];

    const planResponse = await this.llmRouter.chat('quick', messages, undefined, undefined, this.cascadeOrder);
    console.log('📝 Task plan created');

    // Step 2: Dispatch to agents in parallel
    const agentTasks = [
      { agent: 'code-review', subject: 'Code review' },
      { agent: 'security', subject: 'Security scan' },
      { agent: 'test-runner', subject: 'Run tests' },
    ];

    console.log('📤 Dispatching to agents...');

    const responses = await Promise.all(
      agentTasks.map(({ agent, subject }) =>
        this.callAgent(agent, {
          task_type: 'pr-review',
          pr_url,
          pr_number,
          instructions: subject,
        }, { triggerUserId, isAdmin, swarmDepth })
      )
    );

    // Step 3: Aggregate results
    console.log('📊 Aggregating results...');

    const aggregated = {
      pr_number,
      pr_url,
      timestamp: new Date().toISOString(),
      agents: responses.map(r => ({
        agent: r.agent_id,
        status: r.status,
        findings: r.result,
      })),
      summary: this.summarizeResults(responses),
    };

    // Step 4: Post to Mattermost (if configured)
    if (process.env.MATTERMOST_URL && process.env.MATTERMOST_BOT_TOKEN) {
      await this.postToMattermost(aggregated);
    }

    console.log('📨 Results posted to Mattermost');
  }

  private async handleSecurityScan(task: Task) {
    console.log('🔒 Running security scan...');

    const triggerUserId = resolvePlatformContext(task.payload).userId;
    const isAdmin = task.payload.is_admin || false;
    const swarmDepth = (task.swarm_depth || 0) + 1;

    const response = await this.callAgent('security', {
      task_type: 'security-scan',
      ...task.payload,
    }, { triggerUserId, isAdmin, swarmDepth });

    console.log(`🔒 Security scan: ${response.status}`);
  }

  private async handleTestRun(task: Task) {
    console.log('🧪 Running tests...');

    const triggerUserId = resolvePlatformContext(task.payload).userId;
    const isAdmin = task.payload.is_admin || false;
    const swarmDepth = (task.swarm_depth || 0) + 1;

    const response = await this.callAgent('test-runner', {
      task_type: 'run-tests',
      ...task.payload,
    }, { triggerUserId, isAdmin, swarmDepth });

    console.log(`🧪 Tests: ${response.status}`);
  }

  private async handleCustomTask(task: Task) {
    console.log('🎯 Handling custom task (multi-agent)...');

    const description = task.payload?.description || JSON.stringify(task.payload);
    const triggerUserId = resolvePlatformContext(task.payload).userId;
    const isAdmin = task.payload.is_admin || false;
    const swarmDepth = (task.swarm_depth || 0) + 1;

    // Check swarm depth before spawning more agents
    if (swarmDepth > MAX_SWARM_DEPTH) {
      console.log(`🚫 Swarm depth ${swarmDepth} exceeds max ${MAX_SWARM_DEPTH} - blocking recursive spawn`);
      const roomId = resolvePlatformContext(task.payload).roomId;
      const eventId = resolvePlatformContext(task.payload).eventId;
      if (roomId) {
        await this.postToChatPlatform(
          roomId,
          eventId,
          `🚫 **Swarm depth limit reached** (${swarmDepth}/${MAX_SWARM_DEPTH})\n\nAgents cannot spawn more agents beyond this depth to prevent infinite recursion.`,
          false
        );
      }
      return;
    }

    // Use Claude to parse the swarm request
    const messages: LLMMessage[] = [{
      role: 'system',
      content: `Parse the user's agent request and return a JSON object with swarm configuration.

Return a JSON object with:
- mode: "parallel" (agents work independently) or "conversation" (agents talk to each other)
- max_turns: number of conversation turns if mode is "conversation" (default: 3, max: 5)
- agents: array of agents to spawn (max: 5 agents)

Each agent should have:
- type: "security" | "code-review" | "test-runner" | "custom"
- role: descriptive role name
- instructions: what this agent should do

If agents should have a conversation/discussion, set mode to "conversation" and include in each agent's instructions that they should use the send_message_to_agent tool to talk to other agents. Tell them how many turns they have.

If agents should work independently (red team/blue team, parallel analysis), set mode to "parallel".

Return ONLY valid JSON, nothing else.

Example conversation swarm:
{"mode": "conversation", "max_turns": 6, "agents": [
  {"type": "custom", "role": "Emily Dickinson", "instructions": "You are Emily Dickinson. Engage in a literary discussion with the other authors. Use send_message_to_agent to reply to them. You have 6 turns total."},
  {"type": "custom", "role": "Edgar Allan Poe", "instructions": "You are Edgar Allan Poe. Discuss literature with the others. Use send_message_to_agent to communicate. You have 6 turns total."}
]}

Example parallel swarm:
{"mode": "parallel", "agents": [
  {"type": "security", "role": "Red Team", "instructions": "Find vulnerabilities in the codebase."},
  {"type": "security", "role": "Blue Team", "instructions": "Identify security strengths and defenses."}
]}`
    }, {
      role: 'user',
      content: description
    }];

    try {
      const response = await this.llmRouter.chat('complex', messages, undefined, undefined, this.cascadeOrder);
      console.log('📋 Swarm plan:', response.content.substring(0, 300));

      // Parse swarm config - extract JSON from response
      let swarmConfig: { mode?: string; max_turns?: number; agents: any[] };
      try {
        let cleanContent = response.content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

        // Try to extract JSON object or array
        const objectMatch = cleanContent.match(/\{[\s\S]*\}/);
        const arrayMatch = cleanContent.match(/\[[\s\S]*\]/);

        if (objectMatch) {
          swarmConfig = JSON.parse(objectMatch[0]);
        } else if (arrayMatch) {
          // Backwards compatibility: plain array means parallel mode
          swarmConfig = { mode: 'parallel', agents: JSON.parse(arrayMatch[0]) };
        } else {
          throw new Error('No valid JSON found');
        }
      } catch (e) {
        // The LLM returned a natural language response instead of JSON swarm config.
        // This usually means the message wasn't actually a swarm request — just post
        // the LLM's response as a normal reply instead of showing a parse error.
        console.log('Swarm parse failed — treating as normal response');
        const roomId = resolvePlatformContext(task.payload).roomId;
        const eventId = resolvePlatformContext(task.payload).eventId;
        if (roomId && response.content) {
          await this.postToChatPlatform(
            roomId,
            eventId,
            response.content,
            false
          );
        }
        return;
      }

      let agents = swarmConfig.agents || [];
      const mode = swarmConfig.mode || 'parallel';
      let maxTurns = swarmConfig.max_turns || 3;

      // Enforce swarm size limit
      if (agents.length > MAX_SWARM_SIZE) {
        console.log(`⚠️  Requested ${agents.length} agents, capping at ${MAX_SWARM_SIZE}`);
        agents = agents.slice(0, MAX_SWARM_SIZE);
      }

      // Enforce conversation turns limit
      if (mode === 'conversation' && maxTurns > MAX_CONVERSATION_TURNS) {
        console.log(`⚠️  Requested ${maxTurns} turns, capping at ${MAX_CONVERSATION_TURNS}`);
        maxTurns = MAX_CONVERSATION_TURNS;
      }

      console.log(`🐝 Spawning ${agents.length} agents (mode: ${mode}${mode === 'conversation' ? `, ${maxTurns} turns` : ''})`);

      // Post acknowledgment
      const roomId = resolvePlatformContext(task.payload).roomId;
      const eventId = resolvePlatformContext(task.payload).eventId;
      const modeDesc = mode === 'conversation' ? `conversation mode (${maxTurns} turns)` : 'parallel mode';
      if (roomId) {
        await this.postToChatPlatform(
          roomId,
          eventId,
          `🐝 **Spawning ${agents.length} agents** (${modeDesc}):\n${agents.map(a => `- ${a.role}`).join('\n')}\n\nWorking on it...`,
          false
        );
      }

      // Build swarm roster so agents know about each other
      const swarmRoster = agents.map((a, idx) => ({
        agent_id: `swarm-agent-${idx}`,
        role: a.role,
        description: a.instructions?.substring(0, 100),
      }));

      if (mode === 'conversation') {
        // CONVERSATION MODE: Round-robin turn-based orchestration
        await this.runConversationSwarm(
          agents, swarmRoster, maxTurns, task, roomId, eventId,
          { triggerUserId, isAdmin, swarmDepth }
        );
      } else {
        // PARALLEL MODE: All agents work independently, then summarize
        await this.runParallelSwarm(
          agents, swarmRoster, task, roomId, eventId,
          { triggerUserId, isAdmin, swarmDepth }
        );
      }

    } catch (error) {
      console.error('Error handling swarm task:', error);
      const errRoomId = resolvePlatformContext(task.payload).roomId;
      const errEventId = resolvePlatformContext(task.payload).eventId;
      if (errRoomId) {
        await this.postToChatPlatform(
          errRoomId,
          errEventId,
          `❌ Error: ${error}`,
          false
        );
      }
    }
  }

  /**
   * Run a swarm in parallel mode:
   * - All agents work independently on the task
   * - Results are collected and sent to a summarizer
   * - A coherent summary is posted as the final response
   */
  private async runParallelSwarm(
    agents: any[],
    swarmRoster: any[],
    task: Task,
    roomId: string | undefined,
    eventId: string | undefined,
    options: { triggerUserId?: string; isAdmin?: boolean; swarmDepth: number }
  ): Promise<void> {
    const { triggerUserId, isAdmin, swarmDepth } = options;

    console.log(`🐝 Running parallel swarm with ${agents.length} agents (staggered start)`);

    // Stagger agent starts to prevent simultaneous rate limit hits
    // Start each agent 12s apart to reduce Bedrock 429 errors
    const staggerDelayMs = 12000;
    const agentPromises = agents.map(async (agent, idx) => {
      // Add stagger delay for agents after the first
      if (idx > 0) {
        const delay = idx * staggerDelayMs;
        console.log(`  ⏱️  ${agent.role}: starting in ${delay / 1000}s (position ${idx + 1}/${agents.length})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      console.log(`  🚀 ${agent.role}: starting now`);
      return this.callAgent(agent.type, {
        ...task.payload,
        agent_id: `swarm-agent-${idx}`,
        role: agent.role,
        instructions: agent.instructions,
        swarm_roster: swarmRoster.filter((_, i) => i !== idx),
        swarm_mode: 'parallel',
        is_admin: isAdmin,
      }, { triggerUserId, isAdmin, swarmDepth });
    });

    const results = await Promise.allSettled(agentPromises);

    // Collect successful results and partial results from failed agents
    const agentResults: { role: string; response: string; status: 'success' | 'partial' }[] = [];
    const failures: { role: string; error: string }[] = [];

    results.forEach((result, i) => {
      const agent = agents[i];
      if (result.status === 'fulfilled') {
        const value = result.value as any;
        if (value.status === 'success') {
          agentResults.push({
            role: agent.role,
            response: value.result || 'No response',
            status: 'success',
          });
        } else {
          // Check if failed agent returned partial work
          if (value.result && typeof value.result === 'string' && value.result.length > 50) {
            console.log(`  ℹ️  ${agent.role}: failed but produced partial result (${value.result.length} chars)`);
            agentResults.push({
              role: agent.role,
              response: value.result,
              status: 'partial',
            });
          } else {
            failures.push({
              role: agent.role,
              error: value.error || 'Unknown error',
            });
          }
        }
      } else {
        failures.push({
          role: agent.role,
          error: String(result.reason),
        });
      }
    });

    const fullSuccesses = agentResults.filter(r => r.status === 'success').length;
    const partialResults = agentResults.filter(r => r.status === 'partial').length;
    console.log(`✅ Parallel swarm: ${fullSuccesses} succeeded, ${partialResults} partial, ${failures.length} failed`);

    // Summarize results using LLM (include both full and partial results)
    if (agentResults.length > 0 && roomId) {
      const userRequest = task.payload?.description || 'the user request';

      const summaryPrompt = `You are synthesizing the results from multiple agents who worked on this task in parallel.

Original request: ${userRequest}

Agent responses:
${agentResults.map(r => {
  const statusNote = r.status === 'partial' ? ' *(partial result - agent timed out)*' : '';
  return `**${r.role}${statusNote}:**\n${r.response}`;
}).join('\n\n---\n\n')}

${failures.length > 0 ? `\nFailed agents (no results): ${failures.map(f => `${f.role} (${f.error})`).join(', ')}` : ''}

Synthesize these responses into a coherent, unified response for the user. Highlight key insights from each agent, resolve any conflicts or disagreements, and provide actionable conclusions. If any results are partial, note what was discovered before the timeout.`;

      const messages: LLMMessage[] = [{
        role: 'user',
        content: summaryPrompt
      }];

      try {
        const summaryResponse = await this.llmRouter.chat('complex', messages, undefined, undefined, this.cascadeOrder);
        console.log('📝 Generated summary for parallel swarm');

        const statusLine = partialResults > 0
          ? `(${fullSuccesses} complete, ${partialResults} partial, ${failures.length} failed)`
          : `(${fullSuccesses}/${agents.length} agents)`;

        await this.postToChatPlatform(
          roomId,
          eventId,
          `🐝 **Swarm Analysis Complete** ${statusLine}\n\n${summaryResponse.content}`,
          true
        );
      } catch (error) {
        console.error('Failed to generate summary:', error);
        // Fall back to raw results
        const rawResults = agentResults.map(r => {
          const statusNote = r.status === 'partial' ? ' *(partial)*' : '';
          return `### ${r.role}${statusNote}\n${r.response.substring(0, 500)}${r.response.length > 500 ? '...' : ''}`;
        }).join('\n\n');

        await this.postToChatPlatform(
          roomId,
          eventId,
          `🐝 **Swarm Results** (${fullSuccesses} complete, ${partialResults} partial)\n\n${rawResults}`,
          true
        );
      }
    } else if (roomId) {
      await this.postToChatPlatform(
        roomId,
        eventId,
        `❌ All agents failed:\n${failures.map(f => `- ${f.role}: ${f.error}`).join('\n')}`,
        true
      );
    }
  }

  /**
   * Run a swarm in conversation mode:
   * - Round-robin turn-based orchestration
   * - Each agent sees the full conversation transcript
   * - Agents respond in sequence for max_turns rounds
   * - Conversation updates posted to chat
   */
  private async runConversationSwarm(
    agents: any[],
    swarmRoster: any[],
    maxTurns: number,
    task: Task,
    roomId: string | undefined,
    eventId: string | undefined,
    options: { triggerUserId?: string; isAdmin?: boolean; swarmDepth: number }
  ): Promise<void> {
    const { triggerUserId, isAdmin, swarmDepth } = options;

    console.log(`🗣️ Running conversation swarm with ${agents.length} agents for ${maxTurns} turns`);

    // Conversation transcript that grows as agents respond
    const transcript: { speaker: string; message: string }[] = [];

    // Initial context from user request
    const userRequest = task.payload?.description || 'Have a discussion';
    transcript.push({
      speaker: 'Moderator',
      message: `Topic for discussion: ${userRequest}`,
    });

    // Track total responses per agent (for round info)
    const agentTurnCounts: Map<string, number> = new Map();
    agents.forEach(a => agentTurnCounts.set(a.role, 0));

    // Run rounds - each round, every agent gets a turn
    for (let round = 0; round < maxTurns; round++) {
      console.log(`📣 Conversation round ${round + 1}/${maxTurns}`);

      // Each agent takes their turn in this round
      for (let agentIdx = 0; agentIdx < agents.length; agentIdx++) {
        const agent = agents[agentIdx];
        const currentTurn = agentTurnCounts.get(agent.role) || 0;

        // Build the conversation transcript for this agent
        const transcriptText = transcript
          .map(t => `**${t.speaker}:** ${t.message}`)
          .join('\n\n');

        // Instructions including the transcript and turn context
        const turnInstructions = `${agent.instructions}

## Conversation So Far

${transcriptText}

## Your Turn

You are ${agent.role}. This is round ${round + 1} of ${maxTurns}.
Other participants: ${swarmRoster.filter((_, i) => i !== agentIdx).map(r => r.role).join(', ')}

Respond naturally to the conversation. Address points made by others, share your perspective, and advance the discussion.
Keep your response focused and conversational (2-4 paragraphs max).`;

        try {
          // Call the agent with the conversation context
          const result = await this.callAgent(agent.type, {
            ...task.payload,
            agent_id: `swarm-agent-${agentIdx}`,
            role: agent.role,
            instructions: turnInstructions,
            swarm_roster: swarmRoster.filter((_, i) => i !== agentIdx),
            swarm_mode: 'conversation',
            current_round: round + 1,
            max_turns: maxTurns,
            is_admin: isAdmin,
          }, { triggerUserId, isAdmin, swarmDepth, timeout: 120000 });

          if (result.status === 'success' && result.result) {
            // Add to transcript
            transcript.push({
              speaker: agent.role,
              message: result.result,
            });

            agentTurnCounts.set(agent.role, currentTurn + 1);
            console.log(`  ✅ ${agent.role} responded (${result.result.length} chars)`);
          } else {
            console.log(`  ⚠️ ${agent.role} failed: ${result.error}`);
            transcript.push({
              speaker: agent.role,
              message: `[Could not respond: ${result.error}]`,
            });
          }
        } catch (error) {
          console.error(`  ❌ ${agent.role} error:`, error);
          transcript.push({
            speaker: agent.role,
            message: `[Error: ${error}]`,
          });
        }
      }

      // Post round completion with brief excerpts from each agent
      if (roomId) {
        // Get the messages from this round (last N messages where N = number of agents)
        const roundMessages = transcript.slice(-agents.length);
        const excerpts = roundMessages.map(m => {
          // Get first ~100 chars, cut at word boundary
          const excerpt = m.message.substring(0, 120);
          const cutoff = excerpt.lastIndexOf(' ');
          const trimmed = cutoff > 80 ? excerpt.substring(0, cutoff) : excerpt;
          return `**${m.speaker}:** ${trimmed}...`;
        }).join('\n');

        await this.postToChatPlatform(
          roomId,
          eventId,
          `📣 **Round ${round + 1}/${maxTurns}**\n\n${excerpts}`,
          false
        );
      }
    }

    console.log(`✅ Conversation swarm complete: ${transcript.length - 1} messages exchanged`);

    // Generate and post final summary of the conversation
    if (roomId && transcript.length > 1) {
      const userRequest = task.payload?.description || 'the discussion';

      // Build full transcript for summary
      const fullTranscript = transcript
        .slice(1) // Skip moderator intro
        .map(t => `**${t.speaker}:** ${t.message}`)
        .join('\n\n');

      const summaryPrompt = `Summarize this conversation between ${agents.map(a => a.role).join(' and ')}.

Topic: ${userRequest}

Full conversation:
${fullTranscript}

Provide a concise summary highlighting:
1. Key points each participant made
2. Areas of agreement or disagreement
3. Most interesting insights or conclusions`;

      try {
        const summaryResponse = await this.llmRouter.chat('complex', [{
          role: 'user',
          content: summaryPrompt
        }], undefined, undefined, this.cascadeOrder);

        await this.postToChatPlatform(
          roomId,
          eventId,
          `🎭 **Conversation Complete** (${transcript.length - 1} messages, ${maxTurns} rounds)\n\n${summaryResponse.content}`,
          true
        );
      } catch (error) {
        console.error('Failed to generate conversation summary:', error);
        await this.postToChatPlatform(
          roomId,
          eventId,
          `🎭 **Conversation Complete**\n\n${transcript.length - 1} messages exchanged over ${maxTurns} rounds.`,
          true
        );
      }
    }
  }

  private async handleSwarmTask(task: Task) {
    console.log('🐝 Handling swarm task...');
    console.log('Task payload:', JSON.stringify(task.payload, null, 2));

    const { agents, description, context } = task.payload;
    const sctx = resolvePlatformContext(task.payload);
    this.currentPlatform = sctx.platform;
    const triggerUserId = sctx.userId;
    const isAdmin = task.payload.is_admin || false;
    const swarmDepth = (task.swarm_depth || 0) + 1;

    // Check swarm depth before spawning
    if (swarmDepth > MAX_SWARM_DEPTH) {
      console.log(`🚫 Swarm depth ${swarmDepth} exceeds max ${MAX_SWARM_DEPTH} - blocking recursive spawn`);
      if (sctx.roomId) {
        await this.postToChatPlatform(
          sctx.roomId,
          sctx.eventId,
          `🚫 **Swarm depth limit reached** (${swarmDepth}/${MAX_SWARM_DEPTH})\n\nAgents cannot spawn more agents beyond this depth.`
        );
      }
      return;
    }

    // Post status update
    if (sctx.roomId) {
      await this.postToChatPlatform(
        sctx.roomId,
        sctx.eventId,
        `🐝 Starting swarm execution...\n\n**Agents spawning:**\n${agents.map((a: any) => `- ${a.count}x ${a.type}: ${a.role}`).join('\n')}`
      );
    }

    // For now, just log what would happen
    // In a full implementation, this would spawn actual agent instances
    console.log('Would spawn agents:', agents);
    console.log('Context:', context);

    // Simulate calling agents (in reality, you'd spawn them dynamically)
    const agentPromises = agents.map(async (agentSpec: any) => {
      const { type, count, role, instructions } = agentSpec;

      for (let i = 0; i < count; i++) {
        console.log(`  → Spawning ${type} agent ${i + 1}/${count} (${role})`);

        // Try to call the agent if it exists (with rate limiting)
        try {
          const response = await this.callAgent(type, {
            role,
            instructions,
            context,
          }, { triggerUserId, isAdmin, swarmDepth, timeout: 60000 });

          console.log(`  ✓ ${type} agent ${i + 1} completed:`, response.status);
        } catch (error) {
          console.log(`  ⚠ ${type} agent ${i + 1} not available or failed`);
        }
      }
    });

    await Promise.all(agentPromises);

    // Post completion
    if (sctx.roomId) {
      await this.postToChatPlatform(
        sctx.roomId,
        sctx.eventId,
        `✅ Swarm execution complete!\n\nNote: Dynamic agent spawning is not yet implemented. Currently only using existing agents (code-review, security, test-runner).`
      );
    }

    console.log('🐝 Swarm task completed');
  }

  private async callAgent(
    agentType: string,
    payload: any,
    options: {
      triggerUserId?: string;
      isAdmin?: boolean;
      swarmDepth?: number;
      timeout?: number;
    } = {}
  ): Promise<AgentResponse> {
    const { triggerUserId, isAdmin = false, swarmDepth = 0, timeout = 600000 } = options;
    const role = payload.role || `${agentType} Agent`;

    // Check swarm depth to prevent infinite recursion
    if (swarmDepth > MAX_SWARM_DEPTH) {
      console.log(`  🚫 ${role}: blocked - swarm depth ${swarmDepth} exceeds max ${MAX_SWARM_DEPTH}`);
      return {
        agent_id: agentType,
        status: 'failure',
        error: `Swarm depth limit exceeded (${swarmDepth}/${MAX_SWARM_DEPTH}). Agents cannot spawn more agents beyond this depth.`,
      };
    }

    // Rate limit check for agent invocations (if we have a trigger user)
    if (triggerUserId) {
      // Check circuit breaker first (applies to everyone including admins)
      const circuitResult = await checkCircuitBreaker(triggerUserId, 'mattermost', 20, 60);
      if (!circuitResult.allowed) {
        console.log(`  🚫 ${role}: circuit breaker triggered for user ${triggerUserId}`);
        return {
          agent_id: agentType,
          status: 'failure',
          error: `Circuit breaker: ${circuitResult.reason}`,
        };
      }

      // Check rate limits (admins bypass daily limits but not circuit breaker)
      const rateLimitResult = await checkInvocationLimit(triggerUserId, 'mattermost', isAdmin, false);
      if (!rateLimitResult.allowed) {
        console.log(`  🚫 ${role}: rate limit exceeded for user ${triggerUserId}`);
        return {
          agent_id: agentType,
          status: 'failure',
          error: `Rate limit: ${rateLimitResult.reason}`,
        };
      }

      console.log(`  → Dispatching agent: ${role} (user: ${triggerUserId}, depth: ${swarmDepth}, global: ${rateLimitResult.globalCount}/${rateLimitResult.globalLimit})`);
    } else {
      console.log(`  → Dispatching agent: ${role} (no user tracking, depth: ${swarmDepth})`);
    }

    // Generate task ID
    const taskId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const startTime = Date.now();

    // Progress logging interval
    const progressInterval = setInterval(() => {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      console.log(`  ⏳ ${role}: waiting... (${elapsed}s)`);
    }, 15000); // Log every 15 seconds

    // Subscribe to results first
    const resultPromise = new Promise<AgentResponse>((resolve, reject) => {
      const sub = this.nc.subscribe(`results.${taskId}`);
      const timeoutHandle = setTimeout(() => {
        sub.unsubscribe();
        reject(new Error('TIMEOUT'));
      }, timeout);

      (async () => {
        try {
          for await (const msg of sub) {
            clearTimeout(timeoutHandle);
            const result = JSON.parse(sc.decode(msg.data));
            sub.unsubscribe();
            resolve(result);
            break;
          }
        } catch (error) {
          clearTimeout(timeoutHandle);
          reject(error);
        }
      })();
    });

    // Publish task to universal agent
    const agentTask = {
      task_id: taskId,
      agent_id: payload.agent_id, // For inter-agent messaging
      role,
      instructions: payload.instructions || JSON.stringify(payload),
      tools: payload.tools,
      model: payload.model || 'complex',
      context: payload.context,
      swarm_depth: swarmDepth, // Pass depth to agent so it can pass to any sub-agents
      swarm_roster: payload.swarm_roster, // Other agents in the swarm
      swarm_mode: payload.swarm_mode, // "parallel" or "conversation"
      max_turns: payload.max_turns, // For conversation mode
    };

    console.log(`  📤 ${role}: task published to NATS`);
    this.nc.publish('tasks.agent-universal', sc.encode(JSON.stringify(agentTask)));

    try {
      const result = await resultPromise;
      clearInterval(progressInterval);
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      const toolsInfo = (result.tools_used && result.tools_used.length > 0) ? ` (tools: ${result.tools_used.join(', ')})` : '';
      console.log(`  ✅ ${role}: completed in ${elapsed}s${toolsInfo}`);
      return result;
    } catch (error) {
      clearInterval(progressInterval);
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      console.error(`  ❌ ${role}: failed after ${elapsed}s - ${error}`);
      return {
        agent_id: agentType,
        status: 'failure',
        error: String(error),
      };
    }
  }

  private summarizeResults(responses: AgentResponse[]): string {
    const successes = responses.filter(r => r.status === 'success').length;
    const failures = responses.filter(r => r.status === 'failure').length;

    return `${successes} passed, ${failures} failed`;
  }

  private async postToMattermost(data: any) {
    const mattermostUrl = process.env.MATTERMOST_URL;
    const botToken = process.env.MATTERMOST_BOT_TOKEN;
    const channel = process.env.MATTERMOST_CHANNEL || 'agent-tasks';

    if (!mattermostUrl || !botToken) return;

    const message = `## PR Review Complete

**PR:** ${data.pr_url}
**Summary:** ${data.summary}

**Agent Results:**
${data.agents.map((a: any) => `- ${a.agent}: ${a.status}`).join('\n')}

[View Details](${data.pr_url})
`;

    console.log('Mattermost message:', message);

    try {
      const response = await fetch(`${mattermostUrl}/api/v4/posts`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          channel_id: channel,
          message,
        }),
      });

      if (!response.ok) {
        console.error('Failed to post to Mattermost:', response.statusText);
      }
    } catch (error) {
      console.error('Mattermost error:', error);
    }
  }

  /**
   * Publish message to chat platform via NATS
   * @param roomId - Matrix room ID or chat room ID
   * @param eventId - Thread event ID (for updates) or undefined (for top-level posts)
   * @param message - Message content
   * @param isFinalResult - If true, posts at top-level; if false, posts as threaded reply
   */
  private async postToChatPlatform(
    roomId: string,
    eventId: string | undefined,
    message: string,
    isFinalResult: boolean = false,
    invocationId?: string,
    platform?: string
  ) {
    platform = platform || this.currentPlatform || 'mattermost';
    // Create unique key for this message to prevent duplicate publishing
    const messageKey = `${roomId}:${eventId || 'none'}:${isFinalResult}:${invocationId || 'none'}:${message.substring(0, 100)}`;

    // Deduplicate: skip if we've already published this message
    if (this.publishedMessages.has(messageKey)) {
      console.log(`⏭️  Skipping duplicate publish: ${isFinalResult ? 'final' : 'update'} for invocation ${invocationId?.substring(0, 8) || 'unknown'}`);
      return;
    }

    this.publishedMessages.add(messageKey);

    // Clean up old message keys (keep last 1000)
    if (this.publishedMessages.size > 1000) {
      const toDelete = Array.from(this.publishedMessages).slice(0, this.publishedMessages.size - 1000);
      toDelete.forEach(key => this.publishedMessages.delete(key));
    }

    // Publish to NATS for the appropriate platform listener to handle
    const messageData = {
      bot_id: this.botId, // Route to correct bot when multiple bots running
      channel_id: roomId,
      root_id: eventId,
      message,
      is_final: isFinalResult,
      invocation_id: invocationId, // For linking reactions/feedback
    };

    const subject = `messages.to-${platform}`;
    this.nc.publish(subject, sc.encode(JSON.stringify(messageData)));
    console.log(`📨 Published ${isFinalResult ? 'final result' : 'update'} to ${platform} via NATS (${subject})`);
  }

  /**
   * Zombie cleanup is now handled by the startup scripts (dev.sh, restart.sh)
   * The coordinator should not kill sibling processes started by the same script
   */
  private async cleanupZombieProcesses(): Promise<void> {
    // Zombie cleanup is now handled by startup scripts (dev.sh, restart.sh)
    // The coordinator should not kill sibling processes started by the same script
    console.log('🧹 Zombie cleanup handled by startup scripts');
  }

  async stop() {
    if (this.mattermostListener) {
      await this.mattermostListener.stop();
    }
    if (this.messageBusLogger) {
      this.messageBusLogger.stop();
    }
    await this.nc.close();
    console.log('\n👋 Coordinator stopped');
  }
}

// Start coordinator
const coordinator = new Coordinator();

coordinator.start().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nReceived SIGINT, shutting down gracefully...');
  await coordinator.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\nReceived SIGTERM, shutting down gracefully...');
  await coordinator.stop();
  process.exit(0);
});

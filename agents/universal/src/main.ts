#!/usr/bin/env node
/**
 * Universal Agent
 *
 * A role-agnostic agent that can:
 * - Assume any role via system prompt
 * - Use any subset of tools
 * - Run on any model (Claude, GPT, Mistral, etc.)
 * - Handle any task type (code review, security analysis, research, etc.)
 *
 * This replaces all specialized agent types with a single universal implementation.
 */

import { connect, NatsConnection, StringCodec } from 'nats';
import { LLMRouter, LLMMessage, createLLM } from '@nimbleco/llm-adapters';
import {
  registry as toolRegistry,
  executeToolCall,
  getToolsForTask,
  ToolContext,
  setNatsConnection,
  Tool,
} from '@nimbleco/tools';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load env from project root
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const sc = StringCodec();

interface AgentTask {
  task_id: string;
  role: string;
  instructions: string;
  tools?: string[]; // Tool names, or undefined for auto-selection
  model?: 'quick' | 'code' | 'complex';
  context?: any; // Task-specific context (repo, PR, files, etc.)
  mattermost_channel?: string;
  mattermost_thread?: string;
  swarm_roster?: SwarmAgent[]; // Other agents in the swarm
  swarm_mode?: string; // e.g. 'conversation' — affects tool use and iteration limits
  max_turns?: number; // Max conversation turns for swarm interactions
}

interface SwarmAgent {
  agent_id: string;
  role: string;
  description?: string;
}

export class UniversalAgent {
  private nc!: NatsConnection;
  private llmRouter!: LLMRouter;
  private agentId: string;

  constructor(agentId: string = `universal-${Math.random().toString(36).substring(7)}`) {
    this.agentId = agentId;
  }

  async start() {
    console.log(`\n🤖 Universal Agent: ${this.agentId}`);
    console.log('━'.repeat(50));

    // Initialize LLM router
    const dailyLimit = parseFloat(process.env.LLM_DAILY_COST_LIMIT || '10');
    this.llmRouter = new LLMRouter(dailyLimit);

    // Register LLM providers
    // Priority order: Bedrock (if configured) > Anthropic > Vertex > Ollama

    // Local Ollama (free!)
    if (process.env.OLLAMA_URL) {
      const quickModel = process.env.LLM_MODEL_QUICK || 'mistral:7b';
      const codeModel = process.env.LLM_MODEL_CODE || 'qwen2.5-coder:32b';
      console.log(`🔧 Ollama: ${quickModel} (quick), ${codeModel} (code)`);

      this.llmRouter.register('ollama-quick', createLLM('ollama', quickModel, {
        baseUrl: process.env.OLLAMA_URL,
      }));
      this.llmRouter.register('ollama-code', createLLM('ollama', codeModel, {
        baseUrl: process.env.OLLAMA_URL,
      }));
    }

    // AWS Bedrock (preferred for production with your bearer token)
    if (process.env.AWS_REGION && process.env.BEDROCK_MODEL_ID) {
      console.log(`🔧 Bedrock: ${process.env.BEDROCK_MODEL_ID} (region: ${process.env.AWS_REGION})`);
      const bedrock = createLLM('bedrock', process.env.BEDROCK_MODEL_ID, {
        region: process.env.AWS_REGION,
        bearerToken: process.env.AWS_BEARER_TOKEN_BEDROCK,
      });
      this.llmRouter.register('bedrock', bedrock);
    }

    // Anthropic Claude (fallback if no Bedrock)
    if (process.env.ANTHROPIC_API_KEY) {
      const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250929';
      console.log(`🔧 Anthropic: ${model}`);
      const claude = createLLM('anthropic', model, {
        apiKey: process.env.ANTHROPIC_API_KEY,
      });
      this.llmRouter.register('anthropic', claude);
    }

    // Google AI (Gemini API with API key)
    if (process.env.GOOGLE_CLOUD_API_KEY && process.env.GOOGLE_MODEL) {
      console.log(`🔧 Google AI: ${process.env.GOOGLE_MODEL}`);
      const googleAI = createLLM('google-ai', process.env.GOOGLE_MODEL, {
        apiKey: process.env.GOOGLE_CLOUD_API_KEY,
        max_tokens: parseInt(process.env.GOOGLE_MAX_OUTPUT_TOKENS || '30000'),
      });
      this.llmRouter.register('google-ai', googleAI);
    }

    // Google Vertex AI (free $300 credits)
    if (process.env.VERTEX_AI_PROJECT) {
      console.log(`🔧 Vertex AI: gemini-pro (project: ${process.env.VERTEX_AI_PROJECT})`);
      const vertex = createLLM('vertex', 'gemini-pro', {
        projectId: process.env.VERTEX_AI_PROJECT,
        region: process.env.VERTEX_AI_LOCATION,
      });
      this.llmRouter.register('vertex', vertex);
    }

    console.log('✅ LLM providers configured');

    // Connect to NATS
    this.nc = await connect({
      servers: process.env.NATS_URL || 'localhost:4222',
    });

    console.log(`📡 Connected to NATS: ${process.env.NATS_URL || 'localhost:4222'}`);

    // Configure inter-agent messaging
    setNatsConnection(this.nc);

    // Subscribe to tasks with queue group for load balancing
    const subscription = this.nc.subscribe('tasks.agent-universal', {
      queue: 'universal-agents' // All universal agents share this queue
    });
    console.log('👂 Listening for tasks on: tasks.agent-universal (queue: universal-agents)');

    // Subscribe to personal inbox for inter-agent messages
    const inboxSub = this.nc.subscribe(`agent.${this.agentId}.inbox`);
    console.log(`📬 Personal inbox: agent.${this.agentId}.inbox\n`);

    // Process tasks
    (async () => {
      for await (const msg of subscription) {
        try {
          const task: AgentTask = JSON.parse(sc.decode(msg.data));
          await this.handleTask(task);
        } catch (error) {
          console.error('Error processing task:', error);
        }
      }
    })();

    // Process inter-agent messages
    (async () => {
      for await (const msg of inboxSub) {
        try {
          const message = JSON.parse(sc.decode(msg.data));
          console.log(`\n💬 Message from ${message.from}: ${message.message}`);
          // Messages are logged in message bus and available for analysis
        } catch (error) {
          console.error('Error handling inter-agent message:', error);
        }
      }
    })();

    // Keep agent running
    await new Promise(() => {});
  }

  private async handleTask(task: AgentTask) {
    const startTime = Date.now();
    console.log(`\n📨 Received task: ${task.task_id}`);
    console.log(`   Role: ${task.role}`);
    console.log(`   Instructions: ${task.instructions.substring(0, 100)}...`);

    try {
      const { response, tools_used } = await this.executeTask(task);
      const duration = Date.now() - startTime;

      const toolsInfo = tools_used.length > 0 ? ` (tools: ${tools_used.join(', ')})` : '';
      console.log(`✅ Task completed in ${duration}ms${toolsInfo}`);

      // Publish result back to coordinator
      this.nc.publish(`results.${task.task_id}`, sc.encode(JSON.stringify({
        task_id: task.task_id,
        agent_id: this.agentId,
        status: 'success',
        result: response,
        tools_used,
        duration_ms: duration,
      })));

    } catch (error: any) {
      const duration = Date.now() - startTime;
      console.error(`❌ Task failed after ${duration}ms:`, error.message);

      // Publish error result
      this.nc.publish(`results.${task.task_id}`, sc.encode(JSON.stringify({
        task_id: task.task_id,
        agent_id: this.agentId,
        status: 'failure',
        error: error.message,
        duration_ms: duration,
      })));
    }
  }

  private async executeTask(task: AgentTask): Promise<{ response: string; tools_used: string[] }> {
    // Track which tools were used
    const toolsUsed: string[] = [];

    // Build tool context
    const context: ToolContext = {
      user_id: this.agentId,
      agent_id: this.agentId,
      platform: 'mattermost',
      credentials: {
        github_token: process.env.GITHUB_TOKEN || '',
        notion_token: process.env.NOTION_API_KEY || '',
        attio_token: process.env.ATTIO_API_KEY || '',
        open_measures_api_key: process.env.OPEN_MEASURES_API_KEY || '',
      },
    };

    // Determine which tools to use
    // Conversation-mode swarm agents receive the full transcript in their instructions
    // and only need to generate a response — tools just add latency and risk timeout.
    const isConversationModeForTools = task.swarm_mode === 'conversation';
    let tools: Tool[];
    if (isConversationModeForTools && (!task.tools || task.tools.length === 0)) {
      tools = [];
      console.log(`🔧 Conversation mode: skipping tools (not needed for transcript response)`);
    } else if (task.tools && task.tools.length > 0) {
      // Use specified tools
      tools = task.tools.map(name => toolRegistry.getTool(name)).filter((t): t is NonNullable<typeof t> => t !== null && t !== undefined);
      console.log(`🔧 Using ${tools.length} specified tools`);
    } else {
      // Auto-select tools based on task
      tools = getToolsForTask(task.instructions);

      // Filter out tools that require missing credentials
      const unconfiguredTools: string[] = [];
      if (!context.credentials.notion_token) unconfiguredTools.push('search_notion', 'create_notion_page', 'append_to_notion_page', 'read_notion_page', 'create_notion_database');
      if (!context.credentials.attio_token) unconfiguredTools.push('search_attio', 'create_attio_record', 'update_attio_record');
      if (!context.credentials.github_token) unconfiguredTools.push('github_list_repos', 'github_get_repo', 'github_create_issue', 'github_list_prs', 'github_get_pr');

      // Filter out inter-agent messaging unless in a swarm
      // This prevents agents from confusing Mattermost @mentions with inter-agent messaging
      if (!task.swarm_roster) {
        unconfiguredTools.push('send_message_to_agent');
      }

      const beforeFilter = tools.length;
      tools = tools.filter(t => !unconfiguredTools.includes(t.name));
      const filtered = beforeFilter - tools.length;

      console.log(`🔧 Auto-selected ${tools.length} tools${filtered > 0 ? ` (filtered ${filtered} unconfigured)` : ''}`);
    }

    // Build system prompt
    const toolDescriptions = tools.length > 0
      ? tools.map(t => `- ${t.name}: ${t.description}\n  Parameters: ${JSON.stringify(t.parameters.properties)}`).join('\n\n')
      : 'No tools available - use your knowledge to answer.';

    // Only mention send_message_to_agent tool if agent actually has tools available
    // In conversation mode without tools, the coordinator handles message passing via transcript
    const swarmInfo = task.swarm_roster ? `

SWARM MEMBERS:
You are part of a swarm with ${task.swarm_roster.length} other agent(s):
${task.swarm_roster.map(a => `- ${a.agent_id}: ${a.role}${a.description ? ` - ${a.description}` : ''}`).join('\n')}
${tools.length > 0 ? `
You can communicate with swarm members using the 'send_message_to_agent' tool.
This is ONLY for backend coordination between agents working on the SAME TASK.` : `
The conversation is managed for you - simply respond to what others have said.
Your response will be shared with the other participants automatically.`}
${task.max_turns ? `The swarm will run for ${task.max_turns} conversational turns.` : ''}
` : '';

    const systemPrompt = `You are ${task.role}.

Your task: ${task.instructions}

${task.context ? `Context:\n${JSON.stringify(task.context, null, 2)}\n` : ''}${swarmInfo}

AVAILABLE TOOLS:
${toolDescriptions}

⚠️ DATA PROCESSING BEST PRACTICES:
- read_workspace_file is LIMITED to 50 items max for large files (>100KB)
- DO NOT use read_workspace_file with large limits to get full data - it will be capped and you'll waste tokens
- FOR DATA PROCESSING (counting, filtering, aggregating): Use execute_javascript with fs.readFileSync() instead
- Example: const data = JSON.parse(fs.readFileSync('/path/to/file.json', 'utf-8')); const result = data.filter(x => x.count > 5);
- This processes data LOCALLY without sending it to the LLM, saving tokens and avoiding rate limits

🚨 MATTERMOST MESSAGING (if responding to Mattermost):

ARCHITECTURE: You generate responses, the coordinator posts them.
1. User @mentions your bot in Mattermost
2. Coordinator calls YOU to generate a response
3. You return your text response
4. Coordinator automatically posts it back to Mattermost

This means:
- Your text response IS the message (posted automatically)
- To @mention someone: Just write "@username" in your response (e.g., "Hi @bbb!")
- DO NOT look for messaging tools - JUST WRITE TEXT
- post_mattermost_message_with_attachment: ONLY for attaching files (charts, images)

CRITICAL TOOL USAGE RULES:
When you need to call a tool, respond with PURE JSON - NO TEXT BEFORE OR AFTER.

❌ WRONG - This will NOT execute the tool:
"I'll fetch the repositories. {"tool": "github_list_repos", "input": {"owner": "example"}}"
"Let me call the tool: {"tool": "github_list_repos", "input": {"owner": "example"}}"

✅ CORRECT - This WILL execute the tool:
{"tool": "github_list_repos", "input": {"owner": "example"}}

WORKFLOW:
1. If you need data from a tool → Return ONLY the JSON tool call (no explanation text)
2. After receiving tool result → Either call another tool (pure JSON) OR provide your final answer (natural language)
3. For final answers → Use natural language, be thorough and complete

FORMAT RULES:
- Tool calls: Pure JSON only, no markdown code blocks, no explanatory text
- Final answers: Natural language only, no JSON
- Never mix both in the same response`;

    const messages: LLMMessage[] = [{
      role: 'system',
      content: systemPrompt
    }, {
      role: 'user',
      content: task.instructions
    }];

    // Select model
    const model = task.model || 'complex';
    console.log(`🧠 Using model tier: ${model}`);

    // Agentic loop
    // Conversation-mode swarm agents just need to read the transcript and respond —
    // they shouldn't need tools. Cap iterations low to stay within the 120s timeout.
    const isConversationMode = task.swarm_mode === 'conversation';
    let iterations = 0;
    const maxIterations = isConversationMode ? 3 : 30;
    let result: any = null;

    while (iterations < maxIterations) {
      iterations++;
      console.log(`  Iteration ${iterations}/${maxIterations}`);

      const response = await this.llmRouter.chat(model, messages);
      console.log(`  Response: ${response.content.substring(0, 100)}...`);

      // Try to parse tool call - handle various formats
      let cleanContent = response.content
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();
      let toolCall: any = null;

      // Strategy 1: Try direct JSON parse (most common case with new prompt)
      try {
        const parsed = JSON.parse(cleanContent);
        if (parsed.tool && parsed.input) {
          toolCall = parsed;
          console.log(`  🔍 Direct parse - calling tool: ${toolCall.tool}`);
        }
      } catch (e) {
        // Strategy 2: Try to extract JSON from text that may have explanatory prefix
        // Match JSON object with "tool" and "input" properties, handling nested objects
        const jsonMatch = cleanContent.match(/\{[\s\S]*?"tool"[\s\S]*?:[\s\S]*?"[^"]*"[\s\S]*?,[\s\S]*?"input"[\s\S]*?:[\s\S]*?\{[\s\S]*?\}[\s\S]*?\}/);
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[0]);
            if (parsed.tool && parsed.input) {
              toolCall = parsed;
              console.log(`  🔍 Extracted from text - calling tool: ${toolCall.tool}`);
              console.log(`  ⚠️ Note: Agent included explanatory text before JSON (should be pure JSON)`);
            }
          } catch (parseError) {
            console.log(`  ⚠️ Found tool-like JSON but couldn't parse:`, jsonMatch[0].substring(0, 100));
          }
        }
      }

      // Execute tool if found
      if (toolCall && toolCall.tool) {
        console.log(`  🔧 Calling tool: ${toolCall.tool}`);
        toolsUsed.push(toolCall.tool);

        try {
          const toolResult = await executeToolCall(
            toolCall.tool,
            toolCall.input,
            context
          );

          console.log(`  ✓ Tool executed successfully`);

          // Add to conversation
          messages.push({
            role: 'assistant',
            content: response.content
          }, {
            role: 'user',
            content: `Tool result: ${JSON.stringify(toolResult)}\n\nContinue with your analysis or provide final answer.`
          });

          continue;
        } catch (toolError: any) {
          console.log(`  ✗ Tool failed: ${toolError.message}`);
          messages.push({
            role: 'assistant',
            content: response.content
          }, {
            role: 'user',
            content: `Tool execution failed: ${toolError.message}\n\nProvide final answer based on what you know.`
          });
          continue;
        }
      }

      // No tool call found - check if response indicates incomplete work
      const incompleteIndicators = [
        /let me (try|search|fetch|find|look|check|get|retrieve)/i,
        /i'll (try|search|fetch|find|look|check|get|retrieve)/i,
        /i will (try|search|fetch|find|look|check|get|retrieve)/i,
        /searching for/i,
        /fetching/i,
      ];

      const seemsIncomplete = incompleteIndicators.some(pattern => pattern.test(response.content));

      if (seemsIncomplete) {
        console.log(`  ⚠️ Response indicates pending action but no tool call found`);
        messages.push({
          role: 'assistant',
          content: response.content
        }, {
          role: 'user',
          content: `You indicated you would take an action, but didn't provide a tool call. Either:
1. Make a tool call using pure JSON format: {"tool": "tool_name", "input": {...}}
2. Or provide your final answer in natural language.

Do not say what you will do - either do it (tool call) or provide the answer.`
        });
        continue;
      }

      // This is the final answer
      result = response.content;
      break;
    }

    if (iterations >= maxIterations) {
      throw new Error('Max iterations reached without final answer');
    }

    return {
      response: result || 'Task completed',
      tools_used: toolsUsed,
    };
  }

  async stop() {
    if (this.nc) {
      await this.nc.close();
    }
    console.log('👋 Agent stopped');
  }
}

// Start agent if run directly
if (require.main === module) {
  const agent = new UniversalAgent();

  agent.start().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\nReceived SIGINT, shutting down gracefully...');
    await agent.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\nReceived SIGTERM, shutting down gracefully...');
    await agent.stop();
    process.exit(0);
  });
}

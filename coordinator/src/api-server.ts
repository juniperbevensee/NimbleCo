#!/usr/bin/env node
/**
 * NimbleCo Tool Executor API Server
 *
 * HTTP API for executing tools, called by Swarm-Map's tool proxy.
 * This enables Claude Code (and other external agents) to use NimbleCo's
 * tools without seeing the actual API credentials.
 *
 * SECURITY: This endpoint should only be accessible from Swarm-Map gateway,
 * not exposed publicly. Use firewall rules or internal networking.
 */

import express from 'express';
import * as dotenv from 'dotenv';
import * as path from 'path';
import {
  registry as toolRegistry,
  executeToolCall,
  ToolContext,
  AllowAllPolicyClient,
} from '@nimbleco/tools';

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const app = express();
app.use(express.json({ limit: '10mb' }));

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'nimbleco-tool-executor',
    timestamp: new Date().toISOString(),
  });
});

/**
 * POST /api/tools/execute
 *
 * Execute a tool with provided credentials.
 * Called by Swarm-Map gateway (not directly by external agents).
 *
 * Request body:
 * {
 *   tool: string,           // Tool name
 *   params: object,         // Tool parameters
 *   credentials: object,    // Decrypted credentials (GITHUB_TOKEN, etc.)
 *   context: {              // Execution context
 *     user_id: string,
 *     platform: string,
 *     agent_id?: string,
 *     is_admin?: boolean,
 *   }
 * }
 */
app.post('/api/tools/execute', async (req, res) => {
  const startTime = Date.now();

  // Verify internal request (basic check - in production use proper auth)
  const internalHeader = req.headers['x-internal-request'];
  if (internalHeader !== 'swarm-map-proxy') {
    console.warn('[API] Unauthorized tool execution attempt');
    res.status(403).json({
      success: false,
      error: 'This endpoint is for internal use only',
    });
    return;
  }

  const { tool, params, credentials, context } = req.body;

  if (!tool) {
    res.status(400).json({
      success: false,
      error: 'tool is required',
    });
    return;
  }

  // Build tool context with provided credentials
  const toolContext: ToolContext = {
    user_id: context?.user_id || 'proxy-user',
    platform: context?.platform || 'proxy',
    credentials: credentials || {},
    agent_id: context?.agent_id,
    is_admin: context?.is_admin || false,
  };

  console.log(`[API] Executing tool: ${tool} for user: ${toolContext.user_id}`);

  try {
    // Execute the tool
    // We use AllowAllPolicyClient here since policy is enforced at Swarm-Map level
    const result = await executeToolCall(
      tool,
      params || {},
      toolContext,
      undefined, // No task payload
      new AllowAllPolicyClient() // Policy already checked by Swarm-Map
    );

    const duration = Date.now() - startTime;
    console.log(`[API] Tool ${tool} completed in ${duration}ms`);

    res.json({
      success: true,
      tool,
      output: result,
      executionTime: duration,
    });
  } catch (error: any) {
    const duration = Date.now() - startTime;
    console.error(`[API] Tool ${tool} failed after ${duration}ms:`, error);

    res.status(500).json({
      success: false,
      tool,
      error: error.message || 'Tool execution failed',
      executionTime: duration,
    });
  }
});

/**
 * GET /api/tools/list
 *
 * List all available tools (for debugging/admin purposes).
 * Requires internal header.
 */
app.get('/api/tools/list', (req, res) => {
  const internalHeader = req.headers['x-internal-request'];
  if (internalHeader !== 'swarm-map-proxy') {
    res.status(403).json({
      error: 'This endpoint is for internal use only',
    });
    return;
  }

  const tools = toolRegistry.getAllNames();
  const toolDetails = tools.map((name) => {
    const tool = toolRegistry.getTool(name);
    return {
      name,
      category: tool?.category,
      description: tool?.description?.substring(0, 200),
      requiredEnv: tool?.requiredEnv || [],
    };
  });

  res.json({
    tools: toolDetails,
    total: toolDetails.length,
  });
});

/**
 * GET /api/tools/info/:toolName
 *
 * Get detailed info about a specific tool.
 */
app.get('/api/tools/info/:toolName', (req, res) => {
  const internalHeader = req.headers['x-internal-request'];
  if (internalHeader !== 'swarm-map-proxy') {
    res.status(403).json({
      error: 'This endpoint is for internal use only',
    });
    return;
  }

  const { toolName } = req.params;
  const tool = toolRegistry.getTool(toolName);

  if (!tool) {
    res.status(404).json({
      error: 'Tool not found',
      message: `Tool '${toolName}' is not registered`,
    });
    return;
  }

  res.json({
    name: tool.name,
    category: tool.category,
    description: tool.description,
    use_cases: tool.use_cases,
    parameters: tool.parameters,
    requiredEnv: tool.requiredEnv || [],
    permissions: tool.permissions,
  });
});

// Start server
const PORT = process.env.NIMBLECO_API_PORT || 3000;

app.listen(PORT, () => {
  console.log(`[NimbleCo API] Tool Executor running on port ${PORT}`);
  console.log(`[NimbleCo API] Health check: http://localhost:${PORT}/health`);
  console.log(`[NimbleCo API] Tool count: ${toolRegistry.getAllNames().length}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[NimbleCo API] Shutting down...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n[NimbleCo API] Shutting down...');
  process.exit(0);
});

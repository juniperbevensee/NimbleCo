/**
 * Multi-provider LLM adapter
 * Supports: Ollama (local), Claude, Vertex AI, AWS Bedrock, Azure OpenAI, OpenRouter
 */

export interface LLMContentBlock {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}

export interface LLMMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | LLMContentBlock[];
}

/**
 * Helper to convert content blocks to a single string
 */
function contentToString(content: string | LLMContentBlock[]): string {
  if (typeof content === 'string') {
    return content;
  }
  return content.map(block => block.text).join('\n');
}

export interface LLMTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface LLMResponse {
  content: string;
  tool_calls?: Array<{
    name: string;
    input: Record<string, any>;
  }>;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cost_usd?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  model: string;
  provider: string;
}

export interface LLMConfig {
  provider: 'ollama' | 'anthropic' | 'vertex' | 'bedrock' | 'azure' | 'openrouter';
  model: string;
  temperature?: number;
  max_tokens?: number;
  timeout_ms?: number;
}

export abstract class LLMAdapter {
  constructor(protected config: LLMConfig) {}

  abstract chat(
    messages: LLMMessage[],
    tools?: LLMTool[]
  ): Promise<LLMResponse>;

  abstract stream(
    messages: LLMMessage[],
    tools?: LLMTool[]
  ): AsyncGenerator<string>;
}

/**
 * Ollama adapter for local models (Qwen 3.5, Llama 3.1, etc)
 */
export class OllamaAdapter extends LLMAdapter {
  private baseUrl: string;

  constructor(config: LLMConfig, baseUrl = 'http://localhost:11434') {
    super(config);
    this.baseUrl = baseUrl;
  }

  async chat(messages: LLMMessage[], tools?: LLMTool[]): Promise<LLMResponse> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.config.model,
        messages,
        stream: false,
        options: {
          temperature: this.config.temperature ?? 0.7,
          num_predict: this.config.max_tokens ?? 4096,
        },
        tools: tools ? this.convertTools(tools) : undefined,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama error: ${response.statusText}`);
    }

    const data = await response.json() as any;

    return {
      content: data.message.content,
      tool_calls: data.message.tool_calls,
      usage: {
        input_tokens: data.prompt_eval_count || 0,
        output_tokens: data.eval_count || 0,
        cost_usd: 0, // Local = free!
      },
      model: this.config.model,
      provider: 'ollama',
    };
  }

  async *stream(messages: LLMMessage[], tools?: LLMTool[]): AsyncGenerator<string> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.config.model,
        messages,
        stream: true,
        tools: tools ? this.convertTools(tools) : undefined,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama error: ${response.statusText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n').filter(l => l.trim());

      for (const line of lines) {
        try {
          const data = JSON.parse(line);
          if (data.message?.content) {
            yield data.message.content;
          }
        } catch (e) {
          // Ignore parsing errors
        }
      }
    }
  }

  private convertTools(tools: LLMTool[]) {
    return tools.map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema,
      },
    }));
  }
}

/**
 * Anthropic Claude adapter
 */
export class AnthropicAdapter extends LLMAdapter {
  private apiKey: string;

  constructor(config: LLMConfig, apiKey: string) {
    super(config);
    this.apiKey = apiKey;
  }

  async chat(messages: LLMMessage[], tools?: LLMTool[]): Promise<LLMResponse> {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic({ apiKey: this.apiKey });

    // Extract system message (Anthropic requires it as separate parameter)
    const systemMessage = messages.find(m => m.role === 'system');
    const nonSystemMessages = messages.filter(m => m.role !== 'system');

    // Convert system message to structured format if it's a string (for caching)
    let systemContent: string | any[] | undefined;
    if (systemMessage) {
      systemContent = Array.isArray(systemMessage.content)
        ? systemMessage.content
        : systemMessage.content;
    }

    // Retry logic for rate limits
    // 1 retry (2 attempts total) before falling back
    const maxRetries = 2;
    let lastError: any;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await client.messages.create({
          model: this.config.model,
          max_tokens: this.config.max_tokens ?? 4096,
          temperature: this.config.temperature ?? 0.7,
          system: systemContent as any,
          messages: nonSystemMessages as any,
          tools: tools as any,
        });

        const textContent = response.content.find(c => c.type === 'text');
        const toolCalls = response.content
          .filter(c => c.type === 'tool_use')
          .map((c: any) => ({ name: c.name, input: c.input }));

        // Extract cache statistics
        const usage: any = {
          input_tokens: response.usage.input_tokens,
          output_tokens: response.usage.output_tokens,
        };

        // Add cache stats if present
        if ((response.usage as any).cache_creation_input_tokens) {
          usage.cache_creation_input_tokens = (response.usage as any).cache_creation_input_tokens;
        }
        if ((response.usage as any).cache_read_input_tokens) {
          usage.cache_read_input_tokens = (response.usage as any).cache_read_input_tokens;
        }

        // Calculate cost including cache pricing
        usage.cost_usd = this.calculateCostWithCache(
          response.usage.input_tokens,
          response.usage.output_tokens,
          (response.usage as any).cache_creation_input_tokens || 0,
          (response.usage as any).cache_read_input_tokens || 0,
          this.config.model
        );

        return {
          content: textContent ? (textContent as any).text : '',
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
          usage,
          model: this.config.model,
          provider: 'anthropic',
        };
      } catch (error: any) {
        lastError = error;

        // Check if it's a rate limit error (429)
        const isRateLimit = error.status === 429 ||
                           (error.error && error.error.type === 'rate_limit_error');

        if (!isRateLimit || attempt === maxRetries - 1) {
          // Not a rate limit error, or we're out of retries
          throw error;
        }

        // Calculate exponential backoff: 2^attempt * 1000ms + jitter
        const baseDelay = Math.pow(2, attempt) * 1000;
        const jitter = Math.random() * 1000;
        const delay = baseDelay + jitter;

        console.log(`⏳ Rate limited (429). Waiting ${Math.round(delay / 1000)}s before retry ${attempt + 1}/1...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    // Should never reach here, but just in case
    throw lastError;
  }

  async *stream(messages: LLMMessage[], tools?: LLMTool[]): AsyncGenerator<string> {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic({ apiKey: this.apiKey });

    const stream = await client.messages.stream({
      model: this.config.model,
      max_tokens: this.config.max_tokens ?? 4096,
      messages: messages as any,
      tools: tools as any,
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield event.delta.text;
      }
    }
  }

  private calculateCost(inputTokens: number, outputTokens: number, model: string): number {
    // Pricing as of 2025 (update periodically)
    const pricing: Record<string, { input: number; output: number }> = {
      'claude-opus-4-5-20251101': { input: 15, output: 75 }, // per 1M tokens
      'claude-sonnet-4-5-20250929': { input: 3, output: 15 },
      'claude-sonnet-3-5-20241022': { input: 3, output: 15 },
      'claude-haiku-3-5-20241022': { input: 0.8, output: 4 },
    };

    const price = pricing[model] || pricing['claude-sonnet-3-5-20241022'];
    return ((inputTokens * price.input) + (outputTokens * price.output)) / 1_000_000;
  }

  private calculateCostWithCache(
    inputTokens: number,
    outputTokens: number,
    cacheCreationTokens: number,
    cacheReadTokens: number,
    model: string
  ): number {
    // Pricing as of 2025 (per 1M tokens)
    const pricing: Record<string, { input: number; output: number; cacheWrite: number; cacheRead: number }> = {
      'claude-opus-4-5-20251101': { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
      'claude-sonnet-4-5-20250929': { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
      'claude-sonnet-3-5-20241022': { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
      'claude-haiku-3-5-20241022': { input: 0.8, output: 4, cacheWrite: 1.0, cacheRead: 0.08 },
    };

    const price = pricing[model] || pricing['claude-sonnet-3-5-20241022'];

    // Regular input tokens (not cached)
    const regularInputTokens = inputTokens - cacheCreationTokens - cacheReadTokens;

    const cost =
      (regularInputTokens * price.input +
       cacheCreationTokens * price.cacheWrite +
       cacheReadTokens * price.cacheRead +
       outputTokens * price.output) / 1_000_000;

    return cost;
  }
}

/**
 * Google Vertex AI adapter
 */
export class VertexAdapter extends LLMAdapter {
  private projectId: string;
  private location: string;

  constructor(config: LLMConfig, projectId: string, location = 'us-central1') {
    super(config);
    this.projectId = projectId;
    this.location = location;
  }

  async chat(messages: LLMMessage[], tools?: LLMTool[]): Promise<LLMResponse> {
    const { VertexAI } = await import('@google-cloud/vertexai');

    const vertex = new VertexAI({
      project: this.projectId,
      location: this.location,
    });

    const model = vertex.getGenerativeModel({ model: this.config.model });

    // Convert messages to Vertex format
    const contents = messages.map(msg => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: contentToString(msg.content) }],
    }));

    const result = await model.generateContent({
      contents,
      generationConfig: {
        temperature: this.config.temperature ?? 0.7,
        maxOutputTokens: this.config.max_tokens ?? 4096,
      },
    });

    const response = result.response;
    const text = response.candidates?.[0]?.content?.parts[0]?.text || '';

    return {
      content: text,
      usage: {
        input_tokens: 0, // Vertex doesn't expose this easily
        output_tokens: 0,
        cost_usd: 0, // Free tier!
      },
      model: this.config.model,
      provider: 'vertex',
    };
  }

  async *stream(messages: LLMMessage[], tools?: LLMTool[]): AsyncGenerator<string> {
    const { VertexAI } = await import('@google-cloud/vertexai');

    const vertex = new VertexAI({
      project: this.projectId,
      location: this.location,
    });

    const model = vertex.getGenerativeModel({ model: this.config.model });

    const contents = messages.map(msg => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: contentToString(msg.content) }],
    }));

    const result = await model.generateContentStream({ contents });

    for await (const chunk of result.stream) {
      const text = chunk.candidates?.[0]?.content?.parts[0]?.text;
      if (text) yield text;
    }
  }
}

/**
 * Google AI (Gemini API) adapter
 * Uses API key for direct Gemini API access
 * Supports custom baseUrl for Vertex AI endpoint
 */
export class GoogleAIAdapter extends LLMAdapter {
  private apiKey: string;
  private baseUrl?: string;

  constructor(config: LLMConfig, apiKey: string, baseUrl?: string) {
    super(config);
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  async chat(messages: LLMMessage[], tools?: LLMTool[]): Promise<LLMResponse> {
    // If custom baseUrl provided (Vertex AI), use direct fetch
    if (this.baseUrl) {
      return this.chatVertexAI(messages, tools);
    }

    // Otherwise use Google AI Studio SDK
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(this.apiKey);
    const model = genAI.getGenerativeModel({ model: this.config.model });

    // Convert messages to Gemini format
    const contents = messages
      .filter(m => m.role !== 'system')
      .map(msg => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: contentToString(msg.content) }],
      }));

    // Extract system instruction
    const systemMessage = messages.find(m => m.role === 'system');
    const systemInstruction = systemMessage ? contentToString(systemMessage.content) : undefined;

    const result = await model.generateContent({
      contents,
      systemInstruction,
      generationConfig: {
        temperature: this.config.temperature ?? 0.7,
        maxOutputTokens: this.config.max_tokens ?? 30000,
      },
    });

    const response = result.response;
    const text = response.text() || '';

    return {
      content: text,
      usage: {
        input_tokens: response.usageMetadata?.promptTokenCount || 0,
        output_tokens: response.usageMetadata?.candidatesTokenCount || 0,
        cost_usd: 0, // Free tier
      },
      model: this.config.model,
      provider: 'google-ai',
    };
  }

  private async chatVertexAI(messages: LLMMessage[], tools?: LLMTool[]): Promise<LLMResponse> {
    // Direct fetch to Vertex AI endpoint with API key
    const url = `${this.baseUrl}/publishers/google/models/${this.config.model}:generateContent?key=${this.apiKey}`;

    // Convert messages to Vertex AI format
    const contents = messages
      .filter(m => m.role !== 'system')
      .map(msg => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: contentToString(msg.content) }],
      }));

    // Extract system instruction
    const systemMessage = messages.find(m => m.role === 'system');
    const systemInstruction = systemMessage ? contentToString(systemMessage.content) : undefined;

    const body: any = {
      contents,
      generationConfig: {
        temperature: this.config.temperature ?? 0.7,
        maxOutputTokens: this.config.max_tokens ?? 30000,
      },
    };

    if (systemInstruction) {
      body.systemInstruction = { parts: [{ text: systemInstruction }] };
    }

    // Add tools if provided (convert to Gemini format)
    if (tools && tools.length > 0) {
      body.tools = [{
        functionDeclarations: tools.map(tool => ({
          name: tool.name,
          description: tool.description,
          parameters: tool.input_schema,
        })),
      }];
      console.log(`🔧 Vertex AI: Sending ${tools.length} tools in request`);
      console.log(`   Tool names: ${tools.map(t => t.name).join(', ').substring(0, 200)}`);
    } else {
      console.log('⚠️  Vertex AI: No tools provided in request');
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Vertex AI error (${response.status}): ${text}`);
    }

    const data = await response.json() as any;

    // Parse parts for text and tool calls
    const parts = data.candidates?.[0]?.content?.parts || [];
    console.log(`📥 Vertex AI response: ${parts.length} parts`);
    parts.forEach((part: any, i: number) => {
      const keys = Object.keys(part);
      console.log(`   Part ${i}: ${keys.join(', ')}`);
    });

    let text = '';
    const toolCalls: Array<{ name: string; input: Record<string, any> }> = [];

    for (const part of parts) {
      if (part.text) {
        text += part.text;
      } else if (part.functionCall) {
        console.log(`🔧 Found function call: ${part.functionCall.name}`);
        toolCalls.push({
          name: part.functionCall.name,
          input: part.functionCall.args || {},
        });
      }
    }

    if (toolCalls.length > 0) {
      console.log(`✅ Extracted ${toolCalls.length} tool calls from Vertex AI response`);
    } else if (text && parts.length > 0) {
      console.log(`⚠️  Vertex AI returned text only, no function calls`);
    }

    return {
      content: text,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        input_tokens: data.usageMetadata?.promptTokenCount || 0,
        output_tokens: data.usageMetadata?.candidatesTokenCount || 0,
        cost_usd: 0, // Free tier
      },
      model: this.config.model,
      provider: 'google-ai',
    };
  }

  async *stream(messages: LLMMessage[], tools?: LLMTool[]): AsyncGenerator<string> {
    // If custom baseUrl, streaming not yet implemented for Vertex AI
    if (this.baseUrl) {
      throw new Error('Streaming not yet implemented for Vertex AI endpoint');
    }

    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(this.apiKey);
    const model = genAI.getGenerativeModel({ model: this.config.model });

    const contents = messages
      .filter(m => m.role !== 'system')
      .map(msg => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: contentToString(msg.content) }],
      }));

    const result = await model.generateContentStream({ contents });

    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) yield text;
    }
  }
}

/**
 * AWS Bedrock adapter
 * Uses Anthropic SDK with bearer token and bedrock base URL
 */
export class BedrockAdapter extends LLMAdapter {
  private region: string;
  private bearerToken: string;

  // Static flag to skip Bedrock entirely when daily quota is exceeded
  // Resets when process restarts (typically at midnight restart or manual restart)
  private static dailyQuotaExceeded = false;

  constructor(config: LLMConfig, region = 'us-east-1', bearerToken?: string) {
    super(config);
    if (!bearerToken) {
      throw new Error('Bearer token is required for Bedrock adapter. Set AWS_BEARER_TOKEN_BEDROCK env var.');
    }
    this.region = region;
    this.bearerToken = bearerToken;
  }

  async chat(messages: LLMMessage[], tools?: LLMTool[]): Promise<LLMResponse> {
    // Skip immediately if we already know daily quota is exceeded
    if (BedrockAdapter.dailyQuotaExceeded) {
      throw new Error('Bedrock daily quota exceeded (cached) - skipping to next provider');
    }
    // Extract system message
    const systemMessage = messages.find(m => m.role === 'system');
    const nonSystemMessages = messages.filter(m => m.role !== 'system');

    // Convert to Bedrock Converse format
    const converseMessages = nonSystemMessages.map(msg => ({
      role: msg.role,
      content: [{ text: contentToString(msg.content) }],
    }));

    // Build request body
    const body: Record<string, any> = {
      messages: converseMessages,
      inferenceConfig: {
        maxTokens: this.config.max_tokens ?? 4096,
        temperature: this.config.temperature ?? 0.7,
      },
    };

    if (systemMessage) {
      body.system = [{ text: contentToString(systemMessage.content) }];
    }

    if (tools && tools.length > 0) {
      body.toolConfig = {
        tools: tools.map(tool => ({
          toolSpec: {
            name: tool.name,
            description: tool.description,
            inputSchema: { json: tool.input_schema },
          },
        })),
        toolChoice: { auto: {} },
      };
    }

    // Make request to Bedrock Converse API with retry logic
    const url = `https://bedrock-runtime.${this.region}.amazonaws.com/model/${encodeURIComponent(this.config.model)}/converse`;

    console.log(`🔍 Bedrock Converse API request:`);
    console.log(`   URL: ${url}`);
    console.log(`   Model: ${this.config.model}`);
    console.log(`   Bearer token: ${this.bearerToken.substring(0, 20)}...`);

    // Retry logic for rate limits and transient errors
    // 1 retry (2 attempts total) with backoff: ~15s before falling back
    const maxRetries = 2;
    let lastError: any;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.bearerToken}`,
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const text = await response.text();

          // Check if it's a daily quota limit - don't retry, fail immediately to fallback
          const isDailyLimit = text.includes('Too many tokens per day') ||
                               text.includes('daily') ||
                               text.includes('quota');

          if (isDailyLimit) {
            console.log(`⚠️ Daily quota exceeded - caching and skipping Bedrock for remaining session`);
            BedrockAdapter.dailyQuotaExceeded = true;
            throw new Error(`Bedrock daily quota exceeded: ${text}`);
          }

          // Check if it's a rate limit error (429) or server error (5xx)
          const isRetryable = response.status === 429 || response.status >= 500;

          if (isRetryable && attempt < maxRetries - 1) {
            // Calculate exponential backoff with longer delays
            // First retry: ~15s
            const baseDelay = Math.pow(3, attempt + 1) * 5000;
            const jitter = Math.random() * 2000;
            const delay = baseDelay + jitter;

            console.log(`⏳ ${response.status === 429 ? 'Rate limited' : 'Server error'} (${response.status}). Waiting ${Math.round(delay / 1000)}s before retry ${attempt + 1}/1...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }

          console.error(`❌ Bedrock error (${response.status}):`, text);
          throw new Error(`Bedrock API error (${response.status}): ${text}`);
        }

        const data = await response.json() as any;

        console.log(`✅ Bedrock response received`);
        console.log(`   Keys: ${Object.keys(data).join(', ')}`);

        // Extract response from Bedrock Converse format
        const content = data?.output?.message?.content ?? [];
        let textContent = '';
        const toolCalls: Array<{ name: string; input: Record<string, any> }> = [];

        for (const block of content) {
          if (block.text) {
            textContent += block.text;
          } else if (block.toolUse) {
            toolCalls.push({
              name: block.toolUse.name,
              input: block.toolUse.input || {},
            });
          }
        }

        return {
          content: textContent,
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
          usage: {
            input_tokens: data?.usage?.inputTokens || 0,
            output_tokens: data?.usage?.outputTokens || 0,
            cost_usd: this.calculateCost(
              data?.usage?.inputTokens || 0,
              data?.usage?.outputTokens || 0,
              this.config.model
            ),
          },
          model: this.config.model,
          provider: 'bedrock',
        };
      } catch (error: any) {
        lastError = error;

        // Don't retry for daily quota errors - fail immediately to fallback
        const isDailyQuota = error.message?.includes('daily quota') ||
                             error.message?.includes('Too many tokens per day');
        if (isDailyQuota) {
          throw error;
        }

        // If we're out of retries, throw
        if (attempt === maxRetries - 1) {
          throw error;
        }

        // Otherwise, retry with backoff
        // First retry: ~15s
        const baseDelay = Math.pow(3, attempt + 1) * 5000;
        const jitter = Math.random() * 2000;
        const delay = baseDelay + jitter;

        console.log(`⚠️ Request failed (${error.message}). Waiting ${Math.round(delay / 1000)}s before retry ${attempt + 1}/1...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    // Should never reach here, but just in case
    throw lastError;
  }

  async *stream(messages: LLMMessage[], tools?: LLMTool[]): AsyncGenerator<string> {
    // Bedrock streaming implementation
    throw new Error('Bedrock streaming not yet implemented');
  }

  private calculateCost(inputTokens: number, outputTokens: number, model: string): number {
    // Bedrock Claude pricing (as of 2025)
    const pricing: Record<string, { input: number; output: number }> = {
      'claude-opus-4-6': { input: 15, output: 75 },
      'claude-sonnet-4': { input: 3, output: 15 },
      'claude-sonnet-3-5': { input: 3, output: 15 },
      'claude-haiku-3-5': { input: 0.8, output: 4 },
    };

    // Extract base model name from ARN or model ID
    const modelKey = Object.keys(pricing).find(key => model.includes(key)) ||
                     'claude-sonnet-3-5';
    const price = pricing[modelKey];

    return ((inputTokens * price.input) + (outputTokens * price.output)) / 1_000_000;
  }
}

/**
 * Factory function to create the right adapter
 */
export function createLLM(
  provider: string,
  model: string,
  options: {
    apiKey?: string;
    projectId?: string;
    region?: string;
    baseUrl?: string;
    bearerToken?: string;
    temperature?: number;
    max_tokens?: number;
  } = {}
): LLMAdapter {
  const config: LLMConfig = {
    provider: provider as any,
    model,
    temperature: options.temperature,
    max_tokens: options.max_tokens,
  };

  switch (provider) {
    case 'ollama':
      return new OllamaAdapter(config, options.baseUrl);

    case 'anthropic':
      if (!options.apiKey) throw new Error('Anthropic API key required');
      return new AnthropicAdapter(config, options.apiKey);

    case 'google-ai':
      if (!options.apiKey) throw new Error('Google AI API key required');
      return new GoogleAIAdapter(config, options.apiKey, options.baseUrl);

    case 'vertex':
      if (!options.projectId) throw new Error('Vertex project ID required');
      return new VertexAdapter(config, options.projectId, options.region);

    case 'bedrock':
      return new BedrockAdapter(config, options.region, options.bearerToken);

    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}

/**
 * User context for access tier filtering
 */
export interface LLMUserContext {
  isAdmin: boolean;
  userId?: string;
  allowedProviders?: Set<string>;
  preferredModel?: string;
}

/**
 * Smart LLM router that picks the best provider based on task type and cost
 * Supports access tier filtering for admin vs non-admin users
 */
export class LLMRouter {
  private adapters: Map<string, LLMAdapter> = new Map();
  private dailyCost = 0;
  private dailyLimit: number;
  private failedAdapters: Set<string> = new Set(); // Track failed adapters for this invocation

  constructor(dailyLimit = 10) {
    this.dailyLimit = dailyLimit;
    this.resetDailyCostAtMidnight();
  }

  /**
   * Reset failed adapters cache (call at start of new invocation)
   */
  resetFailedAdapters() {
    this.failedAdapters.clear();
  }

  register(name: string, adapter: LLMAdapter) {
    this.adapters.set(name, adapter);
  }

  /**
   * Chat with access tier filtering
   * Respects user's allowed providers and preferred model
   */
  async chatWithAccessTier(
    taskType: 'quick' | 'code' | 'complex' | string,
    messages: LLMMessage[],
    tools: LLMTool[] | undefined,
    userContext: LLMUserContext
  ): Promise<LLMResponse> {
    // If user has a preferred model and it's a registered adapter, use it
    if (userContext.preferredModel && this.adapters.has(userContext.preferredModel)) {
      // Check if user is allowed to use this provider
      if (!userContext.allowedProviders || userContext.allowedProviders.has(userContext.preferredModel)) {
        const adapter = this.adapters.get(userContext.preferredModel)!;
        const response = await adapter.chat(messages, tools);
        if (response.usage?.cost_usd) {
          this.dailyCost += response.usage.cost_usd;
        }
        return response;
      }
      console.log(`⚠️ User requested ${userContext.preferredModel} but not allowed, using tier default`);
    }

    // Use regular chat with filtered adapters
    return this.chat(taskType, messages, tools, userContext.allowedProviders);
  }

  async chat(
    taskType: 'quick' | 'code' | 'complex' | string,
    messages: LLMMessage[],
    tools?: LLMTool[],
    allowedProviders?: Set<string>
  ): Promise<LLMResponse> {
    // Check if taskType is actually a specific model name
    if (this.adapters.has(taskType)) {
      const adapter = this.adapters.get(taskType)!;
      const response = await adapter.chat(messages, tools);
      if (response.usage?.cost_usd) {
        this.dailyCost += response.usage.cost_usd;
      }
      return response;
    }

    // Get prioritized list of adapters to try (filtered by allowed providers if set)
    const adaptersToTry = this.getAdapterPriorityList(taskType, allowedProviders);

    let lastError: Error | null = null;

    // Try each adapter in priority order
    for (let i = 0; i < adaptersToTry.length; i++) {
      const { name, adapter } = adaptersToTry[i];
      try {
        console.log(`🔧 Trying LLM adapter: ${name}`);
        const response = await adapter.chat(messages, tools);

        // Track cost
        if (response.usage?.cost_usd) {
          this.dailyCost += response.usage.cost_usd;
        }

        console.log(`✅ Successfully used: ${name}`);
        return response;
      } catch (error: any) {
        console.log(`❌ ${name} failed: ${error.message}`);
        lastError = error;

        // Mark this adapter as failed for the rest of this invocation
        this.failedAdapters.add(name);
        console.log(`   ⚠️  ${name} marked as failed for this invocation`);

        // If we have more adapters to try, continue to next one
        if (i < adaptersToTry.length - 1) {
          console.log(`   Trying next adapter...`);
          continue;
        }
      }
    }

    // All adapters failed
    throw new Error(`All LLM adapters failed. Last error: ${lastError?.message}`);
  }

  private getAdapterPriorityList(
    taskType: string,
    allowedProviders?: Set<string>
  ): Array<{ name: string; adapter: LLMAdapter }> {
    const priorityList: Array<{ name: string; adapter: LLMAdapter }> = [];

    // Helper to add adapter if available, not failed, and allowed
    const tryAddAdapter = (name: string) => {
      if (this.adapters.has(name) && !this.failedAdapters.has(name)) {
        // If allowedProviders is set, check if this provider is allowed
        if (allowedProviders && allowedProviders.size > 0 && !allowedProviders.has(name)) {
          return; // Skip this provider
        }
        priorityList.push({ name, adapter: this.adapters.get(name)! });
      }
    };

    // For ALL tasks, try cloud providers first (they're faster and more reliable)
    // Priority: Bedrock > Vertex > Google AI > Anthropic
    if (this.dailyCost < this.dailyLimit) {
      tryAddAdapter('bedrock');
      tryAddAdapter('vertex');
      tryAddAdapter('google-ai');
      tryAddAdapter('anthropic');
    }

    // Add local Ollama models as final fallback
    if (!priorityList.some(p => p.name === 'ollama-code')) {
      tryAddAdapter('ollama-code');
    }
    if (!priorityList.some(p => p.name === 'ollama-quick')) {
      tryAddAdapter('ollama-quick');
    }

    // If still nothing, add all available adapters
    if (priorityList.length === 0) {
      for (const [name, adapter] of this.adapters) {
        priorityList.push({ name, adapter });
      }
    }

    if (priorityList.length === 0) {
      throw new Error('No LLM adapters configured. Please configure at least one provider.');
    }

    return priorityList;
  }

  private selectAdapter(taskType: string, allowedProviders?: Set<string>): LLMAdapter {
    const priorityList = this.getAdapterPriorityList(taskType, allowedProviders);
    return priorityList[0].adapter;
  }

  private resetDailyCostAtMidnight() {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    const msUntilMidnight = midnight.getTime() - now.getTime();

    setTimeout(() => {
      this.dailyCost = 0;
      this.resetDailyCostAtMidnight();
    }, msUntilMidnight);
  }

  getDailyCost() {
    return this.dailyCost;
  }

  getRemainingBudget() {
    return Math.max(0, this.dailyLimit - this.dailyCost);
  }
}

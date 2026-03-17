# LLM Router Improvements

## Changes Made

### 1. Automatic Fallback to Alternative Models

The LLM router now automatically tries alternative models when one fails:

**Priority Order:**
- For **complex tasks**: Bedrock → Google AI → Anthropic → Vertex → Ollama (code) → Ollama (quick)
- For **quick tasks**: Ollama (quick) → cloud providers → Ollama (code)
- For **code tasks**: Ollama (code) → cloud providers → Ollama (quick)

When a model fails (rate limit, authentication, server error, etc.), the system automatically tries the next model in the priority list.

**Example:**
```
🔧 Trying LLM adapter: bedrock
❌ bedrock failed: Rate limited (429)
   Trying next adapter...
🔧 Trying LLM adapter: google-ai
❌ google-ai failed: Not configured
   Trying next adapter...
🔧 Trying LLM adapter: ollama-code
✅ Successfully used: ollama-code
```

### 2. Improved Retry Logic

**Old retry delays:**
- 1st retry: ~1s
- 2nd retry: ~3s
- 3rd retry: ~5s
- 4th retry: ~8s
- Total: ~17 seconds

**New retry delays:**
- 1st retry: ~5-7s
- 2nd retry: ~15-17s
- Total: ~20-24 seconds per model

The system now:
- Waits longer between retries (exponential backoff: 3^(n+1) * 5 seconds)
- Retries on both rate limits (429) and server errors (5xx)
- Falls back to next model after exhausting retries

### 3. User-Specified Model Selection

Users can now request specific models in their messages:

**Supported patterns:**
- "use qwen" → Uses Ollama Qwen 3.5 9B (local, latest best small model, 256K context)
- "use ollama" → Uses Ollama Qwen 2.5 Coder 32B (code model)
- "use bedrock" → Uses AWS Bedrock
- "use claude" or "use anthropic" → Uses Anthropic API
- "use vertex" → Uses Google Vertex AI
- "use google" → Uses Google AI

**Examples:**
```
@audrey please use your local qwen to do a web search for solarpunk

@audrey using bedrock, summarize this document

@audrey with mistral, help me debug this error
```

The system detects these patterns and passes the preference to the LLM router, which then uses that specific model (without fallback, since the user explicitly requested it).

## Configuration

The improvements work with existing configuration. No changes needed to `.env` or other config files.

## Testing

To test the improvements:

1. **Test automatic fallback:**
   - Disable Bedrock or trigger rate limits
   - Send a message to Audrey
   - Watch logs to see automatic fallback to alternative models

2. **Test longer retry delays:**
   - Trigger a rate limit (429) or server error (5xx)
   - Observe longer wait times between retries (5s, 15s instead of 1s, 3s)

3. **Test user-specified models:**
   ```
   @audrey use qwen to help me with this code
   @audrey please use bedrock to analyze this document
   ```

## Benefits

1. **More resilient:** System continues working even when primary model is unavailable
2. **Cost-effective:** Automatically falls back to free local models when cloud models fail
3. **User control:** Users can choose which model to use for specific tasks
4. **Better retry behavior:** Longer delays between retries give services more time to recover

## Future Improvements

- Add model preference persistence per user
- Add model performance tracking
- Add cost tracking per user/conversation
- Add automatic model selection based on task complexity and cost

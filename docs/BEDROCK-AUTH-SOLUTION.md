# Bedrock Authentication Issue - Root Cause & Solutions

## Problem Summary

The bot can't access Bedrock inference profiles using your bearer token, but Claude Code can access them using AWS SDK authentication.

## Root Cause

### Your Setup Has Two AWS Identities:

1. **IAM User** (used by bearer token): `arn:aws:iam::YOUR_AWS_ACCOUNT_ID:user/your-iam-user`
   - Account: YOUR_AWS_ACCOUNT_ID (your account)
   - Limited to cross-region models in your account
   - ❌ Cannot access inference profiles in other accounts

2. **SSO Role** (used by Claude Code): `BedrockDeveloper` in account BEDROCK_SHARED_ACCOUNT_ID
   - Via AWS SSO profile: `BedrockDeveloper-BEDROCK_SHARED_ACCOUNT_ID`
   - Has direct access to account BEDROCK_SHARED_ACCOUNT_ID (AWS Bedrock shared account)
   - ✅ Can access global inference profiles

### The Models:

- **Inference Profile ARN**: `arn:aws:bedrock:us-west-1:BEDROCK_SHARED_ACCOUNT_ID:inference-profile/global.anthropic.claude-opus-4-6-v1`
  - Lives in account BEDROCK_SHARED_ACCOUNT_ID
  - Requires cross-account permissions
  - Works with SSO role, doesn't work with bearer token

- **Cross-Region Model ID**: `us.anthropic.claude-sonnet-4-5-20250929-v1:0`
  - Available in your account (YOUR_AWS_ACCOUNT_ID)
  - Works with bearer token ✅

## Why Claude Code Works

Claude Code uses the AWS SDK credential chain, which:
1. Looks for AWS credentials in `~/.aws/config`
2. Finds the `BedrockDeveloper-BEDROCK_SHARED_ACCOUNT_ID` SSO profile
3. Assumes the BedrockDeveloper role in account BEDROCK_SHARED_ACCOUNT_ID
4. Has access to inference profiles

## Why Your Bot Doesn't Work

Your bot uses:
- Bearer token authentication (`AWS_BEARER_TOKEN_BEDROCK`)
- Token is for IAM user in account YOUR_AWS_ACCOUNT_ID
- Cannot access resources in account BEDROCK_SHARED_ACCOUNT_ID
- Gets 403 error: "no resource-based policy allows the bedrock:InvokeModel action"

---

## Solution 1: Use Cross-Region Model ID (Quick Fix) ✅

**Easiest and recommended for now.**

### Update `.env`:

```env
AWS_REGION=us-west-1
BEDROCK_MODEL_ID=us.anthropic.claude-sonnet-4-5-20250929-v1:0
AWS_BEARER_TOKEN_BEDROCK=YOUR_BASE64_ENCODED_BEARER_TOKEN
```

### Or use the alias:

```bash
alias bedrock-bot="export CLAUDE_CODE_USE_BEDROCK=1; export AWS_REGION=us-west-1; export BEDROCK_MODEL_ID='us.anthropic.claude-sonnet-4-5-20250929-v1:0'; export AWS_BEARER_TOKEN_BEDROCK='YOUR_BASE64_ENCODED_BEARER_TOKEN'"
```

### Test it:

```bash
# Test the API call directly
AWS_REGION=us-west-1 \
  BEDROCK_MODEL_ID='us.anthropic.claude-sonnet-4-5-20250929-v1:0' \
  AWS_BEARER_TOKEN_BEDROCK='<your-token>' \
  npx tsx test-bedrock-call.ts
```

### Pros:
- ✅ Works immediately
- ✅ No code changes needed
- ✅ Uses existing bearer token

### Cons:
- ❌ Limited to Sonnet 4.5 (Opus not available in cross-region format with your account)
- ❌ Can't use global inference profiles

---

## Solution 2: Add AWS SDK Authentication (Better Long-term) 🚀

**Allows using SSO role like Claude Code does.**

### Step 1: Modify BedrockAdapter to Support AWS SDK

The adapter needs to support two authentication modes:

```typescript
export class BedrockAdapter extends LLMAdapter {
  private region: string;
  private bearerToken?: string;
  private useAwsSdk: boolean;

  constructor(config: LLMConfig, region = 'us-east-1', bearerToken?: string) {
    super(config);
    this.region = region;
    this.bearerToken = bearerToken;
    this.useAwsSdk = !bearerToken; // Use AWS SDK if no bearer token
  }

  async chat(messages: LLMMessage[], tools?: LLMTool[]): Promise<LLMResponse> {
    if (this.useAwsSdk) {
      return this.chatWithAwsSdk(messages, tools);
    } else {
      return this.chatWithBearerToken(messages, tools);
    }
  }

  private async chatWithAwsSdk(messages: LLMMessage[], tools?: LLMTool[]): Promise<LLMResponse> {
    const { BedrockRuntimeClient, ConverseCommand } =
      await import('@aws-sdk/client-bedrock-runtime');

    const client = new BedrockRuntimeClient({ region: this.region });

    // Build request (same as bearer token version)
    const systemMessage = messages.find(m => m.role === 'system');
    const nonSystemMessages = messages.filter(m => m.role !== 'system');

    const input: any = {
      modelId: this.config.model,
      messages: nonSystemMessages.map(msg => ({
        role: msg.role,
        content: [{ text: msg.content }],
      })),
      inferenceConfig: {
        maxTokens: this.config.max_tokens ?? 4096,
        temperature: this.config.temperature ?? 0.7,
      },
    };

    if (systemMessage) {
      input.system = [{ text: systemMessage.content }];
    }

    if (tools && tools.length > 0) {
      input.toolConfig = {
        tools: tools.map(tool => ({
          toolSpec: {
            name: tool.name,
            description: tool.description,
            inputSchema: { json: tool.input_schema },
          },
        })),
      };
    }

    const command = new ConverseCommand(input);
    const response = await client.send(command);

    // Extract response (same as bearer token version)
    const content = response.output?.message?.content ?? [];
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
        input_tokens: response.usage?.inputTokens || 0,
        output_tokens: response.usage?.outputTokens || 0,
        cost_usd: this.calculateCost(
          response.usage?.inputTokens || 0,
          response.usage?.outputTokens || 0,
          this.config.model
        ),
      },
      model: this.config.model,
      provider: 'bedrock',
    };
  }

  private async chatWithBearerToken(/* ... existing implementation ... */) {
    // Keep existing bearer token implementation
  }
}
```

### Step 2: Configure Environment

Instead of bearer token, use AWS profile:

```env
AWS_REGION=us-west-1
AWS_PROFILE=BedrockDeveloper-BEDROCK_SHARED_ACCOUNT_ID
BEDROCK_MODEL_ID=arn:aws:bedrock:us-west-1:BEDROCK_SHARED_ACCOUNT_ID:inference-profile/global.anthropic.claude-opus-4-6-v1
# Don't set AWS_BEARER_TOKEN_BEDROCK - triggers AWS SDK mode
```

### Step 3: Ensure SSO Session is Active

```bash
# Login to SSO
aws sso login --profile BedrockDeveloper-BEDROCK_SHARED_ACCOUNT_ID

# Test it works
aws bedrock-runtime invoke-model \
  --model-id "arn:aws:bedrock:us-west-1:BEDROCK_SHARED_ACCOUNT_ID:inference-profile/global.anthropic.claude-opus-4-6-v1" \
  --profile BedrockDeveloper-BEDROCK_SHARED_ACCOUNT_ID \
  --region us-west-1 \
  --body '{"prompt": "Hello", "max_tokens": 10}' \
  output.json
```

### Pros:
- ✅ Can use Opus via inference profiles
- ✅ Uses same auth as Claude Code
- ✅ More flexible (SSO, IAM roles, credential chain)
- ✅ Better security (no long-lived tokens)

### Cons:
- ❌ Requires code changes
- ❌ Needs SSO session refresh periodically
- ❌ More complex setup

---

## Testing Scripts

### Test Bearer Token + Cross-Region Model:

```bash
npx tsx test-bedrock-call.ts
```

### Test All Model Formats:

```bash
npx tsx test-model-formats.ts
```

---

## Recommendation

**For immediate use:** Solution 1 (cross-region model ID)
- Quick, works now
- Sonnet 4.5 is plenty powerful

**For production:** Solution 2 (AWS SDK auth)
- Better security
- Access to Opus models
- Matches Claude Code's behavior

---

## Available Models (with your credentials)

| Model | Model ID | Bearer Token | AWS SDK |
|-------|----------|--------------|---------|
| Sonnet 4.5 | `us.anthropic.claude-sonnet-4-5-20250929-v1:0` | ✅ | ✅ |
| Opus 4.6 | `arn:aws:bedrock:us-west-1:BEDROCK_SHARED_ACCOUNT_ID:inference-profile/global.anthropic.claude-opus-4-6-v1` | ❌ | ✅ |
| Opus 4 | `us.anthropic.claude-opus-4-20250514-v1:0` | ❌ | ❌ |
| Haiku 3.5 | `us.anthropic.claude-haiku-3-5-20241022-v1:0` | ❌ | ❌ |

---

## Quick Start

```bash
# 1. Update .env with cross-region model ID
sed -i '' 's/BEDROCK_MODEL_ID=.*/BEDROCK_MODEL_ID=us.anthropic.claude-sonnet-4-5-20250929-v1:0/' .env

# 2. Test it
npm run coordinator

# 3. If you want Opus, implement Solution 2
```

---

## Further Reading

- [AWS Bedrock Inference Profiles](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles.html)
- [AWS SDK Credential Chain](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/setting-credentials-node.html)
- [AWS SSO Configuration](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sso.html)

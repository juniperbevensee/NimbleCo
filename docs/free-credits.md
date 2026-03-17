# Getting Free AI Credits

Run NimbleCo with **minimal to zero cost** by using free cloud credits and local models.

## Strategy Overview

```
Local Models (Mac Mini)
├─ Quick tasks: Mistral 7B → FREE
├─ Code tasks: QwenCoder 3 Next 32B → FREE
└─ Reviews: DeepSeek Coder 16B → FREE

Cloud (Free Tier)
├─ Complex reasoning: Vertex AI Gemini → $300 FREE
├─ Fallback: AWS Bedrock Claude → FREE TIER
└─ Emergency: Azure GPT-4 → $200 FREE

Paid (Only if needed)
└─ Best quality: Anthropic Claude → $20-50/month
```

**Total cost with smart routing: $0-10/month**

---

## Option 1: Google Cloud (Vertex AI) - $300 Free

**Best for:** Gemini models, generous free tier

### Step 1: Create Google Cloud Account

1. Go to https://cloud.google.com/free
2. Click "Get started for free"
3. Sign in with Google account
4. **Enter credit card** (required but won't be charged)
5. Get **$300 in credits** valid for 90 days

### Step 2: Enable Vertex AI API

```bash
# Install gcloud CLI
brew install google-cloud-sdk

# Initialize
gcloud init

# Enable required APIs
gcloud services enable aiplatform.googleapis.com
gcloud services enable storage.googleapis.com

# Create service account
gcloud iam service-accounts create nimbleco \
    --description="NimbleCo AI Agent" \
    --display-name="NimbleCo"

# Grant permissions
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
    --member="serviceAccount:nimbleco@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/aiplatform.user"

# Create and download key
gcloud iam service-accounts keys create ~/nimbleco-key.json \
    --iam-account=nimbleco@YOUR_PROJECT_ID.iam.gserviceaccount.com
```

### Step 3: Configure NimbleCo

Add to `.env`:
```bash
VERTEX_AI_PROJECT=your-project-id
VERTEX_AI_LOCATION=us-central1
GOOGLE_APPLICATION_CREDENTIALS=/path/to/nimbleco-key.json

# Use Vertex for complex tasks
LLM_PROVIDER_COMPLEX=vertex
LLM_MODEL_COMPLEX=gemini-pro
```

### Available Models

| Model | Input Cost | Output Cost | Best For |
|-------|------------|-------------|----------|
| gemini-pro | $0.50/1M | $1.50/1M | General tasks |
| gemini-pro-vision | $0.50/1M | $1.50/1M | Image analysis |
| gemini-1.5-flash | $0.075/1M | $0.30/1M | Fast tasks |

**$300 = ~200M tokens with Gemini Pro**

### Monitoring Credits

```bash
# Check remaining credits
gcloud billing accounts list

# View usage
gcloud logging read "resource.type=aiplatform.googleapis.com/Endpoint" \
    --limit 50 --format json
```

---

## Option 2: AWS Bedrock - Free Tier

**Best for:** Claude models, diverse options

### Step 1: Create AWS Account

1. Go to https://aws.amazon.com/free
2. Click "Create a Free Account"
3. Enter email and create password
4. **Enter credit card** (required)
5. Verify phone number
6. Select "Free" tier plan

### Step 2: Request Bedrock Access

```bash
# Install AWS CLI
brew install awscli

# Configure credentials
aws configure
# Enter: Access Key ID, Secret Access Key, Region (us-east-1)

# Request model access (takes ~1 hour to approve)
# Go to: https://console.aws.amazon.com/bedrock
# Click "Model access" → Request access to:
#   - Anthropic Claude 3.5 Sonnet
#   - Meta Llama 3.1
#   - Amazon Titan
```

### Step 3: Configure NimbleCo

Add to `.env`:
```bash
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_BEDROCK_REGION=us-east-1

# Use Bedrock for fallback
LLM_PROVIDER_FALLBACK=bedrock
LLM_MODEL_FALLBACK=anthropic.claude-3-5-sonnet-20241022-v2:0
```

### Free Tier Limits

**Bedrock Free Tier (First 2 months):**
- Up to 100K tokens per month (varies by model)
- After 2 months: Pay-as-you-go

**Claude 3.5 Sonnet pricing:**
- Input: $3/1M tokens
- Output: $15/1M tokens

### Monitoring Usage

```bash
# Check Bedrock usage
aws bedrock-runtime get-usage --region us-east-1

# Set billing alarm
aws cloudwatch put-metric-alarm \
    --alarm-name bedrock-cost-alert \
    --alarm-description "Alert when Bedrock costs exceed $10" \
    --metric-name EstimatedCharges \
    --namespace AWS/Billing \
    --statistic Maximum \
    --period 86400 \
    --threshold 10 \
    --comparison-operator GreaterThanThreshold
```

---

## Option 3: Azure OpenAI - $200 Free

**Best for:** GPT-4, GPT-3.5-turbo

### Step 1: Create Azure Account

1. Go to https://azure.microsoft.com/free
2. Click "Start free"
3. Sign in with Microsoft account
4. **Enter credit card** (required)
5. Get **$200 in credits** valid for 30 days

### Step 2: Create Azure OpenAI Resource

```bash
# Install Azure CLI
brew install azure-cli

# Login
az login

# Create resource group
az group create --name nimbleco --location eastus

# Create Azure OpenAI resource
az cognitiveservices account create \
    --name nimbleco-openai \
    --resource-group nimbleco \
    --kind OpenAI \
    --sku S0 \
    --location eastus \
    --yes

# Get keys
az cognitiveservices account keys list \
    --name nimbleco-openai \
    --resource-group nimbleco
```

### Step 3: Configure NimbleCo

Add to `.env`:
```bash
AZURE_OPENAI_API_KEY=your-azure-key
AZURE_OPENAI_ENDPOINT=https://nimbleco-openai.openai.azure.com/
AZURE_OPENAI_DEPLOYMENT=gpt-4

# Use Azure for specific tasks
LLM_PROVIDER_COMPLEX=azure
LLM_MODEL_COMPLEX=gpt-4
```

### Available Models

| Model | Input Cost | Output Cost |
|-------|------------|-------------|
| gpt-4-turbo | $10/1M | $30/1M |
| gpt-4 | $30/1M | $60/1M |
| gpt-3.5-turbo | $0.50/1M | $1.50/1M |

**$200 = ~6.6M tokens with GPT-4 Turbo**

---

## Cost Comparison Table

| Provider | Free Credits | Duration | Best Models | Setup Time |
|----------|--------------|----------|-------------|------------|
| **Ollama (Local)** | ∞ FREE | Forever | Qwen 3.5, Llama 3.1 | 5 min |
| **Vertex AI** | $300 | 90 days | Gemini Pro, Flash | 15 min |
| **AWS Bedrock** | Free tier | 2 months | Claude 3.5, Llama | 20 min |
| **Azure OpenAI** | $200 | 30 days | GPT-4, GPT-3.5 | 15 min |
| **Anthropic** | None | N/A | Claude Opus 4.5 | 2 min |

---

## Optimal Configuration (Max Free Usage)

### .env Configuration

```bash
# Primary: Local models (FREE forever)
OLLAMA_URL=http://localhost:11434
LLM_PROVIDER_QUICK=ollama
LLM_MODEL_QUICK=mistral:7b
LLM_PROVIDER_CODE=ollama
LLM_MODEL_CODE=qwen2.5-coder:32b

# Secondary: Vertex AI (FREE $300 for 90 days)
VERTEX_AI_PROJECT=your-project
VERTEX_AI_LOCATION=us-central1
GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json
LLM_PROVIDER_COMPLEX=vertex
LLM_MODEL_COMPLEX=gemini-pro

# Tertiary: Bedrock (FREE tier for 2 months)
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-key
AWS_SECRET_ACCESS_KEY=your-secret
LLM_PROVIDER_FALLBACK=bedrock
LLM_MODEL_FALLBACK=anthropic.claude-3-5-sonnet-20241022-v2:0

# Cost limit (switch to local after this)
LLM_DAILY_COST_LIMIT=5.00
```

### Routing Strategy

The LLM router automatically chooses:

1. **Quick tasks** → Ollama Mistral 7B (FREE)
2. **Code tasks** → Ollama Qwen 3.5 32B (FREE)
3. **Complex reasoning** → Vertex Gemini Pro (FREE $300)
4. **Daily limit exceeded** → Ollama Llama 3.1 8B (FREE)
5. **Ollama down** → Bedrock Claude (FREE tier)

**Result: Runs entirely free for 2-3 months!**

---

## Monitoring Total Costs

Create `scripts/check-costs.ts`:

```typescript
import { LLMRouter } from '@nimbleco/llm-adapters';

const router = new LLMRouter(5.00); // $5 daily limit

// Check throughout the day
console.log(`Today's cost: $${router.getDailyCost().toFixed(2)}`);
console.log(`Remaining budget: $${router.getRemainingBudget().toFixed(2)}`);

// Get cost breakdown
const costs = {
  ollama: 0,  // Always free
  vertex: vertexCost,
  bedrock: bedrockCost,
  anthropic: anthropicCost,
};

console.table(costs);
```

Run it:
```bash
npm run cost:check
```

---

## Tips for Staying Free

### 1. Prefer Local Models

Your Mac Mini can run:
- **Qwen 3.5 32B** - Best for code (fits in 32GB RAM)
- **Llama 3.1 8B** - Fast general tasks
- **DeepSeek Coder 16B** - Code review specialist
- **Mistral 7B** - Lightning fast for simple tasks

**Run multiple models simultaneously:**
```bash
# Terminal 1
ollama run qwen2.5-coder:32b

# Terminal 2
ollama run mistral:7b

# Coordinator picks the right one per task
```

### 2. Use Vertex AI Aggressively (While You Have Credits)

```bash
# $300 credit = approximately:
# - 200M tokens with Gemini Pro
# - 1B tokens with Gemini Flash
# - 90 days to use it

# Use it for all complex tasks until it runs out
```

### 3. Cache Prompts

```typescript
// Anthropic supports prompt caching (50% cost reduction)
const response = await claude.messages.create({
  model: 'claude-sonnet-4-5-20250929',
  messages: [{
    role: 'user',
    content: [{
      type: 'text',
      text: longSystemPrompt,
      cache_control: { type: 'ephemeral' }  // Cache this!
    }]
  }]
});
```

### 4. Batch Requests

```typescript
// Instead of 10 separate LLM calls
const results = await Promise.all(tasks.map(t => llm.chat(...)));

// Make 1 call with combined context
const batch = `Analyze these 10 PRs: ${tasks.join('\n---\n')}`;
const result = await llm.chat([{ role: 'user', content: batch }]);
```

### 5. Monitor & Alert

```bash
# Add to .env
LLM_DAILY_COST_LIMIT=5.00
ALERT_WEBHOOK=https://mattermost.com/hooks/your-webhook

# Get notified in Mattermost when approaching limit
```

---

## FAQ

**Q: Will I be charged after free credits run out?**
A: Only if you don't set billing limits. Set alerts at $5, $10, $15 to catch overages.

**Q: Which provider is truly free forever?**
A: Only Ollama (local). Everything else requires credit card and has limits.

**Q: Can I stack free credits?**
A: Yes! Use all three (Vertex + Bedrock + Azure) = $500+ in free compute.

**Q: What happens when Mac Mini is offline?**
A: Router falls back to cloud providers automatically.

**Q: Best bang for buck after free credits?**
A: Claude Haiku ($0.80/$4 per 1M tokens) or Gemini Flash ($0.075/$0.30 per 1M tokens)

---

## Next Steps

1. Set up Ollama on Mac Mini → [Installation Guide](./mac-mini-setup.md)
2. Configure all free cloud providers (takes ~1 hour total)
3. Deploy NimbleCo with cost monitoring
4. Watch costs stay at $0 for months!

**Expected total cost for 2-5 users:**
- **Months 1-2**: $0 (free credits + local)
- **Months 3-6**: $5-15/month (mix of local + cheap cloud)
- **Months 6+**: $10-30/month (stable, optimized usage)

---

*Last updated: March 2025*

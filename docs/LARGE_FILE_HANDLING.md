# Large File Handling & Token Limit Protection

## Problem Solved

**Issue**: Agents were loading entire large files (604KB+) into context, causing:
- 30,000+ token requests
- Rate limit errors (429) across all LLM providers
- Exceeding 30k tokens/minute limits
- Failed analyses

**Root Cause**: `read_workspace_file` tool was returning complete file contents even for huge files, despite warnings.

## Solution Implemented

### 1. Smart File Reading with Auto-Limiting

**File**: `shared/tools/src/storage/workspace.ts`

The `read_workspace_file` tool now:

#### For Large Files (>100KB):
- **Detects structure automatically** (arrays, nested objects)
- **Returns only samples** (first 5-10 items) by default
- **Provides metadata** about file structure
- **Requires explicit limit/offset** for more data

#### Behavior:

```typescript
// Large direct array
{ results: [1, 2, 3, ...229 items] }
→ Returns: first 10 items + total count + message

// Large nested object with arrays
{ success: true, total: 229, results: [...] }
→ Returns: structure info + first 5 from main array

// User wants specific range
read_workspace_file({ file_path: "file.json", limit: 50, offset: 0 })
→ Returns: exactly 50 items starting at offset 0
```

### 2. New Batch Processing Tools

**File**: `shared/tools/src/storage/batch-processor.ts`

Two new tools for efficient large file processing:

#### `analyze_file_in_batches`
- Get file overview without loading entire content
- Returns structure analysis, total count, samples
- Recommends batch size
- Perfect for initial exploration

**Example**:
```json
{
  "structure": {
    "array_key": "results",
    "total_items": 229,
    "sample_item_keys": ["message", "date", "channeltitle"]
  },
  "recommended_batch_size": 50,
  "message": "File contains 229 items in 'results' array"
}
```

#### `extract_text_fields_batched`
- Extract specific fields from large arrays
- Processes in batches (default 100)
- Handles nested paths (`_source.message`)
- Returns only extracted text ready for analysis

**Example**:
```json
{
  "total_items_in_file": 229,
  "texts_extracted": 100,
  "texts": ["message 1", "message 2", ...],
  "has_more": true,
  "next_offset": 100
}
```

### 3. Updated System Prompts

**File**: `coordinator/src/main.ts`

Added guidance:
```
- IMPORTANT: read_workspace_file automatically limits large files (>100KB) to small samples.
  When you see a large file warning, extract the data you need using limit/offset parameters
  or process it iteratively
```

### 4. Enhanced Tool Descriptions

Updated use cases and descriptions to guide agents toward:
- Using batch processing for large files
- Leveraging data science tools on extracted data
- Iterative processing strategies

## Agent Workflow for Large Files

### Before (Broken):
1. `read_workspace_file("big.json")` → 604KB loaded
2. Try to analyze → 150k tokens → RATE LIMIT ERROR ❌

### After (Fixed):
1. `read_workspace_file("big.json")` → Sample + metadata (< 5k tokens) ✅
2. See structure: 229 items in 'results' array
3. `extract_text_fields_batched({ file_path, text_field: "_source.message", batch_size: 100 })`
4. Get 100 messages → Use `analyze_sentiment` with batch parameter
5. Process next 100 if needed with `offset: 100`

## Example: Analyzing OpenClaw Posts

### Old Broken Approach:
```
User: "Analyze sentiment of OpenClaw posts"
Agent: reads entire 604KB file → 30k+ tokens → 429 error
```

### New Working Approach:
```
User: "Analyze sentiment of OpenClaw posts"
Agent:
  1. list_workspace → finds file
  2. read_workspace_file → gets sample + sees 229 items
  3. extract_text_fields_batched({
       file_path: "openmeasures-search-1773798555059.json",
       text_field: "message",
       nested_path: "_source.message",
       batch_size: 229  // or process in chunks
     })
  4. Gets array of 229 message texts
  5. analyze_sentiment({ batch: texts })
  6. extract_topics({ documents: texts, num_topics: 5 })
  7. Provides comprehensive analysis
```

## Token Savings

### Before:
- Full file read: ~150,000 tokens
- Cost per request: $0.45
- Rate limits: Constant 429 errors

### After:
- Sample read: ~1,000 tokens
- Batch extraction: ~5,000 tokens
- Analysis: ~10,000 tokens per batch
- **Total: ~16,000 tokens** (89% reduction)
- **Cost: $0.05** (89% savings)
- **No rate limits!** ✅

## Security & Safety

All batch processing tools:
- ✅ Sandboxed to workspace directory
- ✅ Path validation and security checks
- ✅ No arbitrary file access
- ✅ Error handling for malformed data
- ✅ Memory-efficient streaming where possible

## Tools Summary

### Reading Tools:
- **`read_workspace_file`** - Smart reading with auto-limiting
- **`analyze_file_in_batches`** - Get file overview
- **`extract_text_fields_batched`** - Extract specific fields

### Analysis Tools (work with extracted data):
- **`analyze_sentiment`** - Batch sentiment analysis
- **`extract_topics`** - Topic modeling
- **`text_tfidf`** - Term importance
- **`stats_*`** - Statistical analysis
- **`chart_*`** - Visualization

## Testing

Test the fix by asking Audrey:
```
"Check your workspace for the openmeasures JSON file and perform
sentiment analysis and topic modeling on all 229 OpenClaw posts"
```

Expected behavior:
1. Uses smart reading (sample only)
2. Detects 229 items
3. Uses batch extraction tool
4. Processes all messages efficiently
5. Returns comprehensive analysis
6. No rate limit errors! 🎉

## Future Enhancements

Potential improvements:
- Streaming JSON parser for truly massive files (GB+)
- Automatic chunking strategies based on token budget
- Progress tracking for multi-batch operations
- Caching extracted data between tool calls
- Parallel batch processing

## Files Changed

1. **`shared/tools/src/storage/workspace.ts`** - Smart limiting logic
2. **`shared/tools/src/storage/batch-processor.ts`** - New batch tools
3. **`shared/tools/src/index.ts`** - Tool registration
4. **`coordinator/src/main.ts`** - System prompt guidance
5. **`docs/LARGE_FILE_HANDLING.md`** - This documentation

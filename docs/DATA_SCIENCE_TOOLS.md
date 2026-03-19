# Data Science Tools for NimbleCo

Comprehensive data analysis, visualization, NLP, and file conversion tools ported from cantrip-integrations.

## Overview

Agents now have access to professional-grade data science capabilities:
- **Advanced Statistics**: Summary stats, correlation, regression, moving averages
- **Data Visualization**: Line, bar, scatter, pie charts (saved as PNG)
- **NLP & Text Analysis**: Sentiment analysis, topic modeling, TF-IDF, document similarity
- **File Conversion**: CSV ↔ JSON, Excel, YAML support
- **Built-in TypeScript**: No unsafe code execution, sandboxed and secure

## Installation

All dependencies are already installed:
```bash
simple-statistics    # Statistical calculations
chartjs-node-canvas  # Chart generation
natural             # NLP and text processing
sentiment           # Sentiment analysis
xlsx                # Excel file support
js-yaml             # YAML parsing
papaparse           # CSV parsing
```

## Tool Categories

### 📊 Statistics Tools

#### Basic Statistics
- **`calculate_statistics`** - Mean, median, mode, std dev, min, max
- **`stats_advanced_summary`** - Includes quartiles, IQR, skewness, variance

#### Advanced Analysis
- **`stats_correlation`** - Pearson correlation with interpretation
- **`stats_regression`** - Linear regression with R², RMSE, predictions
- **`stats_moving_average`** - Simple or exponential moving average

### 📈 Chart Generation Tools

All charts are saved as PNG files to the workspace.

#### Available Charts
- **`chart_line`** - Line charts (single or multiple series)
- **`chart_bar`** - Bar charts (vertical or horizontal)
- **`chart_scatter`** - Scatter plots with optional regression line
- **`chart_pie`** - Pie or doughnut charts

#### Features
- Customizable colors, titles, axis labels
- Multiple datasets support
- Auto-sizing (default 800x600)
- Saved to workspace for easy access

### 🔤 NLP & Text Analysis Tools

#### Sentiment Analysis
- **`analyze_sentiment`** - Keyword-based sentiment with confidence scores
  - Handles negations and intensifiers
  - Batch processing support
  - Returns score (-1 to 1), label, confidence

#### Topic Modeling
- **`extract_topics`** - TF-IDF based keyword extraction
  - Configurable number of topics
  - Filters stop words
  - Returns top keywords per topic

#### Advanced NLP
- **`text_tfidf`** - Calculate TF-IDF scores for document importance
- **`text_similarity`** - Cosine similarity between documents

### 📁 File Conversion Tools

#### CSV & JSON
- **`parse_csv`** - Parse CSV to JSON structure
- **`generate_csv`** - Create CSV from JSON data
- **`convert_csv_json`** - Bidirectional CSV ↔ JSON conversion (file-based)

#### Excel Support
- **`read_excel`** - Read .xlsx files to JSON
- **`write_excel`** - Write JSON to .xlsx files

#### YAML Support
- **`convert_yaml_json`** - YAML to JSON
- **`convert_json_yaml`** - JSON to YAML

## Usage Examples

### Example 1: Sentiment Analysis on OpenClaw Posts

```
User: "Analyze sentiment of the OpenClaw posts in my workspace"

Agent:
1. Uses list_workspace to find the file
2. Uses read_workspace_file to load the JSON
3. Extracts message texts from the data
4. Uses analyze_sentiment with batch parameter
5. Provides summary with distribution and insights
```

### Example 2: Create a Chart

```
User: "Create a line chart showing monthly sales growth"

Agent:
1. Prepares the data (labels and values)
2. Uses chart_line with:
   - datasets: [{ label: "Sales", data: [100, 120, 150, 180] }]
   - labels: ["Jan", "Feb", "Mar", "Apr"]
   - output_path: "storage/workspace/sales_chart.png"
3. Returns the path to the saved chart
```

### Example 3: Statistical Analysis

```
User: "Calculate correlation between ad spend and sales"

Agent:
1. Uses stats_correlation with x=ad_spend, y=sales
2. Returns:
   - correlation: 0.92
   - interpretation: "very strong positive"
   - covariance: 245.6
```

### Example 4: File Conversion

```
User: "Convert this CSV file to Excel"

Agent:
1. Uses convert_csv_json to parse CSV to JSON
2. Uses write_excel to save as .xlsx file
3. Returns path to Excel file
```

## Agent Instructions

The system prompt now includes:

```
You have comprehensive data science tools:
* Statistics: calculate_statistics, stats_advanced_summary, stats_correlation,
  stats_regression, stats_moving_average
* Sentiment & Topics: analyze_sentiment, extract_topics, text_tfidf, text_similarity
* Charts (save as PNG): chart_line, chart_bar, chart_scatter, chart_pie
* File Conversion: convert_csv_json, read_excel, write_excel, convert_yaml_json,
  convert_json_yaml, parse_csv, generate_csv

When asked to perform data analysis, create visualizations, or convert file formats,
use these built-in tools rather than writing code.

Charts are saved to the workspace - tell the user the file path so they can view it.
```

## What Changed

### Files Created
1. **`shared/tools/src/compute/data-science.ts`** - Basic data science tools
   - Sentiment analysis
   - Topic modeling (TF-IDF)
   - CSV parsing
   - Basic statistics

2. **`shared/tools/src/compute/data-science-advanced.ts`** - Advanced features
   - Chart generation (all types)
   - Advanced statistics (correlation, regression, moving average)
   - NLP tools (TF-IDF, similarity)
   - File conversions (Excel, YAML)

### Files Modified
1. **`shared/tools/src/index.ts`** - Registered new tools
2. **`coordinator/src/main.ts`** - Updated system prompt with data science instructions
3. **`scripts/restart.sh`** - Added dashboard URL display
4. **`scripts/dev.sh`** - Added dashboard URL display

### Packages Added
```json
{
  "dependencies": {
    "simple-statistics": "^7.8.8",
    "chartjs-node-canvas": "^5.0.0",
    "natural": "^8.1.0",
    "sentiment": "^5.0.2",
    "xlsx": "latest",
    "js-yaml": "latest",
    "papaparse": "latest"
  },
  "devDependencies": {
    "@types/js-yaml": "latest",
    "@types/papaparse": "latest"
  }
}
```

## Tool Count

**Total Data Science Tools: 22**

- Statistics: 5 tools
- Charts: 4 tools
- NLP: 4 tools
- File Conversion: 7 tools
- Basic: 2 tools (CSV parse/generate)

## Security

All tools are:
- ✅ Sandboxed to workspace directory
- ✅ No arbitrary code execution
- ✅ TypeScript type-safe
- ✅ Input validated
- ✅ Error handling included

## Future Enhancements

Potential additions based on cantrip-integrations:
- Data aggregation (group by, aggregate)
- Missing value handling (mean/median fill, forward-fill)
- Data filtering (conditional row/column selection)
- More advanced NLP (text classification, keyword extraction)
- Additional chart types (histogram from raw data, box plots)
- Time series forecasting

## Testing

Test with Audrey by asking:
```
"Check your workspace for the openmeasures JSON file and perform topic modeling
and sentiment analysis on the OpenClaw posts"
```

Expected behavior:
1. Uses `list_workspace` to find file
2. Uses `read_workspace_file` to read it
3. Uses `analyze_sentiment` for sentiment analysis
4. Uses `extract_topics` for topic modeling
5. Provides comprehensive analysis results

## Credits

Tools ported and adapted from [cantrip-integrations](https://github.com/deepfates/cantrip-integrations)
data science module, with modifications for NimbleCo's tool architecture.

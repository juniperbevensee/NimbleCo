/**
 * Data Science tools for analysis and manipulation
 * TypeScript implementations of sentiment analysis, topic modeling, and data processing
 */

import { Tool, ToolContext } from '../base';

/**
 * Simple sentiment analysis using keyword-based approach
 * More sophisticated than regex, but doesn't require external NLP libraries
 */
function analyzeSentiment(text: string): {
  score: number;
  label: 'positive' | 'negative' | 'neutral';
  confidence: number;
} {
  const positiveWords = [
    'good', 'great', 'excellent', 'amazing', 'awesome', 'fantastic', 'wonderful',
    'brilliant', 'perfect', 'outstanding', 'exceptional', 'superb', 'magnificent',
    'love', 'like', 'enjoy', 'happy', 'pleased', 'delighted', 'satisfied',
    'best', 'better', 'superior', 'impressive', 'remarkable', 'extraordinary',
    'helpful', 'useful', 'valuable', 'effective', 'efficient', 'productive',
    'innovative', 'revolutionary', 'groundbreaking', 'powerful', 'robust',
    'success', 'successful', 'win', 'winning', 'achieve', 'accomplish',
  ];

  const negativeWords = [
    'bad', 'terrible', 'awful', 'horrible', 'poor', 'worst', 'disappointing',
    'disgusting', 'pathetic', 'useless', 'worthless', 'inadequate', 'inferior',
    'hate', 'dislike', 'despise', 'detest', 'unhappy', 'sad', 'upset',
    'angry', 'frustrated', 'annoyed', 'irritated', 'dissatisfied', 'displeased',
    'problem', 'issue', 'bug', 'error', 'fail', 'failure', 'broken', 'damaged',
    'difficult', 'hard', 'complicated', 'confusing', 'unclear', 'ambiguous',
    'slow', 'sluggish', 'unresponsive', 'crash', 'freeze', 'hang',
    'waste', 'wasted', 'loss', 'lose', 'losing', 'lost',
  ];

  const intensifiers = ['very', 'extremely', 'incredibly', 'really', 'absolutely', 'totally'];
  const negations = ['not', 'no', 'never', 'none', 'nothing', 'neither', "n't"];

  const words = text.toLowerCase().split(/\s+/);
  let positiveScore = 0;
  let negativeScore = 0;
  let intensity = 1.0;

  for (let i = 0; i < words.length; i++) {
    const word = words[i];

    // Check for intensifiers in previous word
    if (i > 0 && intensifiers.includes(words[i - 1])) {
      intensity = 1.5;
    }

    // Check for negations in previous 1-2 words
    const hasNegation = (i > 0 && negations.some(neg => words[i - 1].includes(neg))) ||
                       (i > 1 && negations.some(neg => words[i - 2].includes(neg)));

    if (positiveWords.includes(word)) {
      if (hasNegation) {
        negativeScore += intensity;
      } else {
        positiveScore += intensity;
      }
    } else if (negativeWords.includes(word)) {
      if (hasNegation) {
        positiveScore += intensity;
      } else {
        negativeScore += intensity;
      }
    }

    // Reset intensity
    if (!intensifiers.includes(word)) {
      intensity = 1.0;
    }
  }

  const totalScore = positiveScore + negativeScore;
  const normalizedScore = totalScore === 0 ? 0 : (positiveScore - negativeScore) / totalScore;

  let label: 'positive' | 'negative' | 'neutral';
  if (normalizedScore > 0.1) {
    label = 'positive';
  } else if (normalizedScore < -0.1) {
    label = 'negative';
  } else {
    label = 'neutral';
  }

  const confidence = Math.abs(normalizedScore);

  return { score: normalizedScore, label, confidence };
}

/**
 * Simple topic modeling using TF-IDF and keyword extraction
 */
function extractTopics(
  documents: string[],
  numTopics: number = 5,
  wordsPerTopic: number = 10
): Array<{ topic: number; words: Array<{ word: string; score: number }> }> {
  // Common stop words to filter out
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
    'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'can', 'this', 'that', 'these', 'those', 'i',
    'you', 'he', 'she', 'it', 'we', 'they', 'them', 'their', 'what', 'which',
    'who', 'when', 'where', 'why', 'how', 'all', 'each', 'every', 'some', 'any',
  ]);

  // Tokenize and clean documents
  const tokenizedDocs = documents.map(doc => {
    const words = doc.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 3 && !stopWords.has(word));
    return words;
  });

  // Calculate term frequency (TF)
  const termFreq: Map<string, Map<number, number>> = new Map();
  tokenizedDocs.forEach((words, docIdx) => {
    words.forEach(word => {
      if (!termFreq.has(word)) {
        termFreq.set(word, new Map());
      }
      const docFreq = termFreq.get(word)!;
      docFreq.set(docIdx, (docFreq.get(docIdx) || 0) + 1);
    });
  });

  // Calculate document frequency (DF) and IDF
  const docFreq: Map<string, number> = new Map();
  termFreq.forEach((docs, word) => {
    docFreq.set(word, docs.size);
  });

  const numDocs = documents.length;
  const idf: Map<string, number> = new Map();
  docFreq.forEach((df, word) => {
    idf.set(word, Math.log(numDocs / df));
  });

  // Calculate TF-IDF scores
  const tfidf: Map<string, number> = new Map();
  termFreq.forEach((docs, word) => {
    let totalTfIdf = 0;
    docs.forEach((tf, docIdx) => {
      const docLength = tokenizedDocs[docIdx].length;
      const normalizedTf = tf / docLength;
      totalTfIdf += normalizedTf * (idf.get(word) || 0);
    });
    tfidf.set(word, totalTfIdf);
  });

  // Sort by TF-IDF score and group into topics
  const sortedWords = Array.from(tfidf.entries())
    .sort((a, b) => b[1] - a[1]);

  const topics: Array<{ topic: number; words: Array<{ word: string; score: number }> }> = [];

  // Simplified topic grouping - in real LDA, we'd cluster related words
  // Here we just take top words and group them
  const wordsPerTopicActual = Math.ceil(sortedWords.length / numTopics);

  for (let i = 0; i < numTopics && i * wordsPerTopicActual < sortedWords.length; i++) {
    const topicWords = sortedWords
      .slice(i * wordsPerTopicActual, (i + 1) * wordsPerTopicActual)
      .slice(0, wordsPerTopic)
      .map(([word, score]) => ({ word, score }));

    if (topicWords.length > 0) {
      topics.push({ topic: i + 1, words: topicWords });
    }
  }

  return topics;
}

/**
 * CSV parsing and manipulation
 */
function parseCSV(
  csvText: string,
  options: { delimiter?: string; hasHeader?: boolean } = {}
): { headers: string[]; rows: string[][] } {
  const delimiter = options.delimiter || ',';
  const hasHeader = options.hasHeader !== false; // default true

  const lines = csvText.trim().split(/\r?\n/);
  const rows: string[][] = [];

  for (const line of lines) {
    // Simple CSV parsing - doesn't handle quoted delimiters perfectly
    // For production, use a library like papaparse
    const row = line.split(delimiter).map(cell => cell.trim());
    rows.push(row);
  }

  const headers = hasHeader ? rows.shift() || [] : rows[0].map((_, i) => `Column${i + 1}`);

  return { headers, rows };
}

function generateCSV(headers: string[], rows: string[][], delimiter: string = ','): string {
  const lines = [headers.join(delimiter)];
  rows.forEach(row => {
    lines.push(row.join(delimiter));
  });
  return lines.join('\n');
}

/**
 * Basic statistical functions
 */
function calculateStats(numbers: number[]): {
  mean: number;
  median: number;
  mode: number;
  stdDev: number;
  min: number;
  max: number;
  sum: number;
  count: number;
} {
  if (numbers.length === 0) {
    return { mean: 0, median: 0, mode: 0, stdDev: 0, min: 0, max: 0, sum: 0, count: 0 };
  }

  const sorted = [...numbers].sort((a, b) => a - b);
  const sum = numbers.reduce((a, b) => a + b, 0);
  const mean = sum / numbers.length;

  const median = numbers.length % 2 === 0
    ? (sorted[numbers.length / 2 - 1] + sorted[numbers.length / 2]) / 2
    : sorted[Math.floor(numbers.length / 2)];

  const freqMap = new Map<number, number>();
  numbers.forEach(n => freqMap.set(n, (freqMap.get(n) || 0) + 1));
  const mode = Array.from(freqMap.entries()).sort((a, b) => b[1] - a[1])[0][0];

  const variance = numbers.reduce((acc, n) => acc + Math.pow(n - mean, 2), 0) / numbers.length;
  const stdDev = Math.sqrt(variance);

  return {
    mean,
    median,
    mode,
    stdDev,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    sum,
    count: numbers.length,
  };
}

/**
 * Export tools
 */
export const dataScienceTools: Tool[] = [
  {
    name: 'analyze_sentiment',
    description: 'Analyze sentiment of text using keyword-based NLP. Returns sentiment score, label (positive/negative/neutral), and confidence.',
    category: 'compute',
    use_cases: [
      'Analyze sentiment of customer feedback',
      'Determine emotional tone of text',
      'Classify text as positive, negative, or neutral',
      'Measure sentiment in social media posts',
      'Analyze product reviews',
    ],
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Text to analyze for sentiment',
        },
        batch: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional: analyze multiple texts at once',
        },
      },
      required: [],
    },
    handler: async (input: any, context: ToolContext) => {
      if (input.batch && Array.isArray(input.batch)) {
        const results = input.batch.map((text: string) => analyzeSentiment(text));
        const avgScore = results.reduce((sum: number, r: ReturnType<typeof analyzeSentiment>) => sum + r.score, 0) / results.length;
        const distribution = {
          positive: results.filter((r: ReturnType<typeof analyzeSentiment>) => r.label === 'positive').length,
          negative: results.filter((r: ReturnType<typeof analyzeSentiment>) => r.label === 'negative').length,
          neutral: results.filter((r: ReturnType<typeof analyzeSentiment>) => r.label === 'neutral').length,
        };

        return {
          success: true,
          results,
          summary: {
            averageScore: avgScore,
            distribution,
            totalAnalyzed: results.length,
          },
        };
      }

      if (!input.text) {
        return { success: false, error: 'Either text or batch parameter is required' };
      }

      const result = analyzeSentiment(input.text);
      return { success: true, ...result };
    },
  },

  {
    name: 'extract_topics',
    description: 'Extract topics from a collection of documents using TF-IDF. Returns top keywords for each topic.',
    category: 'compute',
    use_cases: [
      'Find main themes in a document collection',
      'Identify key topics in customer feedback',
      'Analyze recurring themes in posts',
      'Discover topics in research papers',
      'Summarize main discussion points',
    ],
    parameters: {
      type: 'object',
      properties: {
        documents: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of text documents to analyze',
        },
        num_topics: {
          type: 'number',
          description: 'Number of topics to extract (default: 5)',
        },
        words_per_topic: {
          type: 'number',
          description: 'Number of keywords per topic (default: 10)',
        },
      },
      required: ['documents'],
    },
    handler: async (input: any, context: ToolContext) => {
      if (!input.documents || !Array.isArray(input.documents)) {
        return { success: false, error: 'documents parameter must be an array of strings' };
      }

      if (input.documents.length < 2) {
        return { success: false, error: 'At least 2 documents required for topic modeling' };
      }

      const topics = extractTopics(
        input.documents,
        input.num_topics || 5,
        input.words_per_topic || 10
      );

      return {
        success: true,
        topics,
        totalDocuments: input.documents.length,
      };
    },
  },

  {
    name: 'parse_csv',
    description: 'Parse CSV data into structured format. Returns headers and rows as arrays.',
    category: 'compute',
    use_cases: [
      'Parse CSV file contents',
      'Extract data from CSV for analysis',
      'Convert CSV to JSON structure',
      'Read tabular data from workspace',
      'Process spreadsheet exports',
    ],
    parameters: {
      type: 'object',
      properties: {
        csv_text: {
          type: 'string',
          description: 'CSV text to parse',
        },
        delimiter: {
          type: 'string',
          description: 'Column delimiter (default: comma)',
        },
        has_header: {
          type: 'boolean',
          description: 'Whether first row contains headers (default: true)',
        },
      },
      required: ['csv_text'],
    },
    handler: async (input: any, context: ToolContext) => {
      if (!input.csv_text) {
        return { success: false, error: 'csv_text parameter is required' };
      }

      try {
        const result = parseCSV(input.csv_text, {
          delimiter: input.delimiter,
          hasHeader: input.has_header,
        });

        return {
          success: true,
          ...result,
          rowCount: result.rows.length,
          columnCount: result.headers.length,
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  },

  {
    name: 'generate_csv',
    description: 'Generate CSV text from headers and rows. Use this to create CSV files from structured data.',
    category: 'compute',
    use_cases: [
      'Create CSV file from data',
      'Export analysis results to CSV',
      'Generate CSV for spreadsheet import',
      'Convert JSON data to CSV format',
      'Create tabular data exports',
    ],
    parameters: {
      type: 'object',
      properties: {
        headers: {
          type: 'array',
          items: { type: 'string' },
          description: 'Column headers',
        },
        rows: {
          type: 'array',
          items: { type: 'array', items: { type: 'string' } },
          description: 'Data rows (each row is an array of values)',
        },
        delimiter: {
          type: 'string',
          description: 'Column delimiter (default: comma)',
        },
      },
      required: ['headers', 'rows'],
    },
    handler: async (input: any, context: ToolContext) => {
      if (!input.headers || !Array.isArray(input.headers)) {
        return { success: false, error: 'headers must be an array of strings' };
      }

      if (!input.rows || !Array.isArray(input.rows)) {
        return { success: false, error: 'rows must be an array of arrays' };
      }

      try {
        const csv = generateCSV(input.headers, input.rows, input.delimiter);
        return {
          success: true,
          csv,
          rowCount: input.rows.length,
          columnCount: input.headers.length,
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  },

  {
    name: 'calculate_statistics',
    description: 'Calculate statistical measures (mean, median, mode, std dev, min, max) for a dataset.',
    category: 'compute',
    use_cases: [
      'Analyze numerical data',
      'Calculate summary statistics',
      'Get statistical overview of dataset',
      'Analyze metrics and measurements',
      'Summarize quantitative data',
    ],
    parameters: {
      type: 'object',
      properties: {
        numbers: {
          type: 'array',
          items: { type: 'number' },
          description: 'Array of numbers to analyze',
        },
      },
      required: ['numbers'],
    },
    handler: async (input: any, context: ToolContext) => {
      if (!input.numbers || !Array.isArray(input.numbers)) {
        return { success: false, error: 'numbers parameter must be an array' };
      }

      const numbers = input.numbers.filter((n: any) => typeof n === 'number' && !isNaN(n));

      if (numbers.length === 0) {
        return { success: false, error: 'No valid numbers found in input' };
      }

      const stats = calculateStats(numbers);
      return { success: true, ...stats };
    },
  },
];

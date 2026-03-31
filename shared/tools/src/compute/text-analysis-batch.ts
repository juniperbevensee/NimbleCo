/**
 * Combined text analysis tools that work directly on files
 * Avoids passing large arrays between tool calls
 */

import { Tool, ToolContext } from '../base';
import { promises as fs } from 'fs';
import path from 'path';
import { getWorkspaceRoot } from '../workspace-helper';

/**
 * Simple sentiment analysis
 */
function analyzeSentiment(text: string): { score: number; label: 'positive' | 'negative' | 'neutral'; confidence: number } {
  const positiveWords = [
    'good', 'great', 'excellent', 'amazing', 'awesome', 'fantastic', 'wonderful',
    'brilliant', 'perfect', 'love', 'like', 'happy', 'best', 'better',
    'helpful', 'useful', 'innovative', 'powerful', 'success', 'win',
  ];

  const negativeWords = [
    'bad', 'terrible', 'awful', 'horrible', 'poor', 'worst', 'hate',
    'sad', 'angry', 'problem', 'issue', 'bug', 'error', 'fail',
    'difficult', 'slow', 'crash', 'broken',
  ];

  const words = text.toLowerCase().split(/\s+/);
  let positiveScore = 0;
  let negativeScore = 0;

  for (const word of words) {
    if (positiveWords.includes(word)) positiveScore++;
    if (negativeWords.includes(word)) negativeScore++;
  }

  const totalScore = positiveScore + negativeScore;
  const normalizedScore = totalScore === 0 ? 0 : (positiveScore - negativeScore) / totalScore;

  let label: 'positive' | 'negative' | 'neutral';
  if (normalizedScore > 0.1) label = 'positive';
  else if (normalizedScore < -0.1) label = 'negative';
  else label = 'neutral';

  return { score: normalizedScore, label, confidence: Math.abs(normalizedScore) };
}

/**
 * Extract topics using TF-IDF
 */
function extractTopics(documents: string[], numTopics: number = 5, wordsPerTopic: number = 10) {
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
  ]);

  // Tokenize
  const tokenizedDocs = documents.map(doc =>
    doc.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 3 && !stopWords.has(word))
  );

  // Calculate TF
  const termFreq: Map<string, Map<number, number>> = new Map();
  tokenizedDocs.forEach((words, docIdx) => {
    words.forEach(word => {
      if (!termFreq.has(word)) termFreq.set(word, new Map());
      const docFreq = termFreq.get(word)!;
      docFreq.set(docIdx, (docFreq.get(docIdx) || 0) + 1);
    });
  });

  // Calculate IDF
  const numDocs = documents.length;
  const idf: Map<string, number> = new Map();
  termFreq.forEach((docs, word) => {
    idf.set(word, Math.log(numDocs / docs.size));
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

  // Get top words
  const sortedWords = Array.from(tfidf.entries()).sort((a, b) => b[1] - a[1]);
  const topics: Array<{ topic: number; words: Array<{ word: string; score: number }> }> = [];
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

export const textAnalysisBatchTools: Tool[] = [
  {
    name: 'analyze_file_sentiment_topics',
    description: 'Extract text from a large JSON file and perform both sentiment analysis and topic modeling in one step. This is more efficient than extracting texts first and then analyzing separately.',
    category: 'compute',
    use_cases: [
      'Analyze sentiment and topics of posts in a file',
      'Process large datasets for sentiment and topics',
      'One-step analysis of text collections',
      'Efficient batch text analysis',
      'Combined sentiment and topic extraction',
    ],
    parameters: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Path to JSON file',
        },
        text_field: {
          type: 'string',
          description: 'Field name containing text (e.g., "message", "content")',
        },
        nested_path: {
          type: 'string',
          description: 'Path to nested object containing text_field (e.g., "_source" for item._source.message)',
        },
        num_topics: {
          type: 'number',
          description: 'Number of topics to extract (default: 5)',
        },
        words_per_topic: {
          type: 'number',
          description: 'Keywords per topic (default: 10)',
        },
        batch_size: {
          type: 'number',
          description: 'Max texts to process (default: 200)',
        },
      },
      required: ['file_path', 'text_field'],
    },
    handler: async (input: any, context: ToolContext) => {
      const {
        file_path,
        text_field,
        nested_path,
        num_topics = 5,
        words_per_topic = 10,
        batch_size = 200,
      } = input;

      try {
        // Read file
        const fullPath = path.isAbsolute(file_path)
          ? file_path
          : path.join(getWorkspaceRoot(), file_path);

        const resolvedPath = path.resolve(fullPath);
        if (!resolvedPath.startsWith(path.resolve(getWorkspaceRoot()))) {
          return { success: false, error: 'Access denied: path must be within workspace' };
        }

        const content = await fs.readFile(resolvedPath, 'utf-8');
        let data = JSON.parse(content);

        // Find array
        let arrayData: any[] = [];
        if (Array.isArray(data)) {
          arrayData = data;
        } else {
          const arrayKeys = Object.keys(data).filter(k => Array.isArray(data[k]));
          if (arrayKeys.length > 0) {
            arrayData = data[arrayKeys[0]];
          }
        }

        if (arrayData.length === 0) {
          return { success: false, error: 'No array found in file' };
        }

        // Extract texts
        const texts: string[] = [];
        const batchData = arrayData.slice(0, batch_size);

        for (const item of batchData) {
          try {
            let text = null;

            if (nested_path) {
              const parts = nested_path.split('.');
              let current = item;
              for (const part of parts) {
                current = current?.[part];
              }
              text = current?.[text_field];
            } else {
              text = item[text_field];
            }

            if (text && typeof text === 'string' && text.trim().length > 0) {
              texts.push(text);
            }
          } catch (e) {
            // Skip
          }
        }

        if (texts.length === 0) {
          return { success: false, error: 'No text extracted from file' };
        }

        // Analyze sentiment
        const sentiments = texts.map(analyzeSentiment);
        const sentimentCounts = {
          positive: sentiments.filter(s => s.label === 'positive').length,
          negative: sentiments.filter(s => s.label === 'negative').length,
          neutral: sentiments.filter(s => s.label === 'neutral').length,
        };
        const avgSentiment = sentiments.reduce((sum, s) => sum + s.score, 0) / sentiments.length;

        // Extract topics
        const topics = texts.length >= 2 ? extractTopics(texts, num_topics, words_per_topic) : [];

        // Get sample of most positive/negative
        const topPositive = sentiments
          .map((s, i) => ({ ...s, text: texts[i].substring(0, 150) }))
          .filter(s => s.label === 'positive')
          .sort((a, b) => b.score - a.score)
          .slice(0, 3);

        const topNegative = sentiments
          .map((s, i) => ({ ...s, text: texts[i].substring(0, 150) }))
          .filter(s => s.label === 'negative')
          .sort((a, b) => a.score - b.score)
          .slice(0, 3);

        return {
          success: true,
          file_path: resolvedPath,
          total_items: arrayData.length,
          texts_analyzed: texts.length,
          sentiment_analysis: {
            distribution: sentimentCounts,
            average_score: avgSentiment,
            overall_sentiment: avgSentiment > 0.05 ? 'positive' : avgSentiment < -0.05 ? 'negative' : 'neutral',
            top_positive: topPositive,
            top_negative: topNegative,
          },
          topic_modeling: {
            num_topics: topics.length,
            topics,
          },
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  },
];

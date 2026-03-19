/**
 * Batch processor for large workspace files
 * Processes data in chunks to avoid token limits
 */

import { Tool, ToolContext } from '../base';
import { promises as fs } from 'fs';
import path from 'path';

function getWorkspaceRoot(): string {
  return process.env.WORKSPACE_PATH || path.resolve(process.cwd(), '../storage/workspace');
}

/**
 * Process a large JSON file containing an array, yielding batches
 */
async function* batchProcessor(
  filePath: string,
  batchSize: number = 50
): AsyncGenerator<{ batch: any[]; batchNumber: number; totalBatches: number; offset: number }> {
  const fullPath = path.isAbsolute(filePath)
    ? filePath
    : path.join(getWorkspaceRoot(), filePath);

  const content = await fs.readFile(fullPath, 'utf-8');
  let data = JSON.parse(content);

  // Handle nested array structure (e.g., { results: [...] })
  if (typeof data === 'object' && !Array.isArray(data)) {
    const arrayKeys = Object.keys(data).filter(k => Array.isArray(data[k]));
    if (arrayKeys.length > 0) {
      const mainKey = arrayKeys.reduce((max, curr) =>
        data[curr].length > data[max].length ? curr : max
      );
      data = data[mainKey];
    }
  }

  if (!Array.isArray(data)) {
    throw new Error('File must contain an array or object with an array field');
  }

  const totalItems = data.length;
  const totalBatches = Math.ceil(totalItems / batchSize);

  for (let i = 0; i < totalItems; i += batchSize) {
    const batch = data.slice(i, i + batchSize);
    yield {
      batch,
      batchNumber: Math.floor(i / batchSize) + 1,
      totalBatches,
      offset: i,
    };
  }
}

export const batchProcessorTools: Tool[] = [
  {
    name: 'analyze_file_in_batches',
    description: 'Analyze a large JSON file containing an array by processing it in batches. Returns summary statistics without loading the entire file into context. Use this for large datasets before using specific analysis tools.',
    category: 'storage',
    use_cases: [
      'Get overview of large dataset',
      'Count items in large file',
      'Sample data from large file',
      'Prepare for batch processing',
      'Understand file structure',
    ],
    parameters: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Path to JSON file (relative to workspace or absolute)',
        },
        sample_size: {
          type: 'number',
          description: 'Number of sample items to return (default: 10)',
        },
      },
      required: ['file_path'],
    },
    handler: async (input: any, context: ToolContext) => {
      const { file_path, sample_size = 10 } = input;

      try {
        const fullPath = path.isAbsolute(file_path)
          ? file_path
          : path.join(getWorkspaceRoot(), file_path);

        // Security check
        const resolvedPath = path.resolve(fullPath);
        if (!resolvedPath.startsWith(path.resolve(getWorkspaceRoot()))) {
          return { success: false, error: 'Access denied: path must be within workspace' };
        }

        const content = await fs.readFile(resolvedPath, 'utf-8');
        const fileSize = content.length;
        let data = JSON.parse(content);

        // Detect structure
        let arrayKey: string | null = null;
        let arrayData: any[] = [];
        let otherFields: any = {};

        if (Array.isArray(data)) {
          arrayData = data;
        } else if (typeof data === 'object') {
          const arrayKeys = Object.keys(data).filter(k => Array.isArray(data[k]));
          if (arrayKeys.length > 0) {
            arrayKey = arrayKeys.reduce((max, curr) =>
              data[curr].length > data[max].length ? curr : max
            );
            arrayData = data[arrayKey];
            otherFields = Object.keys(data)
              .filter(k => k !== arrayKey)
              .reduce((obj, k) => ({ ...obj, [k]: data[k] }), {});
          }
        }

        if (arrayData.length === 0) {
          return { success: false, error: 'No array data found in file' };
        }

        // Get sample
        const sampleItems = arrayData.slice(0, sample_size);

        // Analyze structure of first item
        const firstItemKeys = arrayData.length > 0 ? Object.keys(arrayData[0]) : [];

        return {
          success: true,
          file_path: resolvedPath,
          file_size_bytes: fileSize,
          structure: {
            is_direct_array: arrayKey === null,
            array_key: arrayKey,
            total_items: arrayData.length,
            other_fields: Object.keys(otherFields),
            sample_item_keys: firstItemKeys,
          },
          recommended_batch_size: Math.min(50, Math.ceil(arrayData.length / 10)),
          sample: sampleItems,
          message: `File contains ${arrayData.length} items${arrayKey ? ` in '${arrayKey}' array` : ''}. Use limit/offset with read_workspace_file or process in batches of ~50 items.`,
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  },

  {
    name: 'extract_text_fields_batched',
    description: 'Extract specific text fields from a large JSON array file for analysis. Returns extracted texts ready for sentiment analysis or topic modeling. Processes in batches to avoid token limits.',
    category: 'storage',
    use_cases: [
      'Extract messages for sentiment analysis',
      'Get text fields for topic modeling',
      'Prepare text data for NLP',
      'Extract specific fields from large dataset',
      'Batch extract text content',
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
          description: 'Name of the field containing text (e.g., "message", "content", "text")',
        },
        batch_size: {
          type: 'number',
          description: 'Number of items to process (default: 100)',
        },
        offset: {
          type: 'number',
          description: 'Starting offset (default: 0)',
        },
        nested_path: {
          type: 'string',
          description: 'Optional: path to nested object containing the text field (e.g., "_source" if the text_field is in item._source.message). This will navigate to the nested object first, then extract text_field from it.',
        },
      },
      required: ['file_path', 'text_field'],
    },
    handler: async (input: any, context: ToolContext) => {
      const { file_path, text_field, batch_size = 100, offset = 0, nested_path } = input;

      try {
        const fullPath = path.isAbsolute(file_path)
          ? file_path
          : path.join(getWorkspaceRoot(), file_path);

        const resolvedPath = path.resolve(fullPath);
        if (!resolvedPath.startsWith(path.resolve(getWorkspaceRoot()))) {
          return { success: false, error: 'Access denied: path must be within workspace' };
        }

        const content = await fs.readFile(resolvedPath, 'utf-8');
        let data = JSON.parse(content);

        // Find the array
        let arrayData: any[] = [];
        if (Array.isArray(data)) {
          arrayData = data;
        } else {
          const arrayKeys = Object.keys(data).filter(k => Array.isArray(data[k]));
          if (arrayKeys.length > 0) {
            const mainKey = arrayKeys[0];
            arrayData = data[mainKey];
          }
        }

        if (arrayData.length === 0) {
          return { success: false, error: 'No array found in file' };
        }

        // Extract the batch
        const batchData = arrayData.slice(offset, offset + batch_size);

        // Extract text fields
        const texts: string[] = [];
        for (const item of batchData) {
          try {
            let text = null;

            if (nested_path) {
              // Navigate to nested object first (e.g., "_source")
              const parts = nested_path.split('.');
              let current = item;
              for (const part of parts) {
                current = current?.[part];
              }
              // Then get the text field from the nested object
              text = current?.[text_field];
            } else {
              text = item[text_field];
            }

            if (text && typeof text === 'string' && text.trim().length > 0) {
              texts.push(text);
            }
          } catch (e) {
            // Skip items where extraction fails
          }
        }

        return {
          success: true,
          total_items_in_file: arrayData.length,
          batch_start: offset,
          batch_end: offset + batch_size,
          items_processed: batchData.length,
          texts_extracted: texts.length,
          texts,
          has_more: offset + batch_size < arrayData.length,
          next_offset: offset + batch_size,
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  },
];

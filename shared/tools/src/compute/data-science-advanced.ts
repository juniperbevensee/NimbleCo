/**
 * Advanced Data Science Tools - Charts, Stats, NLP, File Conversion
 * Ported and adapted from cantrip-integrations for NimbleCo
 */

import { Tool, ToolContext } from '../base';
import * as ss from 'simple-statistics';
import { promises as fs } from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';
import * as yaml from 'js-yaml';
import Papa from 'papaparse';

// Workspace root - same as in workspace.ts
function getWorkspaceRoot(): string {
  return process.env.WORKSPACE_PATH || path.resolve(process.cwd(), 'storage/workspace');
}

// ============================================================================
// ADVANCED STATISTICS TOOLS
// ============================================================================

/**
 * Calculate comprehensive summary statistics
 */
function calculateAdvancedStats(data: number[]) {
  const sorted = [...data].sort((a, b) => a - b);

  return {
    count: data.length,
    mean: ss.mean(data),
    median: ss.median(sorted),
    std: ss.standardDeviation(data),
    variance: ss.variance(data),
    min: ss.min(data),
    max: ss.max(data),
    range: ss.max(data) - ss.min(data),
    q1: ss.quantile(sorted, 0.25),
    q3: ss.quantile(sorted, 0.75),
    iqr: ss.interquartileRange(sorted),
    skewness: ss.sampleSkewness(data),
  };
}

/**
 * Calculate correlation between two datasets
 */
function calculateCorrelation(x: number[], y: number[]) {
  const correlation = ss.sampleCorrelation(x, y);
  const covariance = ss.sampleCovariance(x, y);

  const absCorr = Math.abs(correlation);
  let interpretation = 'no correlation';
  if (absCorr >= 0.9) interpretation = 'very strong';
  else if (absCorr >= 0.7) interpretation = 'strong';
  else if (absCorr >= 0.5) interpretation = 'moderate';
  else if (absCorr >= 0.3) interpretation = 'weak';
  else if (absCorr > 0) interpretation = 'very weak';

  return {
    correlation,
    covariance,
    interpretation: `${interpretation} ${correlation >= 0 ? 'positive' : 'negative'}`,
    n: x.length,
  };
}

/**
 * Perform linear regression
 */
function performRegression(x: number[], y: number[], predictX?: number[]) {
  const pairs: Array<[number, number]> = x.map((xi, i) => [xi, y[i]]);
  const line = ss.linearRegression(pairs);
  const rSquared = ss.rSquared(pairs, (xi: number) => line.m * xi + line.b);

  // Calculate RMSE
  const predictions = x.map(xi => line.m * xi + line.b);
  const residuals = y.map((yi, i) => yi - predictions[i]);
  const rmse = Math.sqrt(ss.mean(residuals.map(r => r * r)));

  const result: any = {
    slope: line.m,
    intercept: line.b,
    r_squared: rSquared,
    rmse,
    equation: `y = ${line.m.toFixed(4)}x + ${line.b.toFixed(4)}`,
  };

  if (predictX && predictX.length > 0) {
    result.predictions = predictX.map(xi => ({
      x: xi,
      y: line.m * xi + line.b,
    }));
  }

  return result;
}

/**
 * Calculate moving average
 */
function calculateMovingAverage(data: number[], windowSize: number, type: 'simple' | 'exponential' = 'simple') {
  const result: number[] = [];

  if (type === 'simple') {
    for (let i = windowSize - 1; i < data.length; i++) {
      const window = data.slice(i - windowSize + 1, i + 1);
      result.push(ss.mean(window));
    }
  } else {
    // Exponential Moving Average
    const multiplier = 2 / (windowSize + 1);
    result.push(ss.mean(data.slice(0, windowSize))); // First EMA is SMA
    for (let i = windowSize; i < data.length; i++) {
      const ema = (data[i] - result[result.length - 1]) * multiplier + result[result.length - 1];
      result.push(ema);
    }
  }

  return result;
}

// ============================================================================
// CHART GENERATION TOOLS
// ============================================================================

let ChartJSNodeCanvas: any = null;
async function getChartRenderer(width = 800, height = 600) {
  if (!ChartJSNodeCanvas) {
    const mod = await import('chartjs-node-canvas');
    ChartJSNodeCanvas = mod.ChartJSNodeCanvas;
  }
  return new ChartJSNodeCanvas({ width, height, backgroundColour: 'white' });
}

async function saveChart(config: any, outputPath: string, width: number, height: number) {
  const chart = await getChartRenderer(width, height);
  const buffer = await chart.renderToBuffer(config);

  const outputDir = path.dirname(outputPath);
  if (outputDir && outputDir !== '.') {
    await fs.mkdir(outputDir, { recursive: true });
  }
  await fs.writeFile(outputPath, buffer);
}

// ============================================================================
// FILE CONVERSION TOOLS
// ============================================================================

/**
 * Convert between CSV and JSON
 */
async function convertDataFormat(
  inputFile: string,
  outputFormat: 'json' | 'csv',
  outputFile?: string
): Promise<{ outputPath: string; rowCount: number }> {
  const content = await fs.readFile(inputFile, 'utf-8');

  // Detect input format
  const inputFormat = inputFile.endsWith('.json') ? 'json' : 'csv';

  let data: any[];

  if (inputFormat === 'json') {
    data = JSON.parse(content);
    if (!Array.isArray(data)) {
      throw new Error('JSON file must contain an array of objects');
    }
  } else {
    // Parse CSV with papaparse
    const parseResult = Papa.parse(content, { header: true, dynamicTyping: true });
    data = parseResult.data;
  }

  const outputPath = outputFile || inputFile.replace(/\.(json|csv)$/, `.${outputFormat}`);

  if (outputFormat === 'json') {
    await fs.writeFile(outputPath, JSON.stringify(data, null, 2), 'utf-8');
  } else {
    const csv = Papa.unparse(data);
    await fs.writeFile(outputPath, csv, 'utf-8');
  }

  return { outputPath, rowCount: data.length };
}

/**
 * Excel file operations
 */
async function readExcelFile(filePath: string): Promise<any[]> {
  const buffer = await fs.readFile(filePath);
  const workbook = XLSX.read(buffer);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  return XLSX.utils.sheet_to_json(sheet);
}

async function writeExcelFile(data: any[], filePath: string, sheetName: string = 'Sheet1') {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(data);
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  await fs.writeFile(filePath, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));
}

/**
 * YAML operations
 */
async function convertYAMLtoJSON(inputFile: string, outputFile?: string): Promise<string> {
  const content = await fs.readFile(inputFile, 'utf-8');
  const data = yaml.load(content);
  const outputPath = outputFile || inputFile.replace(/\.ya?ml$/, '.json');
  await fs.writeFile(outputPath, JSON.stringify(data, null, 2), 'utf-8');
  return outputPath;
}

async function convertJSONtoYAML(inputFile: string, outputFile?: string): Promise<string> {
  const content = await fs.readFile(inputFile, 'utf-8');
  const data = JSON.parse(content);
  const yamlStr = yaml.dump(data);
  const outputPath = outputFile || inputFile.replace(/\.json$/, '.yaml');
  await fs.writeFile(outputPath, yamlStr, 'utf-8');
  return outputPath;
}

// ============================================================================
// NLP TOOLS
// ============================================================================

/**
 * Calculate TF-IDF scores
 */
async function calculateTFIDF(texts: string[], topN: number = 20, minTermLength: number = 3) {
  const natural = (await import('natural')).default;
  const TfIdf = natural.TfIdf;

  const tfidf = new TfIdf();
  texts.forEach(doc => tfidf.addDocument(doc));

  return texts.map((_, docIndex) => {
    const terms: Array<{ term: string; score: number }> = [];

    tfidf.listTerms(docIndex).forEach((item: any) => {
      if (item.term.length >= minTermLength) {
        terms.push({ term: item.term, score: item.tfidf });
      }
    });

    return {
      documentIndex: docIndex,
      documentPreview: texts[docIndex].substring(0, 100) + '...',
      topTerms: terms.sort((a, b) => b.score - a.score).slice(0, topN),
    };
  });
}

/**
 * Calculate document similarity
 */
async function calculateSimilarity(text1: string, text2: string) {
  const natural = (await import('natural')).default;
  const TfIdf = natural.TfIdf;

  const tfidf = new TfIdf();
  tfidf.addDocument(text1);
  tfidf.addDocument(text2);

  // Calculate cosine similarity using TF-IDF vectors
  const terms1 = new Map<string, number>();
  const terms2 = new Map<string, number>();

  tfidf.listTerms(0).forEach((item: any) => terms1.set(item.term, item.tfidf));
  tfidf.listTerms(1).forEach((item: any) => terms2.set(item.term, item.tfidf));

  const allTerms = new Set([...terms1.keys(), ...terms2.keys()]);
  let dotProduct = 0;
  let mag1 = 0;
  let mag2 = 0;

  allTerms.forEach(term => {
    const v1 = terms1.get(term) || 0;
    const v2 = terms2.get(term) || 0;
    dotProduct += v1 * v2;
    mag1 += v1 * v1;
    mag2 += v2 * v2;
  });

  const similarity = dotProduct / (Math.sqrt(mag1) * Math.sqrt(mag2));

  return {
    similarity,
    interpretation: similarity > 0.7 ? 'very similar' : similarity > 0.4 ? 'moderately similar' : 'not similar',
  };
}

// ============================================================================
// EXPORT TOOLS
// ============================================================================

export const advancedDataScienceTools: Tool[] = [
  // ===== ADVANCED STATISTICS =====
  {
    name: 'stats_advanced_summary',
    description: 'Calculate comprehensive summary statistics including mean, median, std, variance, quartiles, IQR, and skewness.',
    category: 'compute',
    use_cases: [
      'Detailed statistical analysis',
      'Understand data distribution',
      'Calculate quartiles and IQR',
      'Identify data skewness',
      'Comprehensive dataset overview',
    ],
    parameters: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: { type: 'number' },
          description: 'Array of numbers to analyze',
        },
      },
      required: ['data'],
    },
    handler: async (input: any, context: ToolContext) => {
      if (!input.data || !Array.isArray(input.data) || input.data.length === 0) {
        return { success: false, error: 'data must be a non-empty array of numbers' };
      }

      try {
        const stats = calculateAdvancedStats(input.data);
        return { success: true, ...stats };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  },

  {
    name: 'stats_correlation',
    description: 'Calculate Pearson correlation coefficient between two datasets. Returns correlation, covariance, and interpretation.',
    category: 'compute',
    use_cases: [
      'Measure relationship between variables',
      'Analyze correlation strength',
      'Identify positive or negative correlation',
      'Statistical relationship analysis',
    ],
    parameters: {
      type: 'object',
      properties: {
        x: {
          type: 'array',
          items: { type: 'number' },
          description: 'First dataset',
        },
        y: {
          type: 'array',
          items: { type: 'number' },
          description: 'Second dataset (must be same length as x)',
        },
      },
      required: ['x', 'y'],
    },
    handler: async (input: any, context: ToolContext) => {
      if (!input.x || !input.y || input.x.length !== input.y.length || input.x.length < 2) {
        return { success: false, error: 'x and y must be arrays of same length with at least 2 elements' };
      }

      try {
        const result = calculateCorrelation(input.x, input.y);
        return { success: true, ...result };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  },

  {
    name: 'stats_regression',
    description: 'Perform linear regression analysis. Returns slope, intercept, R², RMSE, and optional predictions.',
    category: 'compute',
    use_cases: [
      'Linear regression analysis',
      'Predict future values',
      'Calculate trend line',
      'Measure fit quality (R²)',
      'Forecast based on data',
    ],
    parameters: {
      type: 'object',
      properties: {
        x: {
          type: 'array',
          items: { type: 'number' },
          description: 'Independent variable (x values)',
        },
        y: {
          type: 'array',
          items: { type: 'number' },
          description: 'Dependent variable (y values)',
        },
        predict_x: {
          type: 'array',
          items: { type: 'number' },
          description: 'Optional: x values to predict y for',
        },
      },
      required: ['x', 'y'],
    },
    handler: async (input: any, context: ToolContext) => {
      if (!input.x || !input.y || input.x.length !== input.y.length || input.x.length < 2) {
        return { success: false, error: 'x and y must be arrays of same length with at least 2 elements' };
      }

      try {
        const result = performRegression(input.x, input.y, input.predict_x);
        return { success: true, ...result };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  },

  {
    name: 'stats_moving_average',
    description: 'Calculate simple or exponential moving average for time series data.',
    category: 'compute',
    use_cases: [
      'Smooth time series data',
      'Calculate rolling averages',
      'Trend analysis',
      'Time series smoothing',
      'Exponential moving average',
    ],
    parameters: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: { type: 'number' },
          description: 'Time series data',
        },
        window_size: {
          type: 'number',
          description: 'Window size for moving average',
        },
        type: {
          type: 'string',
          enum: ['simple', 'exponential'],
          description: 'Type of moving average (default: simple)',
        },
      },
      required: ['data', 'window_size'],
    },
    handler: async (input: any, context: ToolContext) => {
      if (!input.data || input.window_size > input.data.length || input.window_size < 1) {
        return { success: false, error: 'Invalid data or window_size' };
      }

      try {
        const values = calculateMovingAverage(
          input.data,
          input.window_size,
          input.type || 'simple'
        );
        return {
          success: true,
          type: input.type || 'simple',
          window_size: input.window_size,
          input_length: input.data.length,
          output_length: values.length,
          values,
          latest: values[values.length - 1],
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  },

  // ===== CHART GENERATION =====
  {
    name: 'chart_line',
    description: 'Create a line chart and save as PNG. Supports multiple datasets with custom colors.',
    category: 'compute',
    use_cases: [
      'Visualize trends over time',
      'Compare multiple data series',
      'Create line graphs',
      'Plot time series data',
      'Generate trend charts',
    ],
    parameters: {
      type: 'object',
      properties: {
        datasets: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string' },
              data: { type: 'array', items: { type: 'number' } },
              color: { type: 'string' },
            },
          },
          description: 'Array of datasets to plot',
        },
        labels: {
          type: 'array',
          items: { type: 'string' },
          description: 'X-axis labels',
        },
        title: { type: 'string', description: 'Chart title' },
        x_label: { type: 'string', description: 'X-axis label' },
        y_label: { type: 'string', description: 'Y-axis label' },
        output_path: { type: 'string', description: 'Path to save PNG file' },
        width: { type: 'number', description: 'Chart width in pixels (default: 800)' },
        height: { type: 'number', description: 'Chart height in pixels (default: 600)' },
      },
      required: ['datasets', 'labels', 'output_path'],
    },
    handler: async (input: any, context: ToolContext) => {
      if (!input.datasets || !input.labels || !input.output_path) {
        return { success: false, error: 'datasets, labels, and output_path are required' };
      }

      // Resolve output path to workspace
      let outputPath = input.output_path;
      if (!path.isAbsolute(outputPath)) {
        outputPath = path.join(getWorkspaceRoot(), outputPath);
      }
      outputPath = path.resolve(outputPath);
      const filename = path.basename(outputPath);

      try {
        const colors = ['#2563eb', '#dc2626', '#16a34a', '#ca8a04', '#9333ea', '#0891b2'];

        const config = {
          type: 'line' as const,
          data: {
            labels: input.labels,
            datasets: input.datasets.map((ds: any, i: number) => ({
              label: ds.label,
              data: ds.data,
              borderColor: ds.color || colors[i % colors.length],
              backgroundColor: (ds.color || colors[i % colors.length]) + '20',
              fill: false,
              tension: 0.1,
            })),
          },
          options: {
            responsive: false,
            plugins: {
              title: { display: !!input.title, text: input.title },
              legend: { display: input.datasets.length > 1 },
            },
            scales: {
              x: { title: { display: !!input.x_label, text: input.x_label } },
              y: { title: { display: !!input.y_label, text: input.y_label } },
            },
          },
        };

        await saveChart(config, outputPath, input.width || 800, input.height || 600);

        return {
          success: true,
          output_path: outputPath,
          filename: filename,
          width: input.width || 800,
          height: input.height || 600,
          datasets_count: input.datasets.length,
          points_count: input.labels.length,
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  },

  {
    name: 'chart_bar',
    description: 'Create a bar chart and save as PNG. Supports horizontal orientation and multiple datasets. For simple charts, you can pass just "data" array instead of "datasets". Arrays can be passed as JSON strings or native arrays.',
    category: 'compute',
    use_cases: [
      'Compare values across categories',
      'Create bar graphs',
      'Visualize categorical data',
      'Show rankings',
      'Compare groups',
    ],
    parameters: {
      type: 'object',
      properties: {
        datasets: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string' },
              data: { type: 'array', items: { type: 'number' } },
              color: { type: 'string' },
            },
          },
          description: 'Array of datasets to plot',
        },
        labels: {
          type: 'array',
          items: { type: 'string' },
          description: 'Category labels (can be array or JSON string)',
        },
        data: {
          type: 'array',
          items: { type: 'number' },
          description: 'Shorthand: single data series (alternative to datasets)',
        },
        horizontal: { type: 'boolean', description: 'Make horizontal bar chart (default: false)' },
        title: { type: 'string', description: 'Chart title' },
        x_label: { type: 'string', description: 'X-axis label' },
        y_label: { type: 'string', description: 'Y-axis label' },
        output_path: { type: 'string', description: 'Path to save PNG file' },
        width: { type: 'number', description: 'Chart width (default: 800)' },
        height: { type: 'number', description: 'Chart height (default: 600)' },
      },
      required: ['datasets', 'labels', 'output_path'],
    },
    handler: async (input: any, context: ToolContext) => {
      // Parse JSON strings if needed (LLMs sometimes send arrays as strings)
      let labels = input.labels;
      let datasets = input.datasets;

      if (typeof labels === 'string') {
        try {
          labels = JSON.parse(labels);
        } catch (e) {
          return { success: false, error: 'labels must be an array or valid JSON array string' };
        }
      }

      // Handle simple case: just "data" array provided instead of "datasets"
      if (!datasets && input.data) {
        let data = input.data;
        if (typeof data === 'string') {
          try {
            data = JSON.parse(data);
          } catch (e) {
            return { success: false, error: 'data must be an array or valid JSON array string' };
          }
        }
        datasets = [{ label: input.title || 'Data', data }];
      }

      if (typeof datasets === 'string') {
        try {
          datasets = JSON.parse(datasets);
        } catch (e) {
          return { success: false, error: 'datasets must be an array or valid JSON array string' };
        }
      }

      if (!datasets || !labels || !input.output_path) {
        return { success: false, error: 'datasets (or data), labels, and output_path are required' };
      }

      // Ensure output path is in workspace and resolve to absolute path
      let outputPath = input.output_path;
      if (!path.isAbsolute(outputPath)) {
        outputPath = path.join(getWorkspaceRoot(), outputPath);
      }

      // Always resolve to absolute path
      outputPath = path.resolve(outputPath);

      try {
        const colors = ['#2563eb', '#dc2626', '#16a34a', '#ca8a04', '#9333ea', '#0891b2'];

        const chartType: 'bar' = 'bar';
        const config = {
          type: chartType,
          data: {
            labels,
            datasets: datasets.map((ds: any, i: number) => ({
              label: ds.label || 'Data',
              data: ds.data,
              backgroundColor: ds.color || colors[i % colors.length],
              borderWidth: 1,
            })),
          },
          options: {
            responsive: false,
            indexAxis: input.horizontal ? ('y' as const) : ('x' as const),
            plugins: {
              title: { display: !!input.title, text: input.title },
              legend: { display: datasets.length > 1 },
            },
            scales: {
              x: { title: { display: !!input.x_label, text: input.x_label } },
              y: { title: { display: !!input.y_label, text: input.y_label } },
            },
          },
        };

        await saveChart(config, outputPath, input.width || 800, input.height || 600);

        // Return both absolute path and just filename for easy workspace file reading
        const filename = path.basename(outputPath);

        return {
          success: true,
          output_path: outputPath,
          filename: filename,  // Easy to use with read_workspace_file
          orientation: input.horizontal ? 'horizontal' : 'vertical',
          datasets_count: datasets.length,
          categories_count: labels.length,
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  },

  {
    name: 'chart_scatter',
    description: 'Create a scatter plot and save as PNG. Optional regression line.',
    category: 'compute',
    use_cases: [
      'Visualize x-y relationships',
      'Show correlation between variables',
      'Create scatter plots',
      'Plot data points',
      'Show regression line',
    ],
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'array', items: { type: 'number' }, description: 'X coordinates' },
        y: { type: 'array', items: { type: 'number' }, description: 'Y coordinates' },
        show_regression: { type: 'boolean', description: 'Show regression line (default: false)' },
        title: { type: 'string', description: 'Chart title' },
        x_label: { type: 'string', description: 'X-axis label' },
        y_label: { type: 'string', description: 'Y-axis label' },
        output_path: { type: 'string', description: 'Path to save PNG file' },
        width: { type: 'number', description: 'Chart width (default: 800)' },
        height: { type: 'number', description: 'Chart height (default: 600)' },
      },
      required: ['x', 'y', 'output_path'],
    },
    handler: async (input: any, context: ToolContext) => {
      if (!input.x || !input.y || input.x.length !== input.y.length || !input.output_path) {
        return { success: false, error: 'x and y must be same-length arrays, output_path required' };
      }

      try {
        // Resolve output path to workspace
        let outputPath = input.output_path;
        if (!path.isAbsolute(outputPath)) {
          outputPath = path.join(getWorkspaceRoot(), outputPath);
        }
        outputPath = path.resolve(outputPath);
        const filename = path.basename(outputPath);

        const datasets: any[] = [
          {
            label: 'Data Points',
            data: input.x.map((xi: number, i: number) => ({ x: xi, y: input.y[i] })),
            backgroundColor: '#2563eb',
            borderColor: '#2563eb',
          },
        ];

        if (input.show_regression) {
          const regression = performRegression(input.x, input.y);
          const regressionPoints = input.x.map((xi: number) => ({
            x: xi,
            y: regression.slope * xi + regression.intercept,
          }));
          datasets.push({
            label: `Regression (R²=${regression.r_squared.toFixed(3)})`,
            data: regressionPoints,
            type: 'line',
            borderColor: '#dc2626',
            backgroundColor: 'transparent',
            fill: false,
            pointRadius: 0,
          });
        }

        const config = {
          type: 'scatter' as const,
          data: { datasets },
          options: {
            responsive: false,
            plugins: {
              title: { display: !!input.title, text: input.title },
              legend: { display: input.show_regression },
            },
            scales: {
              x: { type: 'linear' as const, title: { display: !!input.x_label, text: input.x_label } },
              y: { title: { display: !!input.y_label, text: input.y_label } },
            },
          },
        };

        await saveChart(config, outputPath, input.width || 800, input.height || 600);

        return {
          success: true,
          output_path: outputPath,
          filename: filename,
          points_count: input.x.length,
          regression_shown: !!input.show_regression,
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  },

  {
    name: 'chart_pie',
    description: 'Create a pie or doughnut chart and save as PNG.',
    category: 'compute',
    use_cases: [
      'Show proportions',
      'Visualize percentages',
      'Create pie charts',
      'Display parts of whole',
      'Show distribution',
    ],
    parameters: {
      type: 'object',
      properties: {
        labels: { type: 'array', items: { type: 'string' }, description: 'Category labels' },
        data: { type: 'array', items: { type: 'number' }, description: 'Values for each category' },
        doughnut: { type: 'boolean', description: 'Create doughnut chart (default: false)' },
        title: { type: 'string', description: 'Chart title' },
        output_path: { type: 'string', description: 'Path to save PNG file' },
        width: { type: 'number', description: 'Chart width (default: 800)' },
        height: { type: 'number', description: 'Chart height (default: 600)' },
      },
      required: ['labels', 'data', 'output_path'],
    },
    handler: async (input: any, context: ToolContext) => {
      if (!input.labels || !input.data || input.labels.length !== input.data.length || !input.output_path) {
        return { success: false, error: 'labels and data must be same-length arrays, output_path required' };
      }

      try {
        // Resolve output path to workspace
        let outputPath = input.output_path;
        if (!path.isAbsolute(outputPath)) {
          outputPath = path.join(getWorkspaceRoot(), outputPath);
        }
        outputPath = path.resolve(outputPath);
        const filename = path.basename(outputPath);

        const colors = [
          '#2563eb', '#dc2626', '#16a34a', '#ca8a04', '#9333ea', '#0891b2',
          '#ec4899', '#f97316', '#eab308', '#06b6d4', '#8b5cf6', '#f43f5e',
        ];

        const chartType: 'doughnut' | 'pie' = input.doughnut ? 'doughnut' : 'pie';
        const config = {
          type: chartType,
          data: {
            labels: input.labels,
            datasets: [{
              data: input.data,
              backgroundColor: colors.slice(0, input.data.length),
              borderWidth: 2,
              borderColor: '#ffffff',
            }],
          },
          options: {
            responsive: false,
            plugins: {
              title: { display: !!input.title, text: input.title },
              legend: { display: true, position: 'right' as const },
            },
          },
        };

        await saveChart(config, outputPath, input.width || 800, input.height || 600);

        return {
          success: true,
          output_path: outputPath,
          filename: filename,
          type: input.doughnut ? 'doughnut' : 'pie',
          categories_count: input.labels.length,
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  },

  // ===== FILE CONVERSION =====
  {
    name: 'convert_csv_json',
    description: 'Convert between CSV and JSON formats. Automatically detects input format from file extension.',
    category: 'compute',
    use_cases: [
      'Convert CSV to JSON',
      'Convert JSON to CSV',
      'Transform data formats',
      'Prepare data for different tools',
      'Data format conversion',
    ],
    parameters: {
      type: 'object',
      properties: {
        input_file: { type: 'string', description: 'Path to input file (.csv or .json)' },
        output_format: { type: 'string', enum: ['csv', 'json'], description: 'Output format' },
        output_file: { type: 'string', description: 'Optional output path (auto-generated if not provided)' },
      },
      required: ['input_file', 'output_format'],
    },
    handler: async (input: any, context: ToolContext) => {
      try {
        const result = await convertDataFormat(input.input_file, input.output_format, input.output_file);
        return { success: true, ...result };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  },

  {
    name: 'read_excel',
    description: 'Read an Excel file (.xlsx) and return data as JSON array.',
    category: 'compute',
    use_cases: [
      'Read Excel spreadsheets',
      'Import Excel data',
      'Parse .xlsx files',
      'Load spreadsheet data',
      'Convert Excel to JSON',
    ],
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to Excel file (.xlsx)' },
      },
      required: ['file_path'],
    },
    handler: async (input: any, context: ToolContext) => {
      try {
        const data = await readExcelFile(input.file_path);
        return {
          success: true,
          rowCount: data.length,
          columnCount: data.length > 0 ? Object.keys(data[0]).length : 0,
          data,
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  },

  {
    name: 'write_excel',
    description: 'Write data to an Excel file (.xlsx).',
    category: 'compute',
    use_cases: [
      'Create Excel files',
      'Export to spreadsheet',
      'Save data as .xlsx',
      'Generate Excel reports',
      'Convert JSON to Excel',
    ],
    parameters: {
      type: 'object',
      properties: {
        data: { type: 'array', description: 'Array of objects to write' },
        file_path: { type: 'string', description: 'Path to save Excel file' },
        sheet_name: { type: 'string', description: 'Sheet name (default: Sheet1)' },
      },
      required: ['data', 'file_path'],
    },
    handler: async (input: any, context: ToolContext) => {
      if (!Array.isArray(input.data)) {
        return { success: false, error: 'data must be an array' };
      }

      try {
        await writeExcelFile(input.data, input.file_path, input.sheet_name);
        return {
          success: true,
          file_path: input.file_path,
          rowCount: input.data.length,
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  },

  {
    name: 'convert_yaml_json',
    description: 'Convert YAML to JSON.',
    category: 'compute',
    use_cases: [
      'Convert YAML to JSON',
      'Parse YAML files',
      'Transform configuration formats',
    ],
    parameters: {
      type: 'object',
      properties: {
        input_file: { type: 'string', description: 'Path to YAML file' },
        output_file: { type: 'string', description: 'Optional output path' },
      },
      required: ['input_file'],
    },
    handler: async (input: any, context: ToolContext) => {
      try {
        const outputPath = await convertYAMLtoJSON(input.input_file, input.output_file);
        return { success: true, output_path: outputPath };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  },

  {
    name: 'convert_json_yaml',
    description: 'Convert JSON to YAML.',
    category: 'compute',
    use_cases: [
      'Convert JSON to YAML',
      'Create YAML configuration files',
      'Transform data to YAML format',
    ],
    parameters: {
      type: 'object',
      properties: {
        input_file: { type: 'string', description: 'Path to JSON file' },
        output_file: { type: 'string', description: 'Optional output path' },
      },
      required: ['input_file'],
    },
    handler: async (input: any, context: ToolContext) => {
      try {
        const outputPath = await convertJSONtoYAML(input.input_file, input.output_file);
        return { success: true, output_path: outputPath };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  },

  // ===== NLP TOOLS =====
  {
    name: 'text_tfidf',
    description: 'Calculate TF-IDF scores for documents to identify important/distinctive terms.',
    category: 'compute',
    use_cases: [
      'Find important terms in documents',
      'Identify distinctive keywords',
      'Analyze document significance',
      'Extract key terms',
      'Document term importance',
    ],
    parameters: {
      type: 'object',
      properties: {
        texts: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of documents to analyze',
        },
        top_n: { type: 'number', description: 'Number of top terms per document (default: 20)' },
        min_term_length: { type: 'number', description: 'Minimum term length (default: 3)' },
      },
      required: ['texts'],
    },
    handler: async (input: any, context: ToolContext) => {
      if (!Array.isArray(input.texts) || input.texts.length === 0) {
        return { success: false, error: 'texts must be a non-empty array' };
      }

      try {
        const results = await calculateTFIDF(
          input.texts,
          input.top_n || 20,
          input.min_term_length || 3
        );
        return {
          success: true,
          document_count: input.texts.length,
          results,
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  },

  {
    name: 'text_similarity',
    description: 'Calculate similarity between two text documents using TF-IDF and cosine similarity.',
    category: 'compute',
    use_cases: [
      'Compare document similarity',
      'Find similar texts',
      'Measure text likeness',
      'Duplicate detection',
      'Content similarity analysis',
    ],
    parameters: {
      type: 'object',
      properties: {
        text1: { type: 'string', description: 'First text to compare' },
        text2: { type: 'string', description: 'Second text to compare' },
      },
      required: ['text1', 'text2'],
    },
    handler: async (input: any, context: ToolContext) => {
      if (!input.text1 || !input.text2) {
        return { success: false, error: 'text1 and text2 are required' };
      }

      try {
        const result = await calculateSimilarity(input.text1, input.text2);
        return { success: true, ...result };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  },
];

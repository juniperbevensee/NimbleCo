/**
 * Web browsing and content fetching tools
 */

import { Tool } from '../base';

/**
 * Fetch and extract text content from a webpage
 */
async function fetchWebContent(url: string, maxLength: number = 10000): Promise<string> {
  try {
    // Parse URL to block dangerous targets
    const parsedUrl = new URL(url);

    // Block localhost, private IPs, and metadata endpoints (SSRF protection)
    const blockedHosts = [
      'localhost',
      '127.0.0.1',
      '0.0.0.0',
      '169.254.169.254', // AWS metadata
      '::1',
    ];

    const host = parsedUrl.hostname.toLowerCase();

    if (blockedHosts.includes(host) || host.startsWith('192.168.') || host.startsWith('10.') || host.startsWith('172.')) {
      throw new Error('Access to internal/private networks is blocked for security');
    }

    const response = await fetch(url, {
      method: 'GET', // Explicitly only GET
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; NimbleBot/1.0)',
      },
      redirect: 'follow',
      // Timeout after 10 seconds
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type') || '';

    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
      return `⚠️ Skipped non-HTML content (${contentType})`;
    }

    const html = await response.text();

    // Basic HTML to text conversion (strip tags, clean whitespace)
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, ' ')
      .trim();

    // Truncate if needed
    if (text.length > maxLength) {
      return text.substring(0, maxLength) + `\n\n... (truncated at ${maxLength} characters)`;
    }

    return text;
  } catch (error: any) {
    throw new Error(`Failed to fetch ${url}: ${error.message}`);
  }
}

export const webTools: Tool[] = [
  {
    name: 'fetch_webpage',
    description: 'Fetch and extract text content from a webpage. Returns the text content with HTML tags removed.',
    category: 'web',
    use_cases: [
      'Summarize a webpage',
      'Extract information from a URL',
      'Research a topic online',
      'Read documentation from a website',
    ],
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL to fetch (must start with http:// or https://)',
        },
        max_length: {
          type: 'number',
          description: 'Maximum number of characters to return (default: 10000)',
        },
      },
      required: ['url'],
    },
    handler: async (input: any, context: any) => {
      const { url, max_length } = input;

      // Validate URL
      if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
        return {
          success: false,
          error: 'Invalid URL. Must start with http:// or https://',
        };
      }

      try {
        const content = await fetchWebContent(url, max_length || 10000);

        return {
          success: true,
          url,
          content,
          content_length: content.length,
        };
      } catch (error: any) {
        return {
          success: false,
          error: error.message,
        };
      }
    },
  },
];

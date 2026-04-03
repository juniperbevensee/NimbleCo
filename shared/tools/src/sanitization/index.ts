/**
 * Input Sanitizer for LLM-bound web and social content
 * Defends against prompt injection, unicode attacks, and hidden instructions
 *
 * Adapted from Digital-Cryptids implementation
 * Based on OWASP LLM Top 10 (2025) and latest prompt injection research
 */

export interface SanitizationConfig {
  /** Remove zero-width unicode characters */
  removeZeroWidth?: boolean;
  /** Normalize unicode to NFC form */
  normalizeUnicode?: boolean;
  /** Maximum allowed length */
  maxLength?: number;
  /** Strip HTML/markup */
  stripHtml?: boolean;
  /** Remove control characters */
  removeControlChars?: boolean;
  /** Detect and flag suspicious patterns */
  detectSuspiciousPatterns?: boolean;
}

export interface SanitizationResult {
  sanitized: string;
  flagged: boolean;
  flags: string[];
  removed: {
    zeroWidth: number;
    controlChars: number;
    htmlTags: number;
  };
}

export interface InjectionDetection {
  score: number; // 0-1, higher = more likely injection
  reasons: string[];
}

/**
 * Multi-layered input sanitization to prevent prompt injection attacks
 */
export class InputSanitizer {
  // Zero-width and invisible unicode characters that can hide malicious instructions
  private static readonly ZERO_WIDTH_CHARS = [
    '\u200B', // Zero Width Space
    '\u200C', // Zero Width Non-Joiner
    '\u200D', // Zero Width Joiner
    '\u200E', // Left-to-Right Mark
    '\u200F', // Right-to-Left Mark
    '\uFEFF', // Zero Width No-Break Space (BOM)
    '\u2060', // Word Joiner
    '\u2061', // Function Application
    '\u2062', // Invisible Times
    '\u2063', // Invisible Separator
    '\u2064', // Invisible Plus
  ];

  // Patterns commonly used in prompt injection attacks
  private static readonly SUSPICIOUS_PATTERNS = [
    // Direct instruction attempts
    /ignore\s+(previous|above|all)\s+(instructions?|prompts?|rules?)/gi,
    /disregard\s+(previous|above|all)/gi,
    /forget\s+(previous|everything|all)/gi,
    /new\s+(instructions?|prompt|system\s+message)/gi,

    // System prompt manipulation
    /system[:>\s]|\[system\]|<system>/gi,
    /assistant[:>\s]|\[assistant\]|<assistant>/gi,
    /\[INST\]|\[\/INST\]/gi, // Llama instruction markers
    /<\|im_start\|>|<\|im_end\|>/gi, // ChatML markers

    // Role playing jailbreaks
    /act\s+as\s+(a\s+)?(?:dan|developer|grandma|do\s+anything\s+now)/gi,
    /you\s+are\s+now\s+(?:in\s+)?(?:dan|developer|unrestricted)\s+mode/gi,

    // Encoding obfuscation indicators
    /base64|hexadecimal|rot13|rot\s*\d+/gi,
    /decode|decrypt|deobfuscate/gi,

    // Repeated characters (hidden text technique)
    /(.)\1{50,}/g, // Same char repeated 50+ times

    // Boundary escape attempts
    /<\/untrusted_web_content>/gi,
    /<\/system>/gi,
  ];

  private static readonly CONTROL_CHARS_REGEX = /[\x00-\x1F\x7F-\x9F]/g;
  private static readonly HTML_TAG_REGEX = /<[^>]*>/g;

  /**
   * Sanitize input text before sending to LLM
   */
  static sanitize(
    input: string,
    config: SanitizationConfig = {}
  ): SanitizationResult {
    const {
      removeZeroWidth = true,
      normalizeUnicode = true,
      maxLength = 10000,
      stripHtml = true,
      removeControlChars = true,
      detectSuspiciousPatterns = true,
    } = config;

    let text = input;
    const flags: string[] = [];
    const removed = {
      zeroWidth: 0,
      controlChars: 0,
      htmlTags: 0,
    };

    // 1. Unicode normalization (prevents homograph attacks)
    if (normalizeUnicode) {
      text = text.normalize('NFC');
    }

    // 2. Remove zero-width characters
    if (removeZeroWidth) {
      const before = text.length;
      text = this.removeZeroWidthCharacters(text);
      removed.zeroWidth = before - text.length;

      if (removed.zeroWidth > 0) {
        flags.push(`Removed ${removed.zeroWidth} zero-width unicode characters`);
      }
    }

    // 3. Remove control characters (except newlines, tabs)
    if (removeControlChars) {
      const before = text.length;
      text = text.replace(this.CONTROL_CHARS_REGEX, '');
      removed.controlChars = before - text.length;

      if (removed.controlChars > 0) {
        flags.push(`Removed ${removed.controlChars} control characters`);
      }
    }

    // 4. Strip HTML tags (prevents hidden instructions in markup)
    if (stripHtml) {
      const before = text.length;
      text = text.replace(this.HTML_TAG_REGEX, ' ');
      removed.htmlTags = Math.floor((before - text.length) / 2); // Rough estimate

      if (removed.htmlTags > 5) {
        flags.push(`Stripped HTML tags (~${removed.htmlTags} characters)`);
      }
    }

    // 5. Detect suspicious patterns
    if (detectSuspiciousPatterns) {
      for (const pattern of this.SUSPICIOUS_PATTERNS) {
        if (pattern.test(text)) {
          flags.push(`Suspicious pattern detected: ${pattern.source.substring(0, 50)}...`);
        }
      }
    }

    // 6. Enforce length limits
    if (text.length > maxLength) {
      text = text.substring(0, maxLength);
      flags.push(`Truncated to ${maxLength} characters`);
    }

    // 7. Collapse excessive whitespace
    text = text.replace(/\s+/g, ' ').trim();

    return {
      sanitized: text,
      flagged: flags.length > 0,
      flags,
      removed,
    };
  }

  /**
   * Remove all zero-width unicode characters
   */
  private static removeZeroWidthCharacters(text: string): string {
    let result = text;
    for (const char of this.ZERO_WIDTH_CHARS) {
      result = result.split(char).join('');
    }
    return result;
  }

  /**
   * Detect potential prompt injection attempts
   * Returns confidence score 0-1 (higher = more suspicious)
   */
  static detectInjection(text: string): InjectionDetection {
    const reasons: string[] = [];
    let score = 0;

    // Check for instruction keywords
    const instructionKeywords = [
      'ignore', 'disregard', 'forget', 'instead', 'actually',
      'system', 'prompt', 'instruction', 'override', 'bypass'
    ];

    const lowerText = text.toLowerCase();
    const foundKeywords = instructionKeywords.filter(kw => lowerText.includes(kw));

    if (foundKeywords.length >= 2) {
      score += 0.3;
      reasons.push(`Multiple instruction keywords: ${foundKeywords.join(', ')}`);
    }

    // Check for role-playing jailbreak attempts
    if (/act as|you are now|pretend (you|to) (are|be)/gi.test(text)) {
      score += 0.4;
      reasons.push('Role-playing attempt detected');
    }

    // Check for system prompt markers
    if (/\[system\]|<system>|system:|<\|im_start\|>|\[INST\]/gi.test(text)) {
      score += 0.5;
      reasons.push('System prompt markers detected');
    }

    // Check for encoding indicators
    if (/base64|encode|decode|hex|rot\d+/gi.test(text)) {
      score += 0.2;
      reasons.push('Encoding/obfuscation indicators');
    }

    // Check for zero-width character abuse
    const zwCount = this.ZERO_WIDTH_CHARS.reduce(
      (count, char) => count + (text.split(char).length - 1),
      0
    );
    if (zwCount > 5) {
      score += 0.3;
      reasons.push(`Excessive zero-width characters (${zwCount})`);
    }

    // Check for repeated character attacks
    if (/(.)\1{50,}/.test(text)) {
      score += 0.2;
      reasons.push('Repeated character pattern (possible hidden text)');
    }

    return {
      score: Math.min(score, 1.0),
      reasons,
    };
  }
}

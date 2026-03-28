#!/usr/bin/env tsx
// Export NimbleCo tools in a format Swarm-Map can import

import { registry } from '../src/index.js';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Swarm-Map tool format for import
 */
interface SwarmMapTool {
  name: string;
  category: string;
  suggestedTier: string;
  description: string;
  requiredEnv?: string[];
  permissions?: {
    requiresAdmin?: boolean;
    requiresContextRoom?: boolean;
    sensitiveReason?: string;
  };
}

/**
 * Map NimbleCo tool categories to Swarm-Map risk tiers
 * Based on PHASE-3C-STATUS-AND-NIMBLECO-IMPORT.md
 */
const CATEGORY_TO_TIER: Record<string, string> = {
  // HIGH risk - can affect system/data
  'filesystem': 'high',
  'compute': 'high',
  'analytics': 'high',

  // MEDIUM risk - read/write operations
  'crm': 'medium',
  'docs': 'medium',
  'code': 'medium',
  'storage': 'medium',
  'calendar': 'medium',

  // LOW risk - read-only or communication
  'web': 'low',
  'meetings': 'low',
  'research': 'low',
  'communication': 'low',
  'memory': 'low',
  'sales': 'low', // Added sales as low-risk
};

/**
 * Export all registered tools in Swarm-Map format
 */
function exportTools(): SwarmMapTool[] {
  const allTools = registry.getAllTools();

  return allTools.map(tool => ({
    name: tool.name,
    category: tool.category,
    suggestedTier: CATEGORY_TO_TIER[tool.category] || 'medium',
    description: tool.description,
    requiredEnv: tool.requiredEnv,
    permissions: tool.permissions,
  }));
}

/**
 * Main export function
 */
function main() {
  console.log('🔧 Exporting NimbleCo tools for Swarm-Map...\n');

  // Export tools
  const tools = exportTools();

  // Group by tier for summary
  const byTier = tools.reduce((acc, tool) => {
    const tier = tool.suggestedTier;
    if (!acc[tier]) acc[tier] = [];
    acc[tier].push(tool);
    return acc;
  }, {} as Record<string, SwarmMapTool[]>);

  // Print summary
  console.log('📊 Export Summary:');
  console.log(`   Total tools: ${tools.length}`);
  console.log('');
  console.log('   By risk tier:');
  Object.entries(byTier).forEach(([tier, tierTools]) => {
    console.log(`   - ${tier}: ${tierTools.length} tools`);
  });
  console.log('');
  console.log('   By category:');
  const byCategory = tools.reduce((acc, tool) => {
    if (!acc[tool.category]) acc[tool.category] = [];
    acc[tool.category].push(tool);
    return acc;
  }, {} as Record<string, SwarmMapTool[]>);
  Object.entries(byCategory)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .forEach(([category, categoryTools]) => {
      console.log(`   - ${category}: ${categoryTools.length} tools`);
    });

  // Create output object
  const output = {
    exportedAt: new Date().toISOString(),
    sourceSystem: 'nimbleco',
    version: '1.0',
    tools,
  };

  // Write to file
  const outputPath = path.resolve(__dirname, '..', 'nimbleco-tools-export.json');
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

  console.log('');
  console.log(`✅ Exported to: ${outputPath}`);
  console.log('');
  console.log('📋 Next steps:');
  console.log('   1. Review the exported file');
  console.log('   2. Import into Swarm-Map using the admin UI');
  console.log('   3. Map NimbleCo tools to user groups/tiers');
}

// Run the export
main();

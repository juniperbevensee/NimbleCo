#!/usr/bin/env tsx
// Export NimbleCo tools in a format Swarm-Map can import

import { registry, Tool } from '../src/index.js';
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
  /**
   * Source module: "core" for built-in tools, or folder name (e.g., "osint", "cryptid")
   * for additional tools. Used by Swarm-Map to filter based on ADDITIONAL_TOOLS env var.
   */
  sourceModule: string;
}

// Track which tools come from which additional-tools module
const additionalToolModules = new Map<string, string>();

/**
 * Map NimbleCo tool categories to Swarm-Map risk tiers
 * Based on PHASE-3C-STATUS-AND-NIMBLECO-IMPORT.md
 */
const CATEGORY_TO_TIER: Record<string, string> = {
  // HIGH risk - can affect system/data
  'filesystem': 'high',
  'compute': 'high',
  'analytics': 'high',

  // MEDIUM risk - read/write operations (uses "med" to match Swarm-Map DB)
  'crm': 'med',
  'docs': 'med',
  'code': 'med',
  'storage': 'med',
  'calendar': 'med',

  // HIGH risk - web content can contain prompt injection
  'web': 'high',
  'meetings': 'low',
  'research': 'low',
  'communication': 'low',
  'memory': 'low',
  'sales': 'low',
};

/**
 * Auto-discover and load additional tools from the additional-tools/ directory
 * This ensures ALL tools get exported, not just core tools
 */
async function loadAdditionalToolsForExport(): Promise<void> {
  const additionalToolsDir = path.resolve(__dirname, '../../..', 'additional-tools');

  // Check if directory exists
  if (!fs.existsSync(additionalToolsDir)) {
    console.log('   No additional-tools directory found, exporting core tools only');
    return;
  }

  // Find all subdirectories with index.js
  const entries = fs.readdirSync(additionalToolsDir, { withFileTypes: true });
  const categories = entries
    .filter(e => e.isDirectory() && e.name !== 'example')
    .filter(e => fs.existsSync(path.join(additionalToolsDir, e.name, 'index.js')))
    .map(e => e.name);

  if (categories.length === 0) {
    console.log('   No compiled additional tools found');
    console.log('   Run: npx tsc -p additional-tools/tsconfig.json');
    return;
  }

  console.log(`   Found additional tool categories: ${categories.join(', ')}`);

  for (const category of categories) {
    const categoryPath = path.join(additionalToolsDir, category, 'index.js');

    try {
      const module = await import(categoryPath);

      // Look for exported tool arrays
      const possibleExports = [`${category}Tools`, 'tools', 'additionalTools', 'default'];
      let loaded = false;

      for (const exportName of possibleExports) {
        const tools = exportName === 'default' ? module.default : module[exportName];
        if (tools && Array.isArray(tools)) {
          tools.forEach((tool: Tool) => {
            registry.register(tool);
            // Track that this tool comes from this additional-tools module
            additionalToolModules.set(tool.name, category);
          });
          console.log(`   ✅ Loaded ${tools.length} tool(s) from ${category}`);
          loaded = true;
          break;
        }
      }

      if (!loaded) {
        console.warn(`   ⚠️  No tool arrays found in ${category}/index.js`);
      }
    } catch (error: any) {
      console.error(`   ❌ Failed to load ${category}: ${error.message}`);
    }
  }
}

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
    // "core" for built-in tools, or the folder name (e.g., "osint", "cryptid") for additional tools
    sourceModule: additionalToolModules.get(tool.name) || 'core',
  }));
}

/**
 * Main export function
 */
async function main() {
  console.log('🔧 Exporting NimbleCo tools for Swarm-Map...\n');

  // Load additional tools first (auto-discover from additional-tools/)
  console.log('📦 Loading additional tools...');
  await loadAdditionalToolsForExport();
  console.log('');

  // Export tools (now includes both core and additional)
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
main().catch(err => {
  console.error('❌ Export failed:', err);
  process.exit(1);
});

#!/usr/bin/env tsx
// Export NimbleCo tools in a format Swarm-Map can import

import { registry } from '../src/index.js';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

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
 * Artifact file format for export
 */
interface ArtifactFile {
  filename: string;
  relativePath: string;
  size: number;
  contentBase64: string;
  sha256: string;
  mimeType?: string;
}

/**
 * Artifacts collection for export
 */
interface Artifacts {
  memory?: ArtifactFile;
  identity?: ArtifactFile;
  workspaceFiles: ArtifactFile[];
  filesDir: ArtifactFile[];
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
 * Read a file and create an artifact object
 */
function readArtifactFile(filePath: string, baseDir: string): ArtifactFile | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const stats = fs.statSync(filePath);
    if (!stats.isFile()) {
      return null;
    }

    const content = fs.readFileSync(filePath);
    const contentBase64 = content.toString('base64');
    const sha256 = crypto.createHash('sha256').update(content).digest('hex');
    const relativePath = path.relative(baseDir, filePath);

    return {
      filename: path.basename(filePath),
      relativePath,
      size: stats.size,
      contentBase64,
      sha256,
      mimeType: getMimeType(filePath),
    };
  } catch (error) {
    console.warn(`[Export] Failed to read artifact: ${filePath}`, error);
    return null;
  }
}

/**
 * Get MIME type from file extension
 */
function getMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.md': 'text/markdown',
    '.txt': 'text/plain',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

/**
 * Recursively read all files in a directory
 */
function readDirectoryFiles(dirPath: string, baseDir: string): ArtifactFile[] {
  const artifacts: ArtifactFile[] = [];

  try {
    if (!fs.existsSync(dirPath)) {
      return artifacts;
    }

    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      // Skip hidden files and directories
      if (entry.name.startsWith('.')) {
        continue;
      }

      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        // Recursively process subdirectories
        artifacts.push(...readDirectoryFiles(fullPath, baseDir));
      } else if (entry.isFile()) {
        const artifact = readArtifactFile(fullPath, baseDir);
        if (artifact) {
          artifacts.push(artifact);
        }
      }
    }
  } catch (error) {
    console.warn(`[Export] Failed to read directory: ${dirPath}`, error);
  }

  return artifacts;
}

/**
 * Collect all NimbleCo artifacts (memory, identity, workspace files)
 */
function collectArtifacts(): Artifacts {
  const repoRoot = path.resolve(__dirname, '../../..');
  const storagePath = path.join(repoRoot, 'storage');
  const configPath = path.join(repoRoot, 'config');

  console.log('📁 Collecting artifacts from storage...');

  const artifacts: Artifacts = {
    workspaceFiles: [],
    filesDir: [],
  };

  // 1. Memory file (storage/memory.md)
  const memoryPath = path.join(storagePath, 'memory.md');
  const memory = readArtifactFile(memoryPath, repoRoot);
  if (memory) {
    artifacts.memory = memory;
    console.log(`   ✓ Found memory.md (${(memory.size / 1024).toFixed(2)} KB)`);
  } else {
    console.log('   ⚠ memory.md not found');
  }

  // 2. Identity file (storage/identity.md or config/identity.template.md)
  let identityPath = path.join(storagePath, 'identity.md');
  let identity = readArtifactFile(identityPath, repoRoot);

  if (!identity) {
    console.log('   ⚠ storage/identity.md not found, using template');
    identityPath = path.join(configPath, 'identity.template.md');
    identity = readArtifactFile(identityPath, repoRoot);
  }

  if (identity) {
    artifacts.identity = identity;
    console.log(`   ✓ Found identity (${(identity.size / 1024).toFixed(2)} KB)`);
  } else {
    console.log('   ⚠ No identity file found');
  }

  // 3. Workspace files (storage/workspace/*)
  const workspacePath = path.join(storagePath, 'workspace');
  artifacts.workspaceFiles = readDirectoryFiles(workspacePath, repoRoot);
  if (artifacts.workspaceFiles.length > 0) {
    const totalSize = artifacts.workspaceFiles.reduce((sum, f) => sum + f.size, 0);
    console.log(`   ✓ Found ${artifacts.workspaceFiles.length} workspace file(s) (${(totalSize / 1024).toFixed(2)} KB)`);
  } else {
    console.log('   ⚠ No workspace files found');
  }

  // 4. Files directory (storage/files/*)
  const filesPath = path.join(storagePath, 'files');
  artifacts.filesDir = readDirectoryFiles(filesPath, repoRoot);
  if (artifacts.filesDir.length > 0) {
    const totalSize = artifacts.filesDir.reduce((sum, f) => sum + f.size, 0);
    console.log(`   ✓ Found ${artifacts.filesDir.length} file(s) in files/ (${(totalSize / 1024).toFixed(2)} KB)`);
  } else {
    console.log('   ⚠ No files in files/ directory');
  }

  return artifacts;
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
  }));
}

/**
 * Main export function
 */
function main() {
  console.log('🔧 Exporting NimbleCo tools and artifacts for Swarm-Map...\n');

  // Export tools
  const tools = exportTools();

  // Group by tier for summary
  const byTier = tools.reduce((acc, tool) => {
    const tier = tool.suggestedTier;
    if (!acc[tier]) acc[tier] = [];
    acc[tier].push(tool);
    return acc;
  }, {} as Record<string, SwarmMapTool[]>);

  // Print tools summary
  console.log('📊 Tools Export Summary:');
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

  console.log('');

  // Collect artifacts
  const artifacts = collectArtifacts();

  // Count total artifacts
  let totalArtifactCount = 0;
  let totalArtifactSize = 0;

  if (artifacts.memory) {
    totalArtifactCount++;
    totalArtifactSize += artifacts.memory.size;
  }
  if (artifacts.identity) {
    totalArtifactCount++;
    totalArtifactSize += artifacts.identity.size;
  }
  totalArtifactCount += artifacts.workspaceFiles.length;
  totalArtifactSize += artifacts.workspaceFiles.reduce((sum, f) => sum + f.size, 0);
  totalArtifactCount += artifacts.filesDir.length;
  totalArtifactSize += artifacts.filesDir.reduce((sum, f) => sum + f.size, 0);

  console.log('');
  console.log('📦 Artifacts Summary:');
  console.log(`   Total artifacts: ${totalArtifactCount}`);
  console.log(`   Total size: ${(totalArtifactSize / 1024).toFixed(2)} KB`);

  // Create output object
  const output = {
    exportedAt: new Date().toISOString(),
    sourceSystem: 'nimbleco',
    version: '2.0', // Incremented version to include artifacts
    tools,
    artifacts,
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
  console.log('   4. Artifacts will be stored in Swarm-Map gateway storage');
}

// Run the export
main();

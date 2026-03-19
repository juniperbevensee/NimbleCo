#!/usr/bin/env node
/**
 * NimbleCo Multi-Bot Setup Wizard
 *
 * Interactive CLI for creating and managing bot configurations
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const rootDir = path.join(__dirname, '..');

// Utility to ask questions
function ask(question) {
  return new Promise(resolve => rl.question(question, resolve));
}

// Utility to parse .env file
function parseEnvFile(filepath) {
  if (!fs.existsSync(filepath)) return {};

  const content = fs.readFileSync(filepath, 'utf-8');
  const env = {};

  content.split('\n').forEach(line => {
    line = line.trim();
    if (!line || line.startsWith('#')) return;

    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      env[match[1].trim()] = match[2].trim();
    }
  });

  return env;
}

// Utility to write .env file
function writeEnvFile(filepath, env) {
  const lines = Object.entries(env).map(([key, value]) => `${key}=${value}`);
  fs.writeFileSync(filepath, lines.join('\n') + '\n', 'utf-8');
}

// Get list of existing bots
function getExistingBots() {
  return fs.readdirSync(rootDir)
    .filter(f => f.startsWith('.env.') && !f.endsWith('.example') && !f.endsWith('.template'))
    .map(f => f.replace('.env.', ''));
}

// Mask sensitive values
function mask(value) {
  if (!value || value.length < 8) return '●●●●●●';
  return value.substring(0, 4) + '●'.repeat(value.length - 4);
}

async function createBot() {
  console.log('\n📝 Creating new bot configuration...\n');

  // Get bot ID
  const botId = await ask('Bot ID (e.g., "personal", "osint", "cryptid"): ');

  if (!botId || !/^[a-z0-9_-]+$/i.test(botId)) {
    console.log('❌ Invalid bot ID. Use only letters, numbers, hyphens, and underscores.');
    return;
  }

  const envPath = path.join(rootDir, `.env.${botId}`);

  if (fs.existsSync(envPath)) {
    console.log(`❌ Bot "${botId}" already exists. Use edit mode to modify it.`);
    return;
  }

  // Ask if they want to clone from existing config
  const existingBots = getExistingBots();
  let sourceEnv = {};

  if (existingBots.length > 0) {
    console.log(`\nClone from existing bot config?`);
    existingBots.forEach((bot, i) => console.log(`  [${i + 1}] ${bot}`));
    console.log(`  [0] Start fresh`);

    const choice = await ask('\nChoice: ');
    const idx = parseInt(choice) - 1;

    if (idx >= 0 && idx < existingBots.length) {
      const sourceBot = existingBots[idx];
      const sourcePath = path.join(rootDir, `.env.${sourceBot}`);
      sourceEnv = parseEnvFile(sourcePath);
      console.log(`\n✅ Cloning from "${sourceBot}"\n`);
    }
  }

  // Build new config
  const newEnv = { ...sourceEnv };

  // Always set BOT_ID
  newEnv.BOT_ID = botId;

  console.log('\n🔧 Configuration (press Enter to keep current value)\n');

  // Mattermost config
  console.log('━━━ Mattermost Configuration ━━━');

  const mmUrl = sourceEnv.MATTERMOST_URL || '';
  const mmUrlNew = await ask(`  URL [${mmUrl || 'required'}]: `);
  if (mmUrlNew) newEnv.MATTERMOST_URL = mmUrlNew;
  else if (!mmUrl) {
    console.log('❌ Mattermost URL is required');
    return;
  }

  const mmToken = sourceEnv.MATTERMOST_BOT_TOKEN ? mask(sourceEnv.MATTERMOST_BOT_TOKEN) : 'required';
  const mmTokenNew = await ask(`  Bot Token [${mmToken}]: `);
  if (mmTokenNew) newEnv.MATTERMOST_BOT_TOKEN = mmTokenNew;
  else if (!sourceEnv.MATTERMOST_BOT_TOKEN) {
    console.log('❌ Bot token is required');
    return;
  }

  const mmTeam = sourceEnv.MATTERMOST_TEAM_NAME || '';
  const mmTeamNew = await ask(`  Team Name [${mmTeam || 'optional'}]: `);
  if (mmTeamNew) newEnv.MATTERMOST_TEAM_NAME = mmTeamNew;

  // Identity file
  console.log('\n━━━ Bot Identity ━━━');
  const identityPath = `./storage/identity-${botId}.md`;
  newEnv.IDENTITY_FILE = identityPath;
  console.log(`  Identity file will be: ${identityPath}`);

  // Workspace root
  console.log('\n━━━ Storage ━━━');
  const workspaceDefault = `./storage/workspace-${botId}`;
  const workspaceNew = await ask(`  Workspace directory [${workspaceDefault}]: `);
  newEnv.WORKSPACE_ROOT = workspaceNew || workspaceDefault;

  // Additional tools configuration
  console.log('\n━━━ Additional Tools ━━━');
  console.log('Load custom tools from additional-tools/ directory?');
  console.log('(e.g., "osint,cryptids" or leave blank for core tools only)');
  const additionalTools = await ask('  ADDITIONAL_TOOLS [blank for none]: ');
  if (additionalTools) {
    newEnv.ADDITIONAL_TOOLS = additionalTools.trim();
  }

  // Write config file
  writeEnvFile(envPath, newEnv);
  console.log(`\n✅ Created ${envPath}`);

  // Create workspace directory
  const workspacePath = path.join(rootDir, newEnv.WORKSPACE_ROOT);
  if (!fs.existsSync(workspacePath)) {
    fs.mkdirSync(workspacePath, { recursive: true });
    console.log(`✅ Created workspace directory: ${workspacePath}`);
  }

  // Create identity file
  const identityFullPath = path.join(rootDir, identityPath);
  if (!fs.existsSync(identityFullPath)) {
    const identityTemplate = `# ${botId} Bot Identity

## Who am I?
[Describe your bot's personality and role]

## What am I good at?
[Describe your bot's capabilities and strengths]

## How do I communicate?
[Describe your bot's communication style]

## What are my priorities?
[Describe your bot's goals and priorities]
`;
    fs.writeFileSync(identityFullPath, identityTemplate, 'utf-8');
    console.log(`✅ Created identity template: ${identityFullPath}`);
    console.log('   → Edit this file to customize your bot\'s persona');
  }

  console.log('\n✨ Bot setup complete!\n');
  console.log('Next steps:');
  console.log(`  1. Edit ${identityPath} to define your bot's persona`);
  console.log(`  2. Run: npm start`);
  console.log(`  3. Check: pm2 list`);
  console.log(`  4. Logs: pm2 logs nimble-${botId}\n`);
}

async function listBots() {
  const bots = getExistingBots();

  if (bots.length === 0) {
    console.log('\n📭 No bot configurations found.\n');
    console.log('Create your first bot with: npm run setup\n');
    return;
  }

  console.log(`\n🤖 Configured Bots (${bots.length}):\n`);

  bots.forEach(bot => {
    const envPath = path.join(rootDir, `.env.${bot}`);
    const env = parseEnvFile(envPath);

    console.log(`  ${bot}:`);
    console.log(`    Team: ${env.MATTERMOST_TEAM_NAME || 'any'}`);
    console.log(`    Identity: ${env.IDENTITY_FILE || 'default'}`);
    console.log(`    Workspace: ${env.WORKSPACE_ROOT || './storage/workspace'}`);
    console.log(`    Additional tools: ${env.ADDITIONAL_TOOLS || '(none)'}`);
    console.log(`    Has token: ${env.MATTERMOST_BOT_TOKEN ? '✓' : '✗'}`);
    console.log('');
  });
}

async function deleteBot() {
  const bots = getExistingBots();

  if (bots.length === 0) {
    console.log('\n📭 No bots to delete.\n');
    return;
  }

  console.log('\n🗑️  Delete bot:\n');
  bots.forEach((bot, i) => console.log(`  [${i + 1}] ${bot}`));
  console.log(`  [0] Cancel`);

  const choice = await ask('\nChoice: ');
  const idx = parseInt(choice) - 1;

  if (idx < 0 || idx >= bots.length) {
    console.log('Cancelled.');
    return;
  }

  const bot = bots[idx];
  const confirm = await ask(`\n⚠️  Really delete "${bot}"? Type "yes" to confirm: `);

  if (confirm.toLowerCase() !== 'yes') {
    console.log('Cancelled.');
    return;
  }

  const envPath = path.join(rootDir, `.env.${bot}`);
  fs.unlinkSync(envPath);
  console.log(`✅ Deleted ${envPath}`);

  console.log('\n⚠️  Note: Identity file and workspace directory were NOT deleted.');
  console.log('    Delete manually if needed.\n');
}

async function main() {
  console.log('\n🤖 NimbleCo Multi-Bot Setup\n');
  console.log('━'.repeat(50));

  const bots = getExistingBots();
  console.log(`\nCurrent bots: ${bots.length > 0 ? bots.join(', ') : 'none'}\n`);

  console.log('[1] Create new bot');
  console.log('[2] List all bots');
  console.log('[3] Delete bot');
  console.log('[0] Exit\n');

  const choice = await ask('Choice: ');

  switch (choice) {
    case '1':
      await createBot();
      break;
    case '2':
      await listBots();
      break;
    case '3':
      await deleteBot();
      break;
    case '0':
      console.log('👋 Goodbye!\n');
      break;
    default:
      console.log('Invalid choice.');
  }

  rl.close();
}

main().catch(error => {
  console.error('Error:', error);
  rl.close();
  process.exit(1);
});

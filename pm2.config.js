/**
 * PM2 Configuration for Multi-Bot Deployment
 *
 * Auto-discovers all .env.* files (except .env.example and .env.template)
 * and creates a PM2 app for each bot configuration.
 *
 * Usage:
 *   npm start      - Start all bots
 *   npm restart    - Restart all bots
 *   npm stop       - Stop all bots
 *   pm2 list       - View all running bots
 *   pm2 logs       - View logs from all bots
 *   pm2 logs nimble-personal  - View logs from specific bot
 */

const fs = require('fs');
const path = require('path');

/**
 * Parse .env file into key-value object
 */
function parseEnvFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const env = {};

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = trimmed.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      let value = match[2].trim();
      // Remove quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      env[key] = value;
    }
  }

  return env;
}

// Find all .env.* files (excluding examples/templates)
const rootDir = __dirname;
const envFiles = fs.readdirSync(rootDir)
  .filter(file =>
    file.startsWith('.env.') &&
    !file.endsWith('.example') &&
    !file.endsWith('.template')
  );

console.log(`📦 PM2 Config: Found ${envFiles.length} bot configuration(s)`);

// Check for bots without tokens and duplicate tokens
const botsWithoutTokens = [];
const tokenMap = new Map(); // token -> [bot1, bot2, ...]

envFiles.forEach(file => {
  const botName = file.replace('.env.', '');
  const filePath = path.join(rootDir, file);
  const env = parseEnvFile(filePath);

  if (!env.MATTERMOST_BOT_TOKEN || env.MATTERMOST_BOT_TOKEN === '') {
    botsWithoutTokens.push(botName);
  } else {
    const token = env.MATTERMOST_BOT_TOKEN;
    if (!tokenMap.has(token)) {
      tokenMap.set(token, []);
    }
    tokenMap.get(token).push(botName);
  }
});

// Warn about bots without tokens
if (botsWithoutTokens.length > 0) {
  console.log(`\n⚠️  WARNING: ${botsWithoutTokens.length} bot(s) without MATTERMOST_BOT_TOKEN will be skipped:`);
  botsWithoutTokens.forEach(bot => console.log(`   - ${bot}`));
  console.log(`   Add MATTERMOST_BOT_TOKEN to .env.${botsWithoutTokens[0]} to enable`);
}

// Warn about duplicate tokens
const duplicates = Array.from(tokenMap.entries())
  .filter(([token, bots]) => bots.length > 1);

if (duplicates.length > 0) {
  console.log(`\n🚨 ERROR: Duplicate MATTERMOST_BOT_TOKEN detected!\n`);
  duplicates.forEach(([token, bots]) => {
    console.log(`   These bots share the same token:`);
    bots.forEach(bot => console.log(`   - ${bot}`));
    console.log(`   This will cause:`)
    console.log(`   - WebSocket connection conflicts`);
    console.log(`   - Messages delivered to random bots`);
    console.log(`   - Database conflicts\n`);
  });
  console.log(`   ❌ FIX: Each bot needs a unique token from Mattermost System Console → Bot Accounts\n`);
  process.exit(1);
}

// Filter out bots without tokens
const validEnvFiles = envFiles.filter(file => {
  const botName = file.replace('.env.', '');
  return !botsWithoutTokens.includes(botName);
});

if (validEnvFiles.length === 0) {
  console.log(`\n❌ No valid bot configurations found!`);
  console.log(`   All bots are missing MATTERMOST_BOT_TOKEN`);
  console.log(`   Run: npm run setup:bot\n`);
  process.exit(1);
}

// Generate PM2 app config for each valid bot
console.log(`\n✅ Starting ${validEnvFiles.length} bot(s):`);
const apps = validEnvFiles.map(envFile => {
  const botName = envFile.replace('.env.', '');
  const filePath = path.join(rootDir, envFile);
  const envVars = parseEnvFile(filePath);
  console.log(`   - ${botName} (${envFile}) BOT_ID=${envVars.BOT_ID || botName}`);

  return {
    name: `nimble-${botName}`,
    script: './coordinator/dist/main.js',
    cwd: rootDir,

    // Actually load environment variables from the .env file
    env: {
      ...envVars,
      // Ensure BOT_ID is set even if not in .env file
      BOT_ID: envVars.BOT_ID || botName,
    },

    // Process management
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',

    // Logging
    error_file: `./logs/pm2-${botName}-error.log`,
    out_file: `./logs/pm2-${botName}-out.log`,
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    merge_logs: true,

    // Restart policy
    max_restarts: 10,
    min_uptime: '10s',
    restart_delay: 4000,
  };
});

// Also add dashboard server as a separate PM2 app
apps.push({
  name: 'nimble-dashboard',
  script: './dashboard/dist/server.js',
  cwd: rootDir,
  exec_mode: 'fork',  // Use fork mode, not cluster (avoids port conflicts)
  instances: 1,
  autorestart: true,
  watch: false,
  max_memory_restart: '500M',
  error_file: './logs/pm2-dashboard-error.log',
  out_file: './logs/pm2-dashboard-out.log',
  log_date_format: 'YYYY-MM-DD HH:mm:ss',
  merge_logs: true,

  // Dashboard uses .env (not .env.*)
  env_file: path.join(rootDir, '.env'),
});

// Add universal agents for swarm processing (3 instances for parallelism)
const numAgents = parseInt(process.env.UNIVERSAL_AGENT_COUNT || '3', 10);
console.log(`\n✅ Starting ${numAgents} universal agent(s) for swarm processing`);
for (let i = 1; i <= numAgents; i++) {
  apps.push({
    name: `nimble-agent-${i}`,
    script: './agents/universal/dist/main.js',
    cwd: rootDir,
    exec_mode: 'fork',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    error_file: `./logs/pm2-agent-${i}-error.log`,
    out_file: `./logs/pm2-agent-${i}-out.log`,
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    merge_logs: true,
    env_file: path.join(rootDir, '.env'),
  });
}

console.log('\n✅ PM2 configuration ready\n');

module.exports = {
  apps
};

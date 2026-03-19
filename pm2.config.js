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

// Find all .env.* files (excluding examples/templates)
const rootDir = __dirname;
const envFiles = fs.readdirSync(rootDir)
  .filter(file =>
    file.startsWith('.env.') &&
    !file.endsWith('.example') &&
    !file.endsWith('.template')
  );

console.log(`📦 PM2 Config: Found ${envFiles.length} bot configuration(s)`);

if (envFiles.length === 0) {
  console.log('⚠️  No bot configurations found!');
  console.log('   Create a .env.<bot-name> file or run: npm run setup');
  console.log('   Example: .env.personal, .env.osint, .env.cryptid');
  process.exit(1);
}

// Generate PM2 app config for each bot
const apps = envFiles.map(envFile => {
  const botName = envFile.replace('.env.', '');
  console.log(`   - ${botName} (${envFile})`);

  return {
    name: `nimble-${botName}`,
    script: './coordinator/dist/main.js',
    cwd: rootDir,

    // Load environment from specific .env.* file
    env_file: path.join(rootDir, envFile),

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

console.log('\n✅ PM2 configuration ready\n');

module.exports = {
  apps
};

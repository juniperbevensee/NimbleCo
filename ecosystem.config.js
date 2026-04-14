// pm2 ecosystem config - Start all services at once
//
// Quick start:
//   npm install -g pm2
//   pm2 start ecosystem.config.js
//
// Useful commands:
//   pm2 list              - View all processes
//   pm2 logs              - View all logs (live tail)
//   pm2 logs coordinator  - View specific service
//   pm2 monit             - Interactive monitoring dashboard
//   pm2 restart all       - Restart all services
//   pm2 stop all          - Stop all services
//   pm2 delete all        - Remove all processes from pm2
//
// Log files are stored in ./logs/

module.exports = {
  apps: [
    // Coordinator - central orchestration
    {
      name: 'coordinator',
      script: './coordinator/dist/coordinator/src/main.js',
      cwd: './',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        ADDITIONAL_TOOLS: 'osint',
      },
      env_development: {
        NODE_ENV: 'development',
        ADDITIONAL_TOOLS: 'osint',
      },
      error_file: './logs/coordinator-error.log',
      out_file: './logs/coordinator-out.log',
      time: true,
    },

    // Universal Agent - handles dynamic swarm agents
    // exec_mode: fork is required — cluster mode does not work with compiled Node scripts
    {
      name: 'agent-universal',
      script: './agents/universal/dist/main.js',
      cwd: './',
      instances: 3,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        ADDITIONAL_TOOLS: 'osint',
      },
      error_file: './logs/agent-universal-error.log',
      out_file: './logs/agent-universal-out.log',
      time: true,
    },

    // Security Agent (placeholder)
    // Uncomment when implemented
    // {
    //   name: 'agent-security',
    //   script: './agents/security/dist/main.js',
    //   cwd: './',
    //   instances: 1,
    //   autorestart: true,
    //   watch: false,
    // },

    // Test Runner Agent (placeholder)
    // {
    //   name: 'agent-test-runner',
    //   script: './agents/test-runner/dist/main.js',
    //   cwd: './',
    //   instances: 1,
    //   autorestart: true,
    //   watch: false,
    // },

    // Dashboard API Server
    {
      name: 'dashboard-server',
      script: './dashboard/dist/server.js',
      cwd: './',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '256M',
      env: {
        NODE_ENV: 'production',
      },
      error_file: './logs/dashboard-server-error.log',
      out_file: './logs/dashboard-server-out.log',
      time: true,
    },

    // Tool executor API server (called by Swarm-Map proxy)
    {
      name: 'nimble-api',
      script: './coordinator/dist/coordinator/src/api-server.js',
      cwd: './',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      error_file: './logs/api-server-error.log',
      out_file: './logs/api-server-out.log',
      time: true,
    },

    // Dashboard UI (Vite dev server)
    {
      name: 'dashboard-ui',
      script: 'npm',
      args: 'run dev',
      cwd: './dashboard',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '256M',
      env: {
        NODE_ENV: 'development',
      },
      error_file: './logs/dashboard-ui-error.log',
      out_file: './logs/dashboard-ui-out.log',
      time: true,
    },
  ],

  // Development mode with auto-reload
  deploy: {
    development: {
      user: 'node',
      host: 'localhost',
      ref: 'origin/main',
      repo: 'git@github.com:juniperbevensee/NimbleCo.git',
      path: '/var/www/nimbleco',
      'post-deploy': 'npm install && npm run build && pm2 reload ecosystem.config.js',
    },
  },
};

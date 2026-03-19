# Private Fork Guide - Sensitive Tools

This guide explains how to maintain a private fork of NimbleCo that includes sensitive tools (OSINT, crypto, etc.) while still pulling updates from the public repository.

## Architecture

```
┌─────────────────────────────────┐
│ github.com/you/NimbleCo         │  ← Public repo
│ (PUBLIC)                        │     (Core features only)
│                                 │
│ - Agent system                  │
│ - Dashboard                     │
│ - Core tools                    │
│ - Documentation                 │
└─────────────────────────────────┘
          ↓ fork/clone
┌─────────────────────────────────┐
│ github.com/you/NimbleCo-private │  ← Private fork
│ (PRIVATE)                       │     (All tools)
│                                 │
│ Everything from public PLUS:    │
│ + shared/tools/src/osint/       │
│ + shared/tools/src/crypto/      │
│ + .env.osint, .env.cryptid      │
│ + storage/identity-osint.md     │
└─────────────────────────────────┘
```

## Initial Setup

### 1. Create Private Fork

```bash
# Clone the public repo
git clone https://github.com/you/NimbleCo.git NimbleCo-private
cd NimbleCo-private

# Create a new private repo on GitHub called "NimbleCo-private"

# Update the remote to point to your private repo
git remote rename origin public
git remote add origin https://github.com/you/NimbleCo-private.git

# Push to private repo
git push -u origin main
```

### 2. Add Sensitive Tools

```bash
# Create OSINT tools directory
mkdir -p shared/tools/src/osint

# Create crypto tools directory
mkdir -p shared/tools/src/crypto

# Implement your tools
# (See "Tool Implementation" section below)

# Commit to private repo
git add shared/tools/src/osint shared/tools/src/crypto
git commit -m "Add sensitive OSINT and crypto tools"
git push origin main
```

### 3. Add Bot Configurations

```bash
# Create bot configs for sensitive bots
npm run setup:bot
# Create "osint" bot with OSINT tools enabled

npm run setup:bot
# Create "cryptid" bot with crypto tools enabled

# Commit configs to private repo
git add .env.osint .env.cryptid storage/identity-*.md
git commit -m "Add OSINT and crypto bot configurations"
git push origin main
```

## Pulling Updates from Public Repo

Your private fork can pull updates from the public repo with minimal conflicts.

### Regular Update Workflow

```bash
# Fetch latest changes from public repo
git fetch public

# View what changed
git log HEAD..public/main --oneline

# Merge public changes into your private repo
git merge public/main

# Resolve any conflicts (see below)
# Test that everything works
npm run build
npm run test

# Push to your private repo
git push origin main
```

### Expected Conflicts (Rare & Easy)

**99% of updates will have NO conflicts** because you're adding files, not modifying existing ones.

#### Conflict 1: `shared/tools/src/index.ts`

This file exports all tools. Both repos may add new exports.

**Public repo adds:**
```typescript
export * from './github';
export * from './notion';
```

**Private repo adds:**
```typescript
export * from './osint';
export * from './crypto';
```

**Resolution:** Keep both! Merge manually:
```typescript
// Core tools (from public)
export * from './core';
export * from './web';
export * from './storage';
export * from './github';
export * from './notion';

// Sensitive tools (from private)
export * from './osint';
export * from './crypto';
```

#### Conflict 2: `package.json` dependencies

Both repos may add new npm packages.

**Resolution:** Keep both dependency lists, run `npm install` after merging.

#### Conflict 3: Documentation files

Rarely, if the public repo updates MULTI-BOT.md or README.md.

**Resolution:** Accept public version, or manually merge if you've customized it.

## Tool Implementation Structure

### Private Tool Directory Structure

```
shared/tools/src/
├── core/           (public)
├── web/            (public)
├── storage/        (public)
├── osint/          (private - your additions)
│   ├── index.ts
│   ├── social-media.ts
│   ├── domain-lookup.ts
│   └── darkweb-monitor.ts
├── crypto/         (private - your additions)
│   ├── index.ts
│   ├── solana-wallet.ts
│   ├── token-swap.ts
│   └── nft-mint.ts
└── index.ts        (public + private exports)
```

### Example: OSINT Tools Implementation

```typescript
// shared/tools/src/osint/index.ts
import { Tool, ToolRegistry } from '../base';

export function registerOSINTTools(registry: ToolRegistry) {
  // Only load if explicitly enabled
  if (process.env.ENABLE_OSINT_TOOLS !== 'true') {
    console.log('🔒 OSINT tools disabled (missing ENABLE_OSINT_TOOLS=true)');
    return;
  }

  // Check for required credentials
  if (!process.env.OSINT_API_KEY) {
    console.warn('⚠️  OSINT tools disabled (missing OSINT_API_KEY)');
    return;
  }

  console.log('🔍 Loading OSINT tools...');

  registry.register({
    name: 'search_public_records',
    description: 'Search public records databases',
    category: 'osint',
    use_cases: [
      'Find business registrations',
      'Lookup property records',
      'Search court records',
    ],
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query',
        },
        database: {
          type: 'string',
          enum: ['business', 'property', 'court'],
          description: 'Which database to search',
        },
      },
      required: ['query', 'database'],
    },
    handler: async (input: any, context: any) => {
      // Your OSINT tool implementation here
      // ...
      return {
        success: true,
        results: [...],
      };
    },
  });

  // Register more OSINT tools...
}

// Auto-register if this module is imported
import { registry } from '../base';
registerOSINTTools(registry);
```

### Example: Crypto Tools Implementation

```typescript
// shared/tools/src/crypto/index.ts
import { Tool, ToolRegistry } from '../base';
import { Connection, PublicKey } from '@solana/web3.js';

export function registerCryptoTools(registry: ToolRegistry) {
  // Only load if explicitly enabled
  if (process.env.ENABLE_CRYPTO_TOOLS !== 'true') {
    console.log('🔒 Crypto tools disabled (missing ENABLE_CRYPTO_TOOLS=true)');
    return;
  }

  // Check for required config
  if (!process.env.SOLANA_RPC_URL) {
    console.warn('⚠️  Crypto tools disabled (missing SOLANA_RPC_URL)');
    return;
  }

  console.log('💰 Loading crypto tools...');

  const connection = new Connection(process.env.SOLANA_RPC_URL);

  registry.register({
    name: 'solana_get_balance',
    description: 'Get SOL balance for a wallet address',
    category: 'crypto',
    use_cases: [
      'Check wallet balance',
      'Verify payment received',
      'Monitor wallet activity',
    ],
    parameters: {
      type: 'object',
      properties: {
        wallet_address: {
          type: 'string',
          description: 'Solana wallet public key',
        },
      },
      required: ['wallet_address'],
    },
    handler: async (input: any, context: any) => {
      try {
        const publicKey = new PublicKey(input.wallet_address);
        const balance = await connection.getBalance(publicKey);

        return {
          success: true,
          balance_lamports: balance,
          balance_sol: balance / 1e9,
        };
      } catch (error: any) {
        return {
          success: false,
          error: error.message,
        };
      }
    },
  });

  // Register more crypto tools...
}

// Auto-register if this module is imported
import { registry } from '../base';
registerCryptoTools(registry);
```

## Avoiding Conflicts - Best Practices

### ✅ DO: Add New Files
```
shared/tools/src/osint/my-tool.ts       (new file, no conflict)
storage/identity-osint.md               (new file, no conflict)
.env.osint                              (new file, no conflict)
```

### ✅ DO: Use Conditional Registration
```typescript
// Tools self-register based on env vars
// No need to modify shared code
if (process.env.ENABLE_MY_TOOLS === 'true') {
  registry.register(myTool);
}
```

### ⚠️ AVOID: Modifying Core Files
Don't change files that the public repo might also change:
- `coordinator/src/main.ts` (unless absolutely necessary)
- `shared/tools/src/index.ts` (document expected conflicts)
- `README.md` (keep public version, add PRIVATE-README.md instead)

### ⚠️ AVOID: Changing Shared Config
Don't customize `.env.example` in ways that conflict with public repo.
Instead, use `.env.private.example` for your private-specific defaults.

## Testing After Merge

After pulling updates from public repo:

```bash
# 1. Install any new dependencies
npm install

# 2. Run database migrations
npm run db:migrate

# 3. Rebuild everything
npm run build

# 4. Run tests
npm run test

# 5. Test bot startup
npm run dev
# Verify bots start and load correct tools

# 6. Test dashboard
# Open http://localhost:5173
# Verify charts render correctly
# Verify bot filtering works

# 7. Test sensitive tools
# Trigger a tool from the osint/crypto category
# Verify it works as expected
```

## Security Checklist

- [ ] Private repo visibility set to "Private" on GitHub
- [ ] No sensitive credentials in `.env.*` files (use `.env.*.example` instead)
- [ ] Sensitive tools only in private repo
- [ ] Public repo has placeholder README for sensitive tool directories
- [ ] `.gitignore` doesn't accidentally ignore tool directories
- [ ] Collaborators have appropriate access levels

## What to Keep in Public Repo

✅ Infrastructure code:
- Agent orchestration
- LLM adapters
- Dashboard UI
- Database schema
- Documentation

✅ Core tools:
- File operations
- Web fetching
- GitHub integration
- General utilities

✅ Multi-bot system:
- PM2 configuration
- Bot setup wizard
- Environment templates

## What to Keep in Private Repo Only

🔒 Sensitive tools:
- OSINT capabilities
- Cryptocurrency operations
- Proprietary integrations
- Custom automations

🔒 Production configs:
- `.env.osint` (with real credentials)
- `.env.cryptid` (with real credentials)
- Production identity files

🔒 Sensitive documentation:
- Internal playbooks
- API keys documentation
- Operational procedures

## Branching Strategy (Optional)

For more complex workflows:

```bash
# Public repo branches
main            → Stable public releases

# Private repo branches
main            → Production (always deployable)
staging         → Testing updates from public
feature/*       → New sensitive features
```

Workflow:
1. Pull public updates into `staging` branch
2. Test thoroughly
3. Merge `staging` → `main` when stable
4. Deploy from `main`

## Emergency: Accidentally Pushed Sensitive Code to Public

If you accidentally push sensitive code to the public repo:

1. **Immediately** make the public repo private
2. Delete sensitive commits:
   ```bash
   git reset --hard <commit-before-leak>
   git push --force origin main
   ```
3. Rotate all credentials/API keys that were exposed
4. Consider the exposed code permanently compromised
5. Review your workflow to prevent future leaks

## Getting Help

- **Public repo issues**: Safe to discuss architecture, features, bugs
- **Private repo issues**: Can discuss sensitive tool implementations
- **Security issues**: Email privately, don't post publicly

---

**Summary:** Most updates will merge cleanly with no conflicts. Your private tools are additive, not replacements, so merge conflicts are rare and easy to resolve.

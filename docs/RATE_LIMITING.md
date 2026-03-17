# Rate Limiting for Audrey Invocations

## Overview

The NimbleCo coordinator now includes comprehensive rate limiting for bot invocations to prevent abuse and manage system resources effectively. Rate limits are enforced at three levels:

1. **Per-user limits** - Default: 30 invocations per day per user
2. **Global limits** - Default: 150 invocations per day across all users
3. **Bot-to-bot limits** - Default: 20 invocations per day for bot users

**Admins bypass all rate limits.**

## Implementation

The rate limiting system was implemented using Test-Driven Development (TDD) with the following components:

### 1. Database Tables

**Location:** `/infrastructure/postgres/migrations/005_add_invocation_rate_limits.sql`

Two new tables track rate limits:

- `invocation_rate_limits` - Per-user, per-platform, per-day tracking
  - `user_id` - Platform user ID
  - `platform` - Platform name (mattermost, matrix, etc.)
  - `date` - Date of tracking
  - `invocation_count` - Total invocations by this user
  - `bot_invocation_count` - Bot-to-bot invocations by this user

- `global_invocation_limits` - Global per-platform, per-day tracking
  - `platform` - Platform name
  - `date` - Date of tracking
  - `total_invocations` - Total invocations across all users

### 2. Rate Limiter Module

**Location:** `/coordinator/src/rate-limiter.ts`

Core functionality:
- `checkInvocationLimit()` - Check if a user can invoke the bot
  - Returns: `{ allowed: boolean, reason?: string, remaining?: number }`
  - Parameters:
    - `userId` - User ID from the platform
    - `platform` - Platform name ('mattermost', 'matrix', etc.)
    - `isAdmin` - Whether the user is an admin (bypasses all limits)
    - `isBot` - Whether the sender is a bot (subject to bot-to-bot limits)
- Automatically increments counters when invocations are allowed
- Enforces daily reset logic (records are per-date)

### 3. Integration

**Location:** `/coordinator/src/mattermost-listener.ts`

The rate limiter is integrated into the Mattermost listener:
1. Checks if the sender is a bot by fetching user info from Mattermost API
2. Calls `checkInvocationLimit()` before processing any request
3. If blocked, sends a friendly error message to the channel
4. If allowed, proceeds with normal request processing

### 4. Tests

**Location:** `/coordinator/src/rate-limiter.test.ts`

Comprehensive test coverage including:
- Per-user limit enforcement
- Global limit enforcement
- Bot-to-bot limit enforcement
- Admin bypass functionality
- Daily reset logic
- Error handling

## Configuration

Add these environment variables to your `.env` file:

```bash
# Rate Limiting - Bot Invocations
INVOCATION_LIMIT_PER_USER_PER_DAY=30
INVOCATION_LIMIT_GLOBAL_PER_DAY=150
BOT_INVOCATION_LIMIT_PER_DAY=20
```

Default values are used if not specified:
- Per-user: 30/day
- Global: 150/day
- Bot-to-bot: 20/day

## Database Views

Two views provide monitoring capabilities:

### `v_rate_limit_stats`
Shows aggregate statistics by platform and date:
- Unique users
- Total user invocations
- Total bot invocations
- Max invocations by a single user
- Average invocations per user

### `v_rate_limit_warnings`
Shows users approaching their limits (25+ invocations or 15+ bot invocations):
- User ID
- Platform
- Current counts
- Warning level

## Usage Examples

### Query Current Usage

```sql
-- Check all users today
SELECT user_id, invocation_count, bot_invocation_count
FROM invocation_rate_limits
WHERE date = CURRENT_DATE
ORDER BY invocation_count DESC;

-- Check global usage today
SELECT platform, total_invocations
FROM global_invocation_limits
WHERE date = CURRENT_DATE;

-- Check stats for the week
SELECT * FROM v_rate_limit_stats
WHERE date > CURRENT_DATE - INTERVAL '7 days';

-- Check users approaching limits
SELECT * FROM v_rate_limit_warnings;
```

### Manual Testing

```bash
# From project root
cd /Users/juniperbevensee/Documents/GitHub/NimbleCo

# Test basic functionality
npx tsx -e "
import { checkInvocationLimit } from './coordinator/src/rate-limiter';
(async () => {
  const result = await checkInvocationLimit('test-user', 'mattermost', false, false);
  console.log('Allowed:', result.allowed);
  console.log('Remaining:', result.remaining);
})();
"
```

### In Mattermost

When a user exceeds their limit, they'll see:

```
⛔ You've reached your daily limit of 30 invocations. Please try again tomorrow.
```

When a bot exceeds the bot limit:

```
⛔ You've reached the bot-to-bot daily limit of 20 invocations. Please try again tomorrow.
```

When the global limit is reached:

```
⛔ The global daily limit of 150 invocations has been reached. Please try again tomorrow.
```

## Admin Users

Admin users are defined in the environment variable:

```bash
MATTERMOST_ADMIN_USERS=user_id_1,user_id_2
```

Admin users:
- Bypass all rate limits
- Can invoke the bot unlimited times
- Still have their usage tracked in the database

## Monitoring

### Check Daily Stats

```bash
docker exec -i nimble-postgres psql -U agent -d nimbleco -c "
  SELECT * FROM v_rate_limit_stats
  WHERE date = CURRENT_DATE;
"
```

### Check Users Approaching Limits

```bash
docker exec -i nimble-postgres psql -U agent -d nimbleco -c "
  SELECT * FROM v_rate_limit_warnings;
"
```

### Clean Up Old Records

The rate limiter includes a cleanup function to remove old records:

```typescript
import { cleanupOldRateLimits } from './coordinator/src/rate-limiter';

// Remove records older than 30 days (default)
await cleanupOldRateLimits();

// Or specify custom retention period
await cleanupOldRateLimits(90); // Keep 90 days
```

## Migration

To apply the migration to an existing database:

```bash
# Via Docker
docker exec -i nimble-postgres psql -U agent -d nimbleco < infrastructure/postgres/migrations/005_add_invocation_rate_limits.sql

# Or via psql directly
psql $DATABASE_URL -f infrastructure/postgres/migrations/005_add_invocation_rate_limits.sql
```

## Testing

Run the test suite:

```bash
npm test -- rate-limiter.test.ts
```

## Architecture Decisions

1. **Per-platform tracking** - Each platform (Mattermost, Matrix) has separate limits
2. **Date-based reset** - Limits reset at midnight (database date rollover)
3. **Separate bot limits** - Bot-to-bot invocations have their own, more restrictive limit
4. **Admin bypass** - Admins can always invoke the bot, but usage is still tracked
5. **Incremental counters** - Counters increment immediately on success, preventing race conditions
6. **Friendly error messages** - Users get clear explanations when limits are exceeded

## Future Enhancements

Potential improvements for future versions:

1. **Per-channel limits** - Different limits for different channels
2. **Sliding window** - More granular rate limiting (e.g., 10 per hour)
3. **Burst allowance** - Allow temporary bursts above the limit
4. **User notifications** - Warn users when approaching their limit
5. **Dashboard integration** - Visualize rate limit usage in real-time
6. **Automatic adjustment** - Scale limits based on system load

## Troubleshooting

### Rate limiter not working

1. Check environment variables are set correctly
2. Verify migration has been applied: `\d invocation_rate_limits`
3. Check database connectivity: `echo $DATABASE_URL`
4. Review logs for errors: `docker logs nimbleco-coordinator`

### Users getting blocked incorrectly

1. Check if user is in admin list: `echo $MATTERMOST_ADMIN_USERS`
2. Verify current usage: `SELECT * FROM invocation_rate_limits WHERE user_id = 'xxx'`
3. Check if date has rolled over (limits should reset daily)

### Global limit reached too quickly

1. Review global usage: `SELECT * FROM global_invocation_limits WHERE date = CURRENT_DATE`
2. Consider increasing the limit: `INVOCATION_LIMIT_GLOBAL_PER_DAY=300`
3. Check for bot spam or misconfigured integrations

## Support

For questions or issues related to rate limiting, please refer to:
- Main documentation: `/docs/README.md`
- Database schema: `/infrastructure/postgres/init.sql`
- Migration files: `/infrastructure/postgres/migrations/`

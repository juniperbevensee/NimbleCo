# Configuration Files

## Identity System

### `identity.template.md`
Anonymized template for Audrey's constitutional identity document. This defines core values, principles, and approach but contains no personal information.

**In the repo:** Yes (public)
**Loaded by:** Coordinator (fallback if no personal version exists)

### `storage/identity.md` (not in repo)
Personal version of the identity document with specific relationships, context, and customizations.

**In the repo:** No (gitignored)
**Loaded by:** Coordinator (primary)

### Setup Instructions

1. Copy the template to create your personal version:
   ```bash
   cp config/identity.template.md storage/identity.md
   ```

2. Edit `storage/identity.md` to add:
   - Personal relationships and context
   - Specific deployment details
   - Custom values and preferences

3. Restart the coordinator to load your personal identity:
   ```bash
   pm2 restart coordinator
   ```

The coordinator will log which version was loaded:
- `📜 Loaded personal identity document` - using storage/identity.md
- `📜 Loaded identity template (create storage/identity.md to personalize)` - using template

## Memory System

See `storage/memory.md` (also gitignored) for the agent's persistent memory file where learned preferences and session notes are stored.

# Storage System Summary

## Overview

NimbleCo has a two-tier storage system for files:

1. **Ephemeral Storage** (`storage/workspace`) - Temporary files, cleared on restart
2. **Persistent Storage** (`storage/files`) - Permanent files, kept forever

## Storage Tools Available

### Ephemeral/Workspace Tools
- `list_workspace` - List files in ephemeral storage
- `read_workspace_file` - Read files from ephemeral storage (with pagination support)
- `move_workspace_file_to_storage` - **NEW** Move/copy files from ephemeral to persistent

### Persistent Storage Tools
- `upload_file` - Upload files to persistent storage
- `download_file` - Download files from persistent storage
- `list_files` - List files in persistent storage

### Mattermost Integration Tools
- `download_mattermost_attachment` - Download file attachments from messages
- `post_mattermost_message_with_attachment` - Share files to Mattermost channels
- `add_mattermost_reaction` - React to messages with emoji

## Key Features Added

### 1. User Warnings for Ephemeral Files
When large results are saved to ephemeral storage, users now see:
```
⚠️ Result saved to EPHEMERAL workspace (123.4KB).
This will be lost on restart!
Use move_workspace_file_to_storage to make it permanent,
or post_mattermost_message_with_attachment to share it.
```

### 2. Move/Copy Between Storage Tiers
New tool `move_workspace_file_to_storage` allows:
- Moving files from ephemeral → persistent (deletes original)
- Copying files from ephemeral → persistent (keeps original)
- Organizing into folders within persistent storage
- Renaming during the move/copy operation

Example usage:
```json
{
  "tool": "move_workspace_file_to_storage",
  "input": {
    "workspace_file": "result-1710735000.json",
    "storage_folder": "reports",
    "operation": "move"
  }
}
```

## Security Boundaries

All storage operations are sandboxed within the `storage/` directory:
- **Ephemeral**: `storage/workspace/` (or `$WORKSPACE_PATH`)
- **Persistent**: `storage/files/` (or `$FILE_STORAGE_PATH`)

Security checks prevent:
- Path traversal attacks (`../../../etc/passwd`)
- Absolute paths outside storage (`/etc/passwd`)
- Symbolic link escapes

**Verified**: All path traversal attempts are blocked ✅

## Workflow

### Typical User Flow
1. Agent generates large result (>50KB)
2. Result auto-saved to **ephemeral** storage
3. User warned file is temporary
4. User can:
   - Move to **persistent** storage (keep forever)
   - Share to Mattermost (with attachment)
   - Leave in ephemeral (will be cleaned up on restart)

### For Reports/Exports
```
Generate data → Ephemeral → User reviews → Move to persistent or share
```

### For Attachments Users Upload
```
User uploads → Mattermost → Agent downloads → Process → Save/share result
```

## Environment Variables

```bash
# Optional: Override default storage paths
WORKSPACE_PATH=/path/to/ephemeral/storage
FILE_STORAGE_PATH=/path/to/persistent/storage
```

Default paths:
- Ephemeral: `<project-root>/storage/workspace`
- Persistent: `<project-root>/storage/files`

## File Lifecycle

```
┌─────────────────────────────────────────────┐
│  Large Tool Result (>50KB)                  │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
         ┌─────────────────┐
         │   EPHEMERAL     │  ⚠️ Lost on restart
         │ storage/workspace│
         └────────┬─────────┘
                  │
         ┌────────┴─────────┐
         │                  │
         ▼                  ▼
  ┌─────────────┐    ┌──────────────┐
  │ PERSISTENT  │    │  Mattermost  │
  │storage/files│    │  (with file) │
  └─────────────┘    └──────────────┘
   Kept forever       Shared to user
```

## Build Status

✅ Tools compiled successfully
✅ Tool registered in global registry
✅ Security boundaries verified
✅ All path traversal attacks blocked

## Next Steps

The system is ready to use. When the coordinator/agents restart, they will automatically:
1. Warn users about ephemeral files
2. Offer to move files to persistent storage
3. Offer to share files via Mattermost

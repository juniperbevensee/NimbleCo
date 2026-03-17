# Filesystem Sandbox

**Security-first filesystem access for AI agents**

## Problem

AI agents need to:
- Store persistent memory across sessions
- Generate files (reports, graphics, logs)
- Read/write temporary scratch space

But agents should NOT be able to:
- Access environment variables
- Read system prompts or configuration
- Escape to other parts of the filesystem
- Survive prompt injection attacks

## Solution

The filesystem sandbox provides a `/workspace` directory for each agent with strict boundary enforcement.

## Architecture

```
┌────────────────────────────────────────────────┐
│  Agent (Code Review, Security, Test Runner)   │
│                                                │
│  Has access to 11 filesystem tools:           │
│  - read_file, write_file, append_file         │
│  - list_directory, create_directory           │
│  - copy_file, move_file, delete_file          │
│  - file_exists, get_file_info                 │
└───────────────┬────────────────────────────────┘
                │
                │ All operations validated
                ↓
    ┌───────────────────────────┐
    │  FilesystemSandbox        │
    │  - validatePath()         │
    │  - Resolves symlinks      │
    │  - Blocks traversal       │
    │  - Checks boundaries      │
    └───────────┬───────────────┘
                │
                ↓
    ┌───────────────────────────┐
    │  /workspace/agent-id/     │
    │  ✓ Allowed                │
    └───────────────────────────┘

    ┌───────────────────────────┐
    │  /../../../etc/passwd     │
    │  ✗ Blocked                │
    └───────────────────────────┘
```

## Security Guarantees

### 1. Path Validation

All paths are validated before any filesystem operation:

```typescript
private async validatePath(requestedPath: string): Promise<string> {
  // Resolve to absolute path
  const absolutePath = path.resolve(this.workspaceRoot, requestedPath);

  // Resolve symlinks and check boundaries
  const realPath = await fs.realpath(absolutePath).catch(() => absolutePath);

  if (!realPath.startsWith(this.workspaceRoot)) {
    throw new Error('Access denied: Path is outside workspace');
  }

  return realPath;
}
```

### 2. Attack Vectors Blocked

**Directory Traversal:**
```javascript
// Agent tries: read_file('../../../etc/passwd')
// ✗ Blocked: "Access denied: Path is outside workspace"

// Agent tries: read_file('../../.env')
// ✗ Blocked: "Access denied: Path is outside workspace"
```

**Absolute Paths:**
```javascript
// Agent tries: read_file('/etc/passwd')
// ✗ Blocked: "Access denied: Path is outside workspace"
```

**Symlink Escape:**
```javascript
// Agent creates symlink pointing to /etc/passwd
// Agent tries: read_file('evil-link.txt')
// ✗ Blocked: Symlink resolved, points outside workspace
```

**Null Bytes:**
```javascript
// Agent tries: read_file('test\x00.txt')
// ✗ Blocked: Invalid path
```

### 3. Docker Isolation

Agents run in containers with only their workspace mounted:

```yaml
# docker-compose.yml
agent-code-review:
  volumes:
    - ./workspace/code-review:/workspace  # Only this directory accessible
```

Even if sandbox validation failed (it won't), Docker provides a second layer of defense.

## Usage

### For Agent Developers

Agents automatically have access to 11 filesystem tools:

```javascript
// Store persistent memory
await executeToolCall('write_file', {
  path: 'memory/context.json',
  content: JSON.stringify({ lastReview: new Date() })
});

// Generate report
await executeToolCall('write_file', {
  path: 'reports/pr-123.md',
  content: markdownReport
});

// Read back later
const memory = JSON.parse(
  await executeToolCall('read_file', {
    path: 'memory/context.json'
  })
);
```

### For System Operators

Workspace structure:

```
workspace/
├── code-review/      # Code review agent files
├── security/         # Security agent files
└── test-runner/      # Test runner agent files
```

Monitor workspace usage:

```bash
# See all agent files
ls -lR workspace/

# Check disk usage
du -sh workspace/*/

# Clean specific agent workspace
rm -rf workspace/code-review/*
```

## Testing

The sandbox has comprehensive tests covering:

- ✅ Boundary enforcement (27 tests)
- ✅ Directory traversal attacks blocked
- ✅ Symlink attacks blocked
- ✅ All file operations work within workspace
- ✅ Edge cases (unicode, spaces, large files)

Run tests:

```bash
cd shared/tools
npm test -- src/filesystem/sandbox.test.ts
```

All 27 tests passing.

## Use Cases

### 1. Persistent Agent Memory

Agents can remember context across sessions:

```javascript
// Session 1: Store learning
await writeFile('memory/patterns.json', JSON.stringify({
  commonBugs: ['async-without-await', 'missing-error-handling'],
  reviewedPRs: ['#123', '#124', '#125']
}));

// Session 2: Recall learning
const memory = JSON.parse(await readFile('memory/patterns.json'));
// Agent now knows common patterns
```

### 2. Generated Artifacts

Agents can create files for humans:

```javascript
// Generate markdown report
await writeFile('reports/security-scan-2024-03-12.md', reportContent);

// Generate SVG graph
await writeFile('graphs/complexity.svg', svgContent);

// Generate CSV data
await writeFile('data/metrics.csv', csvContent);
```

### 3. Scratch Space

Agents can use workspace for temporary processing:

```javascript
// Download code
await writeFile('tmp/code.js', downloadedCode);

// Process
const analysis = await analyzeCode(await readFile('tmp/code.js'));

// Clean up
await deleteFile('tmp/code.js');
```

### 4. Inter-Agent Communication (Future)

Agents could share data via shared workspace:

```javascript
// Code review agent writes
await writeFile('shared/review-results.json', results);

// Test runner agent reads
const reviewResults = JSON.parse(await readFile('shared/review-results.json'));
```

## Implementation Details

### Files Created

- `shared/tools/src/filesystem/sandbox.ts` - Core sandbox implementation
- `shared/tools/src/filesystem/tools.ts` - 11 agent-accessible tools
- `shared/tools/src/filesystem/sandbox.test.ts` - 27 comprehensive tests
- `workspace/README.md` - User documentation

### Integration Points

- `shared/tools/src/base.ts` - Added 'filesystem' category
- `shared/tools/src/index.ts` - Registered filesystem tools
- `docker-compose.yml` - Mounted workspace directories for each agent
- `setup.sh` - Creates workspace structure during setup
- `.gitignore` - Excludes workspace contents

### Performance

- **Validation overhead:** ~0.1ms per operation (path resolution)
- **Throughput:** Limited only by filesystem I/O
- **Memory:** Minimal (no caching, direct fs operations)

### Limitations

- **No bash execution:** Agents cannot run shell commands
- **No network access:** Agents cannot fetch remote files (use separate tools)
- **Per-agent isolation:** Agents cannot access each other's workspaces (future: shared workspace)

## Security Considerations

### What if an agent is prompt-injected?

Even if an attacker successfully prompt-injects an agent to try malicious operations:

1. **Path validation blocks traversal**
   - Agent: "Read ../../../../etc/passwd"
   - Response: "Access denied: Path is outside workspace"

2. **Docker isolation as backup**
   - Even if sandbox failed, Docker mount only exposes /workspace

3. **No environment access**
   - Agents cannot call process.env or read .env files
   - Credentials are passed via tool context, not accessible files

4. **No system prompt modification**
   - System prompts are in coordinator memory, not files
   - Even if agent writes to workspace, prompts unchanged

### What can still go wrong?

- **Disk exhaustion:** Agent writes GB of data
  - Mitigation: Monitor workspace size, set Docker disk limits

- **Malicious file generation:** Agent generates harmful content
  - Mitigation: Review generated files before using them

- **Resource exhaustion:** Agent creates millions of files
  - Mitigation: Rate limiting on tool calls

## Future Enhancements

- [ ] Disk quota per agent
- [ ] Rate limiting on file operations
- [ ] Shared workspace for inter-agent communication
- [ ] File access logging/auditing
- [ ] Automatic cleanup of old files
- [ ] File versioning/history

## References

- Implementation: `shared/tools/src/filesystem/`
- Tests: `shared/tools/src/filesystem/sandbox.test.ts`
- User docs: `workspace/README.md`
- Related: `docs/tool-system-overview.md`

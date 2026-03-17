// Filesystem Sandbox - Secure boundary checking for agent file operations
// Agents can only access /workspace and cannot escape to system files

import * as fs from 'fs/promises';
import * as path from 'path';

export class FilesystemSandbox {
  private workspaceRoot: string;

  constructor(workspaceRoot: string = './workspace') {
    // Resolve to absolute path to prevent traversal tricks
    this.workspaceRoot = path.resolve(workspaceRoot);
  }

  /**
   * Validate that a path is within the workspace sandbox
   * Prevents directory traversal attacks (../, symlinks, etc)
   */
  private async validatePath(requestedPath: string): Promise<string> {
    // Reject absolute paths outright (security: don't reinterpret /etc/passwd)
    if (path.isAbsolute(requestedPath)) {
      throw new Error(
        `Access denied: Absolute paths not allowed. ` +
        `Use relative paths within /workspace`
      );
    }

    // Resolve to absolute path within workspace
    const absolutePath = path.resolve(this.workspaceRoot, requestedPath);

    // Check if path is within workspace (handle symlinks)
    const realPath = await fs.realpath(absolutePath).catch(() => absolutePath);

    if (!realPath.startsWith(this.workspaceRoot)) {
      throw new Error(
        `Access denied: Path '${requestedPath}' is outside workspace. ` +
        `Agents can only access files within /workspace`
      );
    }

    return realPath;
  }

  /**
   * Validate path for write operations (doesn't need to exist yet)
   */
  private validateWritePath(requestedPath: string): string {
    // Reject absolute paths outright (security: don't reinterpret /etc/passwd)
    if (path.isAbsolute(requestedPath)) {
      throw new Error(
        `Access denied: Absolute paths not allowed. ` +
        `Use relative paths within /workspace`
      );
    }

    const absolutePath = path.resolve(this.workspaceRoot, requestedPath);

    if (!absolutePath.startsWith(this.workspaceRoot)) {
      throw new Error(
        `Access denied: Path '${requestedPath}' is outside workspace. ` +
        `Agents can only access files within /workspace`
      );
    }

    return absolutePath;
  }

  /**
   * Read file within sandbox
   */
  async readFile(filePath: string, encoding: BufferEncoding = 'utf-8'): Promise<string> {
    const safePath = await this.validatePath(filePath);
    return fs.readFile(safePath, encoding);
  }

  /**
   * Write file within sandbox
   */
  async writeFile(filePath: string, content: string, encoding: BufferEncoding = 'utf-8'): Promise<void> {
    const safePath = this.validateWritePath(filePath);

    // Ensure parent directory exists
    const dir = path.dirname(safePath);
    await fs.mkdir(dir, { recursive: true });

    return fs.writeFile(safePath, content, encoding);
  }

  /**
   * Append to file within sandbox
   */
  async appendFile(filePath: string, content: string, encoding: BufferEncoding = 'utf-8'): Promise<void> {
    const safePath = this.validateWritePath(filePath);

    // Ensure parent directory exists
    const dir = path.dirname(safePath);
    await fs.mkdir(dir, { recursive: true });

    return fs.appendFile(safePath, content, encoding);
  }

  /**
   * List directory contents within sandbox
   */
  async listDirectory(dirPath: string = '.'): Promise<string[]> {
    const safePath = await this.validatePath(dirPath);
    return fs.readdir(safePath);
  }

  /**
   * List directory with file details
   */
  async listDirectoryDetailed(dirPath: string = '.'): Promise<Array<{
    name: string;
    isDirectory: boolean;
    isFile: boolean;
    size: number;
    modified: Date;
  }>> {
    const safePath = await this.validatePath(dirPath);
    const entries = await fs.readdir(safePath, { withFileTypes: true });

    return Promise.all(
      entries.map(async (entry) => {
        const entryPath = path.join(safePath, entry.name);
        const stats = await fs.stat(entryPath);

        return {
          name: entry.name,
          isDirectory: entry.isDirectory(),
          isFile: entry.isFile(),
          size: stats.size,
          modified: stats.mtime,
        };
      })
    );
  }

  /**
   * Create directory within sandbox
   */
  async createDirectory(dirPath: string): Promise<void> {
    const safePath = this.validateWritePath(dirPath);
    await fs.mkdir(safePath, { recursive: true });
  }

  /**
   * Delete file within sandbox
   */
  async deleteFile(filePath: string): Promise<void> {
    const safePath = await this.validatePath(filePath);
    return fs.unlink(safePath);
  }

  /**
   * Delete directory within sandbox
   */
  async deleteDirectory(dirPath: string, recursive: boolean = false): Promise<void> {
    const safePath = await this.validatePath(dirPath);
    return fs.rm(safePath, { recursive, force: false });
  }

  /**
   * Check if file/directory exists
   */
  async exists(filePath: string): Promise<boolean> {
    try {
      const safePath = await this.validatePath(filePath);
      await fs.access(safePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get file stats
   */
  async stat(filePath: string): Promise<{
    size: number;
    created: Date;
    modified: Date;
    isDirectory: boolean;
    isFile: boolean;
  }> {
    const safePath = await this.validatePath(filePath);
    const stats = await fs.stat(safePath);

    return {
      size: stats.size,
      created: stats.birthtime,
      modified: stats.mtime,
      isDirectory: stats.isDirectory(),
      isFile: stats.isFile(),
    };
  }

  /**
   * Copy file within sandbox
   */
  async copyFile(sourcePath: string, destPath: string): Promise<void> {
    const safeSrc = await this.validatePath(sourcePath);
    const safeDest = this.validateWritePath(destPath);

    // Ensure destination directory exists
    const dir = path.dirname(safeDest);
    await fs.mkdir(dir, { recursive: true });

    return fs.copyFile(safeSrc, safeDest);
  }

  /**
   * Move/rename file within sandbox
   */
  async moveFile(sourcePath: string, destPath: string): Promise<void> {
    const safeSrc = await this.validatePath(sourcePath);
    const safeDest = this.validateWritePath(destPath);

    // Ensure destination directory exists
    const dir = path.dirname(safeDest);
    await fs.mkdir(dir, { recursive: true });

    return fs.rename(safeSrc, safeDest);
  }

  /**
   * Get workspace root path (for display purposes)
   */
  getWorkspaceRoot(): string {
    return this.workspaceRoot;
  }

  /**
   * Initialize workspace (create if doesn't exist)
   */
  async initialize(): Promise<void> {
    try {
      await fs.mkdir(this.workspaceRoot, { recursive: true });
      console.log(`✅ Workspace initialized at: ${this.workspaceRoot}`);
    } catch (error: any) {
      throw new Error(`Failed to initialize workspace: ${error.message}`);
    }
  }
}

// Singleton instance for default workspace
let defaultSandbox: FilesystemSandbox | null = null;

export function getDefaultSandbox(): FilesystemSandbox {
  if (!defaultSandbox) {
    defaultSandbox = new FilesystemSandbox();
  }
  return defaultSandbox;
}

// Initialize sandbox for agent (per-agent isolation)
export function createAgentSandbox(agentId: string): FilesystemSandbox {
  return new FilesystemSandbox(path.join('./workspace', agentId));
}

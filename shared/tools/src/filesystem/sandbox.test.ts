// Filesystem Sandbox Tests - Verify boundary enforcement

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs/promises';
import * as path from 'path';
import { FilesystemSandbox } from './sandbox';

describe('FilesystemSandbox', () => {
  let sandbox: FilesystemSandbox;
  const testWorkspace = path.join(__dirname, '../../../../test-workspace');

  beforeEach(async () => {
    // Create test workspace
    await fs.mkdir(testWorkspace, { recursive: true });
    sandbox = new FilesystemSandbox(testWorkspace);
  });

  afterEach(async () => {
    // Clean up test workspace
    await fs.rm(testWorkspace, { recursive: true, force: true });
  });

  describe('Boundary Enforcement', () => {
    it('should allow reading files within workspace', async () => {
      // Create test file
      const testFile = path.join(testWorkspace, 'test.txt');
      await fs.writeFile(testFile, 'Hello, world!');

      const content = await sandbox.readFile('test.txt');
      expect(content).toBe('Hello, world!');
    });

    it('should prevent reading files outside workspace using ../', async () => {
      await expect(
        sandbox.readFile('../../../package.json')
      ).rejects.toThrow('Access denied');
    });

    it('should prevent reading absolute paths outside workspace', async () => {
      await expect(
        sandbox.readFile('/etc/passwd')
      ).rejects.toThrow('Access denied');
    });

    it('should prevent reading files via multiple traversals', async () => {
      await expect(
        sandbox.readFile('../../../../../../etc/passwd')
      ).rejects.toThrow('Access denied');
    });

    it('should prevent writing files outside workspace', async () => {
      await expect(
        sandbox.writeFile('../../../evil.txt', 'bad content')
      ).rejects.toThrow('Access denied');
    });

    it('should prevent deleting files outside workspace', async () => {
      await expect(
        sandbox.deleteFile('../../../important.txt')
      ).rejects.toThrow('Access denied');
    });
  });

  describe('File Operations', () => {
    it('should write and read files', async () => {
      await sandbox.writeFile('hello.txt', 'Hello, sandbox!');
      const content = await sandbox.readFile('hello.txt');
      expect(content).toBe('Hello, sandbox!');
    });

    it('should create nested directories automatically', async () => {
      await sandbox.writeFile('deep/nested/file.txt', 'nested content');
      const content = await sandbox.readFile('deep/nested/file.txt');
      expect(content).toBe('nested content');
    });

    it('should append to files', async () => {
      await sandbox.writeFile('log.txt', 'Line 1\n');
      await sandbox.appendFile('log.txt', 'Line 2\n');
      await sandbox.appendFile('log.txt', 'Line 3\n');

      const content = await sandbox.readFile('log.txt');
      expect(content).toBe('Line 1\nLine 2\nLine 3\n');
    });

    it('should list directory contents', async () => {
      await sandbox.writeFile('file1.txt', 'content 1');
      await sandbox.writeFile('file2.txt', 'content 2');
      await sandbox.createDirectory('subdir');

      const entries = await sandbox.listDirectory('.');
      expect(entries).toContain('file1.txt');
      expect(entries).toContain('file2.txt');
      expect(entries).toContain('subdir');
    });

    it('should list directory with details', async () => {
      await sandbox.writeFile('test.txt', 'test content');

      const entries = await sandbox.listDirectoryDetailed('.');
      const testFile = entries.find(e => e.name === 'test.txt');

      expect(testFile).toBeDefined();
      expect(testFile?.isFile).toBe(true);
      expect(testFile?.isDirectory).toBe(false);
      expect(testFile?.size).toBeGreaterThan(0);
    });

    it('should create directories', async () => {
      await sandbox.createDirectory('mydir');
      const exists = await sandbox.exists('mydir');
      expect(exists).toBe(true);
    });

    it('should delete files', async () => {
      await sandbox.writeFile('temp.txt', 'temporary');
      await sandbox.deleteFile('temp.txt');

      const exists = await sandbox.exists('temp.txt');
      expect(exists).toBe(false);
    });

    it('should delete directories', async () => {
      await sandbox.createDirectory('tempdir');
      await sandbox.writeFile('tempdir/file.txt', 'content');

      await sandbox.deleteDirectory('tempdir', true);

      const exists = await sandbox.exists('tempdir');
      expect(exists).toBe(false);
    });

    it('should check file existence', async () => {
      await sandbox.writeFile('exists.txt', 'I exist');

      const exists1 = await sandbox.exists('exists.txt');
      const exists2 = await sandbox.exists('notexists.txt');

      expect(exists1).toBe(true);
      expect(exists2).toBe(false);
    });

    it('should get file stats', async () => {
      await sandbox.writeFile('stats.txt', 'test content');

      const stats = await sandbox.stat('stats.txt');

      expect(stats.isFile).toBe(true);
      expect(stats.isDirectory).toBe(false);
      expect(stats.size).toBeGreaterThan(0);
      expect(stats.created).toBeDefined();
      expect(stats.modified).toBeDefined();
      expect(typeof stats.created.getTime).toBe('function');
      expect(typeof stats.modified.getTime).toBe('function');
    });

    it('should copy files', async () => {
      await sandbox.writeFile('original.txt', 'original content');
      await sandbox.copyFile('original.txt', 'copy.txt');

      const content = await sandbox.readFile('copy.txt');
      expect(content).toBe('original content');

      // Original should still exist
      const originalExists = await sandbox.exists('original.txt');
      expect(originalExists).toBe(true);
    });

    it('should move/rename files', async () => {
      await sandbox.writeFile('old.txt', 'moving content');
      await sandbox.moveFile('old.txt', 'new.txt');

      const content = await sandbox.readFile('new.txt');
      expect(content).toBe('moving content');

      // Original should not exist
      const oldExists = await sandbox.exists('old.txt');
      expect(oldExists).toBe(false);
    });

    it('should handle subdirectories in operations', async () => {
      await sandbox.createDirectory('dir1/subdir1');
      await sandbox.createDirectory('dir2');

      await sandbox.writeFile('dir1/subdir1/file.txt', 'nested');
      await sandbox.copyFile('dir1/subdir1/file.txt', 'dir2/file.txt');

      const content = await sandbox.readFile('dir2/file.txt');
      expect(content).toBe('nested');
    });
  });

  describe('Edge Cases', () => {
    it('should handle files with spaces in names', async () => {
      await sandbox.writeFile('file with spaces.txt', 'spaced content');
      const content = await sandbox.readFile('file with spaces.txt');
      expect(content).toBe('spaced content');
    });

    it('should handle unicode filenames', async () => {
      await sandbox.writeFile('日本語.txt', 'Japanese content');
      const content = await sandbox.readFile('日本語.txt');
      expect(content).toBe('Japanese content');
    });

    it('should handle empty files', async () => {
      await sandbox.writeFile('empty.txt', '');
      const content = await sandbox.readFile('empty.txt');
      expect(content).toBe('');
    });

    it('should handle large files', async () => {
      const largeContent = 'x'.repeat(1024 * 1024); // 1MB
      await sandbox.writeFile('large.txt', largeContent);
      const content = await sandbox.readFile('large.txt');
      expect(content.length).toBe(1024 * 1024);
    });

    it('should normalize paths with /./', async () => {
      await sandbox.writeFile('test.txt', 'content');

      // These should all work (after normalization)
      const content1 = await sandbox.readFile('./test.txt');
      const content2 = await sandbox.readFile('./././test.txt');

      expect(content1).toBe('content');
      expect(content2).toBe('content');
    });
  });

  describe('Security', () => {
    it('should reject paths with null bytes', async () => {
      await expect(
        sandbox.readFile('test\x00.txt')
      ).rejects.toThrow();
    });

    it('should handle symlinks safely (within workspace)', async () => {
      await sandbox.writeFile('target.txt', 'target content');

      // Create symlink (this will be resolved to check boundaries)
      const targetPath = path.join(testWorkspace, 'target.txt');
      const linkPath = path.join(testWorkspace, 'link.txt');
      await fs.symlink(targetPath, linkPath);

      const content = await sandbox.readFile('link.txt');
      expect(content).toBe('target content');
    });

    it('should reject symlinks pointing outside workspace', async () => {
      // Create symlink pointing outside workspace
      const linkPath = path.join(testWorkspace, 'evil-link.txt');
      await fs.symlink('/etc/passwd', linkPath);

      await expect(
        sandbox.readFile('evil-link.txt')
      ).rejects.toThrow('Access denied');
    });
  });
});

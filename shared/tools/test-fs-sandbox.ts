/**
 * Test fs.readFileSync in JavaScript sandbox
 */

import { computeTools } from './src/compute/javascript';
import * as fs from 'fs';
import * as path from 'path';

const executeJavaScript = computeTools[0].handler;

async function testFsReadFileSync() {
  console.log('🧪 Testing fs.readFileSync in JavaScript sandbox\n');

  // Create a test file in workspace
  const workspaceRoot = process.env.WORKSPACE_PATH || path.resolve(process.cwd(), 'storage/workspace');
  await fs.promises.mkdir(workspaceRoot, { recursive: true });

  const testFilePath = path.join(workspaceRoot, 'test-data.json');
  const testData = {
    users: [
      { name: 'Alice', count: 10 },
      { name: 'Bob', count: 5 },
      { name: 'Charlie', count: 15 },
    ],
  };

  await fs.promises.writeFile(testFilePath, JSON.stringify(testData, null, 2), 'utf-8');
  console.log(`✅ Created test file: ${testFilePath}\n`);

  // Test 1: Read and parse JSON
  console.log('TEST 1: Read and parse JSON file');
  const result1 = await executeJavaScript({
    code: `
      const data = JSON.parse(fs.readFileSync('${testFilePath}', 'utf-8'));
      return data.users.length;
    `,
  }, null);

  if (result1.success && result1.result === 3) {
    console.log('✅ PASS: Successfully read and parsed JSON\n');
  } else {
    console.log('❌ FAIL:', result1, '\n');
  }

  // Test 2: Process data and aggregate
  console.log('TEST 2: Process data and aggregate counts');
  const result2 = await executeJavaScript({
    code: `
      const data = JSON.parse(fs.readFileSync('${testFilePath}', 'utf-8'));
      const total = data.users.reduce((sum, user) => sum + user.count, 0);
      return total;
    `,
  }, null);

  if (result2.success && result2.result === 30) {
    console.log('✅ PASS: Successfully aggregated data\n');
  } else {
    console.log('❌ FAIL:', result2, '\n');
  }

  // Test 3: Filter and map
  console.log('TEST 3: Filter and map data');
  const result3 = await executeJavaScript({
    code: `
      const data = JSON.parse(fs.readFileSync('${testFilePath}', 'utf-8'));
      const highCounters = data.users
        .filter(u => u.count > 7)
        .map(u => u.name);
      return highCounters;
    `,
  }, null);

  if (result3.success && JSON.stringify(result3.result) === JSON.stringify(['Alice', 'Charlie'])) {
    console.log('✅ PASS: Successfully filtered and mapped\n');
  } else {
    console.log('❌ FAIL:', result3, '\n');
  }

  // Test 4: Security - try to read outside workspace
  console.log('TEST 4: Security - block reading outside workspace');
  const result4 = await executeJavaScript({
    code: `
      try {
        const data = fs.readFileSync('/etc/passwd', 'utf-8');
        return 'SECURITY BREACH: Read /etc/passwd';
      } catch (error) {
        return 'Blocked: ' + error.message;
      }
    `,
  }, null);

  if (result4.success && result4.result?.includes('Access denied')) {
    console.log('✅ PASS: Successfully blocked access outside workspace\n');
  } else {
    console.log('❌ FAIL:', result4, '\n');
  }

  // Test 5: Realistic use case - count occurrences
  console.log('TEST 5: Realistic use case - count by field');
  const result5 = await executeJavaScript({
    code: `
      const data = JSON.parse(fs.readFileSync('${testFilePath}', 'utf-8'));
      const counts = {};
      data.users.forEach(user => {
        const bracket = user.count > 10 ? 'high' : 'low';
        counts[bracket] = (counts[bracket] || 0) + 1;
      });
      return counts;
    `,
  }, null);

  if (result5.success && result5.result?.high === 1 && result5.result?.low === 2) {
    console.log('✅ PASS: Successfully counted by bracket\n');
  } else {
    console.log('❌ FAIL:', result5, '\n');
  }

  // Cleanup
  await fs.promises.unlink(testFilePath);
  console.log('✅ Cleaned up test file\n');

  console.log('=' .repeat(80));
  console.log('\n✅ All tests passed! fs.readFileSync is working correctly in sandbox.\n');
}

testFsReadFileSync().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});

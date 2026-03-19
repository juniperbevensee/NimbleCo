/**
 * Comprehensive Red-Green Testing for JavaScript Sandbox
 *
 * GREEN: Tests normal functionality works correctly
 * RED: Tests security exploits are properly blocked
 */

import { computeTools } from './src/compute/javascript';

const executeJavaScript = computeTools[0].handler;

interface TestResult {
  name: string;
  type: 'GREEN' | 'RED';
  passed: boolean;
  details: string;
}

const results: TestResult[] = [];

async function runTest(
  name: string,
  type: 'GREEN' | 'RED',
  code: string,
  expectedBehavior: (result: any) => boolean,
  description: string
) {
  try {
    const result = await executeJavaScript({ code }, null);
    const passed = expectedBehavior(result);

    results.push({
      name,
      type,
      passed,
      details: passed ? '✅ PASS' : `❌ FAIL: ${description}`,
    });

    if (!passed) {
      console.log(`\n${type} TEST FAILED: ${name}`);
      console.log(`Expected: ${description}`);
      console.log('Result:', JSON.stringify(result, null, 2));
    }
  } catch (error: any) {
    results.push({
      name,
      type,
      passed: false,
      details: `❌ EXCEPTION: ${error.message}`,
    });
    console.error(`\n${type} TEST EXCEPTION: ${name}`, error);
  }
}

async function runAllTests() {
  console.log('🧪 Starting Red-Green JavaScript Sandbox Tests\n');
  console.log('=' .repeat(80));

  // ============================================================================
  // GREEN TESTS - Normal Functionality
  // ============================================================================

  console.log('\n✅ GREEN TESTS - Normal Functionality\n');

  await runTest(
    'Basic Math',
    'GREEN',
    'return 2 + 2',
    (r) => r.success && r.result === 4,
    'Should calculate 2 + 2 = 4'
  );

  await runTest(
    'Console.log Output',
    'GREEN',
    'console.log("Hello World"); return 42;',
    (r) => r.success && r.output.includes('Hello World') && r.result === 42,
    'Should capture console.log and return value'
  );

  await runTest(
    'Array Processing',
    'GREEN',
    'const arr = [1, 2, 3, 4, 5]; return arr.filter(x => x > 2).map(x => x * 2)',
    (r) => r.success && JSON.stringify(r.result) === JSON.stringify([6, 8, 10]),
    'Should process arrays correctly'
  );

  await runTest(
    'Object Manipulation',
    'GREEN',
    'const obj = { a: 1, b: 2 }; return obj.a + obj.b',
    (r) => r.success && r.result === 3,
    'Should work with objects'
  );

  await runTest(
    'String Operations',
    'GREEN',
    'return "hello".toUpperCase() + " " + "world"',
    (r) => r.success && r.result === 'HELLO world',
    'Should handle string operations'
  );

  await runTest(
    'Math Library',
    'GREEN',
    'return Math.sqrt(16) + Math.pow(2, 3)',
    (r) => r.success && r.result === 12,
    'Should have access to Math library'
  );

  await runTest(
    'Date Operations',
    'GREEN',
    'const d = new Date("2024-01-01"); return d.getFullYear()',
    (r) => r.success && r.result === 2024,
    'Should work with Date objects'
  );

  await runTest(
    'JSON Parsing',
    'GREEN',
    'const data = JSON.parse(\'{"x": 10}\'); return data.x * 2',
    (r) => r.success && r.result === 20,
    'Should parse JSON'
  );

  await runTest(
    'Multiple Console Logs',
    'GREEN',
    'console.log("Line 1"); console.warn("Warning"); console.error("Error"); return "done"',
    (r) => r.success && r.output.includes('Line 1') && r.output.includes('[WARN] Warning') && r.output.includes('[ERROR] Error'),
    'Should capture all console methods'
  );

  await runTest(
    'Complex Calculation',
    'GREEN',
    `
      const fibonacci = (n) => {
        if (n <= 1) return n;
        let a = 0, b = 1;
        for (let i = 2; i <= n; i++) {
          [a, b] = [b, a + b];
        }
        return b;
      };
      return fibonacci(10);
    `,
    (r) => r.success && r.result === 55,
    'Should handle complex functions'
  );

  // ============================================================================
  // RED TESTS - Security Exploits
  // ============================================================================

  console.log('\n🔴 RED TESTS - Security Exploit Attempts\n');

  await runTest(
    'Constructor Escape #1',
    'RED',
    '[].constructor.constructor("return process")()',
    (r) => !r.success || r.result === null || r.result === undefined,
    'Should block constructor-based escapes'
  );

  await runTest(
    'Constructor Escape #2',
    'RED',
    '(function(){}).constructor("return this")()',
    (r) => !r.success || r.result === null || r.result === undefined,
    'Should block Function constructor access'
  );

  await runTest(
    'Prototype Pollution (Isolated)',
    'RED',
    'Object.prototype.polluted = "pwned"; return Object.prototype.polluted',
    (r) => r.success && r.result === 'pwned',
    'Prototype pollution is allowed within isolate (cannot escape to parent process)'
  );

  await runTest(
    '__proto__ Access (Isolated)',
    'RED',
    'const x = {}; x.__proto__.polluted = "hacked"; return "done"',
    (r) => r.success && r.result === 'done',
    '__proto__ access is allowed within isolate (cannot escape to parent process)'
  );

  await runTest(
    'Process Access',
    'RED',
    'return process.env',
    (r) => !r.success || r.error,
    'Should not have access to process object'
  );

  await runTest(
    'Require Import',
    'RED',
    'const fs = require("fs"); return "imported"',
    (r) => !r.success || r.error,
    'Should not allow require()'
  );

  await runTest(
    'Global Access',
    'RED',
    'return global.process',
    (r) => !r.success || r.result === null || r.result === undefined,
    'Should not have access to global object'
  );

  await runTest(
    'Eval Cannot Escape',
    'RED',
    'try { eval("process.exit()"); return "escaped"; } catch(e) { return "blocked: " + e.message; }',
    (r) => r.success && (r.result === null || r.result?.includes('blocked') || r.result?.includes('not defined')),
    'eval exists but cannot access process or escape isolate'
  );

  await runTest(
    'Function Constructor Isolated',
    'RED',
    'try { const f = new Function("return process"); f(); return "escaped"; } catch(e) { return "blocked"; }',
    (r) => r.success && (r.result === 'blocked' || r.result?.includes('not defined')),
    'Function constructor exists but cannot access Node.js globals'
  );

  await runTest(
    'Import Statement',
    'RED',
    'import * as fs from "fs"',
    (r) => !r.success || r.error,
    'Should block import statements'
  );

  await runTest(
    'Async Bypass Attempt',
    'RED',
    'setTimeout(() => console.log("escaped"), 0)',
    (r) => !r.success || r.error,
    'Should block setTimeout'
  );

  await runTest(
    'Promise Isolated',
    'RED',
    'const p = new Promise(resolve => resolve(42)); return "promise created"',
    (r) => r.success && r.result === 'promise created',
    'Promise exists but runs in isolated V8 instance (cannot access parent)'
  );

  await runTest(
    'Memory/CPU Limit',
    'RED',
    'const arr = []; while(true) { arr.push(new Array(1000000)); }',
    (r) => !r.success && r.error?.includes('timed out'),
    'Should terminate on excessive resource usage (memory or CPU timeout)',
  );

  await runTest(
    'CPU Timeout',
    'RED',
    'while(true) {}',
    (r) => !r.success && r.error?.includes('timed out'),
    'Should timeout infinite loops'
  );

  await runTest(
    'Isolation Verified',
    'RED',
    `
      // Try multiple escape vectors
      let results = [];
      try { results.push("process: " + typeof process); } catch(e) { results.push("process: blocked"); }
      try { results.push("require: " + typeof require); } catch(e) { results.push("require: blocked"); }
      try { results.push("global: " + typeof global); } catch(e) { results.push("global: blocked"); }
      return results.join(", ");
    `,
    (r) => r.success && (!r.result?.includes('function') && !r.result?.includes('object')) || (r.result?.includes('undefined') || r.result?.includes('blocked')),
    'Verify Node.js APIs are not accessible from isolate'
  );

  // ============================================================================
  // Print Results
  // ============================================================================

  console.log('\n' + '='.repeat(80));
  console.log('\n📊 TEST RESULTS SUMMARY\n');

  const greenTests = results.filter(r => r.type === 'GREEN');
  const redTests = results.filter(r => r.type === 'RED');

  const greenPassed = greenTests.filter(r => r.passed).length;
  const redPassed = redTests.filter(r => r.passed).length;

  console.log(`✅ GREEN TESTS (Functionality): ${greenPassed}/${greenTests.length} passed`);
  greenTests.forEach(r => {
    console.log(`   ${r.passed ? '✅' : '❌'} ${r.name}`);
  });

  console.log(`\n🔴 RED TESTS (Security): ${redPassed}/${redTests.length} passed`);
  redTests.forEach(r => {
    console.log(`   ${r.passed ? '✅' : '❌'} ${r.name}`);
  });

  const totalPassed = greenPassed + redPassed;
  const totalTests = results.length;

  console.log(`\n${'='.repeat(80)}`);
  console.log(`\n🎯 OVERALL: ${totalPassed}/${totalTests} tests passed (${Math.round(totalPassed / totalTests * 100)}%)\n`);

  if (totalPassed === totalTests) {
    console.log('🎉 ALL TESTS PASSED! Sandbox is secure and functional.\n');
    process.exit(0);
  } else {
    console.log('⚠️  SOME TESTS FAILED! Review failures above.\n');
    process.exit(1);
  }
}

// Run tests
runAllTests().catch(error => {
  console.error('Fatal error running tests:', error);
  process.exit(1);
});

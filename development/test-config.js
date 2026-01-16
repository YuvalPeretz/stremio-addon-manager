#!/usr/bin/env node

/**
 * Configuration Validation Test Script
 * Tests the configuration validation logic
 */

// Simulate the validation functions from config.ts and server.js
function validateConfigValue(value, min, max, name, defaultValue) {
  if (isNaN(value) || value < min || value > max) {
    console.warn(
      `⚠️  Invalid ${name} value: ${value}. Must be between ${min} and ${max}. Using default: ${defaultValue}`
    );
    return defaultValue;
  }
  return value;
}

function parseEnvInt(envVar, defaultValue, min, max, name) {
  const value = envVar ? parseInt(envVar, 10) : defaultValue;
  return validateConfigValue(value, min, max, name, defaultValue);
}

// Test cases
const testCases = [
  {
    name: "Default values (no env vars)",
    env: {},
    expected: { torrentLimit: 15, availabilityCheckLimit: 15, maxStreams: 5, maxConcurrency: 3 },
  },
  {
    name: "Valid custom values (mid-range)",
    env: { TORRENT_LIMIT: "20", AVAILABILITY_CHECK_LIMIT: "25", MAX_STREAMS: "7", MAX_CONCURRENCY: "4" },
    expected: { torrentLimit: 20, availabilityCheckLimit: 25, maxStreams: 7, maxConcurrency: 4 },
  },
  {
    name: "Valid custom values (minimum)",
    env: { TORRENT_LIMIT: "1", AVAILABILITY_CHECK_LIMIT: "5", MAX_STREAMS: "1", MAX_CONCURRENCY: "1" },
    expected: { torrentLimit: 1, availabilityCheckLimit: 5, maxStreams: 1, maxConcurrency: 1 },
  },
  {
    name: "Valid custom values (maximum)",
    env: { TORRENT_LIMIT: "50", AVAILABILITY_CHECK_LIMIT: "50", MAX_STREAMS: "20", MAX_CONCURRENCY: "10" },
    expected: { torrentLimit: 50, availabilityCheckLimit: 50, maxStreams: 20, maxConcurrency: 10 },
  },
  {
    name: "Invalid values (too low)",
    env: { TORRENT_LIMIT: "0", AVAILABILITY_CHECK_LIMIT: "4", MAX_STREAMS: "0", MAX_CONCURRENCY: "0" },
    expected: { torrentLimit: 15, availabilityCheckLimit: 15, maxStreams: 5, maxConcurrency: 3 },
    shouldWarn: true,
  },
  {
    name: "Invalid values (too high)",
    env: { TORRENT_LIMIT: "100", AVAILABILITY_CHECK_LIMIT: "100", MAX_STREAMS: "100", MAX_CONCURRENCY: "100" },
    expected: { torrentLimit: 15, availabilityCheckLimit: 15, maxStreams: 5, maxConcurrency: 3 },
    shouldWarn: true,
  },
  {
    name: "Non-numeric values",
    env: { TORRENT_LIMIT: "abc", AVAILABILITY_CHECK_LIMIT: "xyz", MAX_STREAMS: "not-a-number", MAX_CONCURRENCY: "invalid" },
    expected: { torrentLimit: 15, availabilityCheckLimit: 15, maxStreams: 5, maxConcurrency: 3 },
    shouldWarn: true,
  },
  {
    name: "Negative values",
    env: { TORRENT_LIMIT: "-5", AVAILABILITY_CHECK_LIMIT: "-10", MAX_STREAMS: "-1", MAX_CONCURRENCY: "-2" },
    expected: { torrentLimit: 15, availabilityCheckLimit: 15, maxStreams: 5, maxConcurrency: 3 },
    shouldWarn: true,
  },
  {
    name: "Decimal values (should truncate)",
    env: { TORRENT_LIMIT: "15.5", AVAILABILITY_CHECK_LIMIT: "20.7", MAX_STREAMS: "5.2", MAX_CONCURRENCY: "3.9" },
    expected: { torrentLimit: 15, availabilityCheckLimit: 20, maxStreams: 5, maxConcurrency: 3 },
  },
  {
    name: "Empty strings",
    env: { TORRENT_LIMIT: "", AVAILABILITY_CHECK_LIMIT: "", MAX_STREAMS: "", MAX_CONCURRENCY: "" },
    expected: { torrentLimit: 15, availabilityCheckLimit: 15, maxStreams: 5, maxConcurrency: 3 },
  },
  {
    name: "Boundary (exact min)",
    env: { TORRENT_LIMIT: "1", AVAILABILITY_CHECK_LIMIT: "5", MAX_STREAMS: "1", MAX_CONCURRENCY: "1" },
    expected: { torrentLimit: 1, availabilityCheckLimit: 5, maxStreams: 1, maxConcurrency: 1 },
  },
  {
    name: "Boundary (exact max)",
    env: { TORRENT_LIMIT: "50", AVAILABILITY_CHECK_LIMIT: "50", MAX_STREAMS: "20", MAX_CONCURRENCY: "10" },
    expected: { torrentLimit: 50, availabilityCheckLimit: 50, maxStreams: 20, maxConcurrency: 10 },
  },
  {
    name: "Boundary (one below min)",
    env: { TORRENT_LIMIT: "0", AVAILABILITY_CHECK_LIMIT: "4", MAX_STREAMS: "0", MAX_CONCURRENCY: "0" },
    expected: { torrentLimit: 15, availabilityCheckLimit: 15, maxStreams: 5, maxConcurrency: 3 },
    shouldWarn: true,
  },
  {
    name: "Boundary (one above max)",
    env: { TORRENT_LIMIT: "51", AVAILABILITY_CHECK_LIMIT: "51", MAX_STREAMS: "21", MAX_CONCURRENCY: "11" },
    expected: { torrentLimit: 15, availabilityCheckLimit: 15, maxStreams: 5, maxConcurrency: 3 },
    shouldWarn: true,
  },
];

// Run tests
console.log("🧪 Configuration Validation Test Suite\n");
console.log("=" .repeat(60));

let passed = 0;
let failed = 0;

for (const testCase of testCases) {
  console.log(`\n📋 Test: ${testCase.name}`);
  console.log("-".repeat(60));

  // Capture console.warn output
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => {
    warnings.push(args.join(" "));
  };

  // Run validation
  const torrentLimit = parseEnvInt(testCase.env.TORRENT_LIMIT, 15, 1, 50, "TORRENT_LIMIT");
  const availabilityCheckLimit = parseEnvInt(
    testCase.env.AVAILABILITY_CHECK_LIMIT,
    15,
    5,
    50,
    "AVAILABILITY_CHECK_LIMIT"
  );
  const maxStreams = parseEnvInt(testCase.env.MAX_STREAMS, 5, 1, 20, "MAX_STREAMS");
  const maxConcurrency = parseEnvInt(testCase.env.MAX_CONCURRENCY, 3, 1, 10, "MAX_CONCURRENCY");

  // Restore console.warn
  console.warn = originalWarn;

  const result = { torrentLimit, availabilityCheckLimit, maxStreams, maxConcurrency };
  const hasWarnings = warnings.length > 0;

  // Check if test passed
  const valuesMatch = JSON.stringify(result) === JSON.stringify(testCase.expected);
  const warningsMatch = testCase.shouldWarn === undefined ? !hasWarnings : testCase.shouldWarn === hasWarnings;

  if (valuesMatch && warningsMatch) {
    console.log("✅ PASSED");
    console.log(`   Result: ${JSON.stringify(result)}`);
    if (hasWarnings) {
      console.log(`   Warnings: ${warnings.length} (expected)`);
    }
    passed++;
  } else {
    console.log("❌ FAILED");
    console.log(`   Expected: ${JSON.stringify(testCase.expected)}`);
    console.log(`   Got:      ${JSON.stringify(result)}`);
    if (testCase.shouldWarn !== undefined) {
      console.log(`   Expected warnings: ${testCase.shouldWarn ? "Yes" : "No"}`);
      console.log(`   Got warnings:      ${hasWarnings ? "Yes" : "No"}`);
    }
    if (warnings.length > 0) {
      warnings.forEach((w) => console.log(`   Warning: ${w}`));
    }
    failed++;
  }
}

// Summary
console.log("\n" + "=".repeat(60));
console.log(`\n📊 Test Summary:`);
console.log(`   ✅ Passed: ${passed}`);
console.log(`   ❌ Failed: ${failed}`);
console.log(`   📈 Total:  ${passed + failed}`);

if (failed === 0) {
  console.log("\n🎉 All tests passed!\n");
  process.exit(0);
} else {
  console.log("\n⚠️  Some tests failed. Please review the output above.\n");
  process.exit(1);
}

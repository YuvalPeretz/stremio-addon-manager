# Configuration Validation Test Plan

**Last Updated:** January 12, 2026  
**Purpose:** Comprehensive testing of configuration validation for torrent processing limits

**Test Script:** `test-config.js` - Automated validation test suite  
**Status:** ✅ All 14 test cases passing

---

## Test Categories

### 1. Default Values Testing

#### Test Case 1.1: No Environment Variables Set

**Setup:** Remove all environment variables  
**Expected:** All config values should use defaults

- `TORRENT_LIMIT` → 15
- `AVAILABILITY_CHECK_LIMIT` → 15
- `MAX_STREAMS` → 5
- `MAX_CONCURRENCY` → 3

**Validation:**

```bash
# TypeScript (addon-server)
cd packages/addon-server
npm run build
# Check startup logs for default values

# JavaScript (server.js)
node server.js
# Check startup logs for default values
```

---

### 2. Custom Valid Values Testing

#### Test Case 2.1: Valid Custom Values (Mid-Range)

**Environment Variables:**

```bash
TORRENT_LIMIT=20
AVAILABILITY_CHECK_LIMIT=25
MAX_STREAMS=7
MAX_CONCURRENCY=4
```

**Expected:** All values should be accepted and used

- No warnings in logs
- Config values match environment variables

#### Test Case 2.2: Valid Custom Values (Minimum)

**Environment Variables:**

```bash
TORRENT_LIMIT=1
AVAILABILITY_CHECK_LIMIT=5
MAX_STREAMS=1
MAX_CONCURRENCY=1
```

**Expected:** All minimum values should be accepted

#### Test Case 2.3: Valid Custom Values (Maximum)

**Environment Variables:**

```bash
TORRENT_LIMIT=50
AVAILABILITY_CHECK_LIMIT=50
MAX_STREAMS=20
MAX_CONCURRENCY=10
```

**Expected:** All maximum values should be accepted

---

### 3. Invalid Values Testing

#### Test Case 3.1: Out of Range (Too Low)

**Environment Variables:**

```bash
TORRENT_LIMIT=0
AVAILABILITY_CHECK_LIMIT=4
MAX_STREAMS=0
MAX_CONCURRENCY=0
```

**Expected:**

- Warning messages for each invalid value
- Default values used instead
- Application continues to run

**Expected Warnings:**

```
⚠️  Invalid TORRENT_LIMIT value: 0. Must be between 1 and 50. Using default: 15
⚠️  Invalid AVAILABILITY_CHECK_LIMIT value: 4. Must be between 5 and 50. Using default: 15
⚠️  Invalid MAX_STREAMS value: 0. Must be between 1 and 20. Using default: 5
⚠️  Invalid MAX_CONCURRENCY value: 0. Must be between 1 and 10. Using default: 3
```

#### Test Case 3.2: Out of Range (Too High)

**Environment Variables:**

```bash
TORRENT_LIMIT=100
AVAILABILITY_CHECK_LIMIT=100
MAX_STREAMS=100
MAX_CONCURRENCY=100
```

**Expected:**

- Warning messages for each invalid value
- Default values used instead

#### Test Case 3.3: Non-Numeric Values

**Environment Variables:**

```bash
TORRENT_LIMIT=abc
AVAILABILITY_CHECK_LIMIT=xyz
MAX_STREAMS=not-a-number
MAX_CONCURRENCY=invalid
```

**Expected:**

- `parseInt()` returns `NaN`
- Warning messages for each invalid value
- Default values used instead

#### Test Case 3.4: Negative Values

**Environment Variables:**

```bash
TORRENT_LIMIT=-5
AVAILABILITY_CHECK_LIMIT=-10
MAX_STREAMS=-1
MAX_CONCURRENCY=-2
```

**Expected:**

- Warning messages (negative values are out of range)
- Default values used instead

#### Test Case 3.5: Decimal Values

**Environment Variables:**

```bash
TORRENT_LIMIT=15.5
AVAILABILITY_CHECK_LIMIT=20.7
MAX_STREAMS=5.2
MAX_CONCURRENCY=3.9
```

**Expected:**

- `parseInt()` truncates to integer (15, 20, 5, 3)
- Values should be accepted if within range
- No warnings if truncated values are valid

#### Test Case 3.6: Empty Strings

**Environment Variables:**

```bash
TORRENT_LIMIT=
AVAILABILITY_CHECK_LIMIT=
MAX_STREAMS=
MAX_CONCURRENCY=
```

**Expected:**

- Empty strings → `undefined` → defaults used
- No warnings (missing values use defaults silently)

---

### 4. Edge Cases Testing

#### Test Case 4.1: Boundary Values (Exact Min)

**Environment Variables:**

```bash
TORRENT_LIMIT=1
AVAILABILITY_CHECK_LIMIT=5
MAX_STREAMS=1
MAX_CONCURRENCY=1
```

**Expected:** All values accepted (boundary inclusive)

#### Test Case 4.2: Boundary Values (Exact Max)

**Environment Variables:**

```bash
TORRENT_LIMIT=50
AVAILABILITY_CHECK_LIMIT=50
MAX_STREAMS=20
MAX_CONCURRENCY=10
```

**Expected:** All values accepted (boundary inclusive)

#### Test Case 4.3: Boundary Values (One Below Min)

**Environment Variables:**

```bash
TORRENT_LIMIT=0
AVAILABILITY_CHECK_LIMIT=4
MAX_STREAMS=0
MAX_CONCURRENCY=0
```

**Expected:** Warnings and defaults used

#### Test Case 4.4: Boundary Values (One Above Max)

**Environment Variables:**

```bash
TORRENT_LIMIT=51
AVAILABILITY_CHECK_LIMIT=51
MAX_STREAMS=21
MAX_CONCURRENCY=11
```

**Expected:** Warnings and defaults used

#### Test Case 4.5: Very Large Numbers

**Environment Variables:**

```bash
TORRENT_LIMIT=999999
AVAILABILITY_CHECK_LIMIT=999999
MAX_STREAMS=999999
MAX_CONCURRENCY=999999
```

**Expected:**

- Values parsed as integers
- Out of range warnings
- Defaults used

#### Test Case 4.6: String Numbers (Valid)

**Environment Variables:**

```bash
TORRENT_LIMIT="15"
AVAILABILITY_CHECK_LIMIT="20"
MAX_STREAMS="5"
MAX_CONCURRENCY="3"
```

**Expected:**

- `parseInt()` converts to numbers
- Values accepted (quotes don't matter in env vars)

---

### 5. Core Package ConfigManager Validation

#### Test Case 5.1: Valid Configuration Object

**Input:**

```typescript
const config = {
  addon: {
    name: "Test",
    domain: "test.com",
    password: "password123",
    provider: Provider.REAL_DEBRID,
    torrentLimit: 15,
    availabilityCheckLimit: 15,
    maxStreams: 5,
    maxConcurrency: 3,
  },
  // ... other required fields
};
```

**Expected:** `validate()` returns `{ valid: true, errors: [] }`

#### Test Case 5.2: Invalid torrentLimit (Type)

**Input:**

```typescript
torrentLimit: "not-a-number";
```

**Expected:** Error: "Torrent limit must be a valid number"

#### Test Case 5.3: Invalid torrentLimit (Range)

**Input:**

```typescript
torrentLimit: 100;
```

**Expected:** Error: "Torrent limit must be between 1 and 50"

#### Test Case 5.4: Invalid availabilityCheckLimit (Type)

**Input:**

```typescript
availabilityCheckLimit: NaN;
```

**Expected:** Error: "Availability check limit must be a valid number"

#### Test Case 5.5: Invalid availabilityCheckLimit (Range)

**Input:**

```typescript
availabilityCheckLimit: 3;
```

**Expected:** Error: "Availability check limit must be between 5 and 50"

#### Test Case 5.6: Missing Optional Fields

**Input:**

```typescript
{
  torrentLimit: 15,
  // availabilityCheckLimit, maxStreams, maxConcurrency not provided
}
```

**Expected:** Validation passes (optional fields)

#### Test Case 5.7: All Optional Fields Provided

**Input:**

```typescript
{
  torrentLimit: 15,
  availabilityCheckLimit: 20,
  maxStreams: 7,
  maxConcurrency: 4,
}
```

**Expected:** All validated successfully

---

### 6. Integration Testing

#### Test Case 6.1: Full Configuration Flow

1. Set environment variables
2. Start addon-server
3. Make a stream request
4. Verify config values are used in processing

**Steps:**

```bash
# Set config
export TORRENT_LIMIT=10
export AVAILABILITY_CHECK_LIMIT=10
export MAX_STREAMS=3
export MAX_CONCURRENCY=5

# Start server
npm start

# Check logs for:
# - Configuration values logged
# - No warnings
# - Values used in processing
```

#### Test Case 6.2: Backward Compatibility

**Setup:** Old config file without new fields

**Expected:**

- Config loads successfully
- Defaults used for missing fields
- No errors

---

## Test Execution Checklist

### TypeScript Addon Server (`packages/addon-server`)

- [ ] Test 1.1: Default values (no env vars)
- [ ] Test 2.1: Valid custom values (mid-range)
- [ ] Test 2.2: Valid custom values (minimum)
- [ ] Test 2.3: Valid custom values (maximum)
- [ ] Test 3.1: Invalid values (too low)
- [ ] Test 3.2: Invalid values (too high)
- [ ] Test 3.3: Non-numeric values
- [ ] Test 3.4: Negative values
- [ ] Test 3.5: Decimal values
- [ ] Test 3.6: Empty strings
- [ ] Test 4.1: Boundary (exact min)
- [ ] Test 4.2: Boundary (exact max)
- [ ] Test 4.3: Boundary (one below min)
- [ ] Test 4.4: Boundary (one above max)
- [ ] Test 4.5: Very large numbers
- [ ] Test 4.6: String numbers

### JavaScript Server (`server.js`)

- [ ] Test 1.1: Default values (no env vars)
- [ ] Test 2.1: Valid custom values (mid-range)
- [ ] Test 2.2: Valid custom values (minimum)
- [ ] Test 2.3: Valid custom values (maximum)
- [ ] Test 3.1: Invalid values (too low)
- [ ] Test 3.2: Invalid values (too high)
- [ ] Test 3.3: Non-numeric values
- [ ] Test 3.4: Negative values
- [ ] Test 3.5: Decimal values
- [ ] Test 3.6: Empty strings
- [ ] Test 4.1: Boundary (exact min)
- [ ] Test 4.2: Boundary (exact max)
- [ ] Test 4.3: Boundary (one below min)
- [ ] Test 4.4: Boundary (one above max)
- [ ] Test 4.5: Very large numbers
- [ ] Test 4.6: String numbers

### Core Package (`packages/core`)

- [ ] Test 5.1: Valid configuration object
- [ ] Test 5.2: Invalid torrentLimit (type)
- [ ] Test 5.3: Invalid torrentLimit (range)
- [ ] Test 5.4: Invalid availabilityCheckLimit (type)
- [ ] Test 5.5: Invalid availabilityCheckLimit (range)
- [ ] Test 5.6: Missing optional fields
- [ ] Test 5.7: All optional fields provided

### Integration

- [ ] Test 6.1: Full configuration flow
- [ ] Test 6.2: Backward compatibility

---

## Expected Results Summary

### Validation Behavior

1. **Valid Values:** Accepted silently, no warnings
2. **Invalid Values:** Warning logged, default used, app continues
3. **Missing Values:** Defaults used silently (no warnings)
4. **Type Errors:** Caught and handled gracefully
5. **Range Errors:** Caught and handled gracefully

### Logging Behavior

- **Startup:** All config values logged (sensitive values hidden)
- **Invalid Values:** Warning messages with helpful information
- **Defaults:** Applied silently when values missing

---

## Notes

- All tests should verify that the application **never crashes** on invalid config
- All tests should verify that **defaults are always used** when validation fails
- Warning messages should be **helpful and actionable**
- Validation should be **consistent** across TypeScript and JavaScript versions

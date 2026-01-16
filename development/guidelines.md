# Stremio Addon Manager - Development Guidelines

**Last Updated:** January 12, 2026

---

## 🎯 Project Overview

The Stremio Addon Manager is a monorepo containing multiple packages for managing and deploying Stremio addons with Real-Debrid integration.

### Package Structure

- **`addon-server`**: Core addon server (TypeScript)
- **`cli`**: Command-line interface for management
- **`core`**: Shared utilities and types
- **`electron`**: Desktop application (GUI)

---

## 📦 Configuration Management

### Environment Variables

All configuration should be loaded from environment variables with sensible defaults.

#### Addon Server Configuration

**Real-Debrid:**

- `RD_API_TOKEN` - Real-Debrid API token (required)

**Authentication:**

- `ADDON_PASSWORD` - Password for addon access (optional)
- `AUTH_ENABLED` - Auto-enabled if password is set

**Server:**

- `PORT` - Server port (default: 7000)
- `NODE_ENV` - Environment (development/production)

**Torrent Processing:**

- `TORRENT_LIMIT` - Maximum torrents to process (default: 15)
- `AVAILABILITY_CHECK_LIMIT` - Torrents to check for instant availability (default: 15)
- `MAX_STREAMS` - Maximum streams to return before stopping (default: 5)
- `MAX_CONCURRENCY` - Parallel torrent processing limit (default: 3)

**Cache TTL (seconds):**

- `CACHE_TTL_METADATA` - Metadata cache duration (default: 86400 = 24h)
- `CACHE_TTL_TORRENT_SEARCH` - Torrent search cache (default: 21600 = 6h)
- `CACHE_TTL_STREAMS` - Stream URL cache (default: 1800 = 30m)

**Rate Limiting:**

- `RATE_LIMIT_STREAM_MAX` - Max stream requests per window (default: 50)
- `RATE_LIMIT_STREAM_WINDOW` - Stream rate limit window in minutes (default: 15)
- `RATE_LIMIT_STATS_MAX` - Max stats requests per window (default: 120)
- `RATE_LIMIT_STATS_WINDOW` - Stats rate limit window in minutes (default: 1)

### Configuration Best Practices

#### General Principles

1. **Always provide defaults** - Never require environment variables unless critical
2. **Validate values** - Check min/max bounds and types
3. **Log configuration** - Display config on startup (hide sensitive values)
4. **Type safety** - Use TypeScript interfaces for config structure
5. **Documentation** - Document all config options in README
6. **Backward compatibility** - New config options should be optional with sensible defaults
7. **Consistent naming** - Use same names across TypeScript and JavaScript versions

#### Torrent Processing Configuration

**Validation Rules:**

- `TORRENT_LIMIT`: Range 1-50, default 15
- `AVAILABILITY_CHECK_LIMIT`: Range 5-50, default 15
- `MAX_STREAMS`: Range 1-20, default 5
- `MAX_CONCURRENCY`: Range 1-10, default 3

**Implementation Guidelines:**

1. **Validation Function Pattern:**

   ```typescript
   function validateConfigValue(value: number, min: number, max: number, name: string, defaultValue: number): number {
     if (isNaN(value) || value < min || value > max) {
       console.warn(
         `⚠️  Invalid ${name} value: ${value}. Must be between ${min} and ${max}. Using default: ${defaultValue}`
       );
       return defaultValue;
     }
     return value;
   }
   ```

2. **Environment Variable Parsing:**

   ```typescript
   function parseEnvInt(
     envVar: string | undefined,
     defaultValue: number,
     min: number,
     max: number,
     name: string
   ): number {
     const value = envVar ? parseInt(envVar, 10) : defaultValue;
     return validateConfigValue(value, min, max, name, defaultValue);
   }
   ```

3. **Startup Logging:**
   - Log all configuration values on startup
   - Hide sensitive values (tokens, passwords)
   - Show validation status
   - Format consistently across both codebases

#### Configuration Flow Architecture

When adding new configuration options, follow this flow:

```
1. Core Package (types.ts)
   ↓ Define AddonConfig interface

2. CLI Package (install.ts)
   ↓ Prompt user for values
   ↓ Save to config file

3. Installation Manager (manager.ts)
   ↓ Write to systemd service file as env vars

4. Addon Server (config.ts)
   ↓ Read from environment variables
   ↓ Validate and apply defaults

5. Stream Handler (stream-handler.ts)
   ↓ Use config values instead of hardcoded
```

#### Performance Considerations

**Torrent Processing Limits:**

- **Availability Check Limit**: Higher values increase API calls but improve cache hit rate
- **Max Streams**: Lower values = faster responses, higher values = more options
- **Max Concurrency**: Higher values = faster processing but risk API rate limits
- **Torrent Limit**: Balance between options and response time

**Recommended Configurations:**

- **Default (Balanced):** All defaults (15, 15, 5, 3)
- **Speed Optimized:** Lower limits, higher concurrency (10, 10, 3, 5)
- **More Options:** Higher limits, standard concurrency (25, 30, 10, 3)
- **High Traffic:** Standard limits, lower concurrency (15, 15, 5, 2)

#### Error Handling

1. **Invalid Values:**

   - Log warning with helpful message
   - Use default value
   - Never crash the application
   - Continue with degraded functionality if needed

2. **Missing Values:**

   - Use defaults silently
   - Log info message in development mode
   - No warnings for missing optional config

3. **Type Errors:**
   - Handle `NaN` from `parseInt()`
   - Handle `undefined` from `process.env`
   - Always provide fallback

#### Testing Configuration

1. **Unit Tests:**

   - Test validation functions
   - Test parsing functions
   - Test default values
   - Test boundary conditions

2. **Integration Tests:**

   - Test with various env var combinations
   - Test backward compatibility (missing new vars)
   - Test invalid values
   - Test edge cases (min, max, boundary)

3. **Performance Tests:**
   - Measure response times with different configs
   - Test concurrency limits
   - Test early return optimization
   - Monitor API rate limit compliance

---

## 🔧 Code Organization

### TypeScript Packages

**File Structure:**

```
packages/addon-server/src/
├── config.ts          # Configuration loading
├── types.ts           # TypeScript types
├── cache.ts           # Caching implementation
├── real-debrid.ts     # Real-Debrid API client
├── torrent-search.ts  # Torrent search logic
├── stream-handler.ts  # Main stream processing
├── episode-matching.ts # Episode matching utilities
├── server.ts          # Express server setup
├── manifest.ts        # Stremio manifest
└── index.ts           # Entry point
```

### JavaScript Version

The root `server.js` should mirror the TypeScript functionality for standalone deployments.

**Key Principles:**

- Keep both versions in sync
- TypeScript is the source of truth
- JavaScript should have same features and behavior

---

## 🚀 Development Workflow

### Making Configuration Changes

1. **Update TypeScript Config First**

   - Modify `config.ts` interface
   - Add to `loadConfig()` function
   - Add validation

2. **Update TypeScript Implementation**

   - Replace hardcoded values with config
   - Update all references

3. **Update JavaScript Version**

   - Mirror changes in `server.js`
   - Use same environment variable names
   - Keep same defaults

4. **Update Documentation**

   - README.md
   - Development guidelines
   - Any relevant docs

5. **Test Both Versions**
   - Verify TypeScript compiles
   - Test JavaScript standalone
   - Test with various config values

### Adding New Features

1. **Plan in Todo List**

   - Break down into phases
   - Identify all affected files
   - Consider both codebases

2. **Implement in TypeScript First**

   - Better type safety
   - Easier to refactor
   - Better tooling

3. **Port to JavaScript**

   - Match functionality exactly
   - Keep same behavior
   - Update comments

4. **Update Tests**
   - Unit tests for new functions
   - Integration tests for flows
   - Edge case testing

---

## 📝 Code Standards

### Naming Conventions

- **Variables**: `camelCase`
- **Functions**: `camelCase`
- **Classes**: `PascalCase`
- **Constants**: `UPPER_SNAKE_CASE`
- **Interfaces**: `PascalCase`
- **Types**: `PascalCase`

### Configuration Constants

- Use `UPPER_SNAKE_CASE` for environment variable names
- Use descriptive names: `AVAILABILITY_CHECK_LIMIT` not `ACL`
- Group related config: `RATE_LIMIT_*`, `CACHE_TTL_*`

### Comments

- Document all config options
- Explain "why" not just "what"
- Include default values in comments
- Add JSDoc for TypeScript functions

### Error Handling

- Validate config on startup
- Use sensible defaults for invalid values
- Log warnings for invalid config
- Never crash on config errors (unless critical)

---

## 🧪 Testing Guidelines

### Configuration Testing

1. **Default Values**

   - Test with no environment variables
   - Verify defaults are used

2. **Custom Values**

   - Test with valid custom values
   - Verify they're applied correctly

3. **Invalid Values**

   - Test with out-of-bounds values
   - Test with non-numeric values
   - Verify fallback to defaults

4. **Edge Cases**
   - Very low values (1, 2)
   - Very high values (100+)
   - Missing required config

### Performance Testing

- Test with different concurrency levels
- Measure response times with different limits
- Verify early return optimization works
- Check memory usage with high limits

---

## 🔍 Code Review Checklist

When reviewing configuration changes:

- [ ] Both TypeScript and JavaScript updated
- [ ] Environment variables documented
- [ ] Default values are sensible
- [ ] Validation is present
- [ ] Error handling is appropriate
- [ ] Comments explain the purpose
- [ ] No hardcoded values remain
- [ ] Tests cover new config options
- [ ] Backward compatibility maintained

---

## 📚 Related Documentation

- `development/todo.md` - Current development tasks
- `development/commands-list.json` - Command reference
- `packages/addon-server/README.md` - Package documentation
- Root `development/guidelines-generic.md` - General project guidelines

---

## 🎯 Current Focus

**Making Torrent Processing Limits Configurable**

See `development/todo.md` for detailed implementation plan.

**Key Changes:**

- ✅ Add `AVAILABILITY_CHECK_LIMIT` config
- ✅ Add `MAX_STREAMS` config
- ✅ Add `MAX_CONCURRENCY` config
- ✅ Remove hardcoded values from both codebases
- ✅ Update configuration documentation
- ✅ Add validation and error handling

---

**Status:** ✅ Configuration System Complete  
**Next:** Continue with CLI and Electron integration (Phase 2-5 from todo.md)

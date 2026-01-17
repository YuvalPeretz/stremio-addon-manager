# Stremio Addon Server

The actual Node.js server that runs on your server/Pi and handles streaming requests.

## Features

- **TypeScript** - Fully typed for better development experience
- **Modular Architecture** - Clean separation of concerns
- **Environment Variables** - Fully configurable via env vars
- **Caching** - Three-tier caching system for performance
- **Rate Limiting** - Protection against abuse
- **Real-Debrid Integration** - Direct streaming via RD
- **Authentication** - URL-based password protection

## Environment Variables

The addon server is configured via environment variables. These can be set in the systemd service file or passed directly when running the server.

### Complete Environment Variable Reference

| Variable | Type | Required | Default | Range/Format | Sensitive | Generateable | Description |
|----------|------|----------|---------|--------------|-----------|--------------|-------------|
| `NODE_ENV` | string | Yes | `production` | `production` \| `development` | No | No | Node.js environment mode |
| `PORT` | number | Yes | `7000` | 1024-65535 | No | No | Server port number |
| `RD_API_TOKEN` | string | Yes | - | Any non-empty string | **Yes** | No | Real-Debrid API token |
| `ADDON_PASSWORD` | string | Yes | - | Min 8 characters | **Yes** | **Yes** | Authentication password for addon access |
| `ADDON_DOMAIN` | string | No | - | Valid domain/IP | No | No | Domain for manifest base URL |
| `TORRENT_LIMIT` | number | Yes | `15` | 1-50 | No | No | Maximum torrents to process per request |
| `AVAILABILITY_CHECK_LIMIT` | number | No | `15` | 5-50 | No | No | Torrents to check for instant availability |
| `MAX_STREAMS` | number | No | `5` | 1-20 | No | No | Maximum streams to return (early return) |
| `MAX_CONCURRENCY` | number | No | `3` | 1-10 | No | No | Parallel torrent processing limit |

### Quick Reference

```bash
# Required Variables
RD_API_TOKEN=your_real_debrid_api_token          # Get from: https://real-debrid.com/apitoken
ADDON_PASSWORD=your_secure_password_here         # Min 8 chars, can be auto-generated

# Server Configuration
PORT=7000                                        # Server port (1024-65535)
NODE_ENV=production                              # Environment mode

# Optional - Domain Configuration
ADDON_DOMAIN=your-domain.duckdns.org            # For multi-addon setups

# Optional - Performance Tuning
TORRENT_LIMIT=15                                 # Max torrents to process (1-50)
AVAILABILITY_CHECK_LIMIT=15                      # Check for cached torrents (5-50)
MAX_STREAMS=5                                    # Max streams to return (1-20)
MAX_CONCURRENCY=3                                # Parallel processing (1-10)
```

### Detailed Variable Descriptions

#### `NODE_ENV`
- **Type:** String
- **Required:** Yes
- **Default:** `production`
- **Values:** `production`, `development`
- **Description:** Sets the Node.js environment mode. Use `production` for deployed servers, `development` for local testing.
- **Sensitive:** No
- **Generateable:** No

#### `PORT`
- **Type:** Number
- **Required:** Yes
- **Default:** `7000`
- **Range:** 1024-65535
- **Description:** The port number the addon server listens on. Must be between 1024 and 65535.
- **Sensitive:** No
- **Generateable:** No
- **Example:** `PORT=7000`

#### `RD_API_TOKEN`
- **Type:** String
- **Required:** Yes
- **Default:** None (must be provided)
- **Format:** Any non-empty string
- **Description:** Your Real-Debrid API token. Get it from [Real-Debrid API Token page](https://real-debrid.com/apitoken).
- **Sensitive:** **Yes** (value is masked in logs and UI)
- **Generateable:** No
- **Example:** `RD_API_TOKEN=ABCD1234EFGH5678IJKL9012MNOP3456QRST7890UVWX`

#### `ADDON_PASSWORD`
- **Type:** String
- **Required:** Yes
- **Default:** None (must be provided)
- **Min Length:** 8 characters
- **Description:** Password required to access the addon. Users must provide this password when installing the addon in Stremio.
- **Sensitive:** **Yes** (value is masked in logs and UI)
- **Generateable:** **Yes** (can be auto-generated as secure random string)
- **Example:** `ADDON_PASSWORD=MySecurePassword123!`
- **Note:** Can be generated using the CLI: `stremio-addon-manager env generate ADDON_PASSWORD`

#### `ADDON_DOMAIN`
- **Type:** String
- **Required:** No
- **Default:** None (uses request host)
- **Format:** Valid domain name or IP address
- **Description:** The domain name for the addon manifest base URL. Used in multi-addon setups to ensure correct domain routing. If not set, uses the incoming request host.
- **Sensitive:** No
- **Generateable:** No
- **Example:** `ADDON_DOMAIN=my-addon.duckdns.org`
- **Note:** Required for multi-addon setups where multiple domains point to the same server.

#### `TORRENT_LIMIT`
- **Type:** Number
- **Required:** Yes
- **Default:** `15`
- **Range:** 1-50
- **Description:** Maximum number of torrents to process through Real-Debrid per stream request. Higher values provide more streaming options but increase response time.
- **Sensitive:** No
- **Generateable:** No
- **Example:** `TORRENT_LIMIT=15`
- **Impact:** 
  - Lower values (5-10): Faster responses, fewer options
  - Default (15): Balanced performance
  - Higher values (20-50): Slower responses, more options

#### `AVAILABILITY_CHECK_LIMIT`
- **Type:** Number
- **Required:** No
- **Default:** `15`
- **Range:** 5-50
- **Description:** Number of torrents to check for instant availability in Real-Debrid cache before processing. Higher values make more API calls but increase the chance of finding cached (instant) torrents.
- **Sensitive:** No
- **Generateable:** No
- **Example:** `AVAILABILITY_CHECK_LIMIT=15`
- **Impact:**
  - Lower values (5-10): Fewer API calls, may miss cached torrents
  - Default (15): Good balance
  - Higher values (25-50): More API calls, better cache hit rate

#### `MAX_STREAMS`
- **Type:** Number
- **Required:** No
- **Default:** `5`
- **Range:** 1-20
- **Description:** Maximum number of working streams to return before stopping processing (early return optimization). Once this many working streams are found, processing stops to improve response time.
- **Sensitive:** No
- **Generateable:** No
- **Example:** `MAX_STREAMS=5`
- **Impact:**
  - Lower values (1-3): Very fast responses, fewer options
  - Default (5): Optimal balance
  - Higher values (10-20): Slower responses, more options

#### `MAX_CONCURRENCY`
- **Type:** Number
- **Required:** No
- **Default:** `3`
- **Range:** 1-10
- **Description:** Number of torrents to process in parallel simultaneously. Higher values process faster but increase load on the Real-Debrid API and may hit rate limits.
- **Sensitive:** No
- **Generateable:** No
- **Example:** `MAX_CONCURRENCY=3`
- **Impact:**
  - Lower values (1-2): Slower processing, safer for API limits
  - Default (3): Safe for most setups
  - Higher values (5-10): Faster processing, may hit rate limits

## Installation

```bash
npm install
npm run build
npm start
```

## Development

```bash
npm run dev
```

## Configuration

### Torrent Processing Limits

The addon server supports several configuration options to fine-tune torrent processing performance:

#### `TORRENT_LIMIT`
- **Description:** Maximum number of torrents to process through Real-Debrid per request
- **Default:** 15
- **Range:** 1-50
- **Impact:** Higher values = more streaming options but slower response times
- **Recommended:** 10-20 for most users

#### `AVAILABILITY_CHECK_LIMIT`
- **Description:** Number of torrents to check for instant availability in Real-Debrid cache before processing
- **Default:** 15
- **Range:** 5-50
- **Impact:** Higher values = more API calls but better chance of finding cached (instant) torrents
- **Recommended:** 15-25 for optimal balance

#### `MAX_STREAMS`
- **Description:** Maximum number of working streams to return before stopping processing (early return optimization)
- **Default:** 5
- **Range:** 1-20
- **Impact:** Higher values = more processing time but more options for users
- **Recommended:** 3-7 for most users (5 is optimal)

#### `MAX_CONCURRENCY`
- **Description:** Number of torrents to process in parallel simultaneously
- **Default:** 3
- **Range:** 1-10
- **Impact:** Higher values = faster processing but more load on Real-Debrid API (may hit rate limits)
- **Recommended:** 2-5 (3 is safe for most setups)

### Performance Tuning Tips

- **For faster responses:** Lower `TORRENT_LIMIT` and `AVAILABILITY_CHECK_LIMIT`, keep `MAX_STREAMS` at 3-5
- **For more options:** Increase `TORRENT_LIMIT` and `AVAILABILITY_CHECK_LIMIT`, increase `MAX_STREAMS`
- **For high-traffic setups:** Keep `MAX_CONCURRENCY` at 3 to avoid API rate limits
- **For single-user setups:** Can safely increase `MAX_CONCURRENCY` to 5-7 for faster processing

### Example Configurations

**Fast & Efficient (Default):**
```bash
TORRENT_LIMIT=15
AVAILABILITY_CHECK_LIMIT=15
MAX_STREAMS=5
MAX_CONCURRENCY=3
```

**More Options:**
```bash
TORRENT_LIMIT=25
AVAILABILITY_CHECK_LIMIT=30
MAX_STREAMS=10
MAX_CONCURRENCY=3
```

**Speed Optimized:**
```bash
TORRENT_LIMIT=10
AVAILABILITY_CHECK_LIMIT=10
MAX_STREAMS=3
MAX_CONCURRENCY=5
```

## Usage with systemd

The addon-server is designed to be deployed via the addon manager, which handles:
- Service file creation with environment variables
- SSL/HTTPS setup
- Auto-start on boot
- Log management

See the main project README for full deployment instructions.


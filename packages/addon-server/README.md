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

```bash
# Required
RD_API_TOKEN=your_real_debrid_api_token
ADDON_PASSWORD=your_password_here

# Optional - Server Configuration
PORT=7000
NODE_ENV=production

# Optional - Torrent Processing Configuration
TORRENT_LIMIT=15                    # Maximum torrents to process (range: 1-50, default: 15)
AVAILABILITY_CHECK_LIMIT=15         # Torrents to check for instant availability (range: 5-50, default: 15)
MAX_STREAMS=5                       # Maximum streams to return before stopping (range: 1-20, default: 5)
MAX_CONCURRENCY=3                   # Parallel torrent processing limit (range: 1-10, default: 3)
```

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


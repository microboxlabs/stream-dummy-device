# @streamhub/dummy-device

CLI tool for simulating IoT devices sending frames to StreamHub API.

## Installation

```bash
npm install -g @streamhub/dummy-device
```

Or run directly with npx:

```bash
npx @streamhub/dummy-device [options] <directory>
```

## Usage

```bash
dummy-device [options] <directory>
```

### Basic Example

```bash
# Send frames from directory every 5 seconds, 2 at a time
npx @streamhub/dummy-device -I 5 -s 2 ~/Documents/sample-frames --auth-token="<JWT>"
```

### With OAuth2 Client Credentials

```bash
npx @streamhub/dummy-device \
  -I 5 \
  -s 2 \
  --client-id="your-client-id" \
  --client-secret="your-client-secret" \
  --token-url="https://your-auth0-domain.auth0.com/oauth/token" \
  --audience="https://api.streamhub.io" \
  ~/Documents/sample-frames
```

### Using Environment File

```bash
npx @streamhub/dummy-device -e .env ~/Documents/sample-frames
```

## Options

| Option | Short | Description | Default |
|--------|-------|-------------|---------|
| `--interval <seconds>` | `-I` | Interval between frame batches | `5` |
| `--size <count>` | `-s` | Number of frames per batch | `1` |
| `--base-url <url>` | `-b` | StreamHub API base URL | `http://localhost:8080` |
| `--device-id <id>` | `-d` | Device identifier | `device-{timestamp}` |
| `--auth-token <token>` | `-t` | JWT authentication token | - |
| `--client-id <id>` | - | OAuth2 client ID | - |
| `--client-secret <secret>` | - | OAuth2 client secret | - |
| `--token-url <url>` | - | OAuth2 token endpoint URL | - |
| `--audience <audience>` | - | OAuth2 audience (for Auth0) | - |
| `--env-file <path>` | `-e` | Path to .env file | `.env` |
| `--loop` | `-l` | Loop through images indefinitely | `false` |
| `--verbose` | `-v` | Enable verbose logging | `false` |
| `--dry-run` | - | Simulate without HTTP requests | `false` |

## Environment Variables

All options can be set via environment variables:

| Variable | Description |
|----------|-------------|
| `STREAMHUB_INTERVAL` | Interval between batches (seconds) |
| `STREAMHUB_SIZE` | Number of frames per batch |
| `STREAMHUB_BASE_URL` | StreamHub API base URL |
| `STREAMHUB_DEVICE_ID` | Device identifier |
| `STREAMHUB_AUTH_TOKEN` | JWT authentication token |
| `STREAMHUB_CLIENT_ID` | OAuth2 client ID |
| `STREAMHUB_CLIENT_SECRET` | OAuth2 client secret |
| `STREAMHUB_TOKEN_URL` | OAuth2 token endpoint URL |
| `STREAMHUB_AUDIENCE` | OAuth2 audience |
| `STREAMHUB_LOOP` | Loop mode (`true`/`false`) |
| `STREAMHUB_VERBOSE` | Verbose logging (`true`/`false`) |
| `STREAMHUB_DRY_RUN` | Dry run mode (`true`/`false`) |

### Example .env file

```env
STREAMHUB_BASE_URL=https://api.streamhub.io
STREAMHUB_DEVICE_ID=my-device-001
STREAMHUB_INTERVAL=5
STREAMHUB_SIZE=2
STREAMHUB_CLIENT_ID=your-client-id
STREAMHUB_CLIENT_SECRET=your-client-secret
STREAMHUB_TOKEN_URL=https://your-domain.auth0.com/oauth/token
STREAMHUB_AUDIENCE=https://api.streamhub.io
```

## Frame Iteration

When the directory contains more images than the batch size, the tool iterates through them:

```
Directory: [img0.jpg, img1.jpg, img2.jpg, img3.jpg, img4.jpg] (5 images)
Batch size: 2

Batch 1: img0.jpg, img1.jpg
Batch 2: img2.jpg, img3.jpg
Batch 3: img4.jpg

With --loop: starts again from img0.jpg
```

## Supported Image Formats

- JPEG (`.jpg`, `.jpeg`)
- PNG (`.png`)
- GIF (`.gif`)
- WebP (`.webp`)
- BMP (`.bmp`)

## Programmatic Usage

```javascript
import { DummyDevice, loadConfig } from '@streamhub/dummy-device';

const config = loadConfig({
  interval: 5,
  size: 2,
  baseUrl: 'http://localhost:8080',
  deviceId: 'my-device',
  authToken: 'your-jwt-token',
  loop: true,
});

const device = new DummyDevice('/path/to/frames', config);

// Handle shutdown
process.on('SIGINT', () => device.stop());

await device.start();
```

## Development

```bash
# Clone repository
git clone https://github.com/microboxlabs/stream-dummy-device.git
cd stream-dummy-device

# Install dependencies
npm install

# Run in development mode
npm run dev -- ~/Documents/sample-frames --auth-token="test"

# Run with watch mode
npm run dev
```

## License

MIT


import fs from 'fs';
import chalk from 'chalk';

const EARTH_RADIUS_M = 6371000;

/**
 * Configuration for the track command - merges CLI options with environment variables
 */
export function loadTrackConfig(cliOptions) {
  return {
    trackUrl: cliOptions.trackUrl || process.env.STREAMHUB_TRACK_URL,
    assetId: cliOptions.assetId || process.env.STREAMHUB_ASSET_ID || `ASSET${Date.now() % 100000}`,
    interval: parseFloat(cliOptions.interval || process.env.STREAMHUB_INTERVAL || '5'),
    count: parseInt(cliOptions.count || process.env.STREAMHUB_COUNT || '10'),
    latitude: parseFloat(cliOptions.latitude ?? process.env.STREAMHUB_LATITUDE ?? '-33.4489'),
    longitude: parseFloat(cliOptions.longitude ?? process.env.STREAMHUB_LONGITUDE ?? '-70.6693'),
    speed: parseFloat(cliOptions.speed || process.env.STREAMHUB_SPEED || '50'),
    heading: parseFloat(cliOptions.heading ?? process.env.STREAMHUB_HEADING ?? '90'),
    route: cliOptions.route || process.env.STREAMHUB_ROUTE || null,
    authToken: cliOptions.authToken || process.env.STREAMHUB_AUTH_TOKEN,
    clientId: cliOptions.clientId || process.env.STREAMHUB_CLIENT_ID,
    clientSecret: cliOptions.clientSecret || process.env.STREAMHUB_CLIENT_SECRET,
    tokenUrl: cliOptions.tokenUrl || process.env.STREAMHUB_TOKEN_URL,
    audience: cliOptions.audience || process.env.STREAMHUB_AUDIENCE,
    loop: cliOptions.loop || process.env.STREAMHUB_LOOP === 'true',
    verbose: cliOptions.verbose || process.env.STREAMHUB_VERBOSE === 'true',
    dryRun: cliOptions.dryRun || process.env.STREAMHUB_DRY_RUN === 'true',
    panic: parsePanic(cliOptions.panic ?? process.env.STREAMHUB_PANIC),
  };
}

/**
 * The position numbers (1-based) whose frame has the panic button pressed, from "3" or "3,4,5".
 * Null when the option is not given: the frames then carry no panic button at all.
 */
export function parsePanic(value) {
  if (value === undefined || value === null || value === '') return null;
  return new Set(String(value).split(',').map((v) => parseInt(v.trim(), 10)));
}

export function validateTrackConfig(config) {
  const errors = [];
  if (!config.trackUrl) {
    errors.push('--track-url is required');
  }
  if (!config.dryRun && !config.authToken && !config.clientId) {
    errors.push('Either --auth-token or --client-id/--client-secret must be provided');
  }
  if (config.clientId && !config.clientSecret) {
    errors.push('--client-secret is required when using --client-id');
  }
  if (config.clientId && !config.tokenUrl) {
    errors.push('--token-url is required when using --client-id');
  }
  if (!(config.interval > 0)) {
    errors.push('--interval must be greater than 0');
  }
  if (!config.route && !(config.count >= 1)) {
    errors.push('--count must be at least 1');
  }
  if (config.panic && [...config.panic].some((n) => !(n >= 1))) {
    errors.push('--panic must be position numbers from 1, e.g. 3 or 3,4');
  }
  for (const key of ['latitude', 'longitude', 'speed', 'heading']) {
    if (Number.isNaN(config[key])) {
      errors.push(`--${key} must be a number`);
    }
  }
  return errors;
}

/**
 * The point `distance` metres from (lat, lon) along `heading` degrees.
 */
export function move(lat, lon, heading, distance) {
  const d = distance / EARTH_RADIUS_M;
  const h = (heading * Math.PI) / 180;
  const p1 = (lat * Math.PI) / 180;
  const l1 = (lon * Math.PI) / 180;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(h));
  const l2 = l1 + Math.atan2(Math.sin(h) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { latitude: (p2 * 180) / Math.PI, longitude: (l2 * 180) / Math.PI };
}

/**
 * Initial bearing in degrees from point a to point b.
 */
export function bearing(a, b) {
  const p1 = (a.latitude * Math.PI) / 180;
  const p2 = (b.latitude * Math.PI) / 180;
  const dl = ((b.longitude - a.longitude) * Math.PI) / 180;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/**
 * Reads a route file: a JSON array of [latitude, longitude] pairs or {latitude, longitude} objects,
 * or a GeoJSON LineString (coordinates are [longitude, latitude]).
 */
export function readRoute(file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const geometry = data.type === 'Feature' ? data.geometry : data;
  if (geometry && geometry.type === 'LineString') {
    return geometry.coordinates.map(([longitude, latitude]) => ({ latitude, longitude }));
  }
  if (!Array.isArray(data)) {
    throw new Error(`Route file ${file} is not an array or a GeoJSON LineString`);
  }
  return data.map((p) => (Array.isArray(p) ? { latitude: p[0], longitude: p[1] } : { latitude: p.latitude, longitude: p.longitude }));
}

/**
 * The positions to send: the route file's points, or `count` points along a straight line
 * at `speed` km/h, one per interval.
 */
export function buildPositions(config) {
  if (config.route) {
    const points = readRoute(config.route);
    let heading = config.heading;
    return points.map((p, i) => {
      if (i + 1 < points.length) heading = Math.round(bearing(p, points[i + 1]));
      return { ...p, heading, speed: config.speed };
    });
  }
  const step = (config.speed / 3.6) * config.interval;
  const positions = [];
  let point = { latitude: config.latitude, longitude: config.longitude };
  for (let i = 0; i < config.count; i++) {
    positions.push({ ...point, heading: config.heading, speed: config.speed });
    point = move(point.latitude, point.longitude, config.heading, step);
  }
  return positions;
}

/**
 * The request body of one position. With `panic` true or false the frame carries
 * `sensors.panic_button`; with `panic` undefined it has no sensors.
 */
export function trackPayload(assetId, position, timestamp, panic) {
  const payload = {
    asset_id: assetId,
    timestamp,
    gps: {
      latitude: Number(position.latitude.toFixed(6)),
      longitude: Number(position.longitude.toFixed(6)),
      speed: position.speed,
      heading: position.heading,
    },
  };
  if (panic !== undefined) payload.sensors = { panic_button: panic };
  return payload;
}

/**
 * Sends asset positions to a track endpoint (`POST /v1/asset/track` or `/api/v1/asset/track`).
 * Authorizes with a token or API key (`--auth-token`), or with OAuth2 client credentials.
 */
export class TrackDevice {
  constructor(config) {
    this.config = config;
    this.running = false;
    this.accessToken = config.authToken;
    this.tokenExpiry = null;
    this.stats = { sent: 0, accepted: 0, rejected: 0, startTime: null };
  }

  async start() {
    const errors = validateTrackConfig(this.config);
    if (errors.length > 0) {
      throw new Error(`Configuration errors:\n  - ${errors.join('\n  - ')}`);
    }
    const positions = buildPositions(this.config);
    if (positions.length === 0) {
      throw new Error('No positions to send');
    }
    if (this.config.clientId && !this.config.dryRun) {
      await this.refreshToken();
    }

    this.running = true;
    this.stats.startTime = Date.now();
    let index = 0;
    while (this.running) {
      await this.send(positions[index], index + 1);
      index++;
      if (index >= positions.length) {
        if (!this.config.loop) break;
        index = 0;
      }
      if (this.running) await this.sleep(this.config.interval * 1000);
    }
    this.running = false;
    this.printStats();
    return this.stats;
  }

  stop() {
    this.running = false;
  }

  async getToken() {
    if (this.config.clientId && this.tokenExpiry && Date.now() > this.tokenExpiry - 300000) {
      await this.refreshToken();
    }
    return this.accessToken;
  }

  /**
   * Client credentials grant with a JSON body, which both Auth0's /oauth/token and the
   * StreamHub login endpoint accept.
   */
  async refreshToken() {
    const { clientId, clientSecret, tokenUrl, audience } = this.config;
    const body = { grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret };
    if (audience) body.audience = audience;
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`Token request failed: ${response.status} - ${await response.text()}`);
    }
    const data = await response.json();
    if (!data.access_token) {
      throw new Error('Token response has no access_token');
    }
    this.accessToken = data.access_token;
    this.tokenExpiry = Date.now() + (data.expires_in || 3600) * 1000;
  }

  async send(position, number) {
    const now = new Date();
    const panic = this.config.panic ? this.config.panic.has(number) : undefined;
    const payload = trackPayload(this.config.assetId, position, now.toISOString(), panic);
    const label = `#${this.stats.sent + 1} ${payload.gps.latitude},${payload.gps.longitude}${panic ? ' PANIC' : ''}`;
    this.stats.sent++;

    if (this.config.dryRun) {
      console.log(chalk.gray(`[DRY RUN] ${label} ${JSON.stringify(payload)}`));
      this.stats.accepted++;
      return;
    }

    try {
      const response = await fetch(this.config.trackUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await this.getToken()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const text = await response.text();
      if (response.ok) {
        this.stats.accepted++;
        console.log(chalk.green(`✓ ${label} ${response.status}`) + chalk.gray(this.config.verbose ? ` ${text}` : ''));
      } else {
        this.stats.rejected++;
        console.log(chalk.red(`✗ ${label} ${response.status} ${text}`));
      }
      if (this.config.verbose && response.headers.get('x-request-id')) {
        console.log(chalk.gray(`   └─ X-Request-Id: ${response.headers.get('x-request-id')}`));
      }
    } catch (error) {
      this.stats.rejected++;
      console.log(chalk.red(`✗ ${label} ${error.message}`));
    }
  }

  printStats() {
    const duration = this.stats.startTime ? Math.round((Date.now() - this.stats.startTime) / 1000) : 0;
    console.log(chalk.gray('\n' + '─'.repeat(50)));
    console.log(chalk.white('  Positions sent: ') + chalk.green(this.stats.sent));
    console.log(chalk.white('  Accepted:       ') + chalk.green(this.stats.accepted));
    console.log(chalk.white('  Rejected:       ') + chalk.red(this.stats.rejected));
    console.log(chalk.white('  Duration:       ') + chalk.yellow(`${duration}s`));
    console.log(chalk.gray('─'.repeat(50)) + '\n');
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

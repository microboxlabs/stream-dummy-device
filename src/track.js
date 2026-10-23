import fs from 'fs';
import chalk from 'chalk';

const EARTH_RADIUS_M = 6371000;

/**
 * Options that only apply to generated positions, so they cannot be combined with --replay.
 */
const REPLAY_CONFLICTS = ['route', 'count', 'latitude', 'longitude', 'speed', 'heading'];

/**
 * Configuration for the track command - merges CLI options with environment variables.
 * `given` holds the generated-position options that were set, so --replay can reject them.
 */
export function loadTrackConfig(cliOptions) {
  const env = process.env;
  const replay = cliOptions.replay || env.STREAMHUB_REPLAY || null;
  const given = new Set();
  const pick = (key, envName, fallback) => {
    const value = cliOptions[key] ?? env[envName];
    if (value === undefined || value === '') return fallback;
    given.add(key);
    return value;
  };
  return {
    trackUrl: cliOptions.trackUrl || env.STREAMHUB_TRACK_URL,
    assetId: cliOptions.assetId || env.STREAMHUB_ASSET_ID || (replay ? null : `ASSET${Date.now() % 100000}`),
    interval: parseFloat(pick('interval', 'STREAMHUB_INTERVAL', '5')),
    count: parseInt(pick('count', 'STREAMHUB_COUNT', '10')),
    latitude: parseFloat(pick('latitude', 'STREAMHUB_LATITUDE', '-33.4489')),
    longitude: parseFloat(pick('longitude', 'STREAMHUB_LONGITUDE', '-70.6693')),
    speed: parseFloat(pick('speed', 'STREAMHUB_SPEED', '50')),
    heading: parseFloat(pick('heading', 'STREAMHUB_HEADING', '90')),
    route: pick('route', 'STREAMHUB_ROUTE', null),
    replay,
    speedup: parseFloat(cliOptions.speedup ?? env.STREAMHUB_SPEEDUP ?? '1'),
    maxGap: parseFloat(cliOptions.maxGap ?? env.STREAMHUB_MAX_GAP ?? '300'),
    keepTimestamps: cliOptions.keepTimestamps || env.STREAMHUB_KEEP_TIMESTAMPS === 'true',
    from: parsePointNumber(cliOptions.from ?? env.STREAMHUB_REPLAY_FROM),
    to: parsePointNumber(cliOptions.to ?? env.STREAMHUB_REPLAY_TO),
    given,
    authToken: cliOptions.authToken || env.STREAMHUB_AUTH_TOKEN,
    clientId: cliOptions.clientId || env.STREAMHUB_CLIENT_ID,
    clientSecret: cliOptions.clientSecret || env.STREAMHUB_CLIENT_SECRET,
    tokenUrl: cliOptions.tokenUrl || env.STREAMHUB_TOKEN_URL,
    audience: cliOptions.audience || env.STREAMHUB_AUDIENCE,
    loop: cliOptions.loop || env.STREAMHUB_LOOP === 'true',
    verbose: cliOptions.verbose || env.STREAMHUB_VERBOSE === 'true',
    dryRun: cliOptions.dryRun || env.STREAMHUB_DRY_RUN === 'true',
    panic: parsePanic(cliOptions.panic ?? env.STREAMHUB_PANIC),
  };
}

function parsePointNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  return Number(value);
}

/**
 * The position numbers (1-based) whose frame has the panic button pressed, from "3" or "3,4,5".
 * Null when the option is not given: the frames then carry no panic button at all.
 */
export function parsePanic(value) {
  if (value === undefined || value === null || value === '') return null;
  return new Set(String(value).split(',').map((v) => parseInt(v.trim(), 10)));
}

/**
 * Options that are accepted but have no effect.
 */
export function trackWarnings(config) {
  const warnings = [];
  if (config.replay && config.given?.has('interval')) {
    warnings.push('--interval is ignored with --replay: the recorded gaps set the pace (see --speedup)');
  }
  return warnings;
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
  if (config.panic && [...config.panic].some((n) => !(n >= 1))) {
    errors.push('--panic must be position numbers from 1, e.g. 3 or 3,4');
  }
  if (config.replay) {
    errors.push(...validateReplayConfig(config));
    return errors;
  }
  if (!(config.interval > 0)) {
    errors.push('--interval must be greater than 0');
  }
  if (!config.route && !(config.count >= 1)) {
    errors.push('--count must be at least 1');
  }
  for (const key of ['latitude', 'longitude', 'speed', 'heading']) {
    if (Number.isNaN(config[key])) {
      errors.push(`--${key} must be a number`);
    }
  }
  for (const key of ['from', 'to']) {
    if (config[key] != null) errors.push(`--${key} needs --replay`);
  }
  return errors;
}

function validateReplayConfig(config) {
  const errors = [];
  if (!config.assetId) {
    errors.push('--asset-id is required with --replay');
  }
  for (const key of REPLAY_CONFLICTS) {
    if (config.given?.has(key)) errors.push(`--${key} cannot be used with --replay`);
  }
  if (!(config.speedup > 0)) {
    errors.push('--speedup must be greater than 0');
  }
  if (!(config.maxGap >= 0)) {
    errors.push('--max-gap must be 0 or more seconds');
  }
  for (const key of ['from', 'to']) {
    if (config[key] != null && !(Number.isInteger(config[key]) && config[key] >= 1)) {
      errors.push(`--${key} must be a point number from 1`);
    }
  }
  if (config.from != null && config.to != null && config.to < config.from) {
    errors.push('--to must not be before --from');
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
 * Parses a recorded trip: NDJSON, one track payload per line. Blank lines are skipped.
 * Each point has its payload, its number (1-based, blank lines not counted) and its time in ms.
 */
export function parseReplay(text, file = 'replay file') {
  const points = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (line.trim() === '') return;
    const where = `${file} line ${i + 1}`;
    let payload;
    try {
      payload = JSON.parse(line);
    } catch (error) {
      throw new Error(`${where}: invalid JSON (${error.message})`);
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error(`${where}: not a JSON object`);
    }
    const time = typeof payload.timestamp === 'string' ? Date.parse(payload.timestamp) : NaN;
    if (Number.isNaN(time)) {
      throw new Error(`${where}: timestamp is missing or not an ISO date`);
    }
    const gps = payload.gps;
    if (!gps || !Number.isFinite(gps.latitude) || !Number.isFinite(gps.longitude)) {
      throw new Error(`${where}: gps.latitude and gps.longitude must be numbers`);
    }
    points.push({ number: points.length + 1, time, payload });
  });
  return points;
}

export function readReplay(file) {
  return parseReplay(fs.readFileSync(file, 'utf8'), file);
}

/**
 * The points from `from` to `to` (1-based, inclusive). Either end may be null.
 */
export function sliceReplay(points, from, to) {
  const first = from ?? 1;
  const last = to ?? points.length;
  if (first > points.length) {
    throw new Error(`--from ${first} is past the last point (${points.length})`);
  }
  if (last > points.length) {
    throw new Error(`--to ${last} is past the last point (${points.length})`);
  }
  return points.slice(first - 1, last);
}

/**
 * Milliseconds to wait for a recorded gap: the gap divided by `speedup`, at most `maxGap` seconds.
 * Points out of order wait nothing.
 */
export function replayWait(gapMs, speedup, maxGap) {
  return Math.min(Math.max(0, gapMs) / speedup, maxGap * 1000);
}

/**
 * The request body of a recorded point: the recorded payload with this asset id and `timestamp`.
 * With `panic` it also has `sensors.panic_button = true`; otherwise its sensors are unchanged.
 */
export function replayPayload(assetId, point, timestamp, panic) {
  const payload = { asset_id: assetId, timestamp, ...point.payload };
  payload.asset_id = assetId;
  payload.timestamp = timestamp;
  if (panic) payload.sensors = { ...point.payload.sensors, panic_button: true };
  return payload;
}

export function formatDuration(ms) {
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60);
  if (h) return `${h}h${String(m).padStart(2, '0')}m${s.padStart(2, '0')}s`;
  if (m) return `${m}m${s.padStart(2, '0')}s`;
  return `${s}s`;
}

/**
 * Sends asset positions to a track endpoint (`POST /v1/asset/track` or `/api/v1/asset/track`).
 * Authorizes with a token or API key (`--auth-token`), or with OAuth2 client credentials.
 * `options.now` and `options.sleep` replace the clock and the wait, for tests.
 */
export class TrackDevice {
  constructor(config, options = {}) {
    this.config = config;
    this.running = false;
    this.accessToken = config.authToken;
    this.tokenExpiry = null;
    this.now = options.now || Date.now;
    if (options.sleep) this.sleep = options.sleep;
    this.stats = { sent: 0, accepted: 0, rejected: 0, startTime: null, replayedMs: null };
  }

  async start() {
    const errors = validateTrackConfig(this.config);
    if (errors.length > 0) {
      throw new Error(`Configuration errors:\n  - ${errors.join('\n  - ')}`);
    }
    const points = this.config.replay
      ? sliceReplay(readReplay(this.config.replay), this.config.from, this.config.to)
      : buildPositions(this.config);
    if (points.length === 0) {
      throw new Error('No positions to send');
    }
    if (this.config.clientId && !this.config.dryRun) {
      await this.refreshToken();
    }

    this.running = true;
    this.stats.startTime = this.now();
    if (this.config.replay) {
      await this.replay(points);
    } else {
      await this.track(points);
    }
    this.running = false;
    this.printStats();
    return this.stats;
  }

  async track(positions) {
    let index = 0;
    while (this.running) {
      await this.send(positions[index], index + 1);
      index++;
      if (index >= positions.length) {
        if (!this.config.loop) break;
        index = 0;
      }
      if (this.running && !this.config.dryRun) await this.sleep(this.config.interval * 1000);
    }
  }

  /**
   * Sends the recorded points, waiting the recorded gaps. Timestamps are moved so the first point
   * is now and the recorded gaps stay; each loop continues from the last point sent.
   */
  async replay(points) {
    const { speedup, maxGap, keepTimestamps, dryRun, loop } = this.config;
    const span = points[points.length - 1].time - points[0].time;
    // Gap between the last point of a pass and the first point of the next one.
    const loopGap = points.length > 1 ? Math.max(0, points[1].time - points[0].time) : 1000;
    let offset = this.stats.startTime - points[0].time;
    this.stats.replayedMs = 0;
    let index = 0;
    while (this.running) {
      const point = points[index];
      const timestamp = keepTimestamps ? point.payload.timestamp : new Date(point.time + offset).toISOString();
      await this.sendReplay(point, timestamp);
      let gap;
      if (index + 1 < points.length) {
        gap = points[index + 1].time - point.time;
        index++;
      } else {
        if (!loop) break;
        gap = loopGap;
        offset += span + loopGap;
        index = 0;
      }
      if (this.running && !dryRun) await this.sleep(replayWait(gap, speedup, maxGap));
      if (this.running) this.stats.replayedMs += Math.max(0, gap);
    }
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
    if (this.wake) this.wake();
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
    const panic = this.config.panic ? this.config.panic.has(number) : undefined;
    const payload = trackPayload(this.config.assetId, position, new Date(this.now()).toISOString(), panic);
    await this.post(payload, `#${this.stats.sent + 1} ${payload.gps.latitude},${payload.gps.longitude}${panic ? ' PANIC' : ''}`);
  }

  async sendReplay(point, timestamp) {
    const panic = Boolean(this.config.panic && this.config.panic.has(point.number));
    const payload = replayPayload(this.config.assetId, point, timestamp, panic);
    const { latitude, longitude } = payload.gps;
    await this.post(payload, `#${this.stats.sent + 1} p${point.number} ${latitude},${longitude} ${timestamp}${panic ? ' PANIC' : ''}`);
  }

  async post(payload, label) {
    this.stats.sent++;

    if (this.config.dryRun) {
      console.log(chalk.gray(`[DRY RUN] ${label} ${JSON.stringify(payload)}`));
      this.stats.accepted++;
      // Dry runs do not wait, so yield here to let SIGINT and stop() run.
      await new Promise((resolve) => setTimeout(resolve, 0));
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
    const wall = this.stats.startTime ? this.now() - this.stats.startTime : 0;
    const replaying = this.stats.replayedMs !== null;
    console.log(chalk.gray('\n' + '─'.repeat(50)));
    console.log(chalk.white('  Positions sent: ') + chalk.green(this.stats.sent));
    console.log(chalk.white('  Accepted:       ') + chalk.green(this.stats.accepted));
    console.log(chalk.white('  Rejected:       ') + chalk.red(this.stats.rejected));
    if (replaying) {
      console.log(chalk.white('  Replayed span:  ') + chalk.yellow(formatDuration(this.stats.replayedMs)));
    }
    console.log(chalk.white(replaying ? '  Wall time:      ' : '  Duration:       ') + chalk.yellow(formatDuration(wall)));
    console.log(chalk.gray('─'.repeat(50)) + '\n');
  }

  sleep(ms) {
    return new Promise((resolve) => {
      this.wake = resolve;
      this.timer = setTimeout(resolve, ms);
    });
  }
}

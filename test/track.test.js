import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { TrackDevice, buildPositions, parsePanic, validateTrackConfig } from '../src/track.js';

function server(handler) {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        // No keep-alive, so close() does not wait on an idle connection.
        res.setHeader('connection', 'close');
        handler(req, body ? JSON.parse(body) : null, res);
      });
    });
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
}

const base = { interval: 0.01, count: 2, latitude: -33.4489, longitude: -70.6693, speed: 36, heading: 0, assetId: 'TEST01' };

test('gets a token with client credentials and sends each position with it', async () => {
  const seen = [];
  const s = await server((req, body, res) => {
    seen.push({ url: req.url, headers: req.headers, body });
    res.setHeader('content-type', 'application/json');
    if (req.url === '/token') {
      res.end(JSON.stringify({ access_token: 'jwt-1', expires_in: 3600 }));
    } else {
      res.end(JSON.stringify({ status: 'success' }));
    }
  });
  const url = `http://127.0.0.1:${s.address().port}`;
  const stats = await new TrackDevice({
    ...base, trackUrl: `${url}/v1/asset/track`, tokenUrl: `${url}/token`,
    clientId: 'cid', clientSecret: 'secret', audience: 'aud',
  }).start();
  s.close();

  assert.equal(stats.accepted, 2);
  assert.deepEqual(seen[0].body, { grant_type: 'client_credentials', client_id: 'cid', client_secret: 'secret', audience: 'aud' });
  assert.equal(seen[0].headers['content-type'], 'application/json');
  const track = seen.filter((r) => r.url === '/v1/asset/track');
  assert.equal(track.length, 2);
  assert.equal(track[0].headers.authorization, 'Bearer jwt-1');
  assert.equal(track[0].headers['x-request-id'], undefined, 'the gateway sets the request id');
  assert.equal(track[0].body.sensors, undefined, 'no panic button without --panic');
  assert.equal(track[0].body.asset_id, 'TEST01');
  assert.equal(track[0].body.gps.latitude, -33.4489);
  assert.ok(track[1].body.gps.latitude > track[0].body.gps.latitude, 'heading 0 moves north');
});

test('sends an API key as the bearer and counts rejected positions', async () => {
  const auth = [];
  const s = await server((req, body, res) => {
    auth.push(req.headers.authorization);
    res.statusCode = 403;
    res.end('{"status":"error"}');
  });
  const stats = await new TrackDevice({
    ...base, trackUrl: `http://127.0.0.1:${s.address().port}/api/v1/asset/track`, authToken: 'miot_sk_key',
  }).start();
  s.close();
  assert.deepEqual(auth, ['Bearer miot_sk_key', 'Bearer miot_sk_key']);
  assert.equal(stats.rejected, 2);
  assert.equal(stats.accepted, 0);
});

test('a GeoJSON route gives one position per point, heading toward the next', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'route-')), 'route.json');
  fs.writeFileSync(file, JSON.stringify({ type: 'LineString', coordinates: [[-70.0, -33.0], [-70.0, -32.9], [-69.9, -32.9]] }));
  const positions = buildPositions({ ...base, route: file });
  assert.deepEqual(positions.map((p) => [p.latitude, p.longitude]), [[-33.0, -70.0], [-32.9, -70.0], [-32.9, -69.9]]);
  assert.equal(positions[0].heading, 0);
  assert.equal(positions[1].heading, 90);
  assert.equal(positions[2].heading, 90);
});

test('requires a track URL and credentials', () => {
  assert.deepEqual(validateTrackConfig({ ...base }), [
    '--track-url is required',
    'Either --auth-token or --client-id/--client-secret must be provided',
  ]);
});

test('--panic presses the panic button on the given positions only', async () => {
  const bodies = [];
  const s = await server((req, body, res) => {
    bodies.push(body);
    res.end('{}');
  });
  const stats = await new TrackDevice({
    ...base, count: 4, panic: new Set([2, 3]),
    trackUrl: `http://127.0.0.1:${s.address().port}/v1/asset/track`, authToken: 'miot_sk_x',
  }).start();
  s.close();

  assert.equal(stats.accepted, 4);
  assert.deepEqual(bodies.map((b) => b.sensors.panic_button), [false, true, true, false]);
});

test('--panic takes position numbers from 1', () => {
  assert.deepEqual([...parsePanic('3, 4')], [3, 4]);
  assert.equal(parsePanic(undefined), null);
  assert.ok(validateTrackConfig({ ...base, dryRun: true, trackUrl: 'x', panic: parsePanic('0') })
    .some((e) => e.includes('--panic')));
});

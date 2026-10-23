import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  TrackDevice, loadTrackConfig, parseReplay, replayPayload, replayWait, sliceReplay, trackWarnings, validateTrackConfig,
} from '../src/track.js';

const T0 = Date.parse('2024-01-01T10:00:00.000Z');
const NOW = Date.parse('2026-05-05T12:00:00.000Z');

function line(seconds, extra = {}) {
  return JSON.stringify({
    timestamp: new Date(T0 + seconds * 1000).toISOString(),
    gps: { latitude: -33.4 + seconds / 1e5, longitude: -70.6, altitude: 500, speed: 40, heading: 90 },
    ...extra,
  });
}

function replayFile(lines) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'replay-')), 'trip.replay.ndjson');
  fs.writeFileSync(file, lines.join('\n') + '\n');
  return file;
}

/**
 * A device with a fake clock: sleep records each wait and moves the clock forward.
 * Sending goes through a captured post, so nothing leaves the process.
 */
function fakeDevice(config) {
  let clock = NOW;
  const waits = [];
  const sent = [];
  const device = new TrackDevice(
    { trackUrl: 'http://127.0.0.1:9/track', authToken: 'miot_sk_x', assetId: 'DEMO01', speedup: 1, maxGap: 300, ...config },
    { now: () => clock, sleep: async (ms) => { waits.push(ms); clock += ms; } },
  );
  device.post = async (payload) => {
    sent.push(payload);
    device.stats.sent++;
    device.stats.accepted++;
  };
  device.printStats = () => {};
  return { device, waits, sent };
}

test('parses NDJSON points and skips blank lines', () => {
  const points = parseReplay([line(0), '', '   ', line(3, { asset_id: 'OTHER' }), ''].join('\n'));
  assert.equal(points.length, 2);
  assert.deepEqual(points.map((p) => p.number), [1, 2]);
  assert.equal(points[1].time - points[0].time, 3000);
  assert.equal(points[1].payload.asset_id, 'OTHER');
});

test('an invalid line is an error naming its line number', () => {
  assert.throws(() => parseReplay([line(0), '', '{not json'].join('\n'), 'trip.ndjson'), /trip\.ndjson line 3: invalid JSON/);
  assert.throws(() => parseReplay([line(0), '{"gps":{"latitude":1,"longitude":2}}'].join('\n')), /line 2: timestamp/);
  assert.throws(() => parseReplay('{"timestamp":"2024-01-01T00:00:00Z","gps":{"latitude":"x"}}'), /line 1: gps/);
  assert.throws(() => parseReplay('[1,2]'), /line 1: not a JSON object/);
});

test('an invalid line fails before anything is sent', async () => {
  const { device, sent } = fakeDevice({ replay: replayFile([line(0), line(3), 'oops']) });
  await assert.rejects(device.start(), /line 3/);
  assert.equal(sent.length, 0);
});

test('the wait is the recorded gap divided by speedup, at most max-gap', () => {
  assert.equal(replayWait(3000, 1, 300), 3000);
  assert.equal(replayWait(3000, 4, 300), 750);
  assert.equal(replayWait(3600_000, 1, 300), 300_000);
  assert.equal(replayWait(3600_000, 10, 300), 300_000);
  assert.equal(replayWait(-2000, 1, 300), 0, 'points out of order do not wait');
});

test('moves timestamps so the first point is now and keeps the recorded gaps', async () => {
  const { device, waits, sent } = fakeDevice({ replay: replayFile([line(0), line(3), line(3603)]), speedup: 2 });
  const stats = await device.start();
  assert.deepEqual(sent.map((p) => p.timestamp), [
    new Date(NOW).toISOString(),
    new Date(NOW + 3000).toISOString(),
    new Date(NOW + 3603_000).toISOString(),
  ]);
  assert.deepEqual(waits, [1500, 300_000], 'gap / speedup, the one-hour stop capped at 300 s');
  assert.ok(sent.every((p) => p.asset_id === 'DEMO01'));
  assert.equal(stats.replayedMs, 3603_000);
});

test('--keep-timestamps sends the recorded timestamps and the rest of the payload as recorded', async () => {
  const lines = [line(0, { sensors: { engine_status: true }, events: { ignition: 'on' } }), line(3)];
  const { device, sent } = fakeDevice({ replay: replayFile(lines), keepTimestamps: true });
  await device.start();
  const recorded = JSON.parse(lines[0]);
  assert.deepEqual(sent[0], { ...recorded, asset_id: 'DEMO01' });
  assert.equal(sent[1].timestamp, new Date(T0 + 3000).toISOString());
});

test('--panic merges panic_button into the sensors of those points only', () => {
  const point = { number: 2, time: T0, payload: JSON.parse(line(0, { sensors: { engine_status: true } })) };
  assert.deepEqual(replayPayload('A', point, 'ts', true).sensors, { engine_status: true, panic_button: true });
  assert.deepEqual(replayPayload('A', point, 'ts', false).sensors, { engine_status: true });
  const bare = { number: 1, time: T0, payload: JSON.parse(line(0)) };
  assert.equal(replayPayload('A', bare, 'ts', false).sensors, undefined, 'no panic_button: false is added');
  assert.deepEqual(replayPayload('A', bare, 'ts', true).sensors, { panic_button: true });
  assert.equal(point.payload.sensors.panic_button, undefined, 'the recorded point is not changed');
});

test('--from/--to replay a slice; panic uses the point numbers in the file', async () => {
  const file = replayFile([line(0), line(3), line(6), line(9), line(12)]);
  const { device, sent, waits } = fakeDevice({ replay: file, from: 2, to: 4, panic: new Set([3]) });
  await device.start();
  assert.equal(sent.length, 3);
  assert.equal(sent[0].timestamp, new Date(NOW).toISOString(), 'the first point of the slice is now');
  assert.deepEqual(sent.map((p) => p.sensors?.panic_button), [undefined, true, undefined]);
  assert.deepEqual(waits, [3000, 3000]);
  assert.throws(() => sliceReplay([1, 2], 1, 3), /--to 3 is past the last point \(2\)/);
  assert.throws(() => sliceReplay([1, 2], 3, null), /--from 3/);
});

test('--loop continues the timestamps from the last point sent', async () => {
  const { device, sent } = fakeDevice({ replay: replayFile([line(0), line(5)]), loop: true });
  device.post = async (payload) => {
    sent.push(payload);
    device.stats.sent++;
    if (sent.length === 5) device.stop();
  };
  await device.start();
  assert.deepEqual(sent.map((p) => (Date.parse(p.timestamp) - NOW) / 1000), [0, 5, 10, 15, 20]);
});

test('--dry-run does not wait, in replay and in generated mode', async () => {
  const replay = fakeDevice({ replay: replayFile([line(0), line(60), line(120)]), dryRun: true });
  replay.device.post = TrackDevice.prototype.post;
  await replay.device.start();
  assert.deepEqual(replay.waits, []);
  assert.equal(replay.device.stats.sent, 3);

  const generated = fakeDevice({ count: 3, interval: 30, latitude: -33, longitude: -70, speed: 50, heading: 0, dryRun: true });
  generated.device.post = TrackDevice.prototype.post;
  await generated.device.start();
  assert.deepEqual(generated.waits, []);
  assert.equal(generated.device.stats.sent, 3);
});

test('--dry-run --loop can be stopped', { timeout: 5000 }, async () => {
  const replay = fakeDevice({ replay: replayFile([line(0), line(3)]), dryRun: true, loop: true });
  replay.device.post = TrackDevice.prototype.post;
  const log = console.log;
  console.log = () => {};
  try {
    setTimeout(() => replay.device.stop(), 20);
    await replay.device.start();
  } finally {
    console.log = log;
  }
  assert.ok(replay.device.stats.sent > 2);
});

test('stopping during a wait does not count that gap as replayed', async () => {
  const { device } = fakeDevice({ replay: replayFile([line(0), line(3), line(603)]) });
  let waits = 0;
  device.sleep = async () => {
    waits++;
    if (waits === 2) device.stop();
  };
  const stats = await device.start();
  assert.equal(stats.sent, 2);
  assert.equal(stats.replayedMs, 3000);
});

test('--replay conflicts with the generated-position options and needs --asset-id', () => {
  const saved = { ...process.env };
  for (const key of Object.keys(process.env)) if (key.startsWith('STREAMHUB_')) delete process.env[key];
  try {
    const cfg = loadTrackConfig({ trackUrl: 'x', dryRun: true, replay: 'trip.ndjson', route: 'r.json', count: '3', latitude: '1', longitude: '2', speed: '9', heading: '4' });
    assert.deepEqual(validateTrackConfig(cfg), [
      '--asset-id is required with --replay',
      '--route cannot be used with --replay',
      '--count cannot be used with --replay',
      '--latitude cannot be used with --replay',
      '--longitude cannot be used with --replay',
      '--speed cannot be used with --replay',
      '--heading cannot be used with --replay',
    ]);

    const ok = loadTrackConfig({ trackUrl: 'x', dryRun: true, replay: 'trip.ndjson', assetId: 'DEMO01', interval: '9' });
    assert.deepEqual(validateTrackConfig(ok), []);
    assert.equal(ok.speedup, 1);
    assert.equal(ok.maxGap, 300);
    assert.deepEqual(trackWarnings(ok), ['--interval is ignored with --replay: the recorded gaps set the pace (see --speedup)']);

    assert.deepEqual(validateTrackConfig({ ...ok, speedup: 0, maxGap: -1, from: 4, to: 2 }), [
      '--speedup must be greater than 0',
      '--max-gap must be 0 or more seconds',
      '--to must not be before --from',
    ]);
    assert.ok(validateTrackConfig({ ...ok, from: 0 }).includes('--from must be a point number from 1'));

    const generated = loadTrackConfig({ trackUrl: 'x', dryRun: true, from: '2' });
    assert.deepEqual(validateTrackConfig(generated), ['--from needs --replay']);

    process.env.STREAMHUB_REPLAY = 'env.ndjson';
    process.env.STREAMHUB_SPEEDUP = '8';
    process.env.STREAMHUB_MAX_GAP = '30';
    process.env.STREAMHUB_REPLAY_FROM = '5';
    process.env.STREAMHUB_REPLAY_TO = '9';
    process.env.STREAMHUB_KEEP_TIMESTAMPS = 'true';
    const fromEnv = loadTrackConfig({});
    assert.deepEqual(
      [fromEnv.replay, fromEnv.speedup, fromEnv.maxGap, fromEnv.from, fromEnv.to, fromEnv.keepTimestamps],
      ['env.ndjson', 8, 30, 5, 9, true],
    );
  } finally {
    for (const key of Object.keys(process.env)) if (key.startsWith('STREAMHUB_')) delete process.env[key];
    Object.assign(process.env, saved);
  }
});

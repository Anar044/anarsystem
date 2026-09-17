import http from 'node:http';
import { createHash } from 'node:crypto';
import { mkdir, readFile, appendFile, writeFile, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(__dirname, '..');
const configPath = resolve(process.env.ZKTECO_CONFIG || `${projectDir}/config.json`);

function clean(v) { return String(v ?? '').trim(); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}
function text(res, status, body = 'OK') {
  const value = String(body);
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(value),
    'Cache-Control': 'no-store'
  });
  res.end(value);
}
async function readBody(req, maxBytes = 2 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('Request body too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function loadConfig() {
  const raw = await readFile(configPath, 'utf8').catch(() => null);
  if (!raw) {
    throw new Error(`Config not found: ${configPath}. Copy config.example.json to config.json and fill deviceToken.`);
  }
  const cfg = JSON.parse(raw);
  cfg.listen ??= {};
  cfg.listen.host ??= '0.0.0.0';
  cfg.listen.port ??= 8088;
  cfg.smartHoreca ??= {};
  cfg.smartHoreca.baseUrl ??= 'https://smarthoreca.pages.dev';
  cfg.smartHoreca.ingestPath ??= '/api/hr/device-ingest';
  cfg.smartHoreca.requestTimeoutMs ??= 15000;
  cfg.attendance ??= {};
  cfg.attendance.utcOffset ??= '+04:00';
  cfg.attendance.flushIntervalMs ??= 5000;
  cfg.attendance.maxBatchSize ??= 200;
  cfg.storage ??= {};
  cfg.storage.queueFile ??= './data/pending-events.jsonl';
  cfg.storage.logFile ??= './data/connector.log';
  cfg.simulation ??= {};
  cfg.simulation.enabled ??= false;
  cfg.devices ??= {};
  return cfg;
}

const config = await loadConfig();
const queueFile = resolve(projectDir, config.storage.queueFile);
const logFile = resolve(projectDir, config.storage.logFile);
await mkdir(dirname(queueFile), { recursive: true });
await mkdir(dirname(logFile), { recursive: true });

async function log(level, message, meta = null) {
  const line = `${new Date().toISOString()} [${level}] ${message}${meta ? ` ${JSON.stringify(meta)}` : ''}`;
  console.log(line);
  await appendFile(logFile, `${line}\n`).catch(() => {});
}

function deviceBySerial(serial) {
  const key = clean(serial);
  const device = config.devices[key];
  if (!device || device.enabled === false) return null;
  return { serial: key, ...device };
}

function normalizeTimestamp(value) {
  const raw = clean(value);
  if (!raw) return '';
  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime()) && /(?:Z|[+-]\d\d:?\d\d)$/i.test(raw)) return direct.toISOString();
  const normalized = raw.replace(' ', 'T');
  const withOffset = `${normalized}${config.attendance.utcOffset}`;
  const d = new Date(withOffset);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

function attendanceDirection(status) {
  const s = clean(status).toUpperCase();
  if (['0', 'IN', 'ENTRY', 'CHECKIN', '3', '4'].includes(s)) return 'IN';
  if (['1', 'OUT', 'EXIT', 'CHECKOUT', '2', '5'].includes(s)) return 'OUT';
  return 'UNKNOWN';
}

function verifyMethod(value) {
  const s = clean(value).toUpperCase();
  const map = {
    '0': 'PASSWORD',
    '1': 'FINGERPRINT',
    '2': 'CARD',
    '3': 'PASSWORD',
    '4': 'CARD',
    '15': 'FACE',
    '20': 'FACE'
  };
  return map[s] || (s || 'UNKNOWN');
}

function sourceId(serial, pin, timestamp, status, verify, rawLine) {
  return createHash('sha256')
    .update(`${serial}|${pin}|${timestamp}|${status}|${verify}|${rawLine}`)
    .digest('hex');
}

function parseKeyValueLine(line) {
  const result = {};
  for (const part of line.split(/\t+/)) {
    const idx = part.indexOf('=');
    if (idx > 0) result[part.slice(0, idx).trim().toUpperCase()] = part.slice(idx + 1).trim();
  }
  return result;
}

function parseAttendanceLine(serial, line) {
  const rawLine = clean(line);
  if (!rawLine) return null;

  const kv = parseKeyValueLine(rawLine);
  let pin = clean(kv.PIN || kv.USERID || kv.USER || kv.ENROLLNUMBER);
  let time = clean(kv.TIME || kv.DATETIME || kv.CHECKTIME);
  let status = clean(kv.STATUS || kv.ATTSTATE || kv.STATE);
  let verify = clean(kv.VERIFY || kv.VERIFYTYPE || kv.VERIFYMODE);
  let workCode = clean(kv.WORKCODE);

  if (!pin || !time) {
    const parts = rawLine.split('\t').map(clean);
    pin ||= parts[0];
    time ||= parts[1];
    status ||= parts[2];
    verify ||= parts[3];
    workCode ||= parts[4];
  }

  if (!pin || !time) return null;
  const timestamp = normalizeTimestamp(time);
  if (!timestamp) return null;
  const type = attendanceDirection(status);

  return {
    externalEmployeeId: pin,
    timestamp,
    type,
    sourceId: sourceId(serial, pin, timestamp, status, verify, rawLine),
    verifyMethod: verifyMethod(verify),
    attendanceStatus: status,
    workCode,
    deviceSerial: serial,
    rawLine
  };
}

function parseAttendance(serial, body) {
  const events = [];
  let invalid = 0;
  for (const line of String(body || '').split(/\r?\n/)) {
    if (!clean(line)) continue;
    const event = parseAttendanceLine(serial, line);
    if (event) events.push(event);
    else invalid++;
  }
  return { events, invalid };
}

let queue = [];
let flushing = false;

async function loadQueue() {
  const raw = await readFile(queueFile, 'utf8').catch(() => '');
  queue = raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean);
  if (queue.length) await log('INFO', 'Loaded pending events', { count: queue.length });
}

async function persistQueue() {
  const tmp = `${queueFile}.tmp`;
  const content = queue.length ? `${queue.map(x => JSON.stringify(x)).join('\n')}\n` : '';
  await writeFile(tmp, content, 'utf8');
  await rename(tmp, queueFile);
}

async function enqueue(serial, events) {
  if (!events.length) return;
  const receivedAt = new Date().toISOString();
  const rows = events.map(event => ({ serial, event, receivedAt }));
  queue.push(...rows);
  await appendFile(queueFile, `${rows.map(x => JSON.stringify(x)).join('\n')}\n`, 'utf8');
}

function ingestUrl() {
  return new URL(config.smartHoreca.ingestPath, config.smartHoreca.baseUrl).toString();
}

async function sendBatch(device, rows) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(config.smartHoreca.requestTimeoutMs) || 15000);
  try {
    const response = await fetch(ingestUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${device.deviceToken}`,
        'X-SH-Connector': 'zkteco/0.1.0'
      },
      body: JSON.stringify({ events: rows.map(x => x.event) }),
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.success !== true) {
      throw new Error(`SmartHoreca ingest failed: HTTP ${response.status} ${data?.message || ''}`.trim());
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function flushQueue() {
  if (flushing || !queue.length) return;
  flushing = true;
  try {
    const serials = [...new Set(queue.map(x => x.serial))];
    for (const serial of serials) {
      const device = deviceBySerial(serial);
      if (!device?.deviceToken) {
        await log('WARN', 'No SmartHoreca token for queued device', { serial });
        continue;
      }
      const maxBatch = Math.max(1, Math.min(1000, Number(config.attendance.maxBatchSize) || 200));
      const candidates = queue.filter(x => x.serial === serial).slice(0, maxBatch);
      if (!candidates.length) continue;
      try {
        const result = await sendBatch(device, candidates);
        const ids = new Set(candidates.map(x => x.event.sourceId));
        queue = queue.filter(x => !(x.serial === serial && ids.has(x.event.sourceId)));
        await persistQueue();
        await log('INFO', 'Attendance batch delivered', {
          serial,
          model: device.model || '',
          sent: candidates.length,
          matched: result.matched,
          unmatched: result.unmatched,
          pending: queue.length
        });
      } catch (error) {
        await log('WARN', 'Attendance delivery postponed', { serial, error: error?.message || String(error) });
      }
    }
  } finally {
    flushing = false;
  }
}

function admsOptions(serial) {
  return [
    `GET OPTION FROM: ${serial}`,
    'Stamp=9999',
    'OpStamp=9999',
    'PhotoStamp=9999',
    'ErrorDelay=60',
    'Delay=10',
    'TransTimes=00:00;14:05',
    'TransInterval=1',
    'TransFlag=1111000000',
    'Realtime=1',
    'Encrypt=0'
  ].join('\n');
}

async function handleCdata(req, res, url) {
  const serial = clean(url.searchParams.get('SN') || url.searchParams.get('sn'));
  if (!serial) return text(res, 400, 'ERROR: missing SN');
  const device = deviceBySerial(serial);
  if (!device) {
    await log('WARN', 'Unknown or disabled ZKTeco device contacted connector', { serial, path: url.pathname });
    return text(res, 403, 'ERROR: device not configured');
  }

  if (req.method === 'GET') {
    await log('INFO', 'ZKTeco device registered', { serial, model: device.model || '', name: device.name || '' });
    return text(res, 200, admsOptions(serial));
  }

  const table = clean(url.searchParams.get('table')).toUpperCase();
  const body = await readBody(req);
  if (table === 'ATTLOG' || (!table && body)) {
    const { events, invalid } = parseAttendance(serial, body);
    await enqueue(serial, events);
    await log('INFO', 'Attendance received from ZKTeco', {
      serial,
      table: table || 'ATTLOG',
      received: events.length,
      invalid,
      pending: queue.length
    });
    void flushQueue();
    return text(res, 200, `OK: ${events.length}`);
  }

  await log('INFO', 'ZKTeco data packet received', { serial, table: table || 'UNKNOWN', bytes: Buffer.byteLength(body) });
  return text(res, 200, 'OK');
}

async function handleSimulate(req, res) {
  if (!config.simulation.enabled) return json(res, 404, { success: false, message: 'Simulation disabled' });
  const raw = await readBody(req);
  const body = JSON.parse(raw || '{}');
  const serial = clean(body.serial);
  const device = deviceBySerial(serial);
  if (!device) return json(res, 400, { success: false, message: 'Unknown serial' });
  const timestamp = normalizeTimestamp(body.timestamp || new Date().toISOString());
  const event = {
    externalEmployeeId: clean(body.externalEmployeeId || body.employeeId || '1'),
    timestamp,
    type: attendanceDirection(body.type || 'IN'),
    sourceId: sourceId(serial, clean(body.externalEmployeeId || body.employeeId || '1'), timestamp, clean(body.type || 'IN'), 'SIM', JSON.stringify(body)),
    verifyMethod: clean(body.verifyMethod || 'FACE'),
    attendanceStatus: clean(body.type || 'IN'),
    workCode: '',
    deviceSerial: serial,
    simulated: true
  };
  await enqueue(serial, [event]);
  await flushQueue();
  return json(res, 200, { success: true, event, pending: queue.length });
}

await loadQueue();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname === '/health') {
      return json(res, 200, {
        success: true,
        service: 'SmartHoreca ZKTeco Connector',
        version: '0.1.0',
        pendingEvents: queue.length,
        configuredDevices: Object.keys(config.devices).filter(sn => config.devices[sn]?.enabled !== false).length,
        now: new Date().toISOString()
      });
    }
    if (url.pathname === '/iclock/cdata' && ['GET', 'POST'].includes(req.method)) return await handleCdata(req, res, url);
    if (url.pathname === '/iclock/getrequest' && req.method === 'GET') return text(res, 200, 'OK');
    if (url.pathname === '/iclock/devicecmd' && req.method === 'POST') {
      const body = await readBody(req);
      await log('INFO', 'ZKTeco command result received', { serial: clean(url.searchParams.get('SN')), body: body.slice(0, 2000) });
      return text(res, 200, 'OK');
    }
    if (url.pathname === '/simulate' && req.method === 'POST') return await handleSimulate(req, res);
    return text(res, 404, 'Not found');
  } catch (error) {
    await log('ERROR', 'Request failed', { error: error?.stack || error?.message || String(error) });
    return text(res, 500, 'ERROR');
  }
});

const host = config.listen.host;
const port = Number(config.listen.port) || 8088;
server.listen(port, host, async () => {
  await log('INFO', 'SmartHoreca ZKTeco Connector started', {
    listen: `${host}:${port}`,
    ingest: ingestUrl(),
    devices: Object.keys(config.devices).length,
    queueFile
  });
});

setInterval(() => void flushQueue(), Math.max(1000, Number(config.attendance.flushIntervalMs) || 5000)).unref();

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await log('INFO', `Stopping connector (${signal})`, { pending: queue.length });
    server.close();
    await persistQueue().catch(() => {});
    await sleep(50);
    process.exit(0);
  });
}

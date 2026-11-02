import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { DIVISIONS } from '../../integration/combine.mjs';
import { createApp } from '../src/app.js';
import { openDatabase } from '../src/db.js';

const apiKey = 'a'.repeat(32);
const ingestKey = 'b'.repeat(32);
const generatedAt = '2026-11-02T06:00:00.000Z';
const weather = { source: 'seasonal', tempMaxC: 7, tempMinC: 2, precipMm: 1, rainChancePct: 40, weatherCode: null };
const snapshot = {
  generatedAt,
  failedSources: ['scotland:climate'],
  divisions: DIVISIONS.map((entry) => ({
    ...entry,
    holidays: [
      { date: '2026-08-31', title: 'Past', notes: '', bunting: true, weather },
      { date: '2026-12-25', title: 'Christmas Day', notes: '', bunting: true, weather },
    ],
  })),
};
const countryXml = `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>
<m:FullCountryInfoResponse xmlns:m="x"><m:FullCountryInfoResult><m:sISOCode>GB</m:sISOCode><m:sName>United Kingdom</m:sName><m:sCapitalCity>London</m:sCapitalCity>
<m:sPhoneCode>44</m:sPhoneCode><m:sContinentCode>EU</m:sContinentCode><m:sCurrencyISOCode>GBP</m:sCurrencyISOCode>
<m:Languages><m:tLanguage><m:sName>English</m:sName></m:tLanguage></m:Languages></m:FullCountryInfoResult></m:FullCountryInfoResponse></soap:Body></soap:Envelope>`;

let db, server, base, soapReply, clock;

async function start(limit = 1000) {
  db = openDatabase(':memory:');
  const config = { apiKey, ingestKey, corsOrigins: ['http://allowed.test'], rateLimitPerMinute: limit };
  const fetchImpl = async () => new Response(soapReply);
  const app = createApp({ db, config, fetchImpl, now: () => clock });
  server = await new Promise((resolve) => {
    const listening = app.listen(0, () => resolve(listening));
  });
  base = `http://localhost:${server.address().port}`;
}

function stop() {
  server.close();
  db.close();
}

const get = (path, headers = { 'X-API-Key': apiKey }) => fetch(base + path, { headers });
const ingest = (body, key = ingestKey) =>
  fetch(`${base}/api/v1/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': key },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

before(() => start());
after(stop);
beforeEach(() => {
  clock = new Date('2026-11-02T12:00:00Z');
  soapReply = countryXml;
});

test('rejects missing and wrong API keys', async () => {
  assert.equal((await get('/api/v1/holidays', {})).status, 401);
  assert.equal((await get('/api/v1/holidays', { 'X-API-Key': 'wrong' })).status, 401);
});

test('keys are not interchangeable', async () => {
  assert.equal((await ingest(snapshot, apiKey)).status, 401);
  assert.equal((await get('/api/v1/holidays', { 'X-API-Key': ingestKey })).status, 401);
});

test('explains that there is no data before the first ingest', async () => {
  const fresh = openDatabase(':memory:');
  const config = { apiKey, ingestKey, corsOrigins: [], rateLimitPerMinute: 1000 };
  const listening = await new Promise((resolve) => {
    const instance = createApp({ db: fresh, config }).listen(0, () => resolve(instance));
  });
  const response = await fetch(`http://localhost:${listening.address().port}/ui/holidays`);
  assert.equal(response.status, 503);
  listening.close();
  fresh.close();
});

test('ingest validates the body and stores a good snapshot', async () => {
  assert.equal((await ingest('{not json')).status, 400);
  assert.equal((await ingest({ ...snapshot, extra: true })).status, 400);
  const badDate = structuredClone(snapshot);
  badDate.divisions[0].holidays[0].date = '2026-13-45';
  assert.equal((await ingest(badDate)).status, 400);
  const response = await ingest(snapshot);
  assert.equal(response.status, 201);
  assert.equal((await response.json()).stored, 6);
});

test('serves future holidays with a computed countdown', async () => {
  await ingest(snapshot);
  const body = await (await get('/api/v1/holidays?division=scotland&limit=3')).json();
  assert.equal(body.division, 'scotland');
  assert.equal(body.count, 1);
  assert.equal(body.holidays[0].daysUntil, 53);
  assert.equal(body.holidays[0].bunting, true);
  assert.equal(body.degraded, true);
  assert.equal(body.stale, false);
});

test('flags data older than 48 hours as stale', async () => {
  await ingest(snapshot);
  clock = new Date('2026-11-05T12:00:00Z');
  assert.equal((await (await get('/api/v1/holidays')).json()).stale, true);
});

test('rejects invalid query parameters', async () => {
  for (const query of ['division=wales', 'limit=0', 'limit=11', 'limit=abc', 'from=tomorrow', 'other=1']) {
    assert.equal((await get(`/api/v1/holidays?${query}`)).status, 400, query);
  }
});

test('the page route works without a key and only reads', async () => {
  await ingest(snapshot);
  assert.equal((await get('/ui/holidays', {})).status, 200);
  assert.equal((await fetch(`${base}/ui/holidays`, { method: 'POST' })).status, 404);
});

test('CORS only allows configured origins', async () => {
  const allowed = await get('/api/v1/holidays', { 'X-API-Key': apiKey, Origin: 'http://allowed.test' });
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://allowed.test');
  const denied = await get('/api/v1/holidays', { 'X-API-Key': apiKey, Origin: 'http://evil.test' });
  assert.equal(denied.headers.get('access-control-allow-origin'), null);
});

test('sets security headers and hides Express', async () => {
  const response = await get('/health', {});
  assert.equal(response.headers.get('x-powered-by'), null);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
});

test('turns the SOAP service into JSON', async () => {
  const response = await get('/api/v1/countries/gb');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    code: 'GB', name: 'United Kingdom', capital: 'London', continentCode: 'EU', currencyCode: 'GBP', phoneCode: '44', languages: ['English'],
  });
});

test('maps SOAP failures to HTTP errors', async () => {
  assert.equal((await get('/api/v1/countries/G1')).status, 400);
  assert.equal((await get('/api/v1/countries/%3Cx%3E')).status, 400);
  soapReply = `<soap:Envelope xmlns:soap="s"><soap:Body><m:FullCountryInfoResponse xmlns:m="x"><m:FullCountryInfoResult><m:sISOCode></m:sISOCode><m:sName>Country not found in the database</m:sName><m:Languages></m:Languages></m:FullCountryInfoResult></m:FullCountryInfoResponse></soap:Body></soap:Envelope>`;
  assert.equal((await get('/api/v1/countries/ZZ')).status, 404);
  soapReply = `<soap:Envelope xmlns:soap="s"><soap:Body><soap:Fault><faultstring>boom</faultstring></soap:Fault></soap:Body></soap:Envelope>`;
  assert.equal((await get('/api/v1/countries/GB')).status, 502);
  soapReply = '<html>maintenance</html>';
  assert.equal((await get('/api/v1/countries/GB')).status, 502);
});

test('rate limits before checking the key', async () => {
  stop();
  await start(2);
  await get('/api/v1/holidays', {});
  await get('/api/v1/holidays', {});
  const limited = await get('/api/v1/holidays', {});
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('content-type'), 'application/problem+json; charset=utf-8');
});

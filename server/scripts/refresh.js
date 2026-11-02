// Script equivalent of the n8n flow: same sources, same join, same ingest endpoint.
import { setTimeout as wait } from 'node:timers/promises';
import { DIVISIONS, HOLIDAYS_URL, buildSnapshot, londonDate, weatherUrls } from '../../integration/combine.mjs';
import { loadConfig } from '../src/config.js';

const RETRIES = 3;
const RETRY_DELAY_MS = 2000;
const config = loadConfig();

async function fetchJson(url, timeoutMs) {
  let lastError;
  for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
    if (attempt > 1) await wait(RETRY_DELAY_MS);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (response.ok) return await response.json();
      lastError = new Error(`HTTP ${response.status}`);
      if (response.status < 500 && response.status !== 429) break;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`${new URL(url).host}: ${lastError.message}`);
}

const now = new Date();
const today = londonDate(now);
const bankHolidays = await fetchJson(HOLIDAYS_URL, 15_000);

const weather = {};
await Promise.all(
  DIVISIONS.map(async (entry) => {
    const urls = weatherUrls(entry, today);
    const [forecast, climate, seasonal] = await Promise.allSettled([
      fetchJson(urls.forecastUrl, 15_000),
      fetchJson(urls.climateUrl, 15_000),
      fetchJson(urls.seasonalUrl, 15_000),
    ]);
    weather[entry.division] = { forecast: forecast.value, climate: climate.value, seasonal: seasonal.value };
  }),
);

const snapshot = buildSnapshot({ bankHolidays, weather, now });
const response = await fetch(`http://localhost:${config.port}/api/v1/ingest`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-API-Key': config.ingestKey },
  body: JSON.stringify(snapshot),
});
console.log(response.status, await response.text());
if (!response.ok) process.exit(1);

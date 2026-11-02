import { createHash, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { DIVISIONS, londonDate } from '../../integration/combine.mjs';
import { CountryNotFound, UpstreamError, fetchCountry } from './soap.js';
import { countryCode, holidaysQuery, snapshot } from './validation.js';

const STALE_AFTER_MS = 48 * 60 * 60 * 1000;
const webBuild = fileURLToPath(new URL('../../web/dist', import.meta.url));

function problem(res, status, title, detail) {
  res.status(status).type('application/problem+json').json({ title, status, detail });
}

function sha256(value) {
  return createHash('sha256').update(value).digest();
}

function requireKey(expected) {
  const expectedHash = sha256(expected);
  return (req, res, next) => {
    if (timingSafeEqual(sha256(req.get('X-API-Key') ?? ''), expectedHash)) return next();
    problem(res, 401, 'Unauthorized', 'A valid X-API-Key header is required.');
  };
}

function limiter(limit, windowMs = 60_000) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (req, res) => problem(res, 429, 'Too Many Requests', 'Rate limit exceeded. Try again shortly.'),
  });
}

function toHoliday(row, today) {
  return {
    date: row.date,
    title: row.title,
    notes: row.notes,
    bunting: row.bunting === 1,
    daysUntil: Math.round((Date.parse(row.date) - Date.parse(today)) / 86_400_000),
    weather: {
      source: row.weather_source,
      tempMaxC: row.temp_max_c,
      tempMinC: row.temp_min_c,
      precipMm: row.precip_mm,
      rainChancePct: row.rain_chance_pct,
      weatherCode: row.weather_code,
    },
  };
}

export function createApp({ db, config, fetchImpl = fetch, now = () => new Date() }) {
  const app = express();
  app.use(helmet());

  const listHolidays = (req, res) => {
    const parsed = holidaysQuery.safeParse(req.query);
    if (!parsed.success) return problem(res, 400, 'Invalid query', parsed.error.issues.map((issue) => `${issue.path.join('.') || 'query'}: ${issue.message}`).join('; '));

    const run = db.latestRun();
    if (!run) return problem(res, 503, 'No data yet', 'Run the n8n workflow or `npm run refresh` to load data.');

    const { division, limit, from } = parsed.data;
    const today = londonDate(now());
    const { label, location } = DIVISIONS.find((entry) => entry.division === division);
    const holidays = db.holidays(division, from ?? today, limit).map((row) => toHoliday(row, today));
    const failedSources = JSON.parse(run.failed_sources);
    res.json({
      division,
      label,
      location,
      updatedAt: run.generated_at,
      stale: now() - Date.parse(run.generated_at) > STALE_AFTER_MS,
      degraded: failedSources.length > 0,
      count: holidays.length,
      holidays,
    });
  };

  app.get('/health', (req, res) => res.json({ status: 'ok' }));

  const api = express.Router();
  api.use(cors({ origin: config.corsOrigins, methods: ['GET', 'POST'], allowedHeaders: ['X-API-Key', 'Content-Type'] }));
  api.use(limiter(config.rateLimitPerMinute));

  api.post('/ingest', requireKey(config.ingestKey), express.json({ limit: '256kb' }), (req, res) => {
    const parsed = snapshot.safeParse(req.body);
    if (!parsed.success) return problem(res, 400, 'Invalid snapshot', parsed.error.issues.slice(0, 5).map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '));
    const stored = db.saveSnapshot(parsed.data, now().toISOString());
    res.status(201).json({ stored, failedSources: parsed.data.failedSources });
  });

  api.use(requireKey(config.apiKey));
  api.get('/holidays', listHolidays);
  api.get('/countries/:code', async (req, res, next) => {
    const code = countryCode.safeParse(req.params.code);
    if (!code.success) return problem(res, 400, 'Invalid country code', code.error.issues[0].message);
    try {
      res.json(await fetchCountry(code.data, fetchImpl));
    } catch (error) {
      if (error instanceof CountryNotFound) return problem(res, 404, 'Country not found', `No country with code ${code.data}.`);
      if (error instanceof UpstreamError) return problem(res, 502, 'Upstream SOAP service failed', error.message);
      next(error);
    }
  });
  app.use('/api/v1', api);

  // Same-origin read-only route for the page, so no API key ships in browser JavaScript.
  app.get('/ui/holidays', limiter(config.rateLimitPerMinute), listHolidays);

  if (existsSync(webBuild)) app.use(express.static(webBuild));

  app.use((req, res) => problem(res, 404, 'Not Found', `No route for ${req.method} ${req.path}.`));
  app.use((error, req, res, next) => {
    if (error.type === 'entity.parse.failed') return problem(res, 400, 'Invalid JSON', 'The request body is not valid JSON.');
    if (error.type === 'entity.too.large') return problem(res, 413, 'Payload Too Large', 'The request body is too large.');
    console.error(error);
    problem(res, 500, 'Internal Server Error', 'Something went wrong.');
  });
  return app;
}

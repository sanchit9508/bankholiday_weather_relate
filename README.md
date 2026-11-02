# Bank Holiday Planner

A small integration project: it pulls UK bank holidays and weather from public APIs, joins them in an n8n flow, stores the result in SQLite, serves it from a secured Express API, and shows it in a React dashboard.

```
gov.uk ───────────────┐
Open-Meteo forecast ──┤                  POST /api/v1/ingest      ┌──────────┐
Open-Meteo archive ───┼─► n8n (06:00 daily) ───────────────────► │ Express  │ ◄── React page (/ui/holidays)
Open-Meteo seasonal ──┘                                           │ + SQLite │ ◄── API clients (/api/v1, X-API-Key)
                                                                  └────┬─────┘
SOAP country service ◄──────────── GET /api/v1/countries/:code ────────┘
```

## Skills shown

| Area | Where |
|---|---|
| Low-code integration | [n8n/bank-holiday-planner.workflow.json](n8n/bank-holiday-planner.workflow.json): schedule, retries, fan-out per nation, join, error branches |
| REST API | [server/src/app.js](server/src/app.js): query filters, problem+json errors, 201/400/401/404/429/502/503 responses |
| Data | [server/src/db.js](server/src/db.js): SQLite with transactional replace and an ingest audit table |
| Front end | [web/src](web/src): loading, error, empty and stale states; light and dark; phone layout |
| API testing | [postman](postman): 14 requests and 33 assertions, plus `server/test` (20 Node tests) |
| Security | API keys, input validation, rate limiting, CORS allowlist, Helmet headers |
| SOAP to JSON | [server/src/soap.js](server/src/soap.js): wraps a public SOAP country service as REST |

## Run it

Needs Node 22.13 or newer.

```bash
npm install
```

```bash
cp .env.example .env
```

Set `PLANNER_API_KEY` and `PLANNER_INGEST_KEY` in `.env` to two different values from `openssl rand -hex 32`.

```bash
npm run build
```

```bash
npm start
```

In a second terminal, load data, then open http://localhost:3001:

```bash
npm run refresh
```

For live front-end work, run `npm run dev:api` and `npm run dev:web`, then open http://localhost:5173.

## Run the n8n flow

`npm run refresh` runs the same join without n8n. To run the real flow, keep the API running and:

```bash
N8N_BLOCK_ENV_ACCESS_IN_NODE=false PLANNER_INGEST_KEY=your-ingest-key npx n8n
```

In n8n, import `n8n/bank-holiday-planner.workflow.json`, click **Execute workflow**, and publish it to enable the 06:00 schedule. For a shared deployment, replace the environment variable with an n8n Header Auth credential.

The Code nodes are generated from [integration/combine.mjs](integration/combine.mjs). After changing that file, run `npm run n8n:build` and import again.

## Test it

```bash
npm test
```

```bash
npx newman run postman/bank-holiday-planner.postman_collection.json -e postman/local.postman_environment.json --env-var apiKey=your-api-key
```

The Postman run needs the API running with data loaded. Import the same two files into Postman to use it interactively.

## API

All `/api/v1` routes need an `X-API-Key` header.

| Route | Purpose |
|---|---|
| `GET /health` | Liveness check, no key needed |
| `GET /api/v1/holidays?division=&limit=&from=` | Upcoming holidays with weather. `division` is `england-and-wales` (default), `scotland` or `northern-ireland`; `limit` is 1–10 (default 5); `from` is `YYYY-MM-DD` |
| `POST /api/v1/ingest` | Replaces stored data. Uses the separate ingest key |
| `GET /api/v1/countries/:code` | SOAP country lookup as JSON, for example `/countries/GB` |

## Design decisions

**Weather has a fallback chain.** Daily forecasts stop at 16 days, so a simple join shows no weather for most holidays. Each holiday uses the first source that covers it, and the response records which one in `weather.source`:

1. `forecast`: the Open-Meteo forecast, within 16 days.
2. `climate`: the 5-year average for that time of year, from the archive API.
3. `seasonal`: the mean of 51 long-range model runs, up to 217 days ahead. It is only a rough guide.
4. `unavailable`: nothing covers the date.

**A weather failure degrades the data; other failures stop the run.** Weather nodes retry, then continue, and the response sets `degraded: true`. A gov.uk, join or ingest failure ends in a Stop and Error node, so the execution is marked failed and the last good data stays in place.

**No key in the browser.** A key in React code would be public. The page uses `/ui/holidays`, a keyless, rate-limited, read-only route for the same public data. `/ui/holidays` is therefore open to anyone who can reach the server, which is fine for this data but would need real user login for private data.

**Two keys.** The read key can't write, and the ingest key can't read. A leaked client key can't replace the data.

## Limitations

- The rate limiter counts in memory per process, so it resets on restart and needs a shared store if you run several instances. Behind a proxy, also set Express `trust proxy`.
- `node:sqlite` is built in, so there is no native dependency, but Node still labels it experimental.
- The SOAP service is HTTP only, so lookups aren't encrypted in transit. It only carries public country data.
- Location is one city per nation: London, Edinburgh and Belfast.

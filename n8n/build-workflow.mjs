// Generates the importable workflow, inlining integration/combine.mjs into its Code
// nodes so the join logic has one source. Run with: npm run n8n:build
import { readFileSync, writeFileSync } from 'node:fs';

const shared = readFileSync(new URL('../integration/combine.mjs', import.meta.url), 'utf8').replaceAll(/^export /gm, '');

const expandCode = `${shared}
const today = londonDate(new Date());
return DIVISIONS.map((entry) => ({ json: { division: entry.division, ...weatherUrls(entry, today) } }));`;

const combineCode = `${shared}
const responses = (name) => $(name).all().map((item) => item.json);
const expanded = responses('Expand divisions');
const forecast = responses('Forecast (16 days)');
const climate = responses('Archive (5 years)');
const seasonal = responses('Seasonal ensemble');
const weather = Object.fromEntries(
  expanded.map(({ division }, index) => [
    division,
    { forecast: forecast[index], climate: climate[index], seasonal: seasonal[index] },
  ]),
);
const bankHolidays = $('Get bank holidays').first().json;
return [{ json: buildSnapshot({ bankHolidays, weather, now: new Date() }) }];`;

const retry = { retryOnFail: true, maxTries: 3, waitBetweenTries: 2000 };

function httpGet(name, position, url, timeout, onError) {
  return {
    id: name.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-'),
    name,
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position,
    parameters: { url, options: { timeout } },
    ...retry,
    onError,
  };
}

const failure = (id, name, position, message) => ({
  id,
  name,
  type: 'n8n-nodes-base.stopAndError',
  typeVersion: 1,
  position,
  parameters: { errorMessage: message },
});

const nodes = [
  {
    id: 'daily-schedule',
    name: 'Every day at 06:00',
    type: 'n8n-nodes-base.scheduleTrigger',
    typeVersion: 1.2,
    position: [0, 0],
    parameters: { rule: { interval: [{ field: 'days', triggerAtHour: 6 }] } },
  },
  { id: 'manual', name: 'Run manually', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 200], parameters: {} },
  httpGet('Get bank holidays', [240, 100], 'https://www.gov.uk/bank-holidays.json', 15000, 'continueErrorOutput'),
  {
    id: 'expand-divisions',
    name: 'Expand divisions',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [480, 0],
    parameters: { jsCode: expandCode },
  },
  // These continue on failure: a dead weather source degrades the data, it does not lose the run.
  httpGet('Forecast (16 days)', [720, 0], '={{ $json.forecastUrl }}', 15000, 'continueRegularOutput'),
  httpGet('Archive (5 years)', [960, 0], "={{ $('Expand divisions').item.json.climateUrl }}", 15000, 'continueRegularOutput'),
  httpGet('Seasonal ensemble', [1200, 0], "={{ $('Expand divisions').item.json.seasonalUrl }}", 15000, 'continueRegularOutput'),
  {
    id: 'combine',
    name: 'Combine sources',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [1440, 0],
    parameters: { jsCode: combineCode },
    onError: 'continueErrorOutput',
  },
  {
    id: 'post-ingest',
    name: 'Send to planner API',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [1680, -100],
    parameters: {
      method: 'POST',
      url: "={{ ($env.PLANNER_API_URL || 'http://localhost:3001') + '/api/v1/ingest' }}",
      sendHeaders: true,
      headerParameters: { parameters: [{ name: 'X-API-Key', value: '={{ $env.PLANNER_INGEST_KEY }}' }] },
      sendBody: true,
      specifyBody: 'json',
      jsonBody: '={{ JSON.stringify($json) }}',
      options: { timeout: 15000 },
    },
    ...retry,
    onError: 'continueErrorOutput',
  },
  failure('holidays-failed', 'Holidays failed', [480, 240], '={{ "gov.uk fetch failed: " + ($json.error?.message ?? "unknown error") }}'),
  failure('combine-failed', 'Combine failed', [1680, 100], '={{ "Join failed: " + ($json.error?.message ?? "unknown error") }}'),
  failure('ingest-failed', 'Ingest failed', [1920, 0], '={{ "Planner API rejected the data: " + ($json.error?.message ?? "unknown error") }}'),
];

const next = (...names) => names.map((name) => (name ? [{ node: name, type: 'main', index: 0 }] : []));

const connections = {
  'Every day at 06:00': { main: next('Get bank holidays') },
  'Run manually': { main: next('Get bank holidays') },
  'Get bank holidays': { main: next('Expand divisions', 'Holidays failed') },
  'Expand divisions': { main: next('Forecast (16 days)') },
  'Forecast (16 days)': { main: next('Archive (5 years)') },
  'Archive (5 years)': { main: next('Seasonal ensemble') },
  'Seasonal ensemble': { main: next('Combine sources') },
  'Combine sources': { main: next('Send to planner API', 'Combine failed') },
  'Send to planner API': { main: next(null, 'Ingest failed') },
};

const workflow = {
  id: 'bankHolidayPlanner',
  name: 'Bank holiday planner',
  active: false,
  nodes,
  connections,
  settings: { executionOrder: 'v1', timezone: 'Europe/London' },
  pinData: {},
};

writeFileSync(new URL('./bank-holiday-planner.workflow.json', import.meta.url), `${JSON.stringify(workflow, null, 2)}\n`);

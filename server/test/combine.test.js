import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DIVISIONS, buildSnapshot, londonDate } from '../../integration/combine.mjs';

const now = new Date('2026-11-02T12:00:00Z');
const events = [
  { title: 'Past day', date: '2026-08-31', notes: '', bunting: true },
  { title: 'Soon', date: '2026-11-10', notes: '', bunting: true },
  { title: 'Christmas Day', date: '2026-12-25', notes: '', bunting: true },
  { title: 'Far away', date: '2028-12-26', notes: 'Substitute day', bunting: false },
];
const bankHolidays = Object.fromEntries(DIVISIONS.map(({ division }) => [division, { division, events }]));

const forecast = {
  daily: {
    time: ['2026-11-10'],
    weather_code: [3],
    temperature_2m_max: [12],
    temperature_2m_min: [6],
    precipitation_sum: [0.4],
    precipitation_probability_max: [30],
  },
};
const climate = {
  daily: {
    time: ['2024-12-25', '2024-12-27', '2024-12-29', '2025-12-25'],
    temperature_2m_max: [8, 10, 99, 6],
    temperature_2m_min: [2, 4, 99, 0],
    precipitation_sum: [0, 2, 99, 4],
  },
};
const seasonal = {
  daily: {
    time: ['2026-12-25'],
    temperature_2m_max: [4],
    temperature_2m_max_member01: [6],
    temperature_2m_min: [1],
    temperature_2m_min_member01: [3],
    precipitation_sum: [0],
    precipitation_sum_member01: [3],
  },
};

function run(sources) {
  const weather = Object.fromEntries(DIVISIONS.map(({ division }) => [division, sources]));
  return buildSnapshot({ bankHolidays, weather, now });
}

test('drops past holidays and sorts by date', () => {
  const [first] = run({ forecast, climate, seasonal }).divisions;
  assert.deepEqual(first.holidays.map((holiday) => holiday.title), ['Soon', 'Christmas Day', 'Far away']);
});

test('uses the forecast inside its horizon and climate beyond it', () => {
  const [soon, christmas] = run({ forecast, climate, seasonal }).divisions[0].holidays;
  assert.equal(soon.weather.source, 'forecast');
  assert.equal(soon.weather.tempMaxC, 12);
  assert.deepEqual(christmas.weather, { source: 'climate', tempMaxC: 8, tempMinC: 2, precipMm: 2, rainChancePct: 67, weatherCode: null });
});

test('falls back to the seasonal ensemble mean when the archive fails', () => {
  const snapshot = run({ forecast, climate: { error: 'timeout' }, seasonal });
  const christmas = snapshot.divisions[0].holidays[1];
  assert.deepEqual(christmas.weather, { source: 'seasonal', tempMaxC: 5, tempMinC: 2, precipMm: 1.5, rainChancePct: 50, weatherCode: null });
  assert.equal(snapshot.failedSources.length, 3);
  assert.equal(snapshot.failedSources[0], 'england-and-wales:climate');
});

test('marks a holiday unavailable when no source covers it', () => {
  const far = run({ forecast, seasonal }).divisions[0].holidays[2];
  assert.equal(far.weather.source, 'unavailable');
  assert.equal(far.weather.tempMaxC, null);
});

test('leap-day holidays still match climate data from other years', () => {
  const leap = { ...bankHolidays['scotland'], events: [{ title: 'Leap', date: '2028-02-29', notes: '', bunting: false }] };
  const data = { daily: { time: ['2025-02-27'], temperature_2m_max: [7], temperature_2m_min: [1], precipitation_sum: [0] } };
  const weather = { scotland: { climate: data } };
  const snapshot = buildSnapshot({ bankHolidays: { ...bankHolidays, scotland: leap }, weather, now });
  assert.equal(snapshot.divisions[1].holidays[0].weather.tempMaxC, 7);
});

test('a malformed gov.uk response fails loudly', () => {
  assert.throws(() => buildSnapshot({ bankHolidays: {}, weather: {}, now }), /no events/);
});

test('today follows the UK calendar, not UTC', () => {
  assert.equal(londonDate(new Date('2026-07-01T23:30:00Z')), '2026-07-02');
});

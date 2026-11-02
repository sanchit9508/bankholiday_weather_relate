// Pure join logic shared by the n8n Code node and server/scripts/refresh.js.
// Keep this file free of imports: n8n/build-workflow.mjs inlines it into the workflow.

export const DIVISIONS = [
  { division: 'england-and-wales', label: 'England and Wales', location: { name: 'London', latitude: 51.51, longitude: -0.13 } },
  { division: 'scotland', label: 'Scotland', location: { name: 'Edinburgh', latitude: 55.95, longitude: -3.19 } },
  { division: 'northern-ireland', label: 'Northern Ireland', location: { name: 'Belfast', latitude: 54.6, longitude: -5.93 } },
];

export const HOLIDAYS_URL = 'https://www.gov.uk/bank-holidays.json';
const HOLIDAYS_KEPT = 10;
const CLIMATE_YEARS = 5;
const CLIMATE_WINDOW_DAYS = 3;
const WET_DAY_MM = 1;

export function londonDate(now) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(now);
}

function dayNumber(isoDate) {
  return Date.parse(`${isoDate}T00:00:00Z`) / 86_400_000;
}

function round(value) {
  return Math.round(value * 10) / 10;
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function numbers(values) {
  return values.filter((value) => typeof value === 'number');
}

export function weatherUrls({ location }, today) {
  const year = Number(today.slice(0, 4));
  const position = `latitude=${location.latitude}&longitude=${location.longitude}&timezone=Europe%2FLondon`;
  const temperature = 'temperature_2m_max,temperature_2m_min,precipitation_sum';
  return {
    forecastUrl: `https://api.open-meteo.com/v1/forecast?${position}&forecast_days=16&daily=weather_code,${temperature},precipitation_probability_max`,
    climateUrl: `https://archive-api.open-meteo.com/v1/archive?${position}&start_date=${year - CLIMATE_YEARS}-01-01&end_date=${year - 1}-12-31&daily=${temperature}`,
    seasonalUrl: `https://seasonal-api.open-meteo.com/v1/seasonal?${position}&forecast_days=217&daily=${temperature}`,
  };
}

function hasDaily(response) {
  return Array.isArray(response?.daily?.time);
}

function fromForecast(forecast, date) {
  const index = forecast.daily.time.indexOf(date);
  const daily = forecast.daily;
  if (index === -1 || typeof daily.temperature_2m_max[index] !== 'number') return null;
  return {
    source: 'forecast',
    tempMaxC: daily.temperature_2m_max[index],
    tempMinC: daily.temperature_2m_min[index],
    precipMm: daily.precipitation_sum[index],
    rainChancePct: daily.precipitation_probability_max[index],
    weatherCode: daily.weather_code[index],
  };
}

// Averages the same calendar window across past years, so a date that moves
// between years (Easter) or only exists in leap years (29 Feb) still has data.
function fromClimate(climate, date) {
  const target = date.slice(5);
  const daily = climate.daily;
  const indexes = [];
  daily.time.forEach((day, index) => {
    const anchor = `${day.slice(0, 4)}-${target === '02-29' ? '02-28' : target}`;
    if (Math.abs(dayNumber(day) - dayNumber(anchor)) <= CLIMATE_WINDOW_DAYS) indexes.push(index);
  });
  const pick = (key) => numbers(indexes.map((index) => daily[key][index]));
  const highs = pick('temperature_2m_max');
  const lows = pick('temperature_2m_min');
  const rain = pick('precipitation_sum');
  if (!highs.length || !lows.length || !rain.length) return null;
  return {
    source: 'climate',
    tempMaxC: round(mean(highs)),
    tempMinC: round(mean(lows)),
    precipMm: round(mean(rain)),
    rainChancePct: Math.round((rain.filter((mm) => mm >= WET_DAY_MM).length / rain.length) * 100),
    weatherCode: null,
  };
}

// The seasonal API returns one control run plus 50 `_memberNN` columns per variable.
function fromSeasonal(seasonal, date) {
  const index = seasonal.daily.time.indexOf(date);
  if (index === -1) return null;
  const members = (variable) =>
    numbers(
      Object.keys(seasonal.daily)
        .filter((key) => key === variable || key.startsWith(`${variable}_member`))
        .map((key) => seasonal.daily[key][index]),
    );
  const highs = members('temperature_2m_max');
  const lows = members('temperature_2m_min');
  const rain = members('precipitation_sum');
  if (!highs.length || !lows.length || !rain.length) return null;
  return {
    source: 'seasonal',
    tempMaxC: round(mean(highs)),
    tempMinC: round(mean(lows)),
    precipMm: round(mean(rain)),
    rainChancePct: Math.round((rain.filter((mm) => mm >= WET_DAY_MM).length / rain.length) * 100),
    weatherCode: null,
  };
}

const UNAVAILABLE = { source: 'unavailable', tempMaxC: null, tempMinC: null, precipMm: null, rainChancePct: null, weatherCode: null };

function chooseWeather(sources, date) {
  return (
    (hasDaily(sources.forecast) && fromForecast(sources.forecast, date)) ||
    (hasDaily(sources.climate) && fromClimate(sources.climate, date)) ||
    (hasDaily(sources.seasonal) && fromSeasonal(sources.seasonal, date)) ||
    UNAVAILABLE
  );
}

// weather: { [division]: { forecast, climate, seasonal } }. A failed source can be
// anything without `daily`; the holiday then falls through to the next source.
export function buildSnapshot({ bankHolidays, weather, now }) {
  const today = londonDate(now);
  const failedSources = [];
  const divisions = DIVISIONS.map(({ division, label, location }) => {
    const events = bankHolidays?.[division]?.events;
    if (!Array.isArray(events)) throw new Error(`gov.uk response has no events for ${division}`);
    const sources = weather[division] ?? {};
    for (const name of ['forecast', 'climate', 'seasonal']) {
      if (!hasDaily(sources[name])) failedSources.push(`${division}:${name}`);
    }
    const holidays = events
      .filter((event) => event.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, HOLIDAYS_KEPT)
      .map((event) => ({
        date: event.date,
        title: event.title,
        notes: event.notes ?? '',
        bunting: Boolean(event.bunting),
        weather: chooseWeather(sources, event.date),
      }));
    return { division, label, location, holidays };
  });
  return { generatedAt: now.toISOString(), failedSources, divisions };
}

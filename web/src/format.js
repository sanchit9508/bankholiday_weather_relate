export const SOURCES = {
  forecast: { label: 'Forecast', detail: 'Open-Meteo daily forecast for this date' },
  climate: { label: 'Typical', detail: 'Average for this time of year over the last 5 years' },
  seasonal: { label: 'Seasonal outlook', detail: 'Mean of 51 long-range model runs: a rough guide, not a forecast' },
  unavailable: { label: 'No data', detail: 'No weather source covers this date yet' },
};

const WEATHER_CODES = [
  [0, 'Clear'], [3, 'Cloudy'], [48, 'Fog'], [57, 'Drizzle'], [67, 'Rain'], [77, 'Snow'], [82, 'Showers'], [86, 'Snow showers'], [99, 'Thunderstorm'],
];

export function describeCode(code) {
  if (code === null) return null;
  return WEATHER_CODES.find(([limit]) => code <= limit)?.[1] ?? null;
}

export function formatDate(iso) {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
}

export function formatUpdated(iso) {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }).format(new Date(iso));
}

export function countdown(days) {
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  return `${days} days`;
}

export function temperature(value) {
  return `${Math.round(value)}°C`;
}

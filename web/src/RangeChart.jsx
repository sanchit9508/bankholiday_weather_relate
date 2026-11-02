import { SOURCES, formatDate, temperature } from './format.js';

const TICK_STEP = 5;

function scale(holidays) {
  const known = holidays.filter(({ weather }) => weather.tempMaxC !== null);
  const low = Math.min(...known.map(({ weather }) => weather.tempMinC));
  const high = Math.max(...known.map(({ weather }) => weather.tempMaxC));
  const min = Math.floor(low / TICK_STEP) * TICK_STEP;
  const max = Math.max(Math.ceil(high / TICK_STEP) * TICK_STEP, min + TICK_STEP);
  const ticks = [];
  for (let tick = min; tick <= max; tick += TICK_STEP) ticks.push(tick);
  return { ticks, position: (value) => ((value - min) / (max - min)) * 100 };
}

export function RangeChart({ holidays }) {
  if (!holidays.some(({ weather }) => weather.tempMaxC !== null)) return null;
  const { ticks, position } = scale(holidays);
  const shown = Object.keys(SOURCES).filter((key) => key !== 'unavailable' && holidays.some(({ weather }) => weather.source === key));

  return (
    <figure className="chart">
      <figcaption>
        <h2>Daily temperature range</h2>
        <ul className="legend">
          {shown.map((key) => (
            <li key={key}>
              <span className={`swatch source-${key}`} />
              {SOURCES[key].label}
            </li>
          ))}
        </ul>
      </figcaption>
      <div className="plot">
        {holidays.map(({ date, title, weather }) => (
          <div className="row" key={date} tabIndex={weather.tempMaxC === null ? undefined : 0}>
            <div className="row-label">
              <span className="row-title">{title}</span>
              <span className="row-date">{formatDate(date)}</span>
            </div>
            <div className="track">
              {ticks.map((tick) => (
                <span className="grid" key={tick} style={{ left: `${position(tick)}%` }} />
              ))}
              {weather.tempMaxC === null ? (
                <span className="no-data">No weather data yet</span>
              ) : (
                <>
                  <span
                    className={`range source-${weather.source}`}
                    style={{ left: `${position(weather.tempMinC)}%`, width: `${position(weather.tempMaxC) - position(weather.tempMinC)}%` }}
                  />
                  <span className="tooltip" role="tooltip" style={{ left: `${position(weather.tempMaxC)}%` }}>
                    <strong>{temperature(weather.tempMinC)} to {temperature(weather.tempMaxC)}</strong>
                    <span>{SOURCES[weather.source].label}</span>
                  </span>
                </>
              )}
            </div>
          </div>
        ))}
        <div className="row axis" aria-hidden="true">
          <span />
          <div className="track">
            {ticks.map((tick) => (
              <span className="tick" key={tick} style={{ left: `${position(tick)}%` }}>{tick}°</span>
            ))}
          </div>
        </div>
      </div>
    </figure>
  );
}

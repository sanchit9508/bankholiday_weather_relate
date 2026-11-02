import { useEffect, useState } from 'react';
import { RangeChart } from './RangeChart.jsx';
import { SOURCES, countdown, describeCode, formatDate, formatUpdated, temperature } from './format.js';

const DIVISIONS = [
  { id: 'england-and-wales', label: 'England and Wales' },
  { id: 'scotland', label: 'Scotland' },
  { id: 'northern-ireland', label: 'Northern Ireland' },
];

function useHolidays(division, attempt) {
  const [state, setState] = useState({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    setState((previous) => ({ ...previous, status: 'loading' }));
    fetch(`/ui/holidays?division=${division}&limit=5`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.detail ?? 'The planner API returned an error.');
        setState({ status: 'ready', data: body });
      })
      .catch((error) => {
        if (error.name !== 'AbortError') setState({ status: 'error', message: error.message });
      });
    return () => controller.abort();
  }, [division, attempt]);

  return state;
}

function NextHoliday({ data }) {
  const [next] = data.holidays;
  return (
    <section className="next" aria-label="Next bank holiday">
      <p className="eyebrow">Next bank holiday</p>
      <h2>{next.title}</h2>
      <p className="next-when">
        <strong>{countdown(next.daysUntil)}</strong> · {formatDate(next.date)}
        {next.notes && ` · ${next.notes}`}
      </p>
    </section>
  );
}

function Notices({ data }) {
  const usesOutlook = data.holidays.some(({ weather }) => weather.source === 'seasonal');
  return (
    <>
      {data.stale && <p className="notice" role="status">This data is more than two days old. The last refresh was {formatUpdated(data.updatedAt)}.</p>}
      {usesOutlook && <p className="note">Daily forecasts only reach 16 days ahead. {SOURCES.seasonal.label} rows are the {SOURCES.seasonal.detail.toLowerCase()}.</p>}
    </>
  );
}

function HolidayTable({ holidays }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th scope="col">Holiday</th>
            <th scope="col">Date</th>
            <th scope="col" className="num">In</th>
            <th scope="col" className="num">Low to high</th>
            <th scope="col" className="num">Rain chance</th>
            <th scope="col">Based on</th>
          </tr>
        </thead>
        <tbody>
          {holidays.map(({ date, title, notes, daysUntil, weather }) => (
            <tr key={date}>
              <th scope="row">
                {title}
                {notes && <span className="sub">{notes}</span>}
              </th>
              <td className="nowrap">{formatDate(date)}</td>
              <td className="num nowrap">{countdown(daysUntil)}</td>
              <td className="num nowrap">{weather.tempMaxC === null ? '–' : `${temperature(weather.tempMinC)} to ${temperature(weather.tempMaxC)}`}</td>
              <td className="num">{weather.rainChancePct === null ? '–' : `${weather.rainChancePct}%`}</td>
              <td title={SOURCES[weather.source].detail}>
                <span className="source-cell">
                  <span className={`swatch source-${weather.source}`} />
                  {describeCode(weather.weatherCode) ?? SOURCES[weather.source].label}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function App() {
  const [division, setDivision] = useState(DIVISIONS[0].id);
  const [attempt, setAttempt] = useState(0);
  const { status, data, message } = useHolidays(division, attempt);

  return (
    <main>
      <header>
        <h1>Bank Holiday Planner</h1>
        <div className="tabs" role="group" aria-label="UK nation">
          {DIVISIONS.map(({ id, label }) => (
            <button key={id} type="button" aria-pressed={id === division} onClick={() => setDivision(id)}>
              {label}
            </button>
          ))}
        </div>
      </header>

      {status === 'error' && (
        <div className="panel message" role="alert">
          <p>{message}</p>
          <button type="button" onClick={() => setAttempt((count) => count + 1)}>Try again</button>
        </div>
      )}
      {!data && status === 'loading' && <p className="panel message" role="status">Loading holidays…</p>}
      {data && status !== 'error' && data.count === 0 && <p className="panel message">No upcoming holidays are stored. Run a refresh to load more.</p>}
      {data && status !== 'error' && data.count > 0 && (
        <div className={status === 'loading' ? 'content loading' : 'content'}>
          <NextHoliday data={data} />
          <RangeChart holidays={data.holidays} />
          <HolidayTable holidays={data.holidays} />
          <Notices data={data} />
          <footer>
            Weather for {data.location.name}. Updated {formatUpdated(data.updatedAt)}. Data: GOV.UK, Open-Meteo.
          </footer>
        </div>
      )}
    </main>
  );
}

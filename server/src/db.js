import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS holidays (
    division TEXT NOT NULL,
    date TEXT NOT NULL,
    title TEXT NOT NULL,
    notes TEXT NOT NULL,
    bunting INTEGER NOT NULL,
    weather_source TEXT NOT NULL,
    temp_max_c REAL,
    temp_min_c REAL,
    precip_mm REAL,
    rain_chance_pct INTEGER,
    weather_code INTEGER,
    PRIMARY KEY (division, date)
  );
  CREATE TABLE IF NOT EXISTS ingest_runs (
    id INTEGER PRIMARY KEY,
    generated_at TEXT NOT NULL,
    received_at TEXT NOT NULL,
    holiday_count INTEGER NOT NULL,
    failed_sources TEXT NOT NULL
  );
`;

export function openDatabase(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);

  const insertHoliday = db.prepare(`
    INSERT INTO holidays VALUES (
      :division, :date, :title, :notes, :bunting, :source, :tempMaxC, :tempMinC, :precipMm, :rainChancePct, :weatherCode
    )`);
  const insertRun = db.prepare('INSERT INTO ingest_runs (generated_at, received_at, holiday_count, failed_sources) VALUES (?, ?, ?, ?)');
  const selectHolidays = db.prepare('SELECT * FROM holidays WHERE division = ? AND date >= ? ORDER BY date LIMIT ?');
  const selectLatestRun = db.prepare('SELECT * FROM ingest_runs ORDER BY id DESC LIMIT 1');

  return {
    saveSnapshot(snapshot, receivedAt) {
      const rows = snapshot.divisions.flatMap(({ division, holidays }) =>
        holidays.map(({ weather, ...holiday }) => ({ division, ...holiday, ...weather, bunting: holiday.bunting ? 1 : 0 })),
      );
      db.exec('BEGIN');
      try {
        db.exec('DELETE FROM holidays');
        for (const row of rows) insertHoliday.run(row);
        insertRun.run(snapshot.generatedAt, receivedAt, rows.length, JSON.stringify(snapshot.failedSources));
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      return rows.length;
    },
    holidays: (division, from, limit) => selectHolidays.all(division, from, limit),
    latestRun: () => selectLatestRun.get(),
    close: () => db.close(),
  };
}

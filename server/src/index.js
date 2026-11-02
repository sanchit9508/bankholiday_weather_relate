import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { openDatabase } from './db.js';

const config = loadConfig();
const db = openDatabase(config.databasePath);
createApp({ db, config }).listen(config.port, () => {
  console.log(`Planner API listening on http://localhost:${config.port}`);
});

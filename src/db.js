/*
 * 開啟 SQLite 並把 schema 升級到最新版。
 * server.js 與 scripts/ 底下的工具都共用這一個連線。
 */
const Database = require('better-sqlite3');
const { DB_FILE } = require('./config');
const { migrate, LATEST_VERSION } = require('./migrations');

const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');

let migration;
try {
  migration = migrate(db, (message) => console.log(message));
} catch (error) {
  // A stack trace helps nobody mid-event: say what is wrong and stop.
  console.error(`資料庫錯誤：${error.message}`);
  process.exit(1);
}

module.exports = { db, DB_FILE, migration, LATEST_VERSION };

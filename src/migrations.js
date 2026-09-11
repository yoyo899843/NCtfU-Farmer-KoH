/*
 * Schema 版本定義。
 *
 * Append-only：每次改 schema 就在陣列後面「新增」一筆，不要修改既有項目 ——
 * 已經升級過的資料庫不會重跑舊步驟。版本號記在 PRAGMA user_version。
 */
const MIGRATIONS = [
  {
    version: 1,
    name: '種植時間與玩家帳號',
    up: (db) => db.exec(`
      CREATE TABLE IF NOT EXISTS plantings (
        token TEXT NOT NULL,
        plot_index INTEGER NOT NULL,
        seedtype TEXT NOT NULL,
        planted_at INTEGER NOT NULL,
        PRIMARY KEY (token, plot_index)
      );
      CREATE TABLE IF NOT EXISTS accounts (
        nickname TEXT PRIMARY KEY,
        pin TEXT NOT NULL,
        total_score INTEGER NOT NULL DEFAULT 0,
        rounds_played INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );
    `)
  },
  {
    version: 2,
    name: '管理員帳號',
    up: (db) => db.exec(`
      CREATE TABLE IF NOT EXISTS admin_accounts (
        username TEXT PRIMARY KEY,
        password_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `)
  },
  {
    version: 3,
    name: '可在管理台調整的設定',
    up: (db) => db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `)
  },
  {
    version: 4,
    name: '公告',
    up: (db) => db.exec(`
      CREATE TABLE IF NOT EXISTS announcements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        body TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `)
  }
];

const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

function migrate(db, log = () => {}) {
  const from = db.pragma('user_version', { simple: true });
  if (from > LATEST_VERSION) {
    throw new Error(`farmer.sqlite 的版本是 v${from}，比這份程式認得的 v${LATEST_VERSION} 還新，請更新程式或改用新的資料庫檔。`);
  }
  const pending = MIGRATIONS.filter((step) => step.version > from);
  for (const step of pending) {
    db.transaction(() => {
      step.up(db);
      db.pragma(`user_version = ${step.version}`);
    })();
    log(`資料庫升級至 v${step.version}：${step.name}`);
  }
  return { from, to: LATEST_VERSION, applied: pending.length };
}

module.exports = { MIGRATIONS, LATEST_VERSION, migrate };

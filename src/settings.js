/*
 * 可在管理台即時調整的設定（目前只有每局與休息秒數）。
 *
 * 取值順序：資料庫 settings 表 → .env／環境變數 → 程式預設值。
 * 也就是說主辦方在管理台改過之後就以資料庫為準，重新啟動仍然保留；
 * 沒改過的話才用 .env 的值。
 */
const { db } = require('./db');
const {
  ROUND_SECONDS, BREAK_SECONDS, MIN_ROUND_SECONDS, MIN_BREAK_SECONDS, MAX_PHASE_SECONDS
} = require('./config');

const statements = {
  get: db.prepare('SELECT value FROM settings WHERE key = ?'),
  set: db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `)
};

function storedNumber(key) {
  const row = statements.get.get(key);
  if (!row) return null;
  const parsed = Number(row.value);
  return Number.isInteger(parsed) ? parsed : null;
}

// 讀一次就快取在記憶體，之後每局開始都會用到。
const current = {
  roundSeconds: storedNumber('round_seconds') ?? ROUND_SECONDS,
  breakSeconds: storedNumber('break_seconds') ?? BREAK_SECONDS
};

function checked(value, minimum, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`${label}必須是整數秒數。`);
  if (parsed < minimum) throw new Error(`${label}不能少於 ${minimum} 秒。`);
  if (parsed > MAX_PHASE_SECONDS) throw new Error(`${label}不能超過 ${MAX_PHASE_SECONDS} 秒。`);
  return parsed;
}

// 兩個值都先驗證過才寫入，避免只改成功一半。
function update({ roundSeconds, breakSeconds }) {
  const nextRound = checked(roundSeconds, MIN_ROUND_SECONDS, '每局秒數');
  const nextBreak = checked(breakSeconds, MIN_BREAK_SECONDS, '休息秒數');
  const now = Date.now();
  db.transaction(() => {
    statements.set.run('round_seconds', String(nextRound), now);
    statements.set.run('break_seconds', String(nextBreak), now);
  })();
  current.roundSeconds = nextRound;
  current.breakSeconds = nextBreak;
  return { ...current };
}

module.exports = {
  roundSeconds: () => current.roundSeconds,
  breakSeconds: () => current.breakSeconds,
  all: () => ({ ...current }),
  update
};

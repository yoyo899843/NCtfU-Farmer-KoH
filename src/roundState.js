/*
 * 回合狀態的「資料」本身，刻意不認識玩家。
 *
 * players.js 需要知道現在是不是比賽中（算累計分數），rounds.js 需要改這些欄位。
 * 把純狀態獨立出來，兩邊都只依賴這裡，避免 players ↔ rounds 互相 require。
 */
const { db } = require('./db');
const settings = require('./settings');

// 局數必須跨重啟保留，否則伺服器一重開，「接續開始」就會把第 n 局打回第 1 局。
// 借用 settings 那張泛用的 key-value 表，不另外開一張。
const roundNumberStatements = {
  get: db.prepare("SELECT value FROM settings WHERE key = 'round_number'"),
  set: db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES ('round_number', ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `)
};

function storedRoundNumber() {
  const row = roundNumberStatements.get.get();
  const parsed = row ? Number(row.value) : NaN;
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

// phase 不持久化：重開後一律回到 'waiting'，等主辦方決定要繼續還是開新活動。
// roundNumber 則從資料庫接回來。
//
// phase: 'waiting' | 'round' | 'break' | 'paused'
// 'paused' 是真正的暫停：不算遊戲也不算休息，倒數凍結在 remainingMs，
// 按「繼續」時從 pausedFrom 那個階段的剩餘時間接回去。這兩個欄位只活在
// 記憶體——伺服器重開後快照就沒了，「繼續」會退回「重開同一局」的行為。
const gameState = {
  phase: 'waiting',
  roundNumber: storedRoundNumber(),
  phaseEndsAt: null,
  pausedFrom: null,
  remainingMs: null
};

function setRoundNumber(value) {
  gameState.roundNumber = value;
  roundNumberStatements.set.run(String(value), Date.now());
}

function isRoundActive() {
  return gameState.phase === 'round';
}

function publicGameState() {
  return {
    phase: gameState.phase,
    roundNumber: gameState.roundNumber,
    phaseEndsAt: gameState.phaseEndsAt,
    pausedFrom: gameState.pausedFrom,
    remainingMs: gameState.remainingMs,
    serverNow: Date.now(),
    roundSeconds: settings.roundSeconds(),
    breakSeconds: settings.breakSeconds()
  };
}

module.exports = { gameState, setRoundNumber, isRoundActive, publicGameState };

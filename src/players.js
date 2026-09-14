/*
 * 玩家：記憶體中的本局狀態、SQLite 中的帳號與累計分數，以及種植時間。
 *
 * 暱稱＋PIN 就是帳號。本局的金錢／種子／作物／田地只活在記憶體，重開就沒了；
 * accounts 表的累計分數則刻意跨重啟保留。
 */
const crypto = require('crypto');
const { db } = require('./db');
const { PLOT_COUNT, STARTING_MONEY, STARTING_SCORE, MAX_POINTS, SEEDS } = require('./config');
const { isRoundActive } = require('./roundState');

const accountStatements = {
  find: db.prepare('SELECT nickname, pin, total_score FROM accounts WHERE nickname = ?'),
  insert: db.prepare('INSERT INTO accounts (nickname, pin, total_score, rounds_played, updated_at) VALUES (?, ?, 0, 0, ?)'),
  saveScore: db.prepare('UPDATE accounts SET total_score = ?, rounds_played = rounds_played + 1, updated_at = ? WHERE nickname = ?'),
  removeAll: db.prepare('DELETE FROM accounts'),
  all: db.prepare('SELECT nickname, total_score FROM accounts'),
  // 後台清單刻意不撈 pin：明文 PIN 沒有理由送到管理台畫面上。
  listAll: db.prepare('SELECT nickname, total_score, rounds_played FROM accounts ORDER BY total_score DESC, nickname'),
  remove: db.prepare('DELETE FROM accounts WHERE nickname = ?'),
  setPin: db.prepare('UPDATE accounts SET pin = ?, updated_at = ? WHERE nickname = ?')
};

const plantingStatements = {
  forToken: db.prepare('SELECT plot_index, planted_at FROM plantings WHERE token = ?'),
  upsert: db.prepare('INSERT OR REPLACE INTO plantings (token, plot_index, seedtype, planted_at) VALUES (?, ?, ?, ?)'),
  moveToken: db.prepare('UPDATE plantings SET token = ? WHERE token = ?'),
  remove: db.prepare('DELETE FROM plantings WHERE token = ? AND plot_index = ?'),
  removeForToken: db.prepare('DELETE FROM plantings WHERE token = ?'),
  clear: db.prepare('DELETE FROM plantings')
};

const players = new Map();

function emptyInventory() {
  return Object.fromEntries(Object.keys(SEEDS).map((key) => [key, 0]));
}

function emptyPlots() {
  return Array.from({ length: PLOT_COUNT }, () => null);
}

function resetPlayerForRound(player) {
  player.money = STARTING_MONEY;
  player.score = STARTING_SCORE;
  player.seeds = emptyInventory();
  player.crops = emptyInventory();
  player.plots = emptyPlots();
}

function cumulativeScore(player) {
  const liveScore = isRoundActive() ? player.score : 0;
  return Math.min(MAX_POINTS, player.totalScore + liveScore);
}

function safePlayer(player) {
  const times = new Map(plantingStatements.forToken.all(player.token)
    .map((row) => [row.plot_index, row.planted_at]));
  return {
    nickname: player.nickname,
    money: player.money,
    score: player.score,
    cumulativeScore: cumulativeScore(player),
    seeds: player.seeds,
    crops: player.crops,
    // This timestamp reaches the browser unchanged.  The browser decides
    // whether it is mature; /harvest deliberately does not verify it again.
    plots: player.plots.map((plot, index) => plot && ({ ...plot, plantedAt: times.get(index) }))
  };
}

function getPlayer(token) {
  return typeof token === 'string' ? players.get(token) : undefined;
}

// Revoke the browser's current token without discarding this round's progress.
// A later nickname + PIN login finds the still-seated player and receives the
// replacement token.
function logoutPlayer(token) {
  const player = getPlayer(token);
  if (!player) return null;
  const nextToken = crypto.randomBytes(18).toString('hex');
  db.transaction(() => plantingStatements.moveToken.run(nextToken, token))();
  players.delete(token);
  player.token = nextToken;
  players.set(nextToken, player);
  return player;
}

function activePlayerByNickname(nickname) {
  for (const player of players.values()) if (player.nickname === nickname) return player;
  return undefined;
}

function findAccount(nickname) {
  return accountStatements.find.get(nickname);
}

// account 為 null 代表這是第一次出現的暱稱，順便把帳號建起來。
function createPlayer(nickname, pin, account) {
  if (!account) accountStatements.insert.run(nickname, pin, Date.now());
  const player = {
    nickname,
    pin,
    token: crypto.randomBytes(18).toString('hex'),
    money: STARTING_MONEY,
    score: STARTING_SCORE,
    totalScore: account ? account.total_score : 0,
    lastRoundScore: 0,
    seeds: emptyInventory(),
    crops: emptyInventory(),
    plots: emptyPlots()
  };
  players.set(player.token, player);
  return player;
}

function persistRoundScore(player, at) {
  accountStatements.saveScore.run(player.totalScore, at, player.nickname);
}

function clearAllPlayers() {
  db.transaction(() => {
    plantingStatements.clear.run();
    accountStatements.removeAll.run();
  })();
  players.clear();
}

/* 以下三個是給管理台用的帳號管理。 */

// 帳號清單，附上目前是否在線與本局分數（在線才有）。
function listAccounts() {
  const seated = new Map();
  for (const player of players.values()) seated.set(player.nickname, player);
  return accountStatements.listAll.all().map((row) => {
    const live = seated.get(row.nickname);
    return {
      nickname: row.nickname,
      totalScore: row.total_score,
      roundsPlayed: row.rounds_played,
      online: Boolean(live),
      roundScore: live ? live.score : null
    };
  });
}

// 刪帳號連同還在線上的 session 與種植資料一起清掉。對方下一次呼叫 API 會拿到
// 401，瀏覽器就自己退回登入畫面。
function deleteAccount(nickname) {
  const name = typeof nickname === 'string' ? nickname.trim() : '';
  if (!name) throw new Error('請指定要刪除的暱稱。');
  const seated = activePlayerByNickname(name);
  const removed = db.transaction(() => {
    if (seated) plantingStatements.removeForToken.run(seated.token);
    return accountStatements.remove.run(name).changes;
  })();
  if (removed === 0 && !seated) throw new Error(`找不到玩家 ${name}。`);
  if (seated) players.delete(seated.token);
  return { nickname: name, wasOnline: Boolean(seated) };
}

// 忘記 PIN 的人由主辦方給一組新的；還在線上的話記憶體那份也要同步。
function setAccountPin(nickname, pin) {
  const name = typeof nickname === 'string' ? nickname.trim() : '';
  const next = String(pin ?? '');
  if (!name) throw new Error('請指定暱稱。');
  if (!/^\d{6}$/.test(next)) throw new Error('PIN 必須是 6 位數字。');
  if (accountStatements.setPin.run(next, Date.now(), name).changes === 0) {
    throw new Error(`找不到玩家 ${name}。`);
  }
  const seated = activePlayerByNickname(name);
  if (seated) seated.pin = next;
  return { nickname: name, wasOnline: Boolean(seated) };
}

// 總排行讀資料庫，所以已經離開的玩家仍會留在榜上；還在場的人則把本局尚未
// 結算的分數即時加上去。
function cumulativeTotals() {
  const totals = new Map(accountStatements.all.all().map((row) => [row.nickname, row.total_score]));
  if (isRoundActive()) {
    for (const player of players.values()) {
      totals.set(player.nickname, Math.min(MAX_POINTS, (totals.get(player.nickname) || 0) + player.score));
    }
  }
  return totals;
}

const plantings = {
  record: (token, plotIndex, seedtype, plantedAt) => plantingStatements.upsert.run(token, plotIndex, seedtype, plantedAt),
  remove: (token, plotIndex) => plantingStatements.remove.run(token, plotIndex),
  clearAll: () => plantingStatements.clear.run()
};

module.exports = {
  players,
  plantings,
  emptyInventory,
  resetPlayerForRound,
  cumulativeScore,
  cumulativeTotals,
  safePlayer,
  getPlayer,
  logoutPlayer,
  activePlayerByNickname,
  findAccount,
  createPlayer,
  persistRoundScore,
  clearAllPlayers,
  listAccounts,
  deleteAccount,
  setAccountPin
};

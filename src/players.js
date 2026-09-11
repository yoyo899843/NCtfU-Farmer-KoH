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
  all: db.prepare('SELECT nickname, total_score FROM accounts')
};

const plantingStatements = {
  forToken: db.prepare('SELECT plot_index, planted_at FROM plantings WHERE token = ?'),
  upsert: db.prepare('INSERT OR REPLACE INTO plantings (token, plot_index, seedtype, planted_at) VALUES (?, ?, ?, ?)'),
  remove: db.prepare('DELETE FROM plantings WHERE token = ? AND plot_index = ?'),
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
  activePlayerByNickname,
  findAccount,
  createPlayer,
  persistRoundScore,
  clearAllPlayers
};

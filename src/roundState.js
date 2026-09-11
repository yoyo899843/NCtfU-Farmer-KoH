/*
 * 回合狀態的「資料」本身，刻意不認識玩家。
 *
 * players.js 需要知道現在是不是比賽中（算累計分數），rounds.js 需要改這些欄位。
 * 把純狀態獨立出來，兩邊都只依賴這裡，避免 players ↔ rounds 互相 require。
 */
const settings = require('./settings');

// phase: 'waiting' | 'round' | 'break' | 'ended'
const gameState = {
  phase: 'waiting',
  roundNumber: 0,
  phaseEndsAt: null
};

function isRoundActive() {
  return gameState.phase === 'round';
}

function publicGameState() {
  return {
    phase: gameState.phase,
    roundNumber: gameState.roundNumber,
    phaseEndsAt: gameState.phaseEndsAt,
    serverNow: Date.now(),
    roundSeconds: settings.roundSeconds(),
    breakSeconds: settings.breakSeconds()
  };
}

module.exports = { gameState, isRoundActive, publicGameState };

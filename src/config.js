/*
 * 所有可調參數與遊戲常數。其他模組一律從這裡取值，不要各自讀 process.env。
 */
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');

// Node 22 內建 .env 讀取，不需要 dotenv。放在讀取任何 process.env 之前。
// 已經存在於環境中的變數優先，所以 docker compose 傳進來的值不會被蓋掉。
const ENV_FILE = path.join(ROOT_DIR, '.env');
if (fs.existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

const durationSetting = (value, fallback, minimum) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.floor(parsed)) : fallback;
};

// Prices are deliberately also sent by the browser to /buy_seed.  This is the
// intended CTF exercise, not a pattern for real applications.
const SEEDS = {
  radish: { name: '小蘿蔔', price: 10, growSeconds: 10, score: 1 },
  carrot: { name: '胡蘿蔔', price: 50, growSeconds: 30, score: 3 },
  corn: { name: '玉米', price: 100, growSeconds: 60, score: 5 },
  pumpkin: { name: '南瓜', price: 500, growSeconds: 300, score: 10 },
  goldenRice: { name: '黃金稻米', price: 10000, growSeconds: 3600, score: 15 }
};

module.exports = {
  ROOT_DIR,
  PUBLIC_DIR: path.join(ROOT_DIR, 'public'),
  DB_FILE: process.env.DB_FILE || path.join(ROOT_DIR, 'farmer.sqlite'),
  LOG_FILE: path.join(ROOT_DIR, 'activity.log'),

  PORT: Number(process.env.PORT || 3000),

  // 這兩個只是「預設值」。主辦方在管理台改過之後，就以資料庫裡的值為準。
  ROUND_SECONDS: durationSetting(process.env.ROUND_SECONDS, 600, 10),
  BREAK_SECONDS: durationSetting(process.env.BREAK_SECONDS, 60, 5),
  MIN_ROUND_SECONDS: 10,
  MIN_BREAK_SECONDS: 5,
  MAX_PHASE_SECONDS: 7200,

  MAX_PLAYERS: 50,
  PLOT_COUNT: 4,
  MAX_NICKNAME_LENGTH: 20,
  MAX_BUY_COUNT: 99,
  STARTING_MONEY: 100,
  STARTING_SCORE: 0,
  MAX_POINTS: 1_000_000,
  MAX_MONEY: 1_000_000,
  SELL_MULTIPLIER: 1.5,

  DEFAULT_ADMIN_USER: 'admin',
  DEFAULT_ADMIN_PASSWORD: 'change-me',

  SEEDS,
  validSeed: (seedType) => Object.prototype.hasOwnProperty.call(SEEDS, seedType)
};

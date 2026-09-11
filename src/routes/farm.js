/*
 * 種田本身：買種子、種下、收成、賣出。
 *
 * 社課刻意保留的兩個漏洞都在這個檔案裡，而且都用 GET 執行會改變狀態的操作
 * （方便在網址列直接示範）。請不要拿這裡的寫法當真實專案的範例。
 */
const express = require('express');
const {
  SEEDS, validSeed, PLOT_COUNT, MAX_BUY_COUNT, MAX_MONEY, MAX_POINTS, SELL_MULTIPLIER
} = require('../config');
const { log } = require('../log');
const { isRoundActive } = require('../roundState');
const { getPlayer, plantings } = require('../players');

const router = express.Router();

function shopPage(message) {
  return `<!doctype html><meta charset="utf-8"><title>農場商店</title><link rel="icon" type="image/jpeg" href="/white_base_logo.jpg"><style>body{font:18px system-ui;max-width:42rem;margin:4rem auto;padding:0 1rem}a{color:#42566e}</style><h1>農場商店</h1><p>${message}</p><p><a href="/">回到遊戲</a></p><script>window.opener?.postMessage({type:'farmer-purchase-complete'}, location.origin)</script>`;
}

const validPlot = (plotIndex) => Number.isInteger(plotIndex) && plotIndex >= 0 && plotIndex < PLOT_COUNT;

// INTENTIONALLY VULNERABLE: cost comes straight from the query string.  It is
// only checked to be positive, then charged without comparing to SEEDS[seedType].price.
router.get('/buy_seed', (req, res) => {
  const { token, seedtype, count, totalprice } = req.query;
  log('buy_seed', req.query);
  const player = getPlayer(token);
  const quantity = Number(count);
  const submittedPrice = Number(totalprice);
  if (!player) return res.status(401).send(shopPage('購買失敗：token 無效。'));
  if (!isRoundActive()) return res.status(409).send(shopPage('購買失敗：目前不是比賽時間。'));
  if (!validSeed(seedtype)) return res.status(400).send(shopPage('購買失敗：找不到這種種子。'));
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_BUY_COUNT) {
    return res.status(400).send(shopPage(`購買失敗：數量必須是 1～${MAX_BUY_COUNT}。`));
  }
  if (!Number.isFinite(submittedPrice) || submittedPrice <= 0) return res.status(400).send(shopPage('購買失敗：總價必須大於 0。'));
  if (player.money < submittedPrice) return res.status(400).send(shopPage('購買失敗：金錢不足。'));

  player.money -= submittedPrice;
  player.seeds[seedtype] += quantity;
  res.send(shopPage(`購買成功：${SEEDS[seedtype].name} × ${quantity}，扣除 ${submittedPrice} 元。可關閉此分頁回到遊戲。`));
});

router.get('/plant', (req, res) => {
  const { token, plot, seedtype } = req.query;
  log('plant', req.query);
  const player = getPlayer(token);
  const plotIndex = Number(plot);
  if (!player) return res.status(401).json({ error: 'token 無效。' });
  if (!isRoundActive()) return res.status(409).json({ error: '目前不是比賽時間。' });
  if (!validPlot(plotIndex)) return res.status(400).json({ error: '田地位置錯誤。' });
  if (!validSeed(seedtype)) return res.status(400).json({ error: '種子種類錯誤。' });
  if (player.plots[plotIndex]) return res.status(400).json({ error: '這格田已經種了作物。' });
  if (player.seeds[seedtype] < 1) return res.status(400).json({ error: `庫存不足：沒有${SEEDS[seedtype].name}種子。` });
  player.seeds[seedtype] -= 1;
  // The actual click time is recorded in SQLite but maturity is deliberately
  // entrusted to the browser after it receives this value.
  player.plots[plotIndex] = { seedtype };
  const plantedAt = Date.now();
  plantings.record(player.token, plotIndex, seedtype, plantedAt);
  res.json({ ok: true, plot: plotIndex, seedtype, plantedAt });
});

// INTENTIONALLY VULNERABLE: no elapsed-time check. The browser decides whether
// to show the harvest button from its local clock and the timestamp it received.
router.get('/harvest', (req, res) => {
  const { token, plot } = req.query;
  log('harvest', req.query);
  const player = getPlayer(token);
  const plotIndex = Number(plot);
  if (!player) return res.status(401).json({ error: 'token 無效。' });
  if (!isRoundActive()) return res.status(409).json({ error: '目前不是比賽時間。' });
  if (!validPlot(plotIndex) || !player.plots[plotIndex]) {
    return res.status(400).json({ error: '這格田沒有可收成的作物。' });
  }
  const { seedtype } = player.plots[plotIndex];
  player.plots[plotIndex] = null;
  plantings.remove(player.token, plotIndex);
  player.crops[seedtype] += 1;
  res.json({ ok: true, seedtype, message: `收成 ${SEEDS[seedtype].name} 成功。` });
});

router.get('/sell', (req, res) => {
  const { token, seedtype, count } = req.query;
  log('sell', req.query);
  const player = getPlayer(token);
  const quantity = Number(count);
  if (!player) return res.status(401).json({ error: 'token 無效。' });
  if (!isRoundActive()) return res.status(409).json({ error: '目前不是比賽時間。' });
  if (!validSeed(seedtype)) return res.status(400).json({ error: '作物種類錯誤。' });
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > player.crops[seedtype]) {
    return res.status(400).json({ error: '作物數量不足。' });
  }
  const earnedMoney = SEEDS[seedtype].price * SELL_MULTIPLIER * quantity;
  const earnedScore = SEEDS[seedtype].score * quantity;
  player.crops[seedtype] -= quantity;
  player.money = Math.min(MAX_MONEY, player.money + earnedMoney);
  player.score = Math.min(MAX_POINTS, player.score + earnedScore);
  res.json({ ok: true, earnedMoney, earnedScore, money: player.money, score: player.score });
});

module.exports = router;

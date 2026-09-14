/*
 * CTF 農場 —— 校內資安體驗用，刻意保留兩個前端／URL 信任問題。
 * 請只在主辦方管理的區網與授權活動中使用，不要部署到公網。
 *
 * 這個檔案只負責組裝與啟動；實際邏輯在 src/ 底下：
 *   config / log / db / migrations  基礎設施
 *   roundState / players / rounds   遊戲狀態
 *   routes/player · farm · admin    HTTP 介面
 */
const express = require('express');
const { PORT, PUBLIC_DIR, MAX_PLAYERS, DEFAULT_ADMIN_PASSWORD } = require('./src/config');
const { admins, applyEnvAdmin } = require('./src/admins');
const { plantings } = require('./src/players');

const app = express();
app.use(express.json());
// redirect:false —— public/admin/ 是個目錄，預設的 serve-static 會把 GET /admin
// 301 轉到 /admin/，網址列跟著變。關掉之後目錄請求直接往下交給路由處理。
app.use(express.static(PUBLIC_DIR, { redirect: false }));
app.use(require('./src/routes/player'));
app.use(require('./src/routes/farm'));
app.use(require('./src/routes/admin'));
app.use(require('./src/routes/bonus'));

// Live round state stays in memory, so planting timestamps are dropped at each
// start.  Accounts and their cumulative scores deliberately survive a restart.
plantings.clearAll();

const envAdmin = applyEnvAdmin();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`CTF Farmer Game: http://0.0.0.0:${PORT}`);
  console.log(`管理頁面：http://0.0.0.0:${PORT}/admin`);
  if (envAdmin?.action === 'created') console.log(`已建立管理員帳號：${envAdmin.username}`);
  if (envAdmin?.action === 'updated') console.log(`已依 .env 更新管理員 ${envAdmin.username} 的密碼。`);
  for (const account of admins.list()) {
    if (admins.verify(account.username, DEFAULT_ADMIN_PASSWORD)) {
      console.log(`警告：管理員 ${account.username} 的密碼仍是預設的 ${DEFAULT_ADMIN_PASSWORD}，請執行 npm run add-admin -- --reset ${account.username} 更換。`);
    }
  }
  console.log(`管理員共 ${admins.count()} 組；新增請執行 npm run add-admin -- <帳號>。`);
  console.log(`最多 ${MAX_PLAYERS} 位玩家；累計分數存在 farmer.sqlite，重新啟動不會清空。`);
});

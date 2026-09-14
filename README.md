# CTF 農場（校內資安體驗用）

一個簡單的種田網頁遊戲，為受控社課刻意保留三類前端／URL 信任問題（竄改網址參數、由瀏覽器判斷作物成熟、用 `hidden` 屬性藏起來的農地），另有一個 `robots.txt` 洩漏隱藏頁的彩蛋。請只在主辦方管理的區網與授權活動中使用，**不要把它部署到公網**。

## 啟動

需要 Node.js 22 以上版本。

```bash
npm install
npm start
```

預設會監聽所有網路介面的 `3000` 埠。主辦筆電自己可開啟 `http://localhost:3000`。

若主辦筆電已有 Docker，也可以只用一個指令啟動：

```bash
cp .env.example .env    # 只有第一次需要；打開 .env 改掉管理密碼
docker compose up --build
```

管理頁面位於 `http://localhost:3000/admin`。預設每局 10 分鐘、休息 1 分鐘，**活動中可以直接在管理台改**；也可以在啟動時指定初始值：

```bash
ROUND_SECONDS=300 BREAK_SECONDS=30 docker compose up --build
```

### 伺服器上要先準備好

```bash
git clone <repo> /home/nctfu/NCtfU-Farmer-KoH
cd /home/nctfu/NCtfU-Farmer-KoH
cp .env.example .env          # 填入管理台帳密
```

部署目錄寫在 workflow 最上面的 `env.DEPLOY_DIR`，要換路徑改那一行即可。該機器需要 Docker 與 Docker Compose plugin，runner 帳號要有執行 Docker 的權限。

### 幾個刻意的設計

- **管理台帳密讀伺服器上的 `.env`**，不從 GitHub Secrets 注入。`.env` 在 `.gitignore` 裡，`git pull` 不會覆蓋它，compose 會自動帶進容器；密碼因此不會出現在 workflow log，也不必存進 GitHub。
- **不另外執行 migration**。schema 升級已經在容器啟動流程裡（`src/db.js` 在 require 階段就跑完，失敗直接 `process.exit(1)`），單獨跑反而會出現「新程式已在服務、schema 還沒更新」的空窗。
- **最後一步會輪詢 `/api/game-state`**（最多 30 次、每次間隔 2 秒）。migration 失敗時容器起不來，這一步會讓整個 deploy 紅掉並印出最後 50 行 log；少了它，失敗會完全無聲。這個 app 沒有 `/health`，用這支免 token 的端點代替。
- **資料不會因為重新部署而消失**。`farmer-data` named volume 保存 SQLite 與 `activity.log`，`--build` 不會動到它。真的要連帳號一起清空才用 `docker compose down -v`。

## 重置活動

本局進行中的金錢、種子、作物與田地只存在伺服器記憶體，按 `Ctrl+C` 停止服務就會消失。但**玩家帳號（暱稱＋PIN）與累計分數存在 SQLite `farmer.sqlite`，重新啟動不會清空**——這是刻意的，主辦筆電中途當掉也不會讓大家的累計歸零。

要完整重置有兩種方式：

- 在管理台按「開始新活動（清除玩家）」，刪除所有玩家帳號、PIN、累計分數與本局資料；管理員帳號、時間設定與公告會保留。
- 停掉服務並刪除 `farmer.sqlite`（連同 `farmer.sqlite-wal`、`farmer.sqlite-shm`），連帳號一起清空。
- Docker 部署若要連帳號與 log 一起完整清除，可在確認活動資料不再需要後執行 `docker compose down -v`；這會刪除 `farmer-data` volume，無法由應用程式復原。

API 呼叫紀錄會持續附加在 `activity.log`，可在下一場活動前手動刪除該檔案。

## KOTH 回合與管理台

開啟 `/admin`，以管理員帳號登入後即可控制活動（帳號管理見下一節）。登入後瀏覽器只保存一組 session token，密碼不會被存下來；按「登出」或重新啟動伺服器即失效。

- 「開始新活動（清除玩家）」會永久刪除所有玩家帳號、PIN、累計分數與本局資料，再開始第 1 局；按下前會再確認一次。
- 「接續開始（保留累計）」會**接回原本的第 n 局**繼續跑，保留 SQLite 中既有的玩家與累計分數。局數本身也存在資料庫，所以伺服器中途重開後按這顆不會被打回第 1 局。想推進到下一局請改用「提早開始下一局」。
- 每局時間到會自動結算本局分數（同時寫入 SQLite），接著進入固定休息時間。
- 休息結束後會自動開始下一局。
- 主辦方也可以提早結算本局或提早開始下一局。
- 「暫停」會凍結倒數，進入既不算遊戲也不算休息的狀態：玩家的錢、種子、田地與本局分數全部保持原樣，但買種子、種植、收成、販售都會被擋下。**它不刪除任何資料。**
- 「繼續」把暫停的活動解凍，從剩下的時間接回原本那一局。暫停後也可以改按「開始」重來（那會清空全部）。
- 若伺服器在暫停期間重新啟動，凍結的剩餘時間只存在記憶體，會消失；這時「繼續」會用同一個局數重開一局，累計分數仍從 SQLite 接回來。
- 每局開始時，玩家會回到 100 元、0 本局分數，種子、作物與全部 20 格田地（看得到的 4 格＋藏起來的 16 格）也會清空。
- 「本局排行榜」顯示目前一局（休息時顯示剛結束的一局）；「累計排行榜」加總所有已結算局數，進行中的分數也會即時納入顯示。
- 「玩家帳號」可以逐一管理玩家：清單顯示暱稱、累計分數、已玩局數、是否在線與本局分數。「刪除」會一併清掉該玩家的累計分數、目前連線與種植資料（對方畫面會退回登入頁），無法復原；「重設 PIN」給忘記 PIN 的人一組新的六位數字，不影響分數。清單不會自動更新，操作後或按「重新整理」才重讀。
- 「時間設定」可隨時修改每局與休息秒數（每局至少 10 秒、休息至少 5 秒，上限 7200 秒）。改完會在**下一局**開始時生效，不會讓正在跑的倒數突然跳動；想立刻結束目前這局請按「提早結算本局」。這組設定存在資料庫的 `settings` 表，重新啟動仍保留——也就是說在管理台改過之後，`.env` 裡的 `ROUND_SECONDS` / `BREAK_SECONDS` 就只是初始值、不再覆蓋它。
- 等待開始、休息與活動結束期間，後端會拒絕購買、種植、收成與販售操作。

## 程式結構

`server.js` 只負責組裝與啟動，實際邏輯都在 `src/`：

```
server.js              入口：建立 app、掛路由、啟動訊息
src/
  config.js            環境變數、遊戲常數、SEEDS（其他模組不自己讀 process.env）
  log.js               寫 activity.log
  migrations.js        schema 版本定義 ← 要改資料表就改這裡
  db.js                開啟 SQLite 並執行 migration
  admins.js            管理員帳號（scrypt 雜湊）與登入 session
  settings.js          可在管理台即時調整的設定（每局／休息秒數）
  announcements.js     公告的存取
  roundState.js        回合狀態資料（phase／局數／結束時間）
  players.js           玩家 registry、帳號與累計分數、種植時間
  rounds.js            回合與活動的狀態機
  routes/
    player.js          /api/config · /api/game-state · /api/announcements · /api/register · /api/me · /api/leaderboard
    farm.js            /buy_seed · /plant · /harvest · /sell ← 兩個刻意漏洞都在這裡
    admin.js           /admin 頁面與 /api/admin/*（含公告與時間設定）
    bonus.js           /extrabigbonus 隱藏加分頁與 /api/bonus
scripts/add-admin.js   管理員帳號維護工具
public/
  index.html · app.js          玩家頁
  extrabigbonus.html           robots.txt 洩漏的隱藏加分頁
  robots.txt
  admin/                       管理台，資料夾結構對齊 /admin/* 網址
    style.css                  三頁共用樣式
    common.js                  三頁共用的登入閘門與 session
    control.html · control.js  /admin　活動控制與時間設定
    player.html · player.js    /admin/player　玩家帳號管理
    announcement.html · .js    /admin/announcement　公告管理
  images/                      logo 等圖片，網址是 /images/<檔名>
```

相依方向是單向的：`routes/` → `rounds`／`players`／`admins` → `roundState`／`db` → `migrations`／`config`。`roundState.js` 之所以獨立出來，是因為 `players.js` 要知道現在是不是比賽中（才能算累計分數），而 `rounds.js` 要修改這些欄位——把純狀態抽出來，兩邊都只依賴它，避免互相 require。

刻意保留的問題分布如下，原始碼中都有中文註解說明：

- **竄改 `totalprice`**、**收成不驗成熟時間**——`src/routes/farm.js`，以 `INTENTIONALLY VULNERABLE` 標示。
- **用 `hidden` 藏起來的 4×4 農地**——版面在 `public/index.html`，格數在 `src/config.js`（`VISIBLE_PLOT_COUNT` / `HIDDEN_PLOT_COUNT`）。後端只用 `PLOT_COUNT` 驗證編號，不在乎前端有沒有畫出來。
- **`robots.txt` 洩漏隱藏加分頁**——`public/robots.txt` 與 `src/routes/bonus.js`。

## 資料庫與 migration

資料存在 SQLite `farmer.sqlite`，schema 版本記在 `PRAGMA user_version`。啟動伺服器或執行任何 script 時都會自動把舊資料庫升級到最新版，升級內容會印在終端機，不需要手動下 SQL。目前的版本：

| 版本 | 內容 |
| ---: | --- |
| v1 | `plantings`（種植時間）、`accounts`（玩家暱稱／PIN／累計分數） |
| v2 | `admin_accounts`（管理員帳號與密碼雜湊） |
| v3 | `settings`（可在管理台調整的設定；局數也存在這張表） |
| v4 | `announcements`（公告） |

要改 schema 就在 `src/migrations.js` 的 `MIGRATIONS` 陣列後面**新增一筆**，不要修改既有項目——已經升級過的資料庫不會重跑舊的步驟。

## 管理員帳號


```ini
ADMIN_USER=admin
ADMIN_PASSWORD=請換成自己的密碼
```

`.env` 由 Node 22 內建支援讀取，不需要額外套件，`npm start` 與 `docker compose up` 都會讀到。`.env` 已列入 `.gitignore` 與 `.dockerignore`，不會進版本控制，也不會被打包進映像檔。

**這組帳密每次啟動都會套用到資料庫**：帳號不存在就建立，密碼和 `.env` 不一樣就更新成 `.env` 的值。所以改完 `.env` 重開伺服器就生效，不必另外下指令。若同時設了真正的環境變數（例如 `ADMIN_PASSWORD=xxx npm start`），環境變數優先於 `.env`。

完全不設 `ADMIN_USER` / `ADMIN_PASSWORD` 時，只有在資料庫一個管理員都沒有的情況下才會建立預設的 `admin` / `change-me`；用下面的指令刪掉的帳號不會在重開後復活。密碼還是 `change-me` 時，每次啟動都會在終端機警告。

管理員密碼在資料庫中以 scrypt 加隨機 salt 雜湊，不存明文。除了 `.env` 這組主控帳號，還可以用下面的指令另外建立帳號（這些帳號不受 `.env` 影響）。

```bash
npm run add-admin -- 小明              # 互動輸入密碼（輸入兩次確認，不會顯示在畫面上）
npm run add-admin -- 小明 --generate   # 隨機產生密碼並印出來
npm run add-admin -- --list            # 列出所有管理員
npm run add-admin -- --reset 小明       # 更換既有帳號的密碼
npm run add-admin -- --remove 小明      # 刪除帳號（會擋下刪掉最後一組）
```

`--password <密碼>` 也可以直接帶在指令上，但密碼會留在 shell 紀錄裡，建議只在腳本或 Docker 裡用。容器內請改成 `docker compose exec farmer-game npm run add-admin -- <帳號>`。

## 設計備註

- 最多建立 50 位玩家；本局與累計排行榜各自只顯示前三名。
- 玩家其實有 20 格田地：畫面上的 2×2 共 4 格，加上用 HTML `hidden` 屬性藏起來的 4×4 共 16 格。後端只用 `PLOT_COUNT` 檢查編號，不在乎前端有沒有把那些格子畫出來，所以在開發人員工具刪掉 `hidden` 就能正常使用並計分——這是刻意留的第三個練習。
- 註冊需要暱稱和六位數 PIN，成功後瀏覽器以 token 維持該玩家身分。暱稱＋PIN 就是帳號：同一個暱稱再次進入必須輸入當初的 PIN，輸錯會被擋下，輸對則接回原本的累計分數。
- 累計分數記在 SQLite 的 `accounts` 表；「總排行」直接讀這張表，所以已經離開的玩家仍會留在榜上，目前在場者則即時加上本局未結算的分數。
- 玩家初始有 100 元、0 分；賣出會回收原始購入價格的 1.5 倍金錢，並取得該作物對應的分數。金錢與分數上限皆為 1,000,000。
- 種下瞬間的時間會寫入本機 SQLite 資料庫 `farmer.sqlite`；但它會原樣交給前端判斷成熟，伺服器不會在收成時重新驗證。
- 每個 API 請求及其參數都寫入 `activity.log`；它只供活動後講解，沒有做即時封鎖或限流。

主辦方講解可直接閱讀 [HOST_WRITEUP.md](HOST_WRITEUP.md)。

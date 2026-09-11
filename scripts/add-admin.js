#!/usr/bin/env node
/*
 * 管理員帳號維護工具。
 *
 *   node scripts/add-admin.js <帳號>                  互動輸入密碼（輸入兩次確認）
 *   node scripts/add-admin.js <帳號> --password <密碼>  直接指定（會留在 shell 紀錄裡）
 *   node scripts/add-admin.js <帳號> --generate        隨機產生密碼並印出
 *   node scripts/add-admin.js --list                  列出所有管理員
 *   node scripts/add-admin.js --reset <帳號> [...]     更換既有帳號的密碼
 *   node scripts/add-admin.js --remove <帳號>          刪除帳號
 */
const crypto = require('crypto');
const readline = require('readline');
const { admins } = require('../src/admins');
const { DB_FILE } = require('../src/config');

const MIN_LENGTH = 8;

function usage() {
  console.log(require('fs').readFileSync(__filename, 'utf8').split('*/')[0].split('\n').slice(2, -1)
    .map((line) => line.replace(/^ \* ?/, '')).join('\n'));
}

function parseArgs(argv) {
  const options = { positional: [], password: null, generate: false, list: false, reset: false, remove: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--password') { options.password = argv[i += 1]; continue; }
    if (arg === '--generate') { options.generate = true; continue; }
    if (arg === '--list') { options.list = true; continue; }
    if (arg === '--reset') { options.reset = true; continue; }
    if (arg === '--remove') { options.remove = true; continue; }
    if (arg === '--help' || arg === '-h') { options.help = true; continue; }
    if (arg.startsWith('-')) throw new Error(`不認得的選項：${arg}`);
    options.positional.push(arg);
  }
  return options;
}

// readline echoes what is typed, so the prompt is written first and every
// later write is swallowed until the answer comes back.
function askHidden(promptText) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      return reject(new Error('這不是互動式終端機，請改用 --password 或 --generate。'));
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    let muted = false;
    rl._writeToOutput = (chunk) => { if (!muted) rl.output.write(chunk); };
    rl.question(promptText, (value) => {
      rl.close();
      process.stdout.write('\n');
      resolve(value);
    });
    muted = true;
  });
}

async function choosePassword(options, { confirm = true } = {}) {
  if (options.generate) {
    // 18 bytes of base64url ≈ 24 printable characters.
    const generated = crypto.randomBytes(18).toString('base64url');
    console.log(`已產生密碼：${generated}`);
    console.log('請立刻記下來，這串不會再顯示第二次。');
    return generated;
  }
  if (options.password !== null && options.password !== undefined) {
    if (options.password.length < MIN_LENGTH) throw new Error(`密碼至少需要 ${MIN_LENGTH} 個字元。`);
    return options.password;
  }
  const password = await askHidden(`請輸入密碼（至少 ${MIN_LENGTH} 個字元）：`);
  if (password.length < MIN_LENGTH) throw new Error(`密碼至少需要 ${MIN_LENGTH} 個字元。`);
  if (confirm) {
    const again = await askHidden('請再輸入一次：');
    if (password !== again) throw new Error('兩次輸入的密碼不一致。');
  }
  return password;
}

function requireName(options, action) {
  const [name] = options.positional;
  if (!name) throw new Error(`請指定要${action}的帳號。`);
  return name;
}

function printList() {
  const rows = admins.list();
  if (rows.length === 0) return console.log('目前沒有任何管理員帳號。');
  console.log(`共 ${rows.length} 組管理員帳號：`);
  for (const row of rows) {
    console.log(`  ${row.username}　（建立於 ${new Date(row.created_at).toLocaleString('zh-TW')}）`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const hasAction = options.list || options.reset || options.remove;
  if (options.help || (options.positional.length === 0 && !hasAction)) return usage();

  if (options.list) return printList();

  if (options.remove) {
    const name = requireName(options, '刪除');
    // Check existence first, or deleting a typo reports the wrong reason.
    if (!admins.find(name)) throw new Error(`找不到管理員帳號 ${name}。`);
    if (admins.count() <= 1) throw new Error('這是最後一組管理員帳號，刪掉就沒有人能進管理台了。');
    admins.remove(name);
    return console.log(`已刪除管理員 ${name}。`);
  }

  if (options.reset) {
    const name = requireName(options, '更換密碼');
    if (!admins.find(name)) throw new Error(`找不到管理員帳號 ${name}。`);
    admins.setPassword(name, await choosePassword(options));
    return console.log(`已更新 ${name} 的密碼。`);
  }

  const name = requireName(options, '新增');
  if (admins.find(name)) throw new Error(`管理員帳號 ${name} 已經存在，要換密碼請加 --reset。`);
  admins.add(name, await choosePassword(options));
  console.log(`已新增管理員 ${name}（資料庫：${DB_FILE}）。`);
}

main().catch((error) => {
  console.error(`錯誤：${error.message}`);
  process.exitCode = 1;
});

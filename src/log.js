/*
 * 每個 API 呼叫與參數都寫進 activity.log，供活動後講解使用。
 * 這裡沒有做限流或即時封鎖 —— 紀錄是事後看的，不是防護。
 */
const fs = require('fs');
const { LOG_FILE } = require('./config');

function log(action, params) {
  const row = JSON.stringify({ at: new Date().toISOString(), action, params });
  console.log(row);
  fs.appendFile(LOG_FILE, `${row}\n`, () => {});
}

module.exports = { log };

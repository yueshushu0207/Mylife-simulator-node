/* ============================================================
 * store.js — 生辰（八字）记录落盘
 * 每次玩家写入生辰开局，服务端重算八字后追加写入 data/ 目录：
 *   data/bazi-records.jsonl   完整记录（每行一条 JSON，机器可读）
 *   data/bazi-records.csv     简明表格（Excel 可直接打开，带 BOM）
 *   data/bazi-summary.json    统计汇总（总数 / 年代分布 / 最近记录）
 *
 * 说明：
 *  - 服务端以 reception 的原始年月日时重算八字，不信任前端传来的排盘结果
 *  - 不记录 IP / UA 等任何可用于定位个人的信息
 * ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const Bazi = require('./js/bazi.js');

const DATA_DIR = path.join(__dirname, 'data');
const JSONL_FILE = path.join(DATA_DIR, 'bazi-records.jsonl');
const CSV_FILE = path.join(DATA_DIR, 'bazi-records.csv');
const SUMMARY_FILE = path.join(DATA_DIR, 'bazi-summary.json');

/* 写入串行队列：避免并发追加导致行交错 */
let chain = Promise.resolve();
function enqueue(task) {
  chain = chain.then(task).catch(e => { console.error('[store] 写入失败:', e.message); });
  return chain;
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

/* ---------------- CSV ---------------- */
const CSV_HEADER = [
  'id', 'created_at', 'birth_year', 'birth_month', 'birth_day', 'birth_hour',
  'hour_label', 'hour_known', 'gender',
  'year_pillar', 'month_pillar', 'day_pillar', 'hour_pillar',
  'day_master', 'day_master_nature',
  'wuxing_jin', 'wuxing_mu', 'wuxing_shui', 'wuxing_huo', 'wuxing_tu',
  'era_from', 'era_to', 'era_label'
];

function csvEscape(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function toCsvLine(rec) {
  return [
    rec.id, rec.createdAt, rec.birth.year, rec.birth.month, rec.birth.day,
    rec.birth.hour === null ? '' : rec.birth.hour,
    rec.birth.hourLabel || '不详', rec.birth.hourKnown ? 'Y' : 'N', rec.birth.gender,
    rec.bazi.year, rec.bazi.month, rec.bazi.day, rec.bazi.hour,
    rec.dayMaster, rec.dayMasterNature,
    rec.wuxing['金'] || 0, rec.wuxing['木'] || 0, rec.wuxing['水'] || 0,
    rec.wuxing['火'] || 0, rec.wuxing['土'] || 0,
    rec.era.from, rec.era.to, rec.era.label
  ].map(csvEscape).join(',');
}

/* ---------------- 统计汇总 ---------------- */
function readRecords() {
  try {
    const text = fs.readFileSync(JSONL_FILE, 'utf8');
    return text.split(/\r?\n/).filter(Boolean).map(line => {
      try { return JSON.parse(line); } catch (_) { return null; }
    }).filter(Boolean);
  } catch (_) { return []; }
}

function buildSummary(records) {
  const byYear = {}, byGender = {}, byHour = { '已知': 0, '不详': 0 };
  records.forEach(r => {
    const y = r.birth && r.birth.year;
    if (y) byYear[y] = (byYear[y] || 0) + 1;
    const g = (r.birth && r.birth.gender) || '未知';
    byGender[g] = (byGender[g] || 0) + 1;
    if (r.birth && r.birth.hourKnown) byHour['已知']++; else byHour['不详']++;
  });
  const sortDesc = obj => Object.fromEntries(Object.entries(obj).sort((a, b) => b[1] - a[1]));
  return {
    total: records.length,
    updatedAt: new Date().toISOString(),
    firstRecordAt: records.length ? records[0].createdAt : null,
    lastRecordAt: records.length ? records[records.length - 1].createdAt : null,
    byBirthYear: sortDesc(byYear),
    byGender: byGender,
    byHourKnown: byHour,
    recent: records.slice(-20).reverse().map(r => ({
      id: r.id, createdAt: r.createdAt,
      birth: r.birth.year + '-' + String(r.birth.month).padStart(2, '0') + '-' + String(r.birth.day).padStart(2, '0'),
      hourLabel: r.birth.hourLabel || '不详',
      gender: r.birth.gender,
      pillars: r.bazi.year + ' ' + r.bazi.month + ' ' + r.bazi.day + ' ' + r.bazi.hour,
      dayMaster: r.dayMaster,
      era: r.era.label
    }))
  };
}

/**
 * 记录一条生辰
 * @param {{year:number, month:number, day:number, hour:number|null, gender:string}} birth
 * @returns {Promise<{ok:boolean, id?:string, total?:number, error?:string}>}
 */
function saveBaziRecord(birth) {
  const y = parseInt(birth.year, 10);
  const m = parseInt(birth.month, 10);
  const d = parseInt(birth.day, 10);
  const h = (birth.hour === null || birth.hour === undefined || birth.hour === '' || birth.hour === '不详')
    ? null : parseInt(birth.hour, 10);
  const gender = birth.gender || '随机';

  if (!isFinite(y) || y < 1900 || y > new Date().getFullYear()) return Promise.resolve({ ok: false, error: '出生年份不合法' });
  if (!isFinite(m) || m < 1 || m > 12) return Promise.resolve({ ok: false, error: '出生月份不合法' });
  if (!isFinite(d) || d < 1 || d > 31) return Promise.resolve({ ok: false, error: '出生日期不合法' });
  if (h !== null && (!isFinite(h) || h < 0 || h > 23)) return Promise.resolve({ ok: false, error: '出生时辰不合法' });
  // 真实日历校验（Date 会自动回绕非法日期，如 2 月 31 日 → 3 月 2/3 日）
  const probe = new Date(y, m - 1, d);
  if (probe.getFullYear() !== y || probe.getMonth() !== m - 1 || probe.getDate() !== d) {
    return Promise.resolve({ ok: false, error: '该月没有 ' + d + ' 日' });
  }

  // 服务端重算，不信任前端排盘
  let b;
  try {
    b = Bazi.computeBazi(y, m, d, h);
  } catch (e) {
    return Promise.resolve({ ok: false, error: '排盘失败：' + e.message });
  }
  const era = Bazi.eraFor(y);

  const rec = {
    id: 'B' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7),
    createdAt: new Date().toISOString(),
    birth: {
      year: y, month: m, day: d,
      hour: h, hourLabel: h !== null ? b.hourLabel : '时辰不详',
      hourKnown: h !== null,
      gender: gender
    },
    bazi: b.pillars,
    dayMaster: b.dayMaster,
    dayMasterNature: b.dayMasterNature,
    wuxing: b.wuxing,
    wuxingText: b.wuxingText,
    era: { from: era.from, to: era.to, label: era.label },
    ending: null // 预留：人生结局补录
  };

  return enqueue(() => {
    ensureDataDir();

    // 1) JSONL 追加
    fs.appendFileSync(JSONL_FILE, JSON.stringify(rec) + '\n', 'utf8');

    // 2) CSV 追加（首行写表头）
    const records = readRecords();
    const needHeader = !fs.existsSync(CSV_FILE) || fs.statSync(CSV_FILE).size === 0;
    let csv = toCsvLine(rec) + '\n';
    if (needHeader) csv = '\uFEFF' + CSV_HEADER.join(',') + '\n' + csv; // BOM 便于 Excel
    fs.appendFileSync(CSV_FILE, csv, 'utf8');

    // 3) 汇总重写
    fs.writeFileSync(SUMMARY_FILE, JSON.stringify(buildSummary(records), null, 2), 'utf8');

    return { ok: true, id: rec.id, total: records.length, era: era.label, pillars: rec.bazi };
  });
}

function getSummary() {
  try { return JSON.parse(fs.readFileSync(SUMMARY_FILE, 'utf8')); }
  catch (_) { return { total: 0, recent: [] }; }
}

module.exports = {
  saveBaziRecord,
  getSummary,
  DATA_DIR,
  JSONL_FILE,
  CSV_FILE,
  SUMMARY_FILE
};

/* ============================================================
 * bazi.js — 生辰八字 · 时代背景（浏览器 / Node 双端可用）
 * 依据公历出生日期与时辰排盘：
 *   年柱 —— 以立春为界（寿星公式近似，±1 天可接受）
 *   月柱 —— 以节气为界（各公历月主节气近似日期，2 月用立春近似）
 *   日柱 —— 儒略日推算，锚点 1949-10-01 甲子日（精确）
 *   时柱 —— 五鼠遁（精确）
 * 另含：五行统计、日主十干性命、1949-2035 时代背景表与大事年表
 * ============================================================ */
(function (global) {
  'use strict';

  /* ---------------- 基础干支表 ---------------- */
  var TG = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
  var DZ = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
  // 天干五行 / 地支五行
  var TG_WX = ['木', '木', '火', '火', '土', '土', '金', '金', '水', '水'];
  var DZ_WX = ['水', '土', '木', '木', '土', '火', '火', '土', '金', '金', '土', '水'];

  // 十干物象与性情（仅作文案风味）
  var TG_NATURE = {
    '甲': '参天大树', '乙': '花草之木', '丙': '太阳之火', '丁': '灯烛之火',
    '戊': '城墙之土', '己': '田园之土', '庚': '剑锋之金', '辛': '珠玉之金',
    '壬': '江河之水', '癸': '雨露之水'
  };
  var TG_PERSONALITY = {
    '甲': '正直进取有担当', '乙': '柔韧细腻善适应', '丙': '热烈开朗乐于表现',
    '丁': '内敛专注重细节', '戊': '稳重可靠能承压', '己': '包容务实善经营',
    '庚': '果断刚毅讲原则', '辛': '精致敏锐重品质', '壬': '睿智奔涌善变通',
    '癸': '细腻敏感润物无声'
  };

  /* ---------------- 时辰 ---------------- */
  var HOURS = [
    { zhi: '子', from: 23 }, { zhi: '丑', from: 1 }, { zhi: '寅', from: 3 },
    { zhi: '卯', from: 5 }, { zhi: '辰', from: 7 }, { zhi: '巳', from: 9 },
    { zhi: '午', from: 11 }, { zhi: '未', from: 13 }, { zhi: '申', from: 15 },
    { zhi: '酉', from: 17 }, { zhi: '戌', from: 19 }, { zhi: '亥', from: 21 }
  ];

  function hourZhiIndex(hour) {
    return Math.floor(((hour + 1) % 24) / 2);
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function hourLabel(hour) {
    if (hour == null) return '时辰不详';
    var h = HOURS[hourZhiIndex(hour)];
    var to = h.from === 23 ? 1 : h.from + 2;
    return h.zhi + '时（' + pad2(h.from) + ':00-' + pad2(to) + ':00）';
  }

  /* ---------------- 时代背景表（1949 起） ---------------- */
  var ERAS = [
    { from: 1949, to: 1952, label: '开国之初',
      backdrop: '新中国成立，百废待兴。农村土改、城市扫盲，物资凭票供应，供销社门口排长队，人们满怀热情建设新国家' },
    { from: 1953, to: 1957, label: '建设年代',
      backdrop: '第一个五年计划，苏联援建工厂，公私合营，手表/自行车/缝纫机"三大件"开始进入家庭，农村成立合作社' },
    { from: 1958, to: 1961, label: '艰难岁月',
      backdrop: '大炼钢铁、人民公社、公共食堂，随后遭遇全国性经济困难，家家勒紧裤腰带，瓜菜代粮，过年才吃上一顿饺子' },
    { from: 1962, to: 1965, label: '调整恢复',
      backdrop: '国民经济调整，自留地恢复、集市重现，生活渐渐缓过来，原子弹爆炸成功，学雷锋运动席卷全国' },
    { from: 1966, to: 1976, label: '动荡岁月',
      backdrop: '运动席卷全国，学校停课，知识青年上山下乡，广播与样板戏贯穿日常，物资凭票供应，婚丧从简' },
    { from: 1977, to: 1979, label: '拨乱反正',
      backdrop: '恢复高考改变一代人命运，知青陆续返城，思想解冻，邓丽君歌声悄悄流传，女排夺冠振奋人心' },
    { from: 1980, to: 1989, label: '改革开放之初',
      backdrop: '农村家庭联产承包，个体户与"万元户"出现，黑白电视、录音机、喇叭裤流行，第一次南下淘金热' },
    { from: 1990, to: 1999, label: '市场经济浪潮',
      backdrop: '下海潮与下岗潮并存，股票认购证、VCD、卡拉OK、寻呼机、大哥大相继登场，商品房与贷款出现，互联网以局域网形式进入大学' },
    { from: 2000, to: 2007, label: '千禧年',
      backdrop: '加入WTO，外贸工厂遍地，网吧、QQ与短信时代，手机从奢侈品变成日用品，商品房货币化，私家车进入家庭，北京申奥成功，非典之夏' },
    { from: 2008, to: 2014, label: '高铁与移动互联网',
      backdrop: '北京奥运，高铁成网，智能手机普及，微博微信改变社交，移动支付出门不用带钱包，房价快速上涨，大众创业热潮' },
    { from: 2015, to: 2019, label: '移动互联网时代',
      backdrop: '4G全覆盖，短视频、直播、外卖、网约车重塑日常，扫码支付遍及菜市场，加班文化盛行，考研热升温' },
    { from: 2020, to: 2035, label: '当代',
      backdrop: '新冠疫情深刻改变生活与工作方式，健康码、网课与远程办公，AI大模型与新能源车爆发，老龄化与少子化加剧，考公考编热' }
  ];

  /* 时代大事年表（中立、生活化；注入提示词供 AI 按角色年龄段取材） */
  var ERA_EVENTS = [
    [1950, '土地改革，抗美援朝'],
    [1953, '第一个五年计划，苏联援建工厂'],
    [1956, '公私合营，"三大件"开始流行'],
    [1958, '人民公社与公共食堂，大炼钢铁'],
    [1962, '经济调整，集市重现，生活缓口气'],
    [1964, '第一颗原子弹爆炸成功，学雷锋运动'],
    [1966, '运动开始，学校停课'],
    [1968, '上山下乡，知青离城'],
    [1971, '中国恢复联合国合法席位'],
    [1977, '恢复高考，知青陆续返城'],
    [1978, '改革开放，家庭联产承包'],
    [1980, '个体户出现，"万元户"令人羡慕'],
    [1984, '洛杉矶奥运会许海峰夺金'],
    [1986, '义务教育法颁布，彩色电视进入家庭'],
    [1990, '股票认购证热，下海潮起'],
    [1992, '全民经商热潮'],
    [1994, '住房商品化起步'],
    [1997, '亚洲金融风暴'],
    [1998, '福利分房取消，商品房时代'],
    [2001, '加入世界贸易组织，北京申奥成功'],
    [2003, '非典之夏，互联网复苏'],
    [2006, '农业税取消'],
    [2008, '北京奥运，汶川地震'],
    [2010, '微博兴起，移动互联网起步'],
    [2011, '微信上线'],
    [2013, '4G元年，移动支付爆发'],
    [2015, '短视频与直播兴起，二胎政策'],
    [2018, '楼市调控'],
    [2020, '新冠疫情，健康码与网课'],
    [2021, '双减政策出台'],
    [2023, 'AI大模型爆发'],
    [2025, '新能源车普及，AI应用加速']
  ];

  function eraFor(year) {
    if (year == null) return ERAS[ERAS.length - 1];
    return ERAS.find(function (e) { return year >= e.from && year <= e.to; }) || ERAS[ERAS.length - 1];
  }

  // 取角色一生可能经历的时代大事（出生当年 ~ 寿命届满），最多 14 条
  function eraEventsFor(birthYear, lifespan) {
    if (birthYear == null) return [];
    var to = Math.min(birthYear + (lifespan || 90) + 3, 2035);
    var list = ERA_EVENTS.filter(function (e) { return e[0] >= birthYear - 1 && e[0] <= to; });
    return list.slice(0, 14);
  }

  /* ---------------- 年代购买力与同时代财富档位 ----------------
   * 记账口径统一为"万元"（wealth 1 点 = 1 万元），但 1 万元的购买力随年代天差地别：
   * 1960 年代 1 万元是天文数字，2020 年代 1 万元是一两个月的工资。
   * PURCHASE_POWER：每段的 coef = 该年代 1 万元约等于 2026 年价多少万元；
   * tiers：该年代下各财富档位的门槛（单位：万元，含下限不含上限）。
   * ---------------------------------------------------------- */
  var PURCHASE_POWER = [
    { from: 1949, to: 1965, coef: 40, anchor: '那时 1 万元是天文数字，"万元户"要等到八十年代才出现',
      tiers: [0.3, 1, 3, 8, 20, 60] },
    { from: 1966, to: 1979, coef: 28, anchor: '那时谁家有上百元存款就让人羡慕，"三转一响"要攒很多年',
      tiers: [0.5, 1.5, 4, 12, 20, 80] },
    { from: 1980, to: 1989, coef: 14, anchor: '那是"万元户"令人羡慕的年月，谁家攒下一万块全厂都传',
      tiers: [1, 3, 8, 20, 50, 200] },
    { from: 1990, to: 1999, coef: 8, anchor: '十万块是笔大钱，商品房刚起步，炒股认购证一纸难求',
      tiers: [2, 5, 12, 30, 90, 300] },
    { from: 2000, to: 2009, coef: 3.5, anchor: '百万身家开始进入寻常话题，城里按揭买房成了潮流',
      tiers: [3, 8, 20, 45, 110, 350] },
    { from: 2010, to: 2019, coef: 1.6, anchor: '"百万"不再稀奇，"首付上百万"是房奴的日常',
      tiers: [5, 15, 35, 70, 200, 500] },
    { from: 2020, to: 2035, coef: 1, anchor: '千万才算真富，年轻人谈薪动辄几十万',
      tiers: [5, 20, 50, 100, 250, 800] }
  ];

  var WEALTH_TIER_LABELS = ['贫困', '拮据', '温饱', '殷实', '小康', '富裕', '巨富'];
  var WEALTH_TIER_DESCS = [
    '一贫如洗，负债或低保边缘，童年早早尝到生活的苦',
    '家境拮据，父母为生计奔波，用钱常需精打细算',
    '勉强温饱，吃饱穿暖，大件开销全靠一点点攒',
    '家境殷实，有房有存款，生活体面有底气',
    '小康之家，衣食无忧，能供孩子读书培养',
    '家境优渥，资源丰厚，人生起点远高于同龄人',
    '富贵之家，当地有头有脸，钱能解决绝大多数问题'
  ];

  function purchaseFor(year) {
    if (year == null) return PURCHASE_POWER[PURCHASE_POWER.length - 1];
    return PURCHASE_POWER.find(function (p) { return year >= p.from && year <= p.to; })
      || PURCHASE_POWER[PURCHASE_POWER.length - 1];
  }

  /* 同时代财富档位：按出生年代衡量同一笔钱的分量 */
  function wealthTier(year, wealth) {
    var w = Math.max(0, Number(wealth) || 0);
    var pp = purchaseFor(year);
    var idx = 0;
    while (idx < pp.tiers.length && w >= pp.tiers[idx]) idx++;
    var realWan = Math.round(w * pp.coef * 10) / 10;
    return {
      label: WEALTH_TIER_LABELS[idx],
      desc: WEALTH_TIER_DESCS[idx],
      idx: idx,
      coef: pp.coef,
      realWan: realWan,
      anchor: pp.anchor,
      note: pp.anchor + '；这笔钱约等于 2026 年价的 ' + realWan + ' 万元'
    };
  }

  /* ---------------- 公历 → 儒略日 ---------------- */
  function toJDN(y, m, d) {
    if (m <= 2) { y -= 1; m += 12; }
    var a = Math.floor(y / 100);
    var b = 2 - a + Math.floor(a / 4);
    return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + b - 1524;
  }

  /* ---------------- 立春近似（通用寿星公式） ---------------- */
  function lichunDay(year) {
    var y2 = year % 100;
    var C = year >= 2000 ? 3.87 : 4.6295; // 21 / 20 世纪常数
    var L = Math.floor((y2 - 1) / 4);      // 闰数
    return Math.floor(y2 * 0.2422 + C - L);
  }

  /* ---------------- 四柱 ---------------- */
  // 年柱：以立春为界（立春前仍属上一干支年）
  function yearPillar(y, m, d) {
    var yy = y;
    if (m < 2 || (m === 2 && d < lichunDay(y))) yy = y - 1;
    var idx = (((yy - 4) % 60) + 60) % 60;
    return { gan: TG[idx % 10], zhi: DZ[idx % 12], ganIdx: idx % 10, zhiIdx: idx % 12 };
  }

  // 各公历月主节气（月建分界）的近似日期；2 月（立春）用公式精确近似
  var MONTH_TERM_DAY = [0, 6, 4, 5, 5, 5, 6, 7, 7, 8, 8, 7, 7];
  // 月柱：以节气为界，月干按"五虎遁"由年干推得
  function monthPillar(y, m, d, yearGanIdx) {
    var termDay = (m === 2) ? lichunDay(y) : MONTH_TERM_DAY[m];
    var passed = d >= termDay;
    // p：月建序号，1=寅月 … 12=丑月
    var p = passed ? (m - 1) : (m - 2);
    if (p <= 0) p += 12;
    var zhiIdx = (p + 1) % 12; // 寅 = DZ[2]
    var ganIdx = (((yearGanIdx % 5) * 2 + 2 + (p - 1)) % 10 + 10) % 10;
    return { gan: TG[ganIdx], zhi: DZ[zhiIdx], ganIdx: ganIdx, zhiIdx: zhiIdx };
  }

  // 日柱：儒略日推算，锚点 1949-10-01 = 甲子日
  var DAY_ANCHOR_JDN = toJDN(1949, 10, 1);
  function dayPillar(y, m, d) {
    var idx = (((toJDN(y, m, d) - DAY_ANCHOR_JDN) % 60) + 60) % 60;
    return { gan: TG[idx % 10], zhi: DZ[idx % 12], ganIdx: idx % 10, zhiIdx: idx % 12, idx: idx };
  }

  // 时柱：五鼠遁（甲己还加甲，乙庚丙作初，丙辛从戊起，丁壬庚子居，戊癸壬子居）
  function hourPillar(dayGanIdx, hour) {
    var zi = hourZhiIndex(hour);
    var ganIdx = (dayGanIdx * 2 + zi) % 10;
    return { gan: TG[ganIdx], zhi: DZ[zi], ganIdx: ganIdx, zhiIdx: zi };
  }

  /* ---------------- 排盘入口 ---------------- */
  function computeBazi(year, month, day, hour) {
    var yp = yearPillar(year, month, day);
    var mp = monthPillar(year, month, day, yp.ganIdx);
    var dp = dayPillar(year, month, day);
    var hp = (hour == null) ? null : hourPillar(dp.ganIdx, hour);

    var pillars = {
      year: yp.gan + yp.zhi,
      month: mp.gan + mp.zhi,
      day: dp.gan + dp.zhi,
      hour: hp ? hp.gan + hp.zhi : '不详'
    };

    // 五行统计（时辰不详时仅统计前三柱 6 字）
    var wuxing = { '木': 0, '火': 0, '土': 0, '金': 0, '水': 0 };
    function add(p) { wuxing[TG_WX[p.ganIdx]]++; wuxing[DZ_WX[p.zhiIdx]]++; }
    add(yp); add(mp); add(dp); if (hp) add(hp);

    var parts = [], extremes = [];
    ['木', '火', '土', '金', '水'].forEach(function (el) {
      parts.push(el + wuxing[el]);
      if (wuxing[el] >= 3) extremes.push(el + '旺');
      if (wuxing[el] === 0) extremes.push('缺' + el);
    });
    var wuxingText = '五行分布：' + parts.join(' ') +
      (extremes.length ? '（' + extremes.join('、') + '）' : '（五行偏均衡）');

    return {
      pillars: pillars,
      dayMaster: dp.gan,
      dayMasterWuxing: TG_WX[dp.ganIdx],
      dayMasterNature: TG_NATURE[dp.gan] + '，' + TG_PERSONALITY[dp.gan],
      wuxing: wuxing,
      wuxingText: wuxingText,
      hourLabel: hourLabel(hour),
      hourKnown: hour != null
    };
  }

  /* ---------------- 导出（浏览器挂 window，Node 走 module.exports） ---------------- */
  var api = {
    computeBazi: computeBazi,
    eraFor: eraFor,
    eraEventsFor: eraEventsFor,
    wealthTier: wealthTier,
    purchaseFor: purchaseFor,
    hourLabel: hourLabel,
    ERAS: ERAS,
    ERA_EVENTS: ERA_EVENTS,
    PURCHASE_POWER: PURCHASE_POWER
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.Bazi = api;
})(typeof window !== 'undefined' ? window : globalThis);

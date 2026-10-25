/* ============================================================
 * talents.js — 出生天赋池 & 新角色随机生成
 * 生辰时代化改造：
 *  - 性别由玩家填写（可选"随机"）
 *  - 初始家境 / 健康 / 寿命按出生年代系数缩放（60 年代 1 万是巨款）
 *  - 八字五行偏枯 → 七维初始属性微调（±3 内）
 *  - 完整生辰记录（四柱/日主/五行/时代背景）随 state.birth 流转
 * ============================================================ */
(function (global) {
  'use strict';

  const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const clamp = v => Math.max(0, Math.min(100, Math.round(v)));

  /* 天赋定义
   * tier: 普通天赋 / 优秀天赋 / 逆天天赋 / 缺陷天赋
   * mod: 属性修正钩子，参数 (key, delta) 返回修正后的 delta
   */
  const TALENTS = [
    {
      id: 'strong', tier: '优秀天赋', name: '体魄强健',
      desc: '健康类增益效果 +20%，更易长寿',
      mod: (k, d) => (k === 'health' && d > 0) ? d * 1.2 : d
    },
    {
      id: 'genius', tier: '逆天天赋', name: '天资聪颖',
      desc: '学识类增益效果 +30%，考试学习事半功倍',
      mod: (k, d) => (k === 'knowledge' && d > 0) ? d * 1.3 : d
    },
    {
      id: 'sickly', tier: '缺陷天赋', name: '体弱多病',
      desc: '健康损耗 +15%，幼年多灾',
      mod: (k, d) => (k === 'health' && d < 0) ? d * 1.15 : d
    },
    {
      id: 'charm', tier: '优秀天赋', name: '情商卓绝',
      desc: '情感与社会类增益 +20%',
      mod: (k, d) => ((k === 'emotion' || k === 'social') && d > 0) ? d * 1.2 : d
    },
    {
      id: 'tough', tier: '普通天赋', name: '坚韧不拔',
      desc: '情感类损耗 -20%，逆境中不易崩溃',
      mod: (k, d) => (k === 'emotion' && d < 0) ? d * 0.8 : d
    },
    {
      id: 'lucky', tier: '逆天天赋', name: '福星高照',
      desc: '运气类增益 +30%，运势更容易回升',
      mod: (k, d) => (k === 'luck' && d > 0) ? d * 1.3 : d,
      luckBias: true
    },
    {
      id: 'rich', tier: '优秀天赋', name: '富贵之家',
      desc: '出生即罗马：初始家庭资产大幅提高',
      family: 'rich'
    },
    {
      id: 'poor', tier: '缺陷天赋', name: '寒门子弟',
      desc: '家境贫寒，初始资产低；逆境磨砺使情感损耗 -10%',
      family: 'poor',
      mod: (k, d) => (k === 'emotion' && d < 0) ? d * 0.9 : d
    },
    {
      id: 'virtue', tier: '普通天赋', name: '赤子之心',
      desc: '品德类增益 +25%，天生良善',
      mod: (k, d) => (k === 'morality' && d > 0) ? d * 1.25 : d
    },
    {
      id: 'silver', tier: '普通天赋', name: '口才伶俐',
      desc: '社会类增益 +20%，与人打交道不吃亏',
      mod: (k, d) => (k === 'social' && d > 0) ? d * 1.2 : d
    },
    {
      id: 'beauty', tier: '优秀天赋', name: '容貌出众',
      desc: '初始社会评价更高，情感增益 +15%',
      mod: (k, d) => (k === 'emotion' && d > 0) ? d * 1.15 : d,
      initBonus: { social: 12 }
    },
    {
      id: 'introvert', tier: '缺陷天赋', name: '内向敏感',
      desc: '社会类损耗 +15%，但沉静带来学识增益 +15%',
      mod: function (k, d) {
        if (k === 'social' && d < 0) return d * 1.15;
        if (k === 'knowledge' && d > 0) return d * 1.15;
        return d;
      }
    }
  ];

  // 抽取天赋：70% 一个，30% 两个；缺陷天赋最多一个；至少有一个非缺陷天赋
  function rollTalents() {
    const count = Math.random() < 0.3 ? 2 : 1;
    const pool = TALENTS.slice();
    const result = [];
    let safety = 0;
    while (result.length < count && safety++ < 50) {
      const t = pick(pool);
      if (result.some(r => r.id === t.id)) continue;
      if (t.tier === '缺陷天赋' && result.some(r => r.tier === '缺陷天赋')) continue;
      if (count === 2 && t.family === 'poor' && Math.random() < 0.5) continue;
      result.push(t);
    }
    if (result.every(t => t.tier === '缺陷天赋')) {
      const nonDefect = TALENTS.filter(t => t.tier !== '缺陷天赋' && !result.some(r => r.id === t.id));
      result[0] = pick(nonDefect);
    }
    // 富贫家境天赋互斥
    if (result.some(t => t.family === 'rich')) {
      const idx = result.findIndex(t => t.family === 'poor');
      if (idx >= 0) result.splice(idx, 1, pick(TALENTS.filter(t => !t.family && t.id !== result[0].id)));
    }
    return result;
  }

  /* 时代经济与医疗系数
   * base/rich/poor：各时代普通/富贵/寒门家境的初始资产区间（单位：万）
   * health：初始健康修正（早年医疗条件差）；life：寿命修正（早年人均寿命低）
   */
  const ERA_ECON = [
    { from: 1949, to: 1979, base: [1, 16],   rich: [25, 100],  poor: [1, 6],   health: -4, life: -3 },
    { from: 1980, to: 1999, base: [6, 60],   rich: [60, 260],  poor: [2, 10],  health: 0,  life: 0 },
    { from: 2000, to: 2009, base: [12, 130], rich: [150, 500], poor: [3, 14],  health: 2,  life: 2 },
    { from: 2010, to: 2035, base: [20, 240], rich: [200, 800], poor: [3, 16],  health: 4,  life: 4 }
  ];

  function eraEcon(year) {
    if (year == null) return ERA_ECON[ERA_ECON.length - 1];
    return ERA_ECON.find(e => year >= e.from && year <= e.to) || ERA_ECON[ERA_ECON.length - 1];
  }

  /* 八字五行 → 七维属性映射（民间五行性理）
   * 木主仁（生发）→ 学识/品德；火主礼（热情）→ 情感/运气；
   * 土主信（厚重）→ 社会/健康；金主义（刚健）→ 资产/品德；
   * 水主智（润下）→ 学识/情感
   */
  const WUXING_ATTRS = {
    '木': ['knowledge', 'morality'],
    '火': ['emotion', 'luck'],
    '土': ['social', 'health'],
    '金': ['wealth', 'morality'],
    '水': ['knowledge', 'emotion']
  };

  // 五行偏枯修正：某元素 0 个给 -2，≥3 个给 +2 左右，影响幅度 ±3 以内
  function applyWuxingBias(attrs, wuxing) {
    if (!wuxing) return;
    Object.keys(WUXING_ATTRS).forEach(el => {
      const c = wuxing[el] || 0;
      const bias = Math.max(-3, Math.min(3, Math.round((c - 1.5) * 1.2)));
      if (!bias) return;
      WUXING_ATTRS[el].forEach(k => {
        attrs[k] = (k === 'wealth') ? Math.max(0, attrs[k] + bias) : clamp(attrs[k] + bias);
      });
    });
  }

  // 家境分层：同一笔钱按出生年代衡量分量（1960 年代 8 万是殷实人家，2010 年代只是温饱）
  function familyTier(wealth, year) {
    const t = Bazi.wealthTier(year, wealth);
    return { level: t.label, desc: t.desc };
  }

  /* 生成一个新角色的初始状态（不含剧情，剧情由 AI 生成）
   * origin: { year, month, day, hour, gender } —— 玩家填写的生辰信息
   */
  function createCharacter(origin) {
    origin = origin || {};
    const year = origin.year || null;
    // 性别：玩家指定，或"随机"
    const gender = (origin.gender && origin.gender !== '随机')
      ? origin.gender
      : (Math.random() < 0.51 ? '男' : '女');

    const talents = rollTalents();
    const familyTalent = talents.find(t => t.family);
    const econ = eraEcon(year);

    let wealth; // 单位：万（W），按时代系数缩放
    if (familyTalent && familyTalent.family === 'rich') wealth = rand(econ.rich[0], econ.rich[1]);
    else if (familyTalent && familyTalent.family === 'poor') wealth = rand(econ.poor[0], econ.poor[1]);
    else wealth = rand(econ.base[0], econ.base[1]);

    const attrs = {
      health:    clamp(rand(74, 96) + (talents.some(t => t.id === 'sickly') ? -15 : 0) + (talents.some(t => t.id === 'strong') ? 5 : 0) + econ.health),
      emotion:   clamp(rand(58, 82)),
      social:    clamp(rand(35, 62)),
      wealth:    Math.max(0, wealth), // 资产无上限，单位万
      knowledge: rand(0, 6),
      morality:  clamp(rand(52, 72)),
      luck:      clamp(rand(35, 72) + (talents.some(t => t.id === 'lucky') ? 12 : 0))
    };

    // 天赋初始加成
    talents.forEach(t => {
      if (t.initBonus) {
        Object.keys(t.initBonus).forEach(k => {
          attrs[k] = clamp(attrs[k] + t.initBonus[k]);
        });
      }
    });

    // 八字五行偏枯 → 七维微调
    let birth = null;
    if (year && origin.month && origin.day) {
      const bazi = Bazi.computeBazi(year, origin.month, origin.day,
        origin.hour == null ? null : origin.hour);
      applyWuxingBias(attrs, bazi.wuxing);
      birth = {
        year: year,
        month: origin.month,
        day: origin.day,
        hour: origin.hour == null ? null : origin.hour,
        hourLabel: bazi.hourLabel,
        gender: gender,
        bazi: bazi.pillars,
        dayMaster: bazi.dayMaster,
        dayMasterWuxing: bazi.dayMasterWuxing,
        dayMasterNature: bazi.dayMasterNature,
        wuxing: bazi.wuxing,
        wuxingText: bazi.wuxingText,
        era: Bazi.eraFor(year)
      };
    }

    // 寿命：50-100 三角分布（均值约 75），受初始健康、天赋与时代医疗水平微调
    let lifespan = 50 + rand(0, 25) + rand(0, 25);
    lifespan += Math.round((attrs.health - 80) * 0.2);
    if (talents.some(t => t.id === 'strong')) lifespan += rand(2, 5);
    if (talents.some(t => t.id === 'sickly')) lifespan -= rand(2, 6);
    lifespan += econ.life;
    lifespan = Math.max(50, Math.min(100, lifespan));

    return {
      gender,
      talents: talents.map(t => ({ id: t.id, tier: t.tier, name: t.name, desc: t.desc })),
      attrs,
      lifespan,
      family: familyTier(attrs.wealth, year),
      birth: birth
    };
  }

  // 根据天赋链计算属性变动
  function applyTalentMods(talentIds, key, delta) {
    const mods = TALENTS.filter(t => talentIds.includes(t.id) && typeof t.mod === 'function');
    let v = delta;
    mods.forEach(t => { v = t.mod(key, v); });
    return v;
  }

  function hasLuckBias(talentIds) {
    return TALENTS.some(t => talentIds.includes(t.id) && t.luckBias);
  }

  global.TALENTS = TALENTS;
  global.rollTalents = rollTalents;
  global.createCharacter = createCharacter;
  global.familyTier = familyTier;
  global.applyTalentMods = applyTalentMods;
  global.hasLuckBias = hasLuckBias;
})(window);

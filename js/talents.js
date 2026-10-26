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

  /* 家庭行业定位（玩家可选，也可随机）
   * 不同年代同一行业境遇迥异：
   *  - 工人 50-70 年代是"老大哥"备受尊崇，90 年代却撞上下岗潮；
   *  - 商人 60-70 年代做买卖要谨小慎微，80 年代后才是万元户风向标；
   *  - 农民 2000 年代后大批进城务工，早已不只是土里刨食。
   * mul：对初始家庭资产（万）的年代乘数；attrs：初始属性微调；note：该年代下的行业注脚
   */
  const FAMILY_JOBS = [
    {
      id: 'farm', name: '农民', note: '土里刨食、靠天吃饭',
      bands: [ { from: 1949, to: 2035, mul: 0.55, attrs: { health: 4, morality: 3, social: -4 } } ]
    },
    {
      id: 'worker', name: '工人', note: '厂子里拿工资的人',
      bands: [
        { from: 1949, to: 1979, mul: 1.15, note: '工人老大哥，铁饭碗令人艳羡', attrs: { social: 8 } },
        { from: 1980, to: 1999, mul: 0.95, note: '厂子效益一年不如一年，下岗风声越来越紧', attrs: { social: 4 } },
        { from: 2000, to: 2035, mul: 1.0, note: '在工厂或企业上班，拿工资吃饭', attrs: {} }
      ]
    },
    {
      id: 'merchant', name: '商人', note: '做买卖、跑生意',
      bands: [
        { from: 1949, to: 1979, mul: 0.65, note: '做点小买卖谨小慎微，生怕被说成投机倒把', attrs: { social: -8, luck: 4 } },
        { from: 1980, to: 2035, mul: 1.8, note: '改革开放后下海经商，风生水起', attrs: { social: 6 } }
      ]
    },
    {
      id: 'teacher', name: '教师', note: '教书育人、书香门第',
      bands: [ { from: 1949, to: 2035, mul: 1.0, note: '在教书育人的行当里，家里有点书卷气', attrs: { knowledge: 10, morality: 4, social: 3 } } ]
    },
    {
      id: 'civil', name: '公务员', note: '体制内的稳定人家',
      bands: [
        { from: 1949, to: 1979, mul: 1.2, note: '在机关单位上班，街坊眼里体面人家', attrs: { social: 8, morality: 3 } },
        { from: 1980, to: 2035, mul: 1.25, note: '体制内旱涝保收，稳定体面', attrs: { social: 6 } }
      ]
    },
    {
      id: 'military', name: '军人', note: '军旅人家、令行禁止',
      bands: [ { from: 1949, to: 2035, mul: 1.0, note: '军旅出身，家里规矩大、作风硬朗', attrs: { health: 6, morality: 5, social: 2 } } ]
    },
    {
      id: 'doctor', name: '医生', note: '悬壶济世、医学世家',
      bands: [ { from: 1949, to: 2035, mul: 1.1, note: '在医院或卫生院做事，街坊都敬三分', attrs: { knowledge: 9, social: 4 } } ]
    },
    {
      id: 'craft', name: '手艺人', note: '一门手艺走天下',
      bands: [
        { from: 1949, to: 1979, mul: 0.8, note: '凭一门手艺挣工分之外的手艺钱', attrs: { social: -3, knowledge: 3 } },
        { from: 1980, to: 2035, mul: 1.15, note: '手艺吃香，活儿接到手软', attrs: { social: 2, knowledge: 3 } }
      ]
    }
  ];

  // 按玩家选择（或随机）确定家庭行业
  function resolveFamilyJob(chosen) {
    const pool = FAMILY_JOBS; // 全部为可选行业，"随机"由调用方处理
    const hit = chosen && pool.find(j => j.name === chosen);
    return hit || pool[Math.floor(Math.random() * pool.length)];
  }

  // 取该行业在指定出生年代的境遇带（资产乘数 / 属性微调 / 年代注脚）
  function jobBand(job, year) {
    const bands = job.bands || [];
    const hit = bands.find(b => year == null || (year >= b.from && year <= b.to));
    return hit || bands[bands.length - 1] || { mul: 1, attrs: {}, note: job.note };
  }

  /* 出生地区（省级行政区）定位（玩家可选，也可随机）
   * 不同地区家境水平与资源禀赋差异明显，且随年代变化：
   *  - 北京/上海在票证年代就比别处见世面，改革开放后更是一线都市；
   *  - 东北 80 年代前是"共和国长子"工业重镇，90 年代撞上下岗潮；
   *  - 沿海省份 80 年代后得改革开放风气之先。
   * 注意：地区只是「出生地的地理与家境背景」，不预设初生者成年后去往何处、做什么。
   * mul：对初始家庭资产（万）的年代乘数；attrs：初始属性微调；note：该年代下的地区注脚
   */
  const REGION_GROUPS = [
    { names: ['北京', '上海'],
      bands: [
        { from: 1949, to: 1979, mul: 1.15, note: '大城市人家，票证年代里也算见世面', attrs: { knowledge: 6, social: 4, health: -2 } },
        { from: 1980, to: 2035, mul: 1.5, note: '一线都市，机会与眼界都是顶配', attrs: { knowledge: 6, social: 5, health: -2 } }
      ] },
    { names: ['天津', '重庆'],
      bands: [
        { from: 1949, to: 1979, mul: 1.05, note: '大城市里的人家，日子不算差', attrs: { knowledge: 4, social: 3 } },
        { from: 1980, to: 2035, mul: 1.25, note: '直辖市人家，城市建设红利赶上了', attrs: { knowledge: 4, social: 4 } }
      ] },
    { names: ['广东', '江苏', '浙江', '福建', '海南'],
      bands: [
        { from: 1949, to: 1979, mul: 1.0, note: '靠山吃山、靠海吃海，日子精打细算', attrs: { morality: 2 } },
        { from: 1980, to: 2035, mul: 1.35, note: '改革开放前沿，遍地是机会', attrs: { social: 5, knowledge: 3 } }
      ] },
    { names: ['山东', '河南'],
      bands: [
        { from: 1949, to: 1979, mul: 0.9, note: '农业大省，人口多、土地厚，日子紧巴却踏实', attrs: { health: 3, morality: 3 } },
        { from: 1980, to: 2035, mul: 0.95, note: '人口大省、高考大省，读书竞争激烈', attrs: { knowledge: 3, morality: 3, health: 2 } }
      ] },
    { names: ['黑龙江', '吉林', '辽宁'],
      bands: [
        { from: 1949, to: 1989, mul: 1.15, note: '共和国长子，工厂林立，工人地位高', attrs: { social: 5, health: 2 } },
        { from: 1990, to: 2035, mul: 0.9, note: '老工业基地转型，不少人家经历下岗再就业', attrs: { social: 2, health: 2 } }
      ] },
    { names: ['河北', '山西', '湖北', '湖南', '安徽', '江西'],
      bands: [
        { from: 1949, to: 1979, mul: 0.9, note: '中原腹地、鱼米之乡，日子清苦却有奔头', attrs: { morality: 2 } },
        { from: 1980, to: 2035, mul: 1.0, note: '中部崛起，进城务工与返乡创业交织', attrs: { morality: 2, social: 2 } }
      ] },
    { names: ['陕西', '甘肃', '青海', '宁夏', '新疆', '西藏', '云南', '贵州', '四川', '广西', '内蒙古'],
      bands: [
        { from: 1949, to: 1979, mul: 0.8, note: '地广人稀，日子清苦但天高地阔', attrs: { health: 4, morality: 3 } },
        { from: 1980, to: 2035, mul: 0.85, note: '西部大开发，山川壮美、日子渐好', attrs: { health: 4, morality: 3 } }
      ] },
    { names: ['中国香港', '中国澳门'],
      bands: [
        { from: 1949, to: 1979, mul: 2.2, note: '繁华码头，寸土寸金', attrs: { social: 6, knowledge: 3 } },
        { from: 1980, to: 2035, mul: 2.0, note: '国际都会，节奏快机会也多', attrs: { social: 6, knowledge: 3 } }
      ] },
    { names: ['中国台湾'],
      bands: [
        { from: 1949, to: 1979, mul: 1.6, note: '海岛人家，市井烟火气足', attrs: { social: 4, knowledge: 3 } },
        { from: 1980, to: 2035, mul: 1.5, note: '经济起飞后的宝岛人家', attrs: { social: 4, knowledge: 3 } }
      ] }
  ];
  const REGIONS = [];
  REGION_GROUPS.forEach(g => g.names.forEach(n => REGIONS.push({ name: n, bands: g.bands })));

  // 按玩家选择（或随机）确定出生地区
  function resolveRegion(chosen) {
    const hit = chosen && REGIONS.find(r => r.name === chosen);
    return hit || REGIONS[Math.floor(Math.random() * REGIONS.length)];
  }

  // 取该地区在指定出生年代的境遇带（资产乘数 / 属性微调 / 年代注脚）
  function regionBand(region, year) {
    const bands = region.bands || [];
    const hit = bands.find(b => year == null || (year >= b.from && year <= b.to));
    return hit || bands[bands.length - 1] || { mul: 1, attrs: {}, note: '' };
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

    // 家庭行业：按玩家选择（或随机）确定，并按出生年代调整家境与初始属性
    const job = resolveFamilyJob(origin.familyJob);
    const band = jobBand(job, year);
    // 出生地区：按玩家选择（或随机）确定，与家庭行业共同决定家境乘数
    const regionHit = resolveRegion(origin.region);
    const rBand = regionBand(regionHit, year);
    wealth = Math.max(1, Math.round(wealth * (band.mul || 1) * (rBand.mul || 1)));
    const familyJob = { name: job.name, note: band.note || job.note };
    const region = { name: regionHit.name, note: rBand.note || '' };

    const attrs = {
      health:    clamp(rand(74, 96) + (talents.some(t => t.id === 'sickly') ? -15 : 0) + (talents.some(t => t.id === 'strong') ? 5 : 0) + econ.health),
      emotion:   clamp(rand(58, 82)),
      social:    clamp(rand(35, 62)),
      wealth:    Math.max(0, wealth), // 资产无上限，单位万
      knowledge: rand(0, 6),
      morality:  clamp(rand(52, 72)),
      luck:      clamp(rand(35, 72) + (talents.some(t => t.id === 'lucky') ? 12 : 0))
    };

    // 家庭行业 + 出生地区带来的初始属性微调（如 军人家庭 健康+、教师家庭 学识+、京沪眼界+）
    [band.attrs, rBand.attrs].forEach(src => {
      Object.keys(src || {}).forEach(k => {
        if (!(k in attrs) || k === 'wealth') return; // 资产已由 mul 调整，不走点数
        attrs[k] = clamp(attrs[k] + src[k]);
      });
    });

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
        familyJob: job.name,
        region: region.name,
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
      familyJob: familyJob,
      region: region,
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
  global.FAMILY_JOBS = FAMILY_JOBS;
  global.REGIONS = REGIONS;
  global.rollTalents = rollTalents;
  global.createCharacter = createCharacter;
  global.familyTier = familyTier;
  global.applyTalentMods = applyTalentMods;
  global.hasLuckBias = hasLuckBias;
})(window);

/* ============================================================
 * game.js — 核心逻辑层
 * 生命周期管理 / 属性结算 / 天赋修正 / 年龄阶段 / 事件循环 / 死亡判定
 * AI 不可用时使用本地降级事件，保证流程永不卡死
 * ============================================================ */
(function (global) {
  'use strict';

  const STAGE_BLURB = {
    '婴儿期': '襁褓之中，你用哭声与睡梦认识这个世界。',
    '幼儿期': '蹒跚学步，牙牙学语，世界在你眼前缓缓展开。',
    '童年期': '背起小小的书包，你有了玩伴、课堂与烦恼。',
    '青春期': '荷尔蒙与叛逆一同到来，你急于向世界证明自己。',
    '青年期': '离开校园的港湾，你开始独自面对生活的风浪。',
    '壮年期': '肩头担子最重的年纪，上有老来下有小。',
    '中年期': '不惑而后知天命，得失起落渐渐看淡。',
    '老年期': '告别职场，身体开始提醒你把脚步放慢。',
    '暮年期': '夕阳正红，你坐在时光的岸边，回望长长的一生。'
  };

  let state = null;

  function getState() { return state; }
  function setState(s) { state = s; }

  function stageForAge(age) {
    return STAGES.find(s => age >= s.min && age <= s.max) || STAGES[STAGES.length - 1];
  }

  function clamp(v) {
    return Math.max(ATTR_MIN, Math.min(ATTR_MAX, Math.round(v)));
  }

  /* ============================================================
   * 开局
   * birthInfo: 玩家填写的生辰 { year, month, day, hour, gender }
   * ============================================================ */
  async function newLife(birthInfo, onLoading) {
    const ch = createCharacter(birthInfo);
    state = {
      phase: 'birth',
      age: 0,
      stage: '婴儿期',
      gender: ch.gender,
      talents: ch.talents,
      attrs: ch.attrs,
      lifespan: ch.lifespan,
      family: ch.family,
      birth: ch.birth || null,
      peak: mapAttrs(ch.attrs),
      trough: mapAttrs(ch.attrs),
      history: [],
      pendingEvent: null,
      usedMilestones: [],
      deathInfo: null,
      ending: null,
      lastFallback: false,
      viewedBirth: false
    };

    // 出生剧情
    onLoading && onLoading('一个新生命即将降临……');
    let birth;
    try {
      birth = await DeepSeek.chatJSON({ kind: 'birth', state }, { maxTokens: CONFIG.maxTokens.birth });
      if (!birth.description) throw new Error('出生剧情缺字段');
    } catch (e) {
      console.warn('出生剧情降级：', e.message);
      birth = fallbackBirth();
      state.lastFallback = true;
    }

    state.history.push({
      age: 0, stage: '婴儿期', type: 'birth',
      title: birth.title || '降生',
      description: birth.description,
      choiceTitle: null, choiceDetail: null, effects: null, outcome: null
    });
    state.phase = 'event';

    await generateEvent(onLoading);
    return state;
  }

  function mapAttrs(attrs) {
    const o = {};
    ATTR_KEYS.forEach(k => { o[k] = attrs[k]; });
    return o;
  }

  /* ============================================================
   * 生成事件（AI 优先，失败降级）
   * ============================================================ */
  async function generateEvent(onLoading, prev) {
    onLoading && onLoading(prev ? '尘埃落定的同时，命运正在书写下一程……' : '命运正在书写下一程……');
    const milestone = dueMilestone(state);

    let event, outcome = null;
    try {
      const raw = await DeepSeek.chatJSON({
        kind: 'event',
        state,
        extra: {
          milestone: milestone ? { label: milestone.label } : null,
          prev: prev || null // 上一次抉择（若有），AI 会顺带产出 outcome 结果文案
        }
      }, {
        maxTokens: CONFIG.maxTokens.event,
        temperature: CONFIG.temperature
      });
      if (prev && raw.outcome) {
        const o = String(raw.outcome).trim();
        if (o.length >= 10) outcome = o;
      }
      event = sanitizeEvent(raw, !!milestone);
      state.lastFallback = false;
    } catch (e) {
      console.warn('事件生成降级：', e.message);
      event = fallbackEvent(state, milestone);
      state.lastFallback = true;
    }
    event.milestoneLabel = milestone ? milestone.label : null;
    state.pendingEvent = event;
    state.phase = 'event';
    return { event, outcome };
  }

  // 找到当前应触发的固定节点；错过的节点直接标记
  function dueMilestone(s) {
    let due = null;
    MILESTONES.forEach(m => {
      if (s.usedMilestones.includes(m.age)) return;
      if (s.age > m.age + 3) { s.usedMilestones.push(m.age); return; }
      if (s.age >= m.age - 1 && s.age <= m.age + 3) {
        if (!due || m.age < due.age) due = m;
      }
    });
    if (due) s.usedMilestones.push(due.age);
    return due;
  }

  /* ============================================================
   * 选项数据清洗与校验
   * ============================================================ */
  function sanitizeEffects(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object') return out;
    ATTR_KEYS.forEach(k => {
      if (raw[k] == null) return;
      let n = Math.round(Number(raw[k]));
      if (!isFinite(n) || n === 0) return;
      n = Math.max(-EFFECT_LIMIT.major, Math.min(EFFECT_LIMIT.major, n));
      out[k] = n;
    });
    return out;
  }

  function sanitizeEvent(raw, isMilestone) {
    if (!raw || typeof raw !== 'object') throw new Error('事件数据为空');
    const title = String(raw.title || '人生一刻').slice(0, 20);
    const description = String(raw.description || '').trim();
    if (description.length < 20) throw new Error('事件描述过短');

    let choices = Array.isArray(raw.choices) ? raw.choices : [];
    choices = choices.slice(0, 5).map((c, idx) => {
      if (!c || typeof c !== 'object') return null;
      const effects = sanitizeEffects(c.effects);
      return {
        title: String(c.title || ('选择' + (idx + 1))).slice(0, 20),
        detail: String(c.detail || '').slice(0, 120),
        effects,
        hint: String(c.hint || '').slice(0, 60)
      };
    }).filter(Boolean).filter(c => c.title);

    if (choices.length < 2) throw new Error('有效选项不足');

    // 保证每个选项都有属性变动（开发规范：禁止无效选项）
    choices.forEach(c => {
      if (!Object.keys(c.effects).length) c.effects = { emotion: 1 };
      if (!c.detail) c.detail = '你打算' + c.title + '。';
    });
    if (choices.length < 3) {
      choices.push({
        title: '顺其自然',
        detail: '不刻意做什么，让事情按它本来的样子发展。',
        effects: { emotion: 2, luck: 1 },
        hint: '佛系也是一种活法。'
      });
    }
    return {
      title,
      description,
      is_milestone: !!isMilestone || !!raw.is_milestone,
      choices,
      fallback: false
    };
  }

  /* ============================================================
   * 玩家抉择：结算属性 → 岁月推进 → 死亡判定 → 生成下一事件
   * （结果文案由"下一事件"请求顺带产出，省一次 AI 调用）
   * ============================================================ */
  async function choose(index, onLoading) {
    if (!state.pendingEvent) throw new Error('当前没有待抉择事件');
    const event = state.pendingEvent;
    const choice = event.choices[index];
    if (!choice) throw new Error('选项不存在');

    // 属性结算（天赋链修正）
    const talentIds = state.talents.map(t => t.id);
    const applied = {};
    Object.keys(choice.effects).forEach(k => {
      const modified = Math.round(applyTalentMods(talentIds, k, choice.effects[k]));
      const before = state.attrs[k];
      // 资产无上限：只保底 0，不封顶；其余属性 0-100
      state.attrs[k] = k === 'wealth'
        ? Math.max(0, Math.round(before + modified))
        : clamp(before + modified);
      applied[k] = state.attrs[k] - before; // 实际生效值（含封顶）
      if (state.attrs[k] > (state.peak[k] ?? -1)) state.peak[k] = state.attrs[k];
      if (state.attrs[k] < (state.trough[k] ?? 101)) state.trough[k] = state.attrs[k];
    });

    // 上一次抉择上下文（交给 AI 顺带写结果）
    const prev = {
      eventTitle: event.title,
      choiceTitle: choice.title,
      choiceDetail: choice.detail,
      effects: applied
    };
    const historyEntry = {
      age: state.age,
      stage: state.stage,
      type: 'event',
      title: event.title,
      description: event.description,
      choiceTitle: choice.title,
      choiceDetail: choice.detail,
      effects: applied,
      outcome: null
    };

    // 岁月推进
    const oldStage = state.stage;
    const step = stageForAge(state.age).step();
    state.age += step;
    const newStage = stageForAge(state.age).name;
    state.stage = newStage;

    // 运气随机小幅波动
    const bias = hasLuckBias(state.talents.map(t => t.id));
    const drift = bias ? randInt(-2, 7) : randInt(-3, 5);
    if (drift !== 0) state.attrs.luck = clamp(state.attrs.luck + drift);

    // 死亡判定：若身故，本次抉择的结果由结局总结一并收束
    const death = checkDeath();
    if (death) {
      state.history.push(historyEntry);
      state.pendingEvent = null;
      return await endGame(death, onLoading);
    }

    if (newStage !== oldStage) {
      state.history.push({
        age: state.age, stage: newStage, type: 'stage',
        title: '步入' + newStage,
        description: STAGE_BLURB[newStage] || '',
        choiceTitle: null, choiceDetail: null, effects: null, outcome: null
      });
    }

    // 合并请求：生成下一事件，AI 同时返回本次抉择的 outcome
    onLoading && onLoading('你做出了选择，尘埃正在落定……');
    const gen = await generateEvent(null, prev);
    const outcome = gen.outcome || fallbackOutcome(event, choice, applied);

    historyEntry.outcome = outcome;
    state.history.push(historyEntry);

    state.phase = 'outcome';
    return { phase: 'outcome', event, choice, effects: applied, outcome };
  }

  function checkDeath() {
    if (state.attrs.health <= 0) {
      return { cause: '病重不治，溘然长逝', kind: 'illness' };
    }
    if (state.age >= state.lifespan) {
      return { cause: '寿终正寝，无疾而终', kind: 'natural' };
    }
    // 病危区间：每回合 25% 概率不治
    if (state.attrs.health <= 9 && Math.random() < 0.25) {
      return { cause: '突发急病，抢救无效', kind: 'critical' };
    }
    return null;
  }

  /* ============================================================
   * 人生结局
   * ============================================================ */
  async function endGame(deathInfo, onLoading) {
    state.deathInfo = deathInfo;
    state.phase = 'ended';
    state.age = Math.min(state.age, Math.max(state.age, state.lifespan));

    onLoading && onLoading('一生的卷轴正在合上……');
    let ending;
    try {
      const raw = await DeepSeek.chatJSON({
        kind: 'ending',
        state,
        extra: { cause: deathInfo.cause, deathKind: deathInfo.kind }
      }, {
        maxTokens: CONFIG.maxTokens.ending,
        temperature: 0.9
      });
      ending = sanitizeEnding(raw);
    } catch (e) {
      console.warn('结局生成降级：', e.message);
      ending = fallbackEnding(state, deathInfo);
    }
    state.ending = ending;

    StorageX.addGallery({
      id: 'e' + Date.now(),
      savedAt: Date.now(),
      endingTitle: ending.ending_title,
      tier: Prompts.endingTier(state).label,
      age: state.age,
      gender: state.gender,
      evaluation: ending.evaluation,
      summary: ending.summary,
      highlights: ending.highlights,
      attrs: mapAttrs(state.attrs),
      talents: state.talents.map(t => t.name),
      cause: deathInfo.cause,
      birthYear: state.birth ? state.birth.year : null,
      era: state.birth ? state.birth.era.label : null
    });

    return { phase: 'ended', ending, deathInfo };
  }

  function sanitizeEnding(raw) {
    if (!raw || typeof raw !== 'object') throw new Error('结局数据为空');
    const title = String(raw.ending_title || '一生落幕').slice(0, 12);
    const summary = String(raw.summary || '').trim();
    const evaluation = String(raw.evaluation || '').trim();
    let highlights = Array.isArray(raw.highlights)
      ? raw.highlights.map(h => String(h)).filter(Boolean).slice(0, 8)
      : [];
    if (summary.length < 30 || evaluation.length < 10) throw new Error('结局内容过短');
    if (!highlights.length) highlights = ['一生平凡，亦有微光'];
    return { ending_title: title, summary, evaluation, highlights };
  }

  function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  // 当前公历年份（有生随时代推演；老存档无生辰则返回 null，视为不限年代）
  function currentYear(s) {
    return (s && s.birth && s.birth.year) ? (s.birth.year + s.age) : null;
  }

  // 事件是否允许出现在某公历年份（无 eras 字段 = 不限年代）
  function eraAllowed(ev, year) {
    if (year == null || !ev.eras) return true;
    return ev.eras.some(function (r) { return year >= r[0] && year <= r[1]; });
  }

  /* ============================================================
   * 本地降级内容（仅在 AI 不可用时启用，防止剧情卡死）
   * 年代化：降级事件同样遵守时代铁律——年代敏感事件标注 eras 区间，
   * ERA_POOL 提供专属年代的降级剧情，老存档（无生辰）不限年代。
   * ============================================================ */
  function fallbackBirth() {
    const tNames = state.talents.map(t => '「' + t.name + '」').join('、');
    const era = state.birth ? state.birth.era : null;
    const eraLine = era ? ('那是' + era.label + '的年月：' + era.backdrop + '。') : '';
    return {
      title: '降生',
      description:
        '你降生在一个' + state.family.level + '的家庭里。' + state.family.desc +
        '。' + eraLine + '接生的人把你裹进襁褓，你用响亮的哭声回应这个陌生的世界。家人们很快发现，这孩子似乎有些与众不同——' +
        tNames + '，命运的伏笔已在襁褓中悄悄埋下。属于你的一生，就这样开始了。'
    };
  }

  const FALLBACK_POOL = {
    '婴儿期': [
      { title: '夜半啼哭', description: '连续几天夜里你都哭闹不止，父母睡得很少，白天还要强打精神照看你。邻居建议他们带你去医院看看。',
        choices: [
          { title: '带去大医院', detail: '请假挂专家号，彻查哭闹原因。', effects: { health: 8, wealth: -6 }, hint: '花钱买个踏实。' },
          { title: '用土办法', detail: '听老人的，喂点偏方、收收惊。', effects: { health: -8, emotion: -2 }, hint: '省下钱，但风险暗伏。' },
          { title: '耐心安抚', detail: '轮流抱着哄，慢慢摸索规律。', effects: { emotion: 5, health: 2 }, hint: '辛苦但温馨。' }
        ]},
      { title: '蹒跚学步', description: '你扶着沙发边摇摇晃晃站起来，又一屁股摔下去。妈妈张开手臂在不远处等你，眼里满是鼓励。',
        choices: [
          { title: '勇敢迈步', detail: '松开手，朝妈妈扑过去。', effects: { health: 5, emotion: 4 }, hint: '总要迈出第一步。' },
          { title: '继续爬', detail: '摔怕了，还是爬着稳当。', effects: { emotion: -2, health: 1 }, hint: '慢一点也无妨。' },
          { title: '哭闹求抱', detail: '伸着胳膊要大人抱。', effects: { emotion: 3, social: -2 }, hint: '撒娇的童年。' }
        ]}
    ],
    '幼儿期': [
      { title: '咿呀学语', description: '你开始学着说话，第一个词叫得含糊不清，全家却高兴了半宿。你指着月亮要，指着小狗也，世界在你嘴里一点点有了名字。',
        choices: [
          { title: '天天缠着讲故事', detail: '睡前要听故事，一个不够再一个。', effects: { knowledge: 4, emotion: 5 }, hint: '语言的黄金期。' },
          { title: '到处翻东西探索', detail: '抽屉、柜子、杂物堆都是宝藏。', effects: { knowledge: 3, health: -2, emotion: 3 }, hint: '好奇宝宝的代价。' },
          { title: '害羞不肯开口', detail: '心里都明白，就是不肯说。', effects: { emotion: -2, social: -2, knowledge: 2 }, hint: '贵人语迟。' }
        ]},
      { title: '初入幼儿园', eras: [[1980, 2099]], description: '第一天上幼儿园，教室里哭声一片。你攥着妈妈的衣角，也有些不知所措。',
        choices: [
          { title: '主动交朋友', detail: '擦擦眼睛，找旁边的小朋友玩积木。', effects: { social: 8, emotion: 3 }, hint: '从小就是社牛。' },
          { title: '安静待着', detail: '坐在角落玩自己的，等放学。', effects: { knowledge: 3, social: -2 }, hint: '独处也有收获。' },
          { title: '大哭要回家', detail: '拽着老师要找妈妈。', effects: { emotion: -5, social: -3 }, hint: '分离需要练习。' }
        ]}
    ],
    '童年期': [
      { title: '期末考试', eras: [[1984, 2099]], description: '期末考试快到了，同学们都在复习。同桌约你放学去打游戏，而你的数学还有几道大题没搞懂。',
        choices: [
          { title: '埋头复习', detail: '拒绝游戏，把错题本刷两遍。', effects: { knowledge: 10, health: -3, emotion: -2 }, hint: '分数不会骗人。' },
          { title: '先玩再说', detail: '痛快打一下午游戏，晚上随便翻翻书。', effects: { emotion: 8, knowledge: -5 }, hint: '快乐一时，成绩堪忧。' },
          { title: '请教同学', detail: '找学习好的同学一起复习，互相讲题。', effects: { knowledge: 7, social: 5 }, hint: '人脉也是学习力。' }
        ]},
      { title: '被人欺负', description: '班上有个高大的同学抢你的文具，还推了你一把。周围的同学都看着，老师还没来。',
        choices: [
          { title: '大声制止', detail: '盯着他，要求他立刻归还。', effects: { social: 5, emotion: 4, health: -4 }, hint: '勇气可能挨一拳。' },
          { title: '告诉老师', detail: '事后向老师和家长说明情况。', effects: { social: 2, emotion: -2 }, hint: '规则内解决。' },
          { title: '忍气吞声', detail: '算了，惹不起躲得起。', effects: { emotion: -8, social: -5 }, hint: '隐忍留下阴影。' }
        ]}
    ],
    '青春期': [
      { title: '叛逆的夏天', description: '你开始嫌父母唠叨，房间门总想关着。这天妈妈又翻看你的日记，你撞见了，怒火一下窜了上来。',
        choices: [
          { title: '大吵一架', detail: '摔门而出，宣布隐私神圣不可侵犯。', effects: { emotion: -6, social: -4 }, hint: '冷战在所难免。' },
          { title: '冷静沟通', detail: '压着火，和父母谈边界与信任。', effects: { emotion: 4, social: 6, morality: 2 }, hint: '成熟得令人意外。' },
          { title: '写上锁的日记', detail: '什么也不说，换个带锁的本子。', effects: { emotion: -2, knowledge: 2 }, hint: '保留自己的世界。' }
        ]},
      { title: '朦胧好感', description: '你对班上某个同学产生了说不清的好感，总想多看对方一眼，成绩也有些走神。',
        choices: [
          { title: '专心学习', detail: '把心思收回来，好感埋在心底。', effects: { knowledge: 8, emotion: -3 }, hint: '青涩的克制。' },
          { title: '递小纸条', detail: '鼓起勇气表达心意。', effects: { emotion: 8, social: 3, knowledge: -4 }, hint: '少年心事。' },
          { title: '请教功课', detail: '以学习的名义多接触。', effects: { knowledge: 5, emotion: 4, social: 3 }, hint: '两全其美的小心机。' }
        ]}
    ],
    '青年期': [
      { title: '求职碰壁', eras: [[1993, 2099]], description: '投出的简历大多石沉大海，好不容易有个面试，HR 压价压得很厉害，工资只够勉强生活。',
        choices: [
          { title: '先签约就业', detail: '骑驴找马，先生存再发展。', effects: { wealth: 8, emotion: -3, knowledge: 3 }, hint: '手里有粮心不慌。' },
          { title: '继续等机会', detail: '拒掉低价 offer，宁缺毋滥。', effects: { wealth: -6, emotion: -2, knowledge: 2 }, hint: '赌一个更好的。' },
          { title: '尝试创业', detail: '和朋友合伙做点小生意。', effects: { wealth: -12, social: 5, luck: 3 }, hint: '高风险高回报。' }
        ]},
      { title: '房租上涨', eras: [[1996, 2099]], description: '房东通知续租要涨三成房租，你工资涨幅远跟不上，合租室友也准备搬走。',
        choices: [
          { title: '搬到远郊', detail: '牺牲通勤，换取便宜房租。', effects: { wealth: 6, health: -5, emotion: -3 }, hint: '每天多挤一小时地铁。' },
          { title: '咬牙续租', detail: '留在市区，多打一份零工。', effects: { wealth: -4, health: -6, knowledge: 2 }, hint: '用身体换时间。' },
          { title: '找人合租', detail: '重新找人分摊房租。', effects: { wealth: 3, social: 4 }, hint: '社交能力变现。' }
        ]}
    ],
    '壮年期': [
      { title: '晋升机会', description: '部门有个管理岗空缺，领导暗示你可以争取，但需要接手一个棘手的项目，加班将成为常态。',
        choices: [
          { title: '全力争取', detail: '立下军令状，死磕项目。', effects: { wealth: 14, social: 8, health: -10, emotion: -3 }, hint: '事业腾飞的代价。' },
          { title: '推给同事', detail: '陪家人更重要，让出机会。', effects: { emotion: 8, wealth: -5, social: -3 }, hint: '得失寸心知。' },
          { title: '谈条件', detail: '争取资源和加薪后再接手。', effects: { wealth: 8, social: 4, health: -5 }, hint: '成熟的谈判。' }
        ]},
      { title: '父母生病', description: '深夜接到电话，父亲突发疾病住院，需要人轮流陪护，而你手上正有重要工作脱不开身。',
        choices: [
          { title: '请假陪护', detail: '工作可以再找，爸只有一个。', effects: { emotion: 10, morality: 8, wealth: -10 }, hint: '亲情不留遗憾。' },
          { title: '请护工', detail: '花钱请专业护工，自己远程协调。', effects: { wealth: -12, emotion: -4, morality: -2 }, hint: '用钱买两全。' },
          { title: '托付兄妹', detail: '让兄弟姐妹先顶着。', effects: { emotion: -8, social: -4, morality: -5 }, hint: '家人心里有本账。' }
        ]}
    ],
    '中年期': [
      { title: '中年体检', eras: [[1995, 2099]], description: '体检报告上多了几个箭头：血脂、颈椎、脂肪肝。医生建议改变生活方式，别再硬扛。',
        choices: [
          { title: '开始健身', detail: '办卡、跑步、清淡饮食。', effects: { health: 12, wealth: -4, emotion: 4 }, hint: '自律给人自由。' },
          { title: '照吃照熬', detail: '道理都懂，应酬躲不开。', effects: { health: -10, wealth: 3, emotion: -2 }, hint: '报告压进抽屉。' },
          { title: '调养身心', detail: '规律作息，培养慢爱好。', effects: { health: 6, emotion: 8, luck: 2 }, hint: '慢下来也是进。' }
        ]},
      { title: '同学聚会', description: '多年不见的老同学聚会，有人发了迹高谈阔论，有人离了异沉默寡言。大家起哄问你这些年过得如何。',
        choices: [
          { title: '真诚分享', detail: '聊聊真实的甘苦，不装不比。', effects: { emotion: 6, social: 6 }, hint: '从容是最好的体面。' },
          { title: '低调买单', detail: '少说多听，悄悄结了账。', effects: { wealth: -6, social: 10, morality: 3 }, hint: '人情账记下了。' },
          { title: '借故不去', detail: '推掉聚会，省得攀比闹心。', effects: { emotion: 2, social: -5 }, hint: '清净但少了联系。' }
        ]}
    ],
    '老年期': [
      { title: '带孙之乐', description: '子女工作忙，提出想让你帮忙带孩子。老伴看着你，等你拿主意。',
        choices: [
          { title: '欣然帮带', detail: '享受天伦之乐，帮子女分忧。', effects: { emotion: 10, social: 4, health: -6 }, hint: '累并快乐着。' },
          { title: '量力而行', detail: '白天帮忙，晚上子女自己带。', effects: { emotion: 5, health: 2, social: 3 }, hint: '边界感保住晚年。' },
          { title: '安享晚年', detail: '出钱不出力，保留自己的生活。', effects: { emotion: 3, wealth: -8, social: -4 }, hint: '两代人的观念差。' }
        ]},
      { title: '老毛病犯了', description: '膝盖的老毛病又犯了，医生建议手术置换关节，费用不低；也可以保守治疗，但行动会越来越受限。',
        choices: [
          { title: '接受手术', detail: '趁身体还行，一次解决。', effects: { health: 12, wealth: -14 }, hint: '花钱买生活质量。' },
          { title: '保守治疗', detail: '吃药理疗，能拖一天是一天。', effects: { health: -5, wealth: -3, emotion: -3 }, hint: '越拖越被动。' },
          { title: '锻炼康复', detail: '遵医嘱做康复训练。', effects: { health: 6, emotion: 4, wealth: -2 }, hint: '和慢性病共处。' }
        ]}
    ],
    '暮年期': [
      { title: '回望一生', description: '阳光好的午后，你坐在院子里翻起发黄的老照片。许多面孔、许多名字涌上心头，有些已经不在了。',
        choices: [
          { title: '讲给孙辈听', detail: '把照片里的故事一代代讲下去。', effects: { emotion: 10, social: 6, morality: 3 }, hint: '记忆因此不朽。' },
          { title: '写回忆录', detail: '戴上老花镜，把一生写下来。', effects: { knowledge: 5, emotion: 6 }, hint: '与自己和解。' },
          { title: '静静晒晒太阳', detail: '什么也不说，挺好。', effects: { emotion: 5, health: 2 }, hint: '平安喜乐。' }
        ]}
    ]
  };

  // 固定人生节点降级剧情：主版本 + 年代变体（variants 按当时公历年份匹配）
  // 例：1977 年前无高考 → 18 岁节点改写为"上山下乡"；1990 年代前"毕业包分配"
  const FALLBACK_MILESTONE = {
    3: { title: '第一天上幼儿园', eras: [[1980, 2099]], description: '三岁这年，父母牵着你的手把你送进幼儿园。陌生的教室、小小的桌椅、一群和你一样哭闹的孩子——你要第一次独自面对外面的世界了。',
      choices: [
        { title: '开心探索', detail: '松开父母的手，跑去玩玩具。', effects: { social: 8, emotion: 4 }, hint: '适应力满分。' },
        { title: '紧紧不放', detail: '抱着妈妈的腿不肯撒手。', effects: { emotion: -6, social: -3 }, hint: '成长需要时间。' },
        { title: '先观察再说', detail: '安静坐在一旁观察大家。', effects: { knowledge: 3, emotion: 1 }, hint: '谨慎的小观察者。' }
      ],
      variants: [
        { eras: [[1949, 1979]], title: '没人带的年月', description: '三岁这年，还没有幼儿园可上。白天大人去上工，你就跟着哥哥姐姐在院子里、田埂上野，弄堂里一伙孩子呼啸着来去。',
          choices: [
            { title: '当野孩子王', detail: '带着一伙孩子满村跑。', effects: { social: 8, emotion: 5, health: -3 }, hint: '泥土里的童年。' },
            { title: '在家帮忙带弟妹', detail: '搬个小板凳看着弟弟。', effects: { morality: 5, emotion: -2, health: -2 }, hint: '早熟的哥哥姐姐。' },
            { title: '跟着大人去地里', detail: '拎着水壶去田头送饭。', effects: { health: -3, social: 3, wealth: 2 }, hint: '早早知道辛苦。' }
          ] }
      ]},
    7: { title: '背起新书包', description: '七岁，你背上崭新的书包走进小学。课本散发着油墨味，讲台上的老师念到你的名字——从今天起，你是一名真正的学生了。',
      choices: [
        { title: '争当第一', detail: '上课坐第一排，事事争先。', effects: { knowledge: 9, social: 2, health: -2 }, hint: '学霸的起点。' },
        { title: '广交朋友', detail: '很快和前后桌打成一片。', effects: { social: 9, knowledge: 2 }, hint: '孩子王气质。' },
        { title: '默默跟上', detail: '不出风头，按部就班。', effects: { knowledge: 4, emotion: 3 }, hint: '稳扎稳打。' }
      ],
      variants: [
        { eras: [[1966, 1976]], title: '时停时复的课堂', description: '七岁，学校时停时复，课本换了一版又一版。你在操场上参加过"闹革命"，也曾在破教室里念过几页书——基础功课，多半靠家里盯着。',
          choices: [
            { title: '当上红小兵头头', detail: '戴上袖章，领着同学出操。', effects: { social: 6, emotion: 4, knowledge: -4 }, hint: '时代的风口。' },
            { title: '在家自学不落下', detail: '父母盯着写大字、算算术。', effects: { knowledge: 6, emotion: -2, health: -2 }, hint: '家学渊源。' },
            { title: '跟着大孩子去串联', detail: '背着干粮坐车去看外面的世界。', effects: { social: 5, emotion: 3, knowledge: -3, health: -3 }, hint: '荒唐的长见识。' }
          ] }
      ]},
    13: { title: '初中来了', description: '十三岁，你升入初中，课程变多，青春期也悄悄到来。身体和心思都在发生陌生的变化，你对未来第一次有了模糊的想象。',
      choices: [
        { title: '埋头苦读', detail: '把青春期的能量用在学习上。', effects: { knowledge: 10, emotion: -3, health: -2 }, hint: '厚积薄发。' },
        { title: '发展爱好', detail: '加入社团，找到热爱的事。', effects: { emotion: 8, social: 5, knowledge: -2 }, hint: '青春该有色彩。' },
        { title: '跟风叛逆', detail: '学着逃课、追潮流。', effects: { knowledge: -7, social: 2, morality: -3 }, hint: '叛逆的代价。' }
      ],
      variants: [
        { eras: [[1966, 1976]], title: '没有教室的青春期', description: '十三岁，初中早已停课。你在宣传队、工厂和农田之间晃悠，同伴们早早学会了抽烟喝酒，也在偷偷传看手抄本——青春期无处安放。',
          choices: [
            { title: '进宣传队排节目', detail: '唱歌跳舞，风头正劲。', effects: { social: 6, emotion: 3, knowledge: -3 }, hint: '舞台上的青春。' },
            { title: '进厂当学徒工', detail: '跟着师傅学一门手艺。', effects: { wealth: 3, knowledge: 3, emotion: -2 }, hint: '手艺人的起点。' },
            { title: '在家把手抄本读烂', detail: '如饥似渴，读完能整本背下。', effects: { knowledge: 7, emotion: -2, morality: 1 }, hint: '书里的春天。' }
          ] }
      ]},
    16: { title: '中考关口', eras: [[1978, 2099]], description: '十六岁，中考在即。重点高中、普通高中、职校，人生第一次分流近在眼前，家里的气氛也紧张起来。',
      choices: [
        { title: '冲刺重点', detail: '拼尽全力冲一把重点高中。', effects: { knowledge: 12, health: -6, emotion: -2 }, hint: '改变跑道的一战。' },
        { title: '稳妥就好', detail: '按自己节奏考个合适的学校。', effects: { knowledge: 5, emotion: 4 }, hint: '适合的才是最好的。' },
        { title: '考虑职校', detail: '学一门实在技术早点工作。', effects: { knowledge: 2, wealth: 4, social: -2 }, hint: '另一条人生路径。' }
      ],
      variants: [
        { eras: [[1966, 1976]], title: '一纸下乡通知', description: '十六岁，没有中考，也没有课堂。下乡的通知贴出来，整个院子都沉默了——你的人生，从此多了"扎根"两个字。',
          choices: [
            { title: '主动去最苦的地方', detail: '写下请战书，去最远的连队。', effects: { morality: 8, health: -5, emotion: -3, social: 3 }, hint: '理想主义的重量。' },
            { title: '留在城里当学徒', detail: '进厂学门手艺，好歹留在父母身边。', effects: { wealth: 4, knowledge: -2, social: 2 }, hint: '现实的温度。' },
            { title: '边哭边收拾行囊', detail: '把课本和照片塞进背包。', effects: { emotion: -5, knowledge: 2, morality: 2 }, hint: '少年的远行。' }
          ] },
        { eras: [[1949, 1965]], title: '招工与支边', description: '十六岁，城里招工，老家来信说边疆缺人。几条路摆在面前，每条都不轻松——这是你第一次自己拿大主意。',
          choices: [
            { title: '报名去边疆建设', detail: '胸怀理想，去最需要的地方。', effects: { morality: 6, health: -4, emotion: 2, social: 3 }, hint: '火红的年代。' },
            { title: '进城当学徒工', detail: '进厂站机床，先端上饭碗。', effects: { wealth: 3, knowledge: 2, emotion: -2 }, hint: '饭碗的分量。' },
            { title: '留在村里务农', detail: '守着几亩地，照顾家里。', effects: { health: -2, morality: 2, emotion: -2 }, hint: '本分的选择。' }
          ] }
      ]},
    18: { title: '高考', eras: [[1977, 2099]], description: '十八岁，高考。三天的考试像一道闸门，十二年的寒窗都压在几张试卷上。交卷铃响，你走出考场，盛夏的阳光晃得人睁不开眼。',
      choices: [
        { title: '超常发挥', detail: '沉着冷静，会的全对。', effects: { knowledge: 10, emotion: 10, luck: 6 }, hint: '命运抛来橄榄枝。' },
        { title: '正常发挥', detail: '不功不过，成绩在意料之中。', effects: { knowledge: 4, emotion: 2 }, hint: '平凡也踏实。' },
        { title: '发挥失常', detail: '紧张到失眠，几门考砸了。', effects: { emotion: -12, knowledge: -4, luck: -5 }, hint: '人生第一道大坎。' }
      ],
      variants: [
        { eras: [[1966, 1976]], title: '没有高考的年月', description: '十八岁，大学停招，高考是上辈子的事。学长们戴着大红花去下乡，你的大学梦换成了粮票与介绍信——可书，你是一天也没舍得放下。',
          choices: [
            { title: '报名下乡接受再教育', detail: '打起背包，去广阔的天地。', effects: { morality: 7, health: -5, emotion: -4, social: 3 }, hint: '一代人的命运。' },
            { title: '托关系谋个临时工作', detail: '街道工厂、副食店，先落脚。', effects: { wealth: 2, social: -2, morality: -2 }, hint: '人情社会的缝隙。' },
            { title: '在家待业苦读不放弃', detail: '帮家里干活，书不离手。', effects: { knowledge: 7, emotion: -4, health: -2 }, hint: '等一个春天。' }
          ] },
        { eras: [[1949, 1965]], title: '人生的岔路口', description: '十八岁，招工、参军、考学，几条路摆在面前。谁也不知道哪条路通向哪里，你只知道，从今晚起睡不着了。',
          choices: [
            { title: '参军报国', detail: '戴上大红花，去了部队。', effects: { health: 6, morality: 7, social: 4, emotion: -2 }, hint: '熔炉里的青春。' },
            { title: '进厂当工人', detail: '站上机床，先端稳饭碗。', effects: { wealth: 5, social: 3, emotion: 2 }, hint: '光荣的工人阶级。' },
            { title: '考学继续读书', detail: '啃下代数几何，跳出农门。', effects: { knowledge: 9, emotion: 2, wealth: -3 }, hint: '书本改变命运。' }
          ] }
      ]},
    22: { title: '毕业季', eras: [[1992, 2099]], description: '二十二岁，你站在大学与社会的交界线上。有人考研，有人考公，有人北漂南下，宿舍楼下的行李箱装着四年和未来。',
      choices: [
        { title: '进入名企', detail: '拿着不错的 offer 去大城市打拼。', effects: { wealth: 10, knowledge: 6, health: -4 }, hint: '光鲜与压力并存。' },
        { title: '继续深造', detail: '考研/出国，把书读透。', effects: { knowledge: 12, wealth: -6, emotion: 2 }, hint: '延迟兑现的价值。' },
        { title: '回乡发展', detail: '考公或接手家里的安排。', effects: { wealth: 5, emotion: 6, social: 3 }, hint: '安稳的护城河。' }
      ],
      variants: [
        { eras: [[1980, 1989]], title: '一张派遣证', description: '二十二岁，毕业即分配。一张派遣证定去向，同学间传着谁分到了部委、谁分到了三线。散伙饭上，有人哭有人笑。',
          choices: [
            { title: '服从分配去大机关', detail: '背着行李去省城报到。', effects: { social: 6, wealth: 4, emotion: 2 }, hint: '铁饭碗的荣耀。' },
            { title: '争取留在母校', detail: '托人递话，想办法留下。', effects: { knowledge: 5, social: 3, emotion: 2 }, hint: '人情与实力的博弈。' },
            { title: '主动申请去特区', detail: '请缨去南方，趁年轻闯一闯。', effects: { wealth: 8, health: -3, emotion: -2, social: 3 }, hint: '先行者的寂寞。' }
          ] },
        { eras: [[1949, 1979]], title: '回城与着落', description: '二十二岁，知青返城的政策下来了，招工、顶班、等指标，人生要重新排队。你提着行李回到既熟悉又陌生的城市。',
          choices: [
            { title: '顶父母的班进厂', detail: '接过父母的工牌，站上机床。', effects: { wealth: 4, emotion: -2, social: 2 }, hint: '薪火相传。' },
            { title: '回城自谋出路', detail: '摆摊、打零工，不信没活路。', effects: { social: 4, wealth: -3, emotion: -2, luck: 2 }, hint: '自找的苦与甜。' },
            { title: '在当地扎根不走了', detail: '娶妻生子，把异乡住成家乡。', effects: { emotion: 3, morality: 3, wealth: -2 }, hint: '此心安处。' }
          ] }
      ]},
    28: { title: '婚恋压力', description: '二十八岁，逢年过节的话题都绕不开结婚生子。有人介绍对象，家里开始旁敲侧击，你也说不清自己到底在等什么。',
      choices: [
        { title: '认真相亲', detail: '不排斥合适的人，试着交往。', effects: { emotion: 8, wealth: -5, social: 4 }, hint: '烟火气的幸福。' },
        { title: '专注事业', detail: '先立业，后成家。', effects: { wealth: 10, knowledge: 5, emotion: -4 }, hint: '甘蔗没有两头甜。' },
        { title: '坚持等真爱', detail: '不将就，缘分急不来。', effects: { emotion: 3, social: -3, luck: 2 }, hint: '灵魂伴侣很贵。' }
      ],
      variants: [
        { eras: [[1949, 1982]], title: '三大件', description: '二十八岁，结婚讲究"三大件"——缝纫机、自行车、手表，外加一顿像样的酒席和一间新房。介绍人踏破了门槛，攒票比攒钱还难。',
          choices: [
            { title: '攒齐三大件风光娶亲', detail: '票攒齐了，酒席摆了八桌。', effects: { wealth: -8, social: 7, emotion: 8 }, hint: '体面的婚礼。' },
            { title: '一切从简领证结婚', detail: '两床新被，就算成了家。', effects: { wealth: -2, emotion: 4, social: -2 }, hint: '简单也是勇气。' },
            { title: '再等等攒够彩礼', detail: '对象愿意等，家里却急了。', effects: { wealth: -3, emotion: -4, social: 2 }, hint: '等待的煎熬。' }
          ] }
      ]},
    60: { title: '退休那天', description: '六十岁，你办完退休手续，交出用了几十年的工牌。回家的路突然变得很长——明天起，再也不用设闹钟了。',
      choices: [
        { title: '发展爱好', detail: '书法、钓鱼、广场舞，重新活一遍。', effects: { emotion: 12, health: 5, social: 4 }, hint: '第二人生开始。' },
        { title: '含饴弄孙', detail: '把时间都给孙辈和家庭。', effects: { emotion: 8, health: -4, social: 2 }, hint: '甜蜜的负担。' },
        { title: '返聘发挥余热', detail: '接受单位返聘，继续做事。', effects: { wealth: 8, knowledge: 4, health: -5 }, hint: '停不下来的人。' }
      ]}
  };

  // 取降级用的人生节点剧情：年代变体优先；主版本不适配且无变体时返回 null（回退普通池）
  function pickMilestoneFallback(milestone, year) {
    const m = FALLBACK_MILESTONE[milestone.age];
    if (!m) return null;
    if (year != null && m.variants) {
      for (const v of m.variants) {
        if (v.eras.some(r => year >= r[0] && year <= r[1])) return v;
      }
    }
    if (!eraAllowed(m, year)) return null;
    return m;
  }

  /* 年代专属降级事件：按"当时公历年份"匹配，优先于通用池，
   * 保证 AI 不可用时剧情依然不穿越（年代/器物/职业/物价符合当年） */
  const ERA_POOL = [
    { from: 1958, to: 1961, stage: '幼儿期', title: '瓜菜代',
      description: '公共食堂的粥越来越清，妈妈把仅有的红薯干藏起来给你。夜里你饿得睡不着，听大人们压低声音议论着今年的收成。',
      choices: [
        { title: '跟着大人去挖野菜', detail: '挎上小篮子，去田埂边认能吃的野菜。', effects: { health: -2, emotion: -2, social: 3 }, hint: '苦中作乐的童年。' },
        { title: '把粥让给弟弟', detail: '说自己不饿，把碗推过去。', effects: { morality: 6, emotion: -3, health: -4 }, hint: '懂事得让人心疼。' },
        { title: '哭闹着要吃饱', detail: '越想越委屈，放声大哭。', effects: { emotion: 3, health: -3, morality: -2 }, hint: '孩子的抗议。' }
      ]},
    { from: 1958, to: 1961, stage: '壮年期', title: '大炼钢铁',
      description: '全村人在打谷场上搭起土高炉，青壮年轮流守夜添料，口号声震天响。你家的大铁锅也拿去炼钢了，厨房里冷清了好些天。',
      choices: [
        { title: '带头守夜炼钢', detail: '扛住疲惫，争当积极分子。', effects: { social: 7, health: -6, emotion: 2 }, hint: '热情燃烧着日子。' },
        { title: '偷偷藏起一口锅', detail: '留个后手，家里人还要吃饭。', effects: { wealth: -2, morality: 2, social: -3 }, hint: '明哲保身。' },
        { title: '照常下地干活', detail: '不声不响，把生产队的农活干完。', effects: { health: -3, morality: 3, wealth: 1 }, hint: '本分人的选择。' }
      ]},
    { from: 1962, to: 1965, stage: '童年期', title: '集市重现',
      description: '自留地的西红柿熟了，妈妈带你去赶集。集市上人声鼎沸，叫卖声此起彼伏，你第一次见到这么多新鲜玩意儿摆在一块儿。',
      choices: [
        { title: '摆摊卖鸡蛋', detail: '用报纸折成托盘，学着吆喝。', effects: { wealth: 2, social: 5, emotion: -2 }, hint: '小小生意人的第一课。' },
        { title: '蹲着看西洋镜', detail: '花两分钱看一次，舍不得走。', effects: { emotion: 5, knowledge: 2, wealth: -1 }, hint: '快乐很便宜。' },
        { title: '把钱攒下买书', detail: '忍住了没花，买了本连环画。', effects: { knowledge: 4, wealth: -2, emotion: 2 }, hint: '精神食粮。' }
      ]},
    { from: 1962, to: 1965, stage: '幼儿期', title: '病中的一碗鸡蛋面',
      description: '你病了一场，连日低烧不肯吃饭。外婆听说后走了十几里路来看你，端着碗热腾腾的鸡蛋面，上面还卧了个荷包蛋。',
      choices: [
        { title: '乖乖把面吃完', detail: '捧着碗，连汤都喝了个干净。', effects: { health: 7, emotion: 6 }, hint: '病好了一半。' },
        { title: '闹着不肯吃药', detail: '药太苦，哭着往外吐。', effects: { health: -4, emotion: -3, morality: -1 }, hint: '苦口的麻烦。' },
        { title: '把蛋留给弟弟', detail: '说自己不爱吃，推了过去。', effects: { morality: 5, emotion: -2, health: -2 }, hint: '懂事的让人心酸。' }
      ]},
    { from: 1966, to: 1976, stage: '童年期', title: '停课的日子',
      description: '学校停课了，大孩子们戴着红袖章排着队游行。你在家照看弟妹，课本换了一版又一版，功课渐渐荒疏下去。',
      choices: [
        { title: '跟着队伍看热闹', detail: '挤在人群里，看满街的大字报。', effects: { social: 4, emotion: 3, knowledge: -4 }, hint: '懵懂的兴奋。' },
        { title: '在家带弟妹做家务', detail: '洗衣做饭，把家撑起来。', effects: { morality: 5, emotion: -3, health: -2 }, hint: '早熟的担当。' },
        { title: '偷听广播学外语', detail: '把半导体贴在耳边，跟着念单词。', effects: { knowledge: 6, emotion: 1, social: -2 }, hint: '乱世里的静气。' }
      ]},
    { from: 1966, to: 1976, stage: '青春期', title: '样板戏与手抄本',
      description: '广播里整天放着样板戏，你在朋友间传看手抄的诗与小说，纸张都翻烂了。誰知哪天就会被人收了去，传阅成了地下工作。',
      choices: [
        { title: '积极参加宣传队', detail: '上台演出，风头无两。', effects: { social: 7, emotion: 3, knowledge: -3 }, hint: '站在台前的人。' },
        { title: '躲在角落读禁书', detail: '如饥似渴，记满一整个笔记本。', effects: { knowledge: 7, emotion: -2, morality: 1 }, hint: '书里的世界更大。' },
        { title: '约人去江边散步', detail: '夏夜的江风，聊到很晚才回。', effects: { emotion: 5, social: 3, morality: -1 }, hint: '青春自有出口。' }
      ]},
    { from: 1966, to: 1976, stage: '青年期', title: '上山下乡',
      description: '通知书下来了，你报名去外地农村。车站上红旗招展，送行的亲人哭成一片，绿皮火车把你拉向一个完全陌生的地方。',
      choices: [
        { title: '主动去最苦的地方', detail: '写下请战书，去最远的连队。', effects: { morality: 9, health: -6, social: 4, emotion: -4 }, hint: '理想主义的重量。' },
        { title: '设法留在城里', detail: '称病或托关系，避开下乡。', effects: { social: -4, emotion: -2, wealth: 2 }, hint: '保住了什么，又失去了什么。' },
        { title: '服从分配去近郊', detail: '收拾行囊，去了邻近的公社。', effects: { health: -3, morality: 3, emotion: -2 }, hint: '随遇而安。' }
      ]},
    { from: 1977, to: 1979, stage: '童年期', title: '课本与收音机',
      description: '学校恢复了正常上课，课本是崭新的。家里的半导体收音机成了宝贝，每晚全家围着听新闻和评书连播。',
      choices: [
        { title: '如饥似渴地读书', detail: '把课本翻烂，到处借书看。', effects: { knowledge: 7, emotion: 2, health: -2 }, hint: '知识的饥渴年代。' },
        { title: '组装矿石收音机', detail: '缠线圈、搭电路，晚上戴耳机听。', effects: { knowledge: 5, social: 3, wealth: -2 }, hint: '动手的快乐。' },
        { title: '带着同学打弹珠', detail: '胡同里一玩就是一下午。', effects: { emotion: 5, social: 4, knowledge: -2 }, hint: '简单的快乐。' }
      ]},
    { from: 1977, to: 1979, stage: '青春期', title: '邓丽君与三洋录音机',
      description: '有人拎着三洋录音机在院子里放邓丽君，你远远地听呆了。那歌声像一道缝，让外面的世界透了点光进来。',
      choices: [
        { title: '凑钱买磁带跟着唱', detail: '和同学凑了笔钱，翻来覆去地听。', effects: { emotion: 7, wealth: -2, social: 4 }, hint: '歌声里的春天。' },
        { title: '埋头准备高考', detail: '把耳机收进抽屉，刷题到半夜。', effects: { knowledge: 9, emotion: -3 }, hint: '改变命运的一年。' },
        { title: '给电台点歌', detail: '省下早饭钱，给同学点了首歌。', effects: { social: 5, emotion: 4, wealth: -1 }, hint: '少年心意。' }
      ]},
    { from: 1977, to: 1979, stage: '青年期', title: '恢复高考',
      description: '广播里播送恢复高考的消息，整个院子都轰动了。你白天上班，夜里在油灯下啃书本，困了就用凉水抹把脸。',
      choices: [
        { title: '白天上工夜里苦读', detail: '报名参考，拼上这一把。', effects: { knowledge: 12, health: -7, emotion: 3 }, hint: '改变命运的几个星期。' },
        { title: '先顾饭碗再说', detail: '考试风险太大，老老实实上班。', effects: { wealth: 3, knowledge: -2, emotion: -2 }, hint: '稳妥也是一种人生。' },
        { title: '拉上同伴一起复习', detail: '几个工友凑在一起互相讲题。', effects: { social: 5, knowledge: 6, emotion: 4 }, hint: '一群人的命运。' }
      ]},
    { from: 1980, to: 1989, stage: '童年期', title: '第一次看电视',
      description: '邻居家买了台黑白电视，一到晚上院子里就摆满小板凳。你一放学就跑去占座，屏幕上的雪花都比白天的游戏好看。',
      choices: [
        { title: '天天去蹭电视', detail: '占个好位置，看到"再见"才走。', effects: { emotion: 7, knowledge: 3, social: 2 }, hint: '全院子的盛会。' },
        { title: '缠着父母也买一台', detail: '哭闹了半个学期，终于盼来了电视。', effects: { wealth: -6, emotion: 7, social: 3 }, hint: '人生第一件大件。' },
        { title: '在院里演剧情', detail: '拿根木棍当剑，和伙伴演射雕。', effects: { emotion: 6, social: 5 }, hint: '自编自导的童年。' }
      ]},
    { from: 1980, to: 1989, stage: '青春期', title: '喇叭裤与录音机',
      description: '邓丽君、费翔、喇叭裤，风潮一阵阵吹进校园。你偷偷把裤脚改宽，被班主任叫去办公室谈话，心里却美滋滋的。',
      choices: [
        { title: '跟上潮流打扮自己', detail: '攒下零用钱，买了条像样的裤子。', effects: { social: 6, emotion: 5, morality: -1 }, hint: '爱美的年纪。' },
        { title: '一心只读圣贤书', detail: '两耳不闻窗外事，考上好学校再说。', effects: { knowledge: 9, emotion: -3 }, hint: '苦读的回报。' },
        { title: '张罗班级舞会', detail: '借来录音机，组织了一场新年晚会。', effects: { social: 7, emotion: 5, knowledge: -3, morality: -1 }, hint: '麻烦也热闹。' }
      ]},
    { from: 1980, to: 1989, stage: '青年期', title: '南下淘金',
      description: '听说广州遍地是机会，同乡已经寄回汇款单。你捏着攒了多年的路费，心里像有猫在抓——去，还是不去？',
      choices: [
        { title: '买张站票直奔南方', detail: '挤上绿皮车，去闯一闯。', effects: { wealth: 9, social: 6, health: -5, emotion: -2 }, hint: '时代的风口。' },
        { title: '进本地乡镇企业', detail: '家门口上班，稳稳当当。', effects: { wealth: 4, health: 2, emotion: 3 }, hint: '小日子也滋润。' },
        { title: '支个摊做个体户', detail: '进点货，在街边摆起摊来。', effects: { wealth: 7, social: -2, emotion: 2, luck: 2 }, hint: '最早一批"老板"。' }
      ]},
    { from: 1990, to: 1999, stage: '童年期', title: '小霸王学习机',
      description: '吵了半个学期，爸妈终于搬回一台学习机。你练了三天打字，就偷偷换上了魂斗罗的卡带。',
      choices: [
        { title: '苦练打字背单词', detail: '用它学五笔，把英语单词过几轮。', effects: { knowledge: 7, emotion: 2 }, hint: '学习机的正确用法。' },
        { title: '打通宵魂斗罗', detail: '上上下下左右左右BA。', effects: { emotion: 8, knowledge: -4, health: -3 }, hint: '快乐但伤眼。' },
        { title: '和同学换卡玩', detail: '一张卡带传遍全班，人缘暴涨。', effects: { social: 6, wealth: -2, emotion: 4 }, hint: '卡带外交。' }
      ]},
    { from: 1990, to: 1999, stage: '青春期', title: '寻呼机与网吧',
      description: '同桌别上了BP机，铃声一响就满楼道跑着回电话。街角新开的网吧五块钱一小时，OICQ的咳嗽声此起彼伏。',
      choices: [
        { title: '缠着家里配BP机', detail: '别在腰上，走路都带着风。', effects: { wealth: -6, social: 6, emotion: 4 }, hint: '当年的身份象征。' },
        { title: '去网吧开个OICQ号', detail: '加了好多陌生人，聊到天亮。', effects: { knowledge: 4, social: 5, emotion: 4, wealth: -2 }, hint: '互联网的第一扇门。' },
        { title: '专心读书不碰这些', detail: '把好奇心压下去，刷题备考。', effects: { knowledge: 8, emotion: -2, social: -3 }, hint: '错过一个时代。' }
      ]},
    { from: 1990, to: 1999, stage: '青年期', title: '下岗与下海',
      description: '厂子里传要裁员，车间人心惶惶。亲戚下海做生意赚了钱，回来请客讲话都硬气了许多。你彻夜难眠。',
      choices: [
        { title: '停薪留职下海', detail: '跟着亲戚跑业务、进货、开店。', effects: { wealth: 10, social: 5, health: -4, emotion: -3, luck: 3 }, hint: '风浪里讨生活。' },
        { title: '守着铁饭碗', detail: '不折腾，领份安稳工资。', effects: { wealth: 3, emotion: -2, knowledge: 2 }, hint: '稳有稳的代价。' },
        { title: '偷偷做点小买卖', detail: '业余时间摆摊，两头不误。', effects: { wealth: 6, social: 3, morality: -2 }, hint: '灰色地带的勤劳。' }
      ]},
    { from: 2000, to: 2009, stage: '童年期', title: '网吧与QQ',
      description: '黑网吧一块钱一小时，你申请了QQ号，养了一只胖企鹅。周末去网吧包夜，被家长从被窝里揪出来是常态。',
      choices: [
        { title: '练级养宠交网友', detail: '加了好多群，头像闪个不停。', effects: { social: 6, emotion: 5, wealth: -2, knowledge: 1 }, hint: '虚拟世界的热闹。' },
        { title: '被家长抓回家', detail: '一顿胖揍，网线被拔。', effects: { knowledge: 3, emotion: -5, social: -2 }, hint: '猫捉老鼠。' },
        { title: '联机打红警', detail: '约上三五好友，战个通宵。', effects: { social: 7, emotion: 6, wealth: -2, health: -2 }, hint: '兄弟的战场。' }
      ]},
    { from: 2000, to: 2009, stage: '青春期', title: '非典之夏',
      description: '学校里天天消毒量体温，板蓝根被抢空，放假的告示贴满了教学楼。整个春天和夏天，口罩与醋味混在一起。',
      choices: [
        { title: '趁机疯狂补课', detail: '把落下的功课一口气补回来。', effects: { knowledge: 9, health: -3, emotion: -2 }, hint: '危机也是转机。' },
        { title: '偷着打球上网', detail: '戴口罩翻墙出去，痛快一时。', effects: { emotion: 5, social: 4, health: -2, morality: -2 }, hint: '叛逆的代价。' },
        { title: '学着做饭照顾家人', detail: '照着菜谱，给全家做饭。', effects: { morality: 5, emotion: 4, knowledge: 2 }, hint: '烟火气的成长。' }
      ]},
    { from: 2000, to: 2009, stage: '青年期', title: '买房还是创业',
      description: '房价一天一个样，爸妈翻出存折说凑个首付。朋友拉你合伙开公司，说再不上车就晚了。两边都像机会。',
      choices: [
        { title: '凑首付买房', detail: '按揭三十年，先安个家。', effects: { wealth: -20, emotion: 5, social: 3 }, hint: '房奴的起点。' },
        { title: '把钱投进公司', detail: '搏一把，输了从头再来。', effects: { wealth: 12, social: 5, emotion: -2, luck: 3 }, hint: '风口上的猪。' },
        { title: '先租着观望', detail: '不接盘，看看风向再说。', effects: { wealth: 3, emotion: -3 }, hint: '观望派的耐心。' }
      ]},
    { from: 2010, to: 2019, stage: '童年期', title: '智能手机与短视频',
      description: '爸妈淘汰的智能机归了你，从此饭前饭后都低着头。手指一划就是一下午，作业总要拖到半夜。',
      choices: [
        { title: '自学剪辑做视频', detail: '下载软件，剪出第一条作品。', effects: { knowledge: 6, social: 5, emotion: 4, health: -3 }, hint: '小小创作者。' },
        { title: '刷到半夜视力下降', detail: '被窝里的蓝光，越刷越精神。', effects: { emotion: 5, knowledge: -3, health: -6 }, hint: '多巴胺的陷阱。' },
        { title: '报编程兴趣班', detail: '用零花钱学图形化编程。', effects: { knowledge: 8, wealth: -5, social: 3 }, hint: '提前起跑。' }
      ]},
    { from: 2010, to: 2019, stage: '青春期', title: '大厂表哥',
      description: '表哥毕业进了大厂，年薪几十万，全家拿他当榜样。饭桌上句句不离"人家孩子"，你默默扒着饭。',
      choices: [
        { title: '发奋考名校进大厂', detail: '把全部力气押在考试上。', effects: { knowledge: 11, health: -5, emotion: -2 }, hint: '独木桥的拥挤。' },
        { title: '钻研竞赛与特长', detail: '走特长路线，另辟赛道。', effects: { knowledge: 7, social: 4, emotion: 3 }, hint: '差异化竞争。' },
        { title: '做游戏直播赚零花', detail: '边玩边播，居然有了粉丝。', effects: { wealth: 6, social: 4, knowledge: -4, morality: -2 }, hint: '风口的诱惑。' }
      ]},
    { from: 2010, to: 2019, stage: '青年期', title: '考研还是考公',
      description: '室友们分成两派：一派占图书馆考研，一派报班考公。招聘会上的简历杳无音信，你也该选条路了。',
      choices: [
        { title: '考研继续深造', detail: '再读三年，把学历卷上去。', effects: { knowledge: 11, wealth: -6, emotion: 3 }, hint: '延迟的兑现。' },
        { title: '考公上岸求稳', detail: '一套行测申论，先上岸再说。', effects: { wealth: 7, social: 4, emotion: 3, morality: 2 }, hint: '宇宙的尽头。' },
        { title: '进公司搏高薪', detail: '接了大厂offer，996就996。', effects: { wealth: 18, health: -7, emotion: -2 }, hint: '用命换钱。' }
      ]},
    { from: 2020, to: 2035, stage: '青春期', title: '网课时代',
      description: '居家网课成了常态，摄像头一关，你在被窝里刷着手机。屏幕那头的"在吗"和窗外的世界，都有点不真实。',
      choices: [
        { title: '自律刷题逆袭', detail: '关掉手机，把落下的课补回来。', effects: { knowledge: 10, health: -3, emotion: 3 }, hint: '弯道超车。' },
        { title: '摸鱼打游戏', detail: '挂着网课，副本打了一局又一局。', effects: { emotion: 6, knowledge: -6, health: -4 }, hint: '代价在后头。' },
        { title: '当志愿者送菜', detail: '帮社区给隔离户送菜。', effects: { social: 6, morality: 7, emotion: 5, health: -3 }, hint: '被需要的价值。' }
      ]},
    { from: 2020, to: 2035, stage: '青年期', title: 'AI浪潮',
      description: '大模型一夜之间刷屏，公司开会必提"拥抱AI"。有人靠它做出产品拿了融资，你既兴奋又焦虑，夜不能寐。',
      choices: [
        { title: '业余苦学AI工具', detail: '看教程、跑demo，做出小工具。', effects: { knowledge: 10, health: -4, wealth: 4 }, hint: '新工具的红利。' },
        { title: '花钱报班考证', detail: '咬牙交了不菲的学费。', effects: { knowledge: 6, wealth: -9, emotion: -2 }, hint: '焦虑的生意。' },
        { title: '观望不动', detail: '等技术再成熟点看。', effects: { emotion: -3, wealth: 2, social: -2 }, hint: '等等党的得失。' }
      ]},
    { from: 2020, to: 2035, stage: '壮年期', title: '失业后再出发',
      description: '行业收缩，你被"优化"了。赔偿金够撑几个月，简历投出去却少有回音。家里人的眼神让你坐不住。',
      choices: [
        { title: '先跑滴滴过渡', detail: '租了车先跑着，收入不能断。', effects: { wealth: 8, health: -7, emotion: -4, social: 3 }, hint: '放下身段的勇气。' },
        { title: '降薪去小公司', detail: '职位降了级，好歹回到牌桌。', effects: { wealth: -5, emotion: -3, knowledge: 3 }, hint: '曲线救国。' },
        { title: '拿赔偿金歇一阵', detail: '给自己放个假，陪陪家人。', effects: { wealth: 5, emotion: 4, health: 3, social: -3 }, hint: '中场休息。' }
      ]}
  ];

  // 年代专属降级事件（匹配当前公历年份与人生阶段，优先于通用池）
  function eraFallbackEvents(stage, year) {
    if (year == null) return [];
    return ERA_POOL.filter(function (e) {
      return year >= e.from && year <= e.to && e.stage === stage;
    });
  }

  function fallbackEvent(s, milestone) {
    const year = currentYear(s);
    let pool = [];
    // 1) 固定人生节点：优先年代变体（如 1977 年前的高考改写为上山下乡）
    if (milestone) {
      const m = pickMilestoneFallback(milestone, year);
      if (m) pool = [m];
    }
    // 2) 年代专属事件优先，其次才是通用池（通用池内年代敏感事件按 eras 过滤）
    if (!pool.length) {
      const eraPool = eraFallbackEvents(s.stage, year);
      const genPool = (FALLBACK_POOL[s.stage] || FALLBACK_POOL['暮年期'])
        .filter(function (e) { return eraAllowed(e, year); });
      pool = eraPool.concat(genPool);
    }
    // 3) 兜底：年代过滤后池子为空（如 1970 年代的幼儿期）→ 放宽到不限年代的通用事件
    if (!pool.length) pool = FALLBACK_POOL[s.stage] || FALLBACK_POOL['婴儿期'];
    const picked = pool[Math.floor(Math.random() * pool.length)];
    return {
      title: picked.title,
      description: picked.description,
      is_milestone: !!milestone,
      choices: picked.choices.map(c => ({
        title: c.title, detail: c.detail, effects: sanitizeEffects(c.effects), hint: c.hint
      })),
      fallback: true
    };
  }

  function fallbackOutcome(event, choice, applied) {
    const effText = Object.keys(applied).length
      ? '这一选择在你身上留下了真切的印记：' + Prompts.formatEffects(applied) + '。'
      : '日子像水一样淌过，一切尽在不言中。';
    return '你最终选择了「' + choice.title + '」。' +
      choice.detail +
      '事情有了它的结果——' + effText +
      '生活不提供撤回键，你收拾好心情，继续往前走。';
  }

  function fallbackEnding(s, deathInfo) {
    const tier = Prompts.endingTier(s);
    const keyEvents = s.history.filter(h => h.type === 'event').slice(-6).map(h => h.age + '岁「' + h.title + '」');
    const bornLine = (s.birth && s.birth.year)
      ? '生于 ' + s.birth.year + ' 年（' + s.birth.era.label + '）的' + s.family.level + '之家'
      : '生于' + s.family.level + '之家';
    return {
      ending_title: deathInfo.kind === 'natural' ? '寿终正寝' : (s.age < 50 ? '英年早逝' : '一生落幕'),
      summary:
        '你是一名' + s.gender + '性，' + bornLine + '，带着' +
        s.talents.map(t => t.name).join('、') + '的天赋来到世间。' +
        (keyEvents.length ? '此生走过的重要关口包括：' + keyEvents.join('，') + '。' : '') +
        '这一生' + tier.hint.replace(/，.*$/, '') + '。' + deathInfo.cause + '，享年 ' + s.age + ' 岁。' +
        '阖眼之际，爱过的人、走过的路、做过的选择，都成了你自己。',
      evaluation: tier.label + '。数字不足以概括一生，但认真活过的每一岁，都算数。',
      highlights: keyEvents.length ? keyEvents.slice(0, 8) : ['一生平凡，亦有微光']
    };
  }

  global.Game = {
    getState, setState,
    newLife,
    generateEvent,
    choose,
    endGame,
    stageForAge
  };
})(window);

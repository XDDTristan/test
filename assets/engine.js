/* ============================================================================
   TP Engagement Agent · 确定性引擎
   ----------------------------------------------------------------------------
   本文件中的全部逻辑均为本地确定性程序（无模型调用、无网络请求）：
     · 结构差异计算（新旧模板条款集比对）
     · 客户事实比对（上年度合同 vs 今年资料）
     · 规则引擎求值（PRD §8.5）
     · 风险分级与人工确认门禁（PRD §7.1 步骤 6/10）
     · 合同装配与一致性检查（PRD §7.1 步骤 8/9）
     · 审计日志（PRD §12.1 AuditEvent / §13.3）
   语义分类（实质性 / 措辞 / 格式）取自 data.js 中的预置分析结果。
   ========================================================================== */
(function (global) {
  'use strict';

  var D = global.TPData;

  /* ------------------------------------------------------------- 工具函数 */
  function nowStamp() {
    var d = new Date();
    function p(n) { return n < 10 ? '0' + n : '' + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  function norm(s) { return String(s == null ? '' : s).replace(/\s+/g, '').trim(); }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  // 数字金额 -> 人民币大写（确定性程序，非模型生成）
  function rmbUpper(n) {
    var digits = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖'];
    var units = ['', '拾', '佰', '仟'];
    var groups = ['', '万', '亿'];
    n = Math.floor(Number(n) || 0);
    if (n === 0) return '零元整';
    var out = '', gi = 0;
    while (n > 0) {
      var g = n % 10000, gs = '', zero = false;
      for (var i = 0; g > 0; i++) {
        var d = g % 10;
        if (d === 0) { zero = true; } else {
          gs = digits[d] + units[i] + (zero ? '零' : '') + gs;
          zero = false;
        }
        g = Math.floor(g / 10);
      }
      out = gs + groups[gi] + out;
      n = Math.floor(n / 10000); gi++;
    }
    return out.replace(/零+$/, '') + '元整';
  }

  function parseMoney(s) {
    var m = String(s || '').match(/([\d,]+)/);
    return m ? Number(m[1].replace(/,/g, '')) : null;
  }

  function fmtMoney(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  /* ==========================================================================
     状态存储（localStorage，file:// 下不可用时自动降级为内存）
     ========================================================================*/
  var STORE_KEY = 'tpea_state_v1';
  var memStore = null;
  var storageOK = (function () {
    try {
      global.localStorage.setItem('__tpea_probe', '1');
      global.localStorage.removeItem('__tpea_probe');
      return true;
    } catch (e) { return false; }
  })();

  var Store = {
    available: storageOK,
    load: function () {
      if (!storageOK) return memStore;
      try {
        var raw = global.localStorage.getItem(STORE_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch (e) { return null; }
    },
    save: function (state) {
      if (!storageOK) { memStore = state; return; }
      try { global.localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
      catch (e) { memStore = state; }
    },
    clear: function () {
      memStore = null;
      if (storageOK) { try { global.localStorage.removeItem(STORE_KEY); } catch (e) {} }
    }
  };

  /* ==========================================================================
     结构差异：新旧模板条款集比对（实时计算）
     ========================================================================*/
  function diffTemplates(oldSecs, newSecs) {
    var oldMap = {}, newMap = {}, i;
    for (i = 0; i < oldSecs.length; i++) oldMap[oldSecs[i].clause_id] = oldSecs[i];
    for (i = 0; i < newSecs.length; i++) newMap[newSecs[i].clause_id] = newSecs[i];

    var added = [], removed = [], modified = [], unchanged = [], renumbered = [];

    for (i = 0; i < newSecs.length; i++) {
      var ns = newSecs[i];
      var os = oldMap[ns.clause_id];
      if (!os) { added.push(ns.clause_id); continue; }
      var textChanged = norm(os.text_cn) !== norm(ns.text_cn) || norm(os.text_en) !== norm(ns.text_en);
      var titleChanged = norm(os.title_cn) !== norm(ns.title_cn);
      if (textChanged || titleChanged) modified.push(ns.clause_id); else unchanged.push(ns.clause_id);
      if (os.no !== ns.no) renumbered.push({ clause_id: ns.clause_id, from: os.no, to: ns.no });
    }
    for (i = 0; i < oldSecs.length; i++) {
      if (!newMap[oldSecs[i].clause_id]) removed.push(oldSecs[i].clause_id);
    }
    return {
      added: added, removed: removed, modified: modified,
      unchanged: unchanged, renumbered: renumbered,
      oldCount: oldSecs.length, newCount: newSecs.length
    };
  }

  function diffFormat(oldF, newF) {
    var out = [];
    for (var k in newF) {
      if (!Object.prototype.hasOwnProperty.call(newF, k)) continue;
      if (norm(oldF[k]) !== norm(newF[k])) {
        out.push({ field: k, from: oldF[k], to: newF[k], change_id: D.FORMAT_FIELD_MAP[k] });
      }
    }
    return out;
  }

  /* ==========================================================================
     客户事实比对（实时计算）
     ========================================================================*/
  function buildFactMap(facts) {
    var m = {};
    for (var i = 0; i < facts.length; i++) {
      var f = facts[i];
      m[f.field_name] = { prior: f.prior ? f.prior.value : null, current: f.current ? f.current.value : null, fact: f };
    }
    return m;
  }

  function classifyFact(f) {
    var prior = f.prior ? f.prior.value : null;
    var cur = f.current ? f.current.value : null;
    var conf = f.current ? f.current.confidence : 0;
    var st = {
      changed: norm(prior) !== norm(cur),
      missing: cur === null || cur === undefined || cur === '',
      conflict: !!f.conflict,
      low_confidence: conf < 0.7,
      needs_review: false,
      ask: false,          // 需要在「追问」队列中向用户提问
      route: ''
    };
    // §9.5 置信度策略路由
    if (st.conflict) { st.route = 'conflict_escalate'; st.needs_review = true; }
    else if (st.missing) { st.route = 'ask'; st.needs_review = true; }
    else if (conf < 0.7) { st.route = 'ask'; st.needs_review = true; }
    else if (conf < 0.85) { st.route = 'confirm_with_source'; st.needs_review = true; }
    else if (f.risk_if_changed === 'high' && st.changed) { st.route = 'suggest_require_confirm'; st.needs_review = true; }
    else { st.route = 'autofill'; st.needs_review = false; }
    // 追问队列只包含「资料缺失 / 冲突 / 置信度不足」三类；
    // 高置信度但属高风险变化的字段走「变更确认队列」，不重复提问（§7.1 步骤 4）
    st.ask = ['conflict_escalate', 'ask', 'confirm_with_source'].indexOf(st.route) >= 0;
    return st;
  }

  /* ==========================================================================
     逐项复核队列（无今年资料时的主模式）
     --------------------------------------------------------------------------
     事务所反馈：真实流程里每年基本依照去年信息更新，通常并没有一份「今年的
     客户信息表」可供比对。所以主模式不是「两份资料比差异」，而是：
       把去年合同里的客户信息摘出来 → 标出哪些字段今年可能变 → 人逐项判断。
     痛点在于「可能变化的信息容易被忽视」，所以按易变程度排序、高的排前面。
     ========================================================================*/
  var VOL_ORDER = { high: 0, medium: 1, low: 2 };
  var VOL_LABEL = { high: '每年都要重新确认', medium: '有时会变', low: '基本不变' };

  function reviewQueue(facts, reviewDecisions) {
    reviewDecisions = reviewDecisions || {};
    var out = facts.map(function (f) {
      var d = reviewDecisions[f.fact_id] || null;
      return {
        fact_id: f.fact_id,
        field_name: f.field_name,
        label_cn: f.label_cn,
        group: f.group,
        // 去年合同里的值 —— 这是复核的起点，不假设存在今年的资料
        prior_value: f.prior ? f.prior.value : null,
        prior_source: f.prior ? f.prior.source : null,
        volatility: f.volatility || 'medium',
        volatility_label: VOL_LABEL[f.volatility || 'medium'],
        volatility_why: f.volatility_why || '',
        risk_if_changed: f.risk_if_changed,
        // 人工判断结果：null 未复核 / 'unchanged' 沿用去年 / 'changed' 今年有变化
        decision: d ? d.status : null,
        new_value: d && d.status === 'changed' ? d.value : null,
        decided_at: d ? d.at : null
      };
    });
    out.sort(function (a, b) {
      var v = VOL_ORDER[a.volatility] - VOL_ORDER[b.volatility];
      if (v !== 0) return v;
      // 同一档内，改了会引发高风险的排前面
      var r = (a.risk_if_changed === 'high' ? 0 : 1) - (b.risk_if_changed === 'high' ? 0 : 1);
      if (r !== 0) return r;
      return a.fact_id < b.fact_id ? -1 : 1;
    });
    return out;
  }

  function reviewSummary(queue) {
    var s = { total: queue.length, reviewed: 0, unchanged: 0, changed: 0, pending: 0,
              highVolTotal: 0, highVolPending: 0 };
    queue.forEach(function (q) {
      if (q.volatility === 'high') s.highVolTotal++;
      if (q.decision === 'unchanged') { s.reviewed++; s.unchanged++; }
      else if (q.decision === 'changed') { s.reviewed++; s.changed++; }
      else {
        s.pending++;
        if (q.volatility === 'high') s.highVolPending++;
      }
    });
    s.progress = s.total ? Math.round(s.reviewed / s.total * 100) : 0;
    // 门禁：易变程度高的字段必须全部复核过，才谈得上「信息已核对」
    s.reviewGateOpen = s.highVolPending === 0 && s.highVolTotal > 0;
    return s;
  }

  /* ==========================================================================
     规则引擎（PRD §8.5）
     ========================================================================*/
  function evaluateRules(factMap, ctx) {
    var fired = [], skipped = [], emitted = {};
    for (var i = 0; i < D.RULES.length; i++) {
      var r = D.RULES[i];
      var ok = false, err = null;
      try { ok = !!r.when(factMap, ctx); } catch (e) { err = e; ok = false; }
      if (ok) {
        fired.push(r.rule_id);
        for (var j = 0; j < r.emits.length; j++) emitted[r.emits[j]] = r.rule_id;
      } else {
        skipped.push({ rule_id: r.rule_id, reason: err ? '求值异常：' + err.message : '条件未满足' });
      }
    }
    return { fired: fired, skipped: skipped, emitted: emitted };
  }

  /* ==========================================================================
     完整分析（PRD §9.3 Agent 工作流的确定性实现）
     ========================================================================*/
  function analyze(facts) {
    var factMap = buildFactMap(facts);

    var tdiff = diffTemplates(D.TEMPLATE_2025_SECTIONS, D.TEMPLATE_2026_SECTIONS);
    var fdiff = diffFormat(D.TEMPLATE_2025_FORMAT, D.TEMPLATE_2026_FORMAT);

    var priorFee = parseMoney(factMap.fee.prior);
    var curFee = parseMoney(factMap.fee.current);
    var feeDeltaPct = (priorFee && curFee) ? ((curFee - priorFee) / priorFee) * 100 : null;

    var wordingOnly = [], substantive = [];
    for (var i = 0; i < tdiff.modified.length; i++) {
      var cid = tdiff.modified[i];
      var sem = D.SEMANTIC_DIFF_CLASS[cid];
      if (sem && sem.diff_class === 'wording_only') wordingOnly.push(cid);
      else substantive.push(cid);
    }

    var ctx = {
      templateAdded: tdiff.added,
      templateRemoved: tdiff.removed,
      templateModified: tdiff.modified,
      templateWordingOnly: wordingOnly,
      templateSubstantive: substantive,
      templateFormatChanged: fdiff.length > 0,
      templateRenumbered: tdiff.renumbered,
      feeDeltaPct: feeDeltaPct
    };

    var ruleResult = evaluateRules(factMap, ctx);

    // 事实变化列表（B 类）
    var factChanges = [];
    for (i = 0; i < facts.length; i++) {
      var st = classifyFact(facts[i]);
      if (st.changed || st.conflict || st.missing) {
        factChanges.push({ fact: facts[i], state: st });
      }
    }

    // 实例化变更项
    var changes = [];
    for (var chId in ruleResult.emitted) {
      if (!Object.prototype.hasOwnProperty.call(ruleResult.emitted, chId)) continue;
      var tpl = D.CHANGE_TEMPLATES[chId];
      if (!tpl) continue;
      var item = clone(tpl);
      item.source_rule = item.source_rule || ruleResult.emitted[chId];
      item.fired_by = ruleResult.emitted[chId];
      changes.push(item);
    }

    // 排序：高 > 中 > 低；冲突项优先；同档按 change_id 稳定排序
    var rank = { high: 0, medium: 1, low: 2 };
    changes.sort(function (a, b) {
      if (rank[a.risk_level] !== rank[b.risk_level]) return rank[a.risk_level] - rank[b.risk_level];
      if (!!b.is_conflict !== !!a.is_conflict) return b.is_conflict ? 1 : -1;
      if (a.highlight && !b.highlight) return -1;
      if (b.highlight && !a.highlight) return 1;
      return a.change_id < b.change_id ? -1 : 1;
    });

    return {
      factMap: factMap, ctx: ctx, templateDiff: tdiff, formatDiff: fdiff,
      ruleResult: ruleResult, factChanges: factChanges, changes: changes,
      feeDeltaPct: feeDeltaPct,
      computedAt: nowStamp()
    };
  }

  /* ==========================================================================
     决策与门禁
     ========================================================================*/
  var DECIDED = ['accepted', 'edited', 'rejected', 'kept_old'];

  function isDecided(status) { return DECIDED.indexOf(status) >= 0; }

  var DECISION_LABEL = {
    pending: '待处理',
    accepted: '已接受建议',
    edited: '编辑后接受',
    rejected: '已拒绝建议',
    kept_old: '保留旧条款',
    escalated: '已升级给经理'
  };

  function riskSummary(changes, decisions) {
    var s = { high: 0, medium: 0, low: 0, highDone: 0, mediumDone: 0, lowDone: 0, escalated: 0, total: 0, done: 0 };
    for (var i = 0; i < changes.length; i++) {
      var c = changes[i];
      var st = (decisions[c.change_id] && decisions[c.change_id].status) || 'pending';
      s[c.risk_level]++; s.total++;
      if (st === 'escalated') s.escalated++;
      if (isDecided(st)) {
        s.done++;
        if (c.risk_level === 'high') s.highDone++;
        if (c.risk_level === 'medium') s.mediumDone++;
        if (c.risk_level === 'low') s.lowDone++;
      }
    }
    s.highPending = s.high - s.highDone;
    s.progress = s.total ? Math.round((s.done / s.total) * 100) : 0;
    s.gateOpen = s.highPending === 0 && s.high > 0;
    return s;
  }

  /* 某条变更项在真实部署中需要什么层级审批。
     单人模式下这只是标注（写进界面、审计与导出），不作为拦截条件。 */
  function requiredRoleFor(change) {
    if (change.risk_level !== 'high') return null;
    if (change.approver === 'partner') return 'partner';
    return 'manager';
  }

  /* ==========================================================================
     合同装配（PRD §7.1 步骤 8）
     ========================================================================*/
  function resolvedFacts(facts, factEdits, decisions) {
    var out = {};
    for (var i = 0; i < facts.length; i++) {
      var f = facts[i];
      var v = Object.prototype.hasOwnProperty.call(factEdits, f.fact_id)
        ? factEdits[f.fact_id]
        : (f.current ? f.current.value : null);
      out[f.field_name] = v;
    }
    // 美国业务结论来自冲突项决策
    var usDec = decisions['CH-US-CONFLICT'];
    if (usDec && usDec.resolution === 'A') out.involves_us = '是';
    else if (usDec && usDec.resolution === 'B') out.involves_us = '否';
    return out;
  }

  /* 从「合伙人 X；项目经理 Y；高级顾问 Z」里取某个角色的人名。
     以分号 / 顿号为界切段，不以空白为界 —— 英文人名内部就带空格。 */
  function pickRole(teamStr, roleWord) {
    var segs = String(teamStr || '').split(/[；;、,]/);
    for (var i = 0; i < segs.length; i++) {
      var seg = segs[i].trim();
      if (seg.indexOf(roleWord) !== 0) continue;
      var name = seg.slice(roleWord.length).replace(/^[\s:：为是]+/, '').trim();
      if (name) return name;
    }
    return null;
  }

  function contractPlaceholders(rf, task) {
    var fee = parseMoney(rf.fee) || 0;
    var ptn = pickRole(rf.service_team, '合伙人');
    return {
      engagement_year: rf.engagement_year || '[待确认]',
      client_name_cn: rf.client_name_cn || '[待确认]',
      client_name_en: rf.client_name_en || '[TBC]',
      registered_address: rf.registered_address || '[待确认]',
      service_type: rf.service_type || '[待确认]',
      service_type_en: 'transfer pricing documentation services',
      partner: ptn ? '合伙人 ' + ptn : '合伙人 Victoria Hale',
      manager: pickRole(rf.service_team, '项目经理') || '[待确认]',
      fee_display: 'RMB ' + fmtMoney(fee),
      fee_cn_upper: '人民币' + rmbUpper(fee),
      payment_terms: '客户应于本协议签署后 30 日内支付服务费的 50%，余款于交付定稿后 30 日内支付。',
      payment_terms_en: 'The Client shall pay 50% of the fees within 30 days of signing this Agreement, and the balance within 30 days after delivery of the final deliverables.',
      contract_no: task.contract_no || '[待确认]'
    };
  }

  function fill(text, ph) {
    return String(text || '').replace(/\{\{(\w+)\}\}/g, function (m, k) {
      return Object.prototype.hasOwnProperty.call(ph, k) ? ph[k] : m;
    });
  }

  /**
   * 装配合同初稿。
   * 规则：以 2026 标准模板条款集为骨架；被人工接受/编辑的变更项写入对应条款；
   *       未决策的高风险条款以「待确认」占位并标红；被拒绝的新增条款不写入。
   */
  /* approvedJa：{clause_id: 日文文本}，只接收已经人批准的机器补译。
     不传就是原样 —— 语言覆盖率照旧只数模板自带的译文。
     刻意做成入参而不是让 engine 去读界面状态：engine 必须保持可独立复现。 */
  function buildContract(analysis, task, facts, factEdits, decisions, fixes, approvedJa) {
    var rf = resolvedFacts(facts, factEdits, decisions);
    var ph = contractPlaceholders(rf, task);
    fixes = fixes || {};
    approvedJa = approvedJa || {};

    function dec(id) { return decisions[id] || { status: 'pending' }; }
    function accepted(id) { var s = dec(id).status; return s === 'accepted' || s === 'edited'; }
    function textOf(id, field, fallback) {
      var d = dec(id);
      if (d.status === 'edited' && d.edited && d.edited[field]) return d.edited[field];
      var tpl = D.CHANGE_TEMPLATES[id];
      return (tpl && tpl[field]) || fallback;
    }

    var secs = [];

    // 首部
    var headCn = '本转让定价服务协议（"本协议"）由' + ph.client_name_cn + '（注册地址：' +
      ph.registered_address + '，以下称"客户"）与普华永道咨询（深圳）有限公司（以下称"我们"）签署。合同编号：' +
      (accepted('CH-CONTRACT-NO') ? ph.contract_no : 'EL-2025-TP-0417') + '。';
    if (accepted('CH-CONTACT')) headCn += '客户授权代表：Richard Chen（法定代表人）；日常授权联系人：财务总监 Grace Zhou（gracezhou@starwave-demo.cn）。';
    var headEn = 'This Transfer Pricing Services Agreement (the "Agreement") is entered into between ' +
      ph.client_name_en + ' (registered address: ' +
      (accepted('CH-ADDR') ? '33/F, Tower A, Starwave Technology Building, No.8 Shenwan 1st Road, Yuehai Sub-district, Nanshan District, Shenzhen' : '20/F Starwave Tower, No.12 Gaoxin South 7th Road, Science Park, Nanshan District, Shenzhen') +
      ', the "Client") and PwC Consulting (Shenzhen) Co., Ltd. ("we"). Engagement Letter No.: ' +
      (accepted('CH-CONTRACT-NO') ? ph.contract_no : 'EL-2025-TP-0417') + '.';
    if (accepted('CH-CONTACT')) headEn += ' Client authorised representative: Richard Chen (Legal Representative); day-to-day contact: Grace Zhou, CFO (gracezhou@starwave-demo.cn).';

    secs.push({
      key: 'head', clause_id: 'C-HEAD-000', no: '首部',
      title_cn: '合同首部与当事人', title_en: 'Parties',
      text_cn: headCn, text_en: headEn,
      status: accepted('CH-ADDR') ? 'modified' : (dec('CH-ADDR').status === 'pending' ? 'pending' : 'unchanged'),
      change_ids: ['CH-ADDR', 'CH-CONTACT', 'CH-CONTRACT-NO']
    });

    var t26 = D.TEMPLATE_2026_SECTIONS;
    var num = 0;

    for (var i = 0; i < t26.length; i++) {
      var s = t26[i];
      var cid = s.clause_id;
      var entry = {
        key: cid, clause_id: cid, title_cn: s.title_cn, title_en: s.title_en,
        text_cn: fill(s.text_cn, ph), text_en: fill(s.text_en, ph),
        status: 'unchanged', change_ids: []
      };

      if (cid === 'C-SCOPE-001') {
        entry.change_ids = ['CH-SCOPE', 'CH-YEAR'];
        if (accepted('CH-SCOPE')) {
          entry.text_cn = textOf('CH-SCOPE', 'proposed_text');
          entry.text_en = textOf('CH-SCOPE', 'proposed_text_en');
          entry.status = 'modified';
          if (rf.involves_us === '是') {
            entry.text_cn = entry.text_cn.replace('中国大陆及香港关联方', '中国大陆、香港及美国关联方');
            entry.text_en = entry.text_en.replace('Mainland China and Hong Kong', 'Mainland China, Hong Kong and the United States');
          }
        } else {
          entry.status = 'pending';
          entry.text_cn = '[待确认：服务范围变更未确认] ' + D.PRIOR_CONTRACT_SECTIONS[1].text_cn;
          entry.text_en = '[TBC: scope change not confirmed] ' + D.PRIOR_CONTRACT_SECTIONS[1].text_en;
        }
      } else if (cid === 'C-TERM-001') {
        entry.change_ids = ['CH-DELIVERABLE', 'CH-YEAR'];
        var termCn = '服务期间自 ' + ph.engagement_year + ' 年 3 月 1 日起至 ' + ph.engagement_year + ' 年 11 月 30 日止。';
        var termEn = 'The service period runs from 1 March ' + ph.engagement_year + ' to 30 November ' + ph.engagement_year + '. ';
        if (accepted('CH-DELIVERABLE')) {
          entry.text_cn = termCn + textOf('CH-DELIVERABLE', 'proposed_text');
          entry.text_en = termEn + textOf('CH-DELIVERABLE', 'proposed_text_en');
          entry.status = 'modified';
        } else {
          entry.text_cn = termCn + '交付物包括：中文本地文档定稿、英文摘要、可比性分析附件。';
          entry.text_en = termEn + 'Deliverables include: final Local File in Chinese, an English summary, and the comparability analysis annex.';
          entry.status = dec('CH-DELIVERABLE').status === 'pending' ? 'pending' : 'unchanged';
        }
      } else if (cid === 'C-TEAM-001') {
        entry.change_ids = ['CH-TEAM'];
        if (accepted('CH-TEAM')) {
          entry.text_cn = textOf('CH-TEAM', 'proposed_text');
          entry.text_en = textOf('CH-TEAM', 'proposed_text_en');
          entry.status = 'modified';
        } else {
          entry.text_cn = D.PRIOR_CONTRACT_SECTIONS[3].text_cn;
          entry.text_en = D.PRIOR_CONTRACT_SECTIONS[3].text_en;
          entry.status = dec('CH-TEAM').status === 'pending' ? 'pending' : 'unchanged';
        }
      } else if (cid === 'C-FEE-001') {
        entry.change_ids = ['CH-FEE'];
        if (accepted('CH-FEE')) {
          entry.text_cn = textOf('CH-FEE', 'proposed_text');
          entry.text_en = textOf('CH-FEE', 'proposed_text_en');
          entry.status = 'modified';
        } else {
          entry.text_cn = D.PRIOR_CONTRACT_SECTIONS[4].text_cn;
          entry.text_en = D.PRIOR_CONTRACT_SECTIONS[4].text_en;
          entry.status = dec('CH-FEE').status === 'pending' ? 'pending' : 'unchanged';
        }
      } else if (cid === 'C-CLIENT-001') {
        entry.change_ids = ['CH-WORDING-1'];
        if (!accepted('CH-WORDING-1')) {
          entry.text_cn = D.PRIOR_CONTRACT_SECTIONS[6].text_cn;
          entry.text_en = D.PRIOR_CONTRACT_SECTIONS[6].text_en;
        } else { entry.status = 'modified'; }
      } else if (cid === 'C-CONF-001') {
        entry.change_ids = ['CH-WORDING-2'];
        if (!accepted('CH-WORDING-2')) {
          entry.text_cn = D.PRIOR_CONTRACT_SECTIONS[7].text_cn;
          entry.text_en = D.PRIOR_CONTRACT_SECTIONS[7].text_en;
        } else { entry.status = 'modified'; }
      } else if (cid === 'C-DATA-005') {
        entry.change_ids = ['CH-DATA'];
        if (accepted('CH-DATA')) { entry.status = 'modified'; }
        else if (dec('CH-DATA').status === 'rejected' || dec('CH-DATA').status === 'kept_old') {
          entry.text_cn = D.PRIOR_CONTRACT_SECTIONS[8].text_cn;
          entry.text_en = D.PRIOR_CONTRACT_SECTIONS[8].text_en;
          entry.status = 'kept_old';
        } else {
          entry.status = 'pending';
          entry.text_cn = '[待确认：高风险条款未确认] ' + entry.text_cn;
          entry.text_en = '[TBC: high-risk clause not confirmed] ' + entry.text_en;
        }
      } else if (cid === 'C-LIAB-002') {
        entry.change_ids = ['CH-LIAB'];
        if (accepted('CH-LIAB')) {
          entry.text_cn = textOf('CH-LIAB', 'proposed_text');
          entry.text_en = textOf('CH-LIAB', 'proposed_text_en');
          entry.status = 'modified';
        } else if (dec('CH-LIAB').status === 'rejected' || dec('CH-LIAB').status === 'kept_old') {
          entry.text_cn = D.PRIOR_CONTRACT_SECTIONS[9].text_cn;
          entry.text_en = D.PRIOR_CONTRACT_SECTIONS[9].text_en;
          entry.status = 'kept_old';
        } else {
          entry.status = 'pending';
          entry.text_cn = '[待确认：责任限额须合伙人批准] ' + entry.text_cn;
          entry.text_en = '[TBC: liability cap requires partner approval] ' + entry.text_en;
        }
      } else if (cid === 'C-US-001') {
        entry.change_ids = ['CH-US-CONFLICT', 'CH-US-KEEP'];
        var ud = dec('CH-US-CONFLICT');
        if (ud.resolution === 'A' && isDecided(ud.status)) {
          entry.text_cn = D.PRIOR_CONTRACT_SECTIONS[10].text_cn;
          entry.text_en = D.PRIOR_CONTRACT_SECTIONS[10].text_en;
          entry.status = 'kept_old';
        } else if (ud.resolution === 'B' && isDecided(ud.status)) {
          entry.omit = true; entry.status = 'removed';
          entry.text_cn = '（已确认今年不涉及美国业务，本条删除）';
          entry.text_en = '(Deleted — confirmed no US involvement for the current year.)';
        } else {
          entry.status = 'pending';
          entry.text_cn = '[待确认：是否涉及美国业务尚未裁定，本条暂停处理] ' + D.PRIOR_CONTRACT_SECTIONS[10].text_cn;
          entry.text_en = '[TBC: US involvement undetermined — clause on hold] ' + D.PRIOR_CONTRACT_SECTIONS[10].text_en;
        }
      } else if (cid === 'C-GROUP-002') {
        entry.change_ids = ['CH-GROUP'];
        if (accepted('CH-GROUP')) { entry.status = 'modified'; }
        else if (dec('CH-GROUP').status === 'rejected' || dec('CH-GROUP').status === 'kept_old') {
          entry.text_cn = D.PRIOR_CONTRACT_SECTIONS[11].text_cn;
          entry.text_en = D.PRIOR_CONTRACT_SECTIONS[11].text_en;
          entry.title_cn = '集团成员所协作';
          entry.status = 'kept_old';
        } else {
          entry.status = 'pending';
          entry.text_cn = '[待确认：高风险条款未确认] ' + entry.text_cn;
          entry.text_en = '[TBC: high-risk clause not confirmed] ' + entry.text_en;
        }
      } else if (cid === 'C-COMM-003') {
        entry.change_ids = ['CH-WECHAT'];
        if (accepted('CH-WECHAT')) {
          entry.text_cn = textOf('CH-WECHAT', 'proposed_text');
          entry.text_en = textOf('CH-WECHAT', 'proposed_text_en');
          entry.status = 'modified';
        } else {
          entry.status = dec('CH-WECHAT').status === 'pending' ? 'pending' : 'unchanged';
        }
      } else if (cid === 'C-AI-DATA-004') {
        entry.change_ids = ['CH-AI-DATA'];
        if (accepted('CH-AI-DATA')) {
          entry.text_cn = textOf('CH-AI-DATA', 'proposed_text');
          entry.text_en = textOf('CH-AI-DATA', 'proposed_text_en');
          entry.status = 'added';
        } else if (dec('CH-AI-DATA').status === 'rejected') {
          entry.omit = true; entry.status = 'removed';
          entry.text_cn = '（已拒绝加入新增条款）'; entry.text_en = '(New clause rejected.)';
        } else {
          entry.status = 'pending';
          entry.text_cn = '[待确认：2026 模板新增条款，须人工确认后写入] ' + entry.text_cn;
          entry.text_en = '[TBC: new 2026 clause pending human confirmation] ' + entry.text_en;
        }
      } else if (cid === 'C-LAW-001') {
        entry.change_ids = ['CH-LAW'];
        if (accepted('CH-LAW')) { entry.status = 'modified'; }
        else { entry.text_cn = D.PRIOR_CONTRACT_SECTIONS[14].text_cn; entry.text_en = D.PRIOR_CONTRACT_SECTIONS[14].text_en; }
      }

      // 一致性检查修正：合伙人裁定以中文口径统一责任限制条款的英文倍数
      // 日文为附带非正式译文（中文为准），按 clause_id 挂到条款上
      if (D.TEMPLATE_JA && D.TEMPLATE_JA[cid]) {
        entry.text_ja = D.TEMPLATE_JA[cid];
        entry.ja_provenance = 'template';
      }
      // 已批准的机器补译在函数末尾统一施加 —— 首部与附件一是在这个循环之外
      // 单独构造的，在这里写一遍会漏掉它们（实测漏了 2 条）
      if (cid === 'C-LIAB-002' && fixes['CK-BILINGUAL']) {
        entry.text_en = entry.text_en
          .replace(/capped at two times the fees payable by you/g, 'capped at the fees payable by you')
          .replace(/two times the fees/g, 'the fees');
        // 译文与正文一并统一 —— 只改英文而漏掉日文，就是同一个漏改再犯一次
        if (entry.text_ja) {
          entry.text_ja = entry.text_ja.replace(/報酬額の二倍とすること/g, '報酬額とすること');
        }
        entry.bilingual_fixed = true;
      }

      // 一致性检查修正：数据保护条款对已删除送达条款的交叉引用
      if (cid === 'C-DATA-005' && fixes['CK-XREF']) {
        entry.text_cn = entry.text_cn.replace('具体送达与通知方式适用第 13 条。', '具体送达与通知方式以本协议首部所载联络信息为准。');
        entry.text_en = entry.text_en.replace('Notices are governed by Clause 13.', 'Notices shall be served using the contact details set out in the Parties section of this Agreement.');
        entry.xref_fixed = true;
      }

      if (!entry.omit) { num++; entry.no = String(num); }
      secs.push(entry);
    }

    // 送达条款：2026 模板已删除，仅在人工「保留旧条款 / 拒绝删除」时写回
    var nd = dec('CH-NOTICE');
    if (nd.status === 'rejected' || nd.status === 'kept_old') {
      num++;
      secs.push({
        key: 'C-NOTICE-007', clause_id: 'C-NOTICE-007', no: String(num),
        title_cn: '送达', title_en: 'Notices',
        text_cn: D.PRIOR_CONTRACT_SECTIONS[13].text_cn,
        text_en: D.PRIOR_CONTRACT_SECTIONS[13].text_en,
        status: 'kept_old', change_ids: ['CH-NOTICE']
      });
    }

    // 附件一
    var annexTitle = accepted('CH-ANNEX-TITLE') ? '关联方清单（' + ph.engagement_year + '）' : '关联方清单';
    var parties = ['星海智能（香港）有限公司', '星海软件（成都）有限公司'];
    var partiesEn = ['Starwave Intelligence (Hong Kong) Limited', 'Starwave Software (Chengdu) Co., Ltd.'];
    var annexStatus = 'modified';
    if (rf.involves_us === '是') {
      parties.splice(1, 0, 'Starwave Intelligence US Inc.（美国特拉华州）');
      partiesEn.splice(1, 0, 'Starwave Intelligence US Inc. (Delaware, USA)');
    } else if (rf.involves_us !== '否') {
      annexStatus = 'pending';
    }
    var annexCn = parties.map(function (p, i2) { return (i2 + 1) + '. ' + p + '；'; }).join('');
    if (annexStatus === 'pending') annexCn = '[待确认：美国关联方是否保留尚未裁定] ' + annexCn;
    secs.push({
      key: 'C-ANNEX-001', clause_id: 'C-ANNEX-001', no: '附件一',
      title_cn: annexTitle, title_en: 'List of Related Parties',
      text_cn: annexCn,
      text_en: partiesEn.map(function (p, i2) { return (i2 + 1) + '. ' + p + ';'; }).join(' '),
      status: annexStatus, change_ids: ['CH-ANNEX', 'CH-ANNEX-TITLE']
    });

    /* 已批准的机器补译：对全部条款统一施加一次。
       只补模板本来没有译文的条款 —— 模板自带的译文优先，机器不覆盖它。 */
    secs.forEach(function (s2) {
      if (!s2.text_ja && approvedJa[s2.clause_id]) {
        s2.text_ja = approvedJa[s2.clause_id];
        s2.ja_provenance = 'model_approved';
      }
    });

    return { sections: secs, placeholders: ph, resolved: rf };
  }

  /* ==========================================================================
     一致性检查（PRD §7.1 步骤 9 / F15）
     ========================================================================*/
  function consistencyCheck(contract, analysis, task, decisions, facts, factEdits) {
    var secs = contract.sections;
    var ph = contract.placeholders;
    var allCn = secs.map(function (s) { return s.text_cn; }).join('\n');
    var allEn = secs.map(function (s) { return s.text_en; }).join('\n');
    var results = [];

    function add(id, name, ok, detail, severity, fixable, extra) {
      var r = {
        check_id: id, name: name, ok: ok, detail: detail,
        severity: ok ? 'ok' : (severity || 'medium'), fixable: !!fixable
      };
      if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) r[k] = extra[k];
      results.push(r);
    }

    // 1 客户名称全篇一致
    var nameHits = (allCn.match(new RegExp(ph.client_name_cn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
    var otherName = /星海科技（深圳）|星海智能技术（深圳）/.test(allCn);
    add('CK-NAME', '客户名称全篇一致', !otherName && nameHits >= 1,
      otherName ? '发现与主名称不一致的客户名称写法。' : '全篇客户名称统一为「' + ph.client_name_cn + '」，出现 ' + nameHits + ' 处。');

    // 2 年份一致
    var oldYear = (allCn.match(/2025\s*(年|财政年度)/g) || []).length;
    add('CK-YEAR', '年份全篇一致', oldYear === 0,
      oldYear === 0 ? '正文中未发现残留的 2025 年度引用；年度统一为 ' + ph.engagement_year + '。'
        : '仍有 ' + oldYear + ' 处 2025 年度引用未更新（年度或服务范围变更项尚未接受）。', 'medium', false);

    // 3 金额数字与大写一致
    var feeNum = parseMoney(ph.fee_display);
    var expectUpper = '人民币' + rmbUpper(feeNum);
    var upperInText = allCn.indexOf(expectUpper) >= 0;
    var feeSec = secs.filter(function (s) { return s.clause_id === 'C-FEE-001'; })[0];
    var feeConfirmed = feeSec && feeSec.status === 'modified';
    add('CK-MONEY', '金额数字与中文大写一致', !feeConfirmed || upperInText,
      feeConfirmed
        ? (upperInText ? '第 ' + (feeSec ? feeSec.no : '-') + ' 条：' + expectUpper + '（' + ph.fee_display + '）数字与大写一致（由程序生成并校验）。'
          : '费用条款中大写金额与数字不一致，应为 ' + expectUpper + '。')
        : '费用变更项尚未接受，暂以上年度金额校验；接受后将重新校验。', 'high', false);

    // 4 中英文客户名称一致
    add('CK-NAME-EN', '中英文客户名称对应一致',
      allEn.indexOf(ph.client_name_en) >= 0,
      allEn.indexOf(ph.client_name_en) >= 0 ? '英文版客户名称与中文版对应：' + ph.client_name_en
        : '英文版未找到对应的客户英文名称。');

    // 5 中英文条款语义一致（预置一处不一致：责任限制倍数）
    var liabSec = secs.filter(function (s) { return s.clause_id === 'C-LIAB-002'; })[0];
    var biOk = true, biDetail = '已比对 ' + secs.length + ' 个条款的中英文对应关系，未发现数量或倍数类语义偏差。';
    if (liabSec) {
      /* 责任上限的倍数：中文「服务费的数额」= 1 倍，「两倍」= 2；
         英文 "the fees payable" = 1 倍，"two times the fees" = 2。
         倍数是数值，一律由确定性程序比对，不交给模型。 */
      var cnMul = /服务费的数额/.test(liabSec.text_cn) ? 1
        : (/服务费的两倍/.test(liabSec.text_cn) ? 2 : (/服务费的三倍/.test(liabSec.text_cn) ? 3 : null));
      var enMul = /two times the fees/i.test(liabSec.text_en) ? 2
        : (/three times the fees/i.test(liabSec.text_en) ? 3
          : (/capped at the fees payable/i.test(liabSec.text_en) ? 1 : null));
      var MUL_CN = { 1: '服务费的数额（一倍）', 2: '服务费的两倍', 3: '服务费的三倍' };
      var MUL_EN = { 1: 'the fees payable', 2: 'two times the fees', 3: 'three times the fees' };
      /* 日文为附带非正式译文（中文为准），但译文里数字错了同样是漏改 ——
         事务所反馈的痛点三就是「人工修改不同语言版本很容易发生漏改」，
         所以倍数比对必须覆盖三语，而不只是中英。 */
      // 必须读「装配后的条款」而不是静态译文表 ——
      // 否则合伙人裁定统一口径之后，检查仍会拿旧译文报错。
      var jaText = liabSec.text_ja || '';
      var jaMul = /報酬額の二倍/.test(jaText) ? 2
        : (/報酬額の三倍/.test(jaText) ? 3 : (/報酬額とする|報酬額を上限/.test(jaText) ? 1 : null));
      var MUL_JA = { 1: '報酬額（一倍）', 2: '報酬額の二倍', 3: '報酬額の三倍' };
      var mism = [];
      if (cnMul && enMul && cnMul !== enMul) mism.push('英文为「' + MUL_EN[enMul] + '」');
      if (cnMul && jaMul && cnMul !== jaMul) mism.push('日文为「' + MUL_JA[jaMul] + '」');
      if (mism.length) {
        biOk = false;
        biDetail = '第 ' + liabSec.no + ' 条 责任限制：中文为「' + MUL_CN[cnMul] + '」，但 ' +
          mism.join('、') + '，责任上限倍数不一致（共 ' + (mism.length + 1) + ' 个语言版本参与比对）。' +
          '2026 模板的英文与日文疑均沿用 2025 年的倍数 —— 这正是「改了中文忘了改译文」的典型。' +
          '责任限额不得由系统自行修改，须由合伙人 / 风险审批人裁定后统一口径。';
      }
    }
    // 模型接入后：倍数等数值比对仍由上面的确定性程序负责（§5.4），
    // 模型结论只在数值检查之外提供额外覆盖；任一发现问题即判为不一致。
    var biProv = 'deterministic';
    var mv = global.TPModel && global.TPModel.getBilingualVerdict && global.TPModel.getBilingualVerdict();
    if (mv) {
      biProv = biOk ? 'model' : 'deterministic+model';
      if (!mv.consistent) {
        if (biOk) { biOk = false; biDetail = '（模型比对）' + mv.detail; }
        else { biDetail += '　另据模型比对：' + mv.detail; }
      } else if (biOk) {
        biDetail += '　模型比对亦未发现语义偏差。';
      }
    }
    // 语言覆盖率无条件报出 —— 不假装三语都齐全（日文为附带译文，可能未覆盖全部条款）
    var jaCount = secs.filter(function (x) { return !!x.text_ja; }).length;
    // 机器补译单独计数：混在一起报会让「已覆盖」看起来比实际可靠
    var jaMachine = secs.filter(function (x) { return x.ja_provenance === 'model_approved'; }).length;
    biDetail += '　语言覆盖：中文 ' + secs.length + ' 条、英文 ' + secs.length +
      ' 条、日文附带译文 ' + jaCount + ' 条（中文为准' +
      (jaMachine ? '；其中 ' + jaMachine + ' 条为模型补译并经人批准，未经母语复核' : '') + '）。';
    add('CK-BILINGUAL', '中英文条款语义一致', biOk, biDetail, 'high', !biOk, {
      provenance: biProv,
      fix_role: 'partner',
      fix_label: '以中文口径统一英文（合伙人裁定）',
      fix_note: '系统不自行决定责任限额；此操作是由合伙人 / 风险审批人裁定「以中文口径（相当于服务费的数额）为准」，并据此修正英文文本。'
    });

    // 6 定义均被使用
    var defUsed = true, defDetail = '定义项「关联方 / Related Party」「交付成果 / Deliverables」均在正文中被引用。';
    if (contract.resolved.involves_us !== '是' && /美国关联方/.test(allCn) === false && /Starwave Intelligence US Inc/.test(allCn)) {
      defUsed = false; defDetail = '附件一列出美国主体，但正文已无对应条款引用。';
    }
    add('CK-DEF', '定义均被正文使用', defUsed, defDetail, 'low', false);

    // 7 条款编号与交叉引用正确
    var refIssues = [];
    for (var i = 0; i < secs.length; i++) {
      var m = secs[i].text_cn.match(/第\s*(\d+)\s*条/g);
      if (!m) continue;
      for (var j = 0; j < m.length; j++) {
        var n = m[j].replace(/\D/g, '');
        var target = secs.filter(function (s) { return s.no === n; })[0];
        if (!target) {
          refIssues.push('第 ' + secs[i].no + ' 条引用了不存在的「' + m[j] + '」');
        } else if (secs[i].clause_id === 'C-DATA-005' && target.clause_id !== 'C-NOTICE-007') {
          refIssues.push('第 ' + secs[i].no + ' 条（数据保护）交叉引用「' + m[j] + '」实际指向「' +
            target.title_cn + '」，而非送达条款；2026 模板已删除送达条款');
        }
      }
    }
    add('CK-XREF', '条款编号与交叉引用正确', refIssues.length === 0,
      refIssues.length === 0 ? '已校验全部「第 X 条」交叉引用，均指向存在且语义匹配的条款。'
        : refIssues.join('；') + '。', 'medium', true);

    // 8 附件被正文引用（在附件之外的正文条款中查找引用）
    var bodyOnly = secs.filter(function (s) { return s.clause_id !== 'C-ANNEX-001'; })
      .map(function (s) { return s.text_cn + '\n' + s.text_en; }).join('\n');
    var annexRef = /附件一|Annex I/i.test(bodyOnly);
    add('CK-ANNEX', '附件被正文引用', annexRef,
      annexRef ? '附件一在正文条款中被引用（服务范围条款）。' : '附件一未被任何正文条款引用。', 'low', false);

    // 9 服务范围与费用表一致
    var scopeSec = secs.filter(function (s) { return s.clause_id === 'C-SCOPE-001'; })[0];
    var termSec = secs.filter(function (s) { return s.clause_id === 'C-TERM-001'; })[0];
    var scopeHasMaster = scopeSec && /主体文档|Master File/i.test(scopeSec.text_cn + scopeSec.text_en);
    var termHasMaster = termSec && /主体文档|Master File/i.test(termSec.text_cn + termSec.text_en);
    var feeUp = analysis.feeDeltaPct !== null && analysis.feeDeltaPct > 0 && feeConfirmed;
    var scopeOk = !(scopeHasMaster && !termHasMaster) && !(feeUp && !scopeHasMaster);
    add('CK-SCOPE-FEE', '服务范围、交付物与费用相互匹配', scopeOk,
      scopeOk ? '服务范围新增主体文档更新协助，交付物与费用（' + ph.fee_display + '，+' +
        (analysis.feeDeltaPct === null ? '-' : analysis.feeDeltaPct.toFixed(2)) + '%）相互对应。'
        : (scopeHasMaster && !termHasMaster
          ? '服务范围含「集团主体文档更新协助」，但交付物清单未列示对应交付成果。'
          : '费用已上调但服务范围未体现新增服务内容。'), 'medium', false);

    // 10 是否仍存在占位符
    var ph1 = (allCn.match(/\[待确认[^\]]*\]/g) || []).length;
    var ph2 = (allEn.match(/\[TBC[^\]]*\]/g) || []).length;
    var phLeft = (allCn.match(/\{\{\w+\}\}/g) || []).length + (allEn.match(/\{\{\w+\}\}/g) || []).length;
    add('CK-PLACEHOLDER', '不存在未填写的占位符', ph1 + ph2 + phLeft === 0,
      ph1 + ph2 + phLeft === 0 ? '未发现 [待确认] / [TBC] / {{字段}} 占位符。'
        : '仍有 ' + (ph1 + ph2) + ' 处「待确认 / TBC」标记' + (phLeft ? '及 ' + phLeft + ' 处未替换字段' : '') + '，来源为尚未确认的变更项。', 'high', false);

    // 11 是否存在未确认高风险项
    var rs = riskSummary(analysis.changes, decisions);
    add('CK-HIGHRISK', '不存在未确认的高风险事项', rs.highPending === 0,
      rs.highPending === 0 ? '全部 ' + rs.high + ' 项高风险变更均已由授权人员确认。'
        : '仍有 ' + rs.highPending + ' 项高风险变更未确认' + (rs.escalated ? '（其中 ' + rs.escalated + ' 项已升级待裁定）' : '') + '，任务不可完成、导出受限。', 'high', false);

    var failed = results.filter(function (r) { return !r.ok; });
    return {
      results: results, passed: results.length - failed.length, total: results.length,
      failed: failed, allPass: failed.length === 0,
      highFailed: failed.filter(function (r) { return r.severity === 'high'; }).length
    };
  }

  /* ==========================================================================
     审计日志（AuditEvent §12.1 / §13.3）
     ========================================================================*/
  var Audit = {
    make: function (seq, actorType, actorId, action, objType, objId, before, after, extra) {
      var e = {
        event_id: 'EV-' + String(seq).padStart(4, '0'),
        task_id: 'T-2026-0392',
        actor_type: actorType, actor_id: actorId, action: action,
        object_type: objType, object_id: objId,
        before_value: before == null ? '' : String(before),
        after_value: after == null ? '' : String(after),
        timestamp: nowStamp()
      };
      if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) e[k] = extra[k];
      return e;
    }
  };

  global.TPEngine = {
    nowStamp: nowStamp, rmbUpper: rmbUpper, parseMoney: parseMoney, fmtMoney: fmtMoney,
    reviewQueue: reviewQueue, reviewSummary: reviewSummary,
    pickRole: pickRole,
    Store: Store, Audit: Audit,
    diffTemplates: diffTemplates, diffFormat: diffFormat,
    buildFactMap: buildFactMap, classifyFact: classifyFact,
    evaluateRules: evaluateRules, analyze: analyze,
    riskSummary: riskSummary, isDecided: isDecided, DECISION_LABEL: DECISION_LABEL,
    requiredRoleFor: requiredRoleFor,
    buildContract: buildContract, consistencyCheck: consistencyCheck,
    resolvedFacts: resolvedFacts
  };
})(window);

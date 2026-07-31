/* ============================================================================
   TP Engagement Agent · 界面与交互
   PRD §6 信息架构 / §7 核心流程 / §11 界面设计要求
   ========================================================================== */
(function (global) {
  'use strict';

  var D = global.TPData, E = global.TPEngine, X = global.TPExport;
  var $ = function (id) { return document.getElementById(id); };

  /* ======================================================== 状态 */
  var S = {
    role: 'consultant',
    view: 'home',
    taskId: null,
    created: false,
    docsLoaded: false,
    analyzed: false,
    analyzing: false,
    pipeStage: -1,
    decisions: {},
    factEdits: {},
    factConfirms: {},
    reviewDecisions: {},   // 逐项复核：fact_id -> {status:'unchanged'|'changed', value, at}
    realAnalysis: null,    // 真实文件模式的分析结果（不进持久化：含全文，体积大）
    realAnswers: {},       // 模板条件性条款的人工回答：GQ-n -> 'applicable'|'not_applicable'
    ruleProposals: [],     // 模型从模板指引提炼的规则提议（默认 draft，需人批准）
    clauseDrafts: [],      // 模型起草的条款（默认 draft，需人批准）
    jaDrafts: [],          // 模型补译的日文（默认 draft，未批准不计入覆盖率）
    realDecisions: {},     // 真实模式下每条差异的决定：key -> 'accept_new'|'keep_old'
    fixes: {},
    audit: [],
    seq: 0,
    changeFilter: 'all',
    openChange: null,
    editing: null,
    previewLang: 'both',
    qAnswers: {},
    qGenerated: false,
    extraDocs: [],
    exports: [],
    modelCfg: null,        // 已保存的模型配置（不含 API Key）
    modelResult: null      // 最近一次 enhance 的结果
  };

  // API Key 仅驻留内存，绝不写入 localStorage、绝不进入导出物
  var MODEL_KEY = '';

  var analysis = null;

  function persist() {
    E.Store.save({
      role: S.role, taskId: S.taskId, created: S.created, docsLoaded: S.docsLoaded,
      analyzed: S.analyzed, decisions: S.decisions, factEdits: S.factEdits,
      factConfirms: S.factConfirms, reviewDecisions: S.reviewDecisions, realAnswers: S.realAnswers,
      ruleProposals: S.ruleProposals, clauseDrafts: S.clauseDrafts, realDecisions: S.realDecisions,
      jaDrafts: S.jaDrafts,
      fixes: S.fixes, audit: S.audit, seq: S.seq,
      previewLang: S.previewLang, qAnswers: S.qAnswers, qGenerated: S.qGenerated,
      exports: S.exports, view: S.view, modelCfg: S.modelCfg
    });
  }

  function restore() {
    var s = E.Store.load();
    if (!s) return false;
    ['role', 'taskId', 'created', 'docsLoaded', 'analyzed', 'decisions', 'factEdits',
      'factConfirms', 'reviewDecisions', 'realAnswers', 'ruleProposals', 'clauseDrafts',
      'realDecisions', 'fixes', 'audit', 'seq', 'previewLang', 'qAnswers', 'qGenerated', 'exports', 'view', 'modelCfg']
      .forEach(function (k) { if (s[k] !== undefined) S[k] = s[k]; });
    if (S.analyzed) analysis = E.analyze(D.FACTS);
    return true;
  }

  /* ======================================================== 工具 */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function nl2br(s) { return esc(s).replace(/\n/g, '<br>'); }

  function task() {
    var id = S.taskId || 'T-2026-0392';
    for (var i = 0; i < D.PRESET_TASKS.length; i++) if (D.PRESET_TASKS[i].task_id === id) return D.PRESET_TASKS[i];
    return D.PRESET_TASKS[0];
  }
  function mainTask() { return D.PRESET_TASKS[0]; }

  function roleObj(id) {
    for (var i = 0; i < D.ROLES.length; i++) if (D.ROLES[i].id === (id || S.role)) return D.ROLES[i];
    return D.ROLES[0];
  }
  function actorLabel() { var r = roleObj(); return r.person + '（' + r.name_cn + '）'; }

  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(t._tm); t._tm = setTimeout(function () { t.classList.remove('show'); }, 2600);
  }

  function log(actorType, action, objType, objId, before, after, extra) {
    S.seq++;
    var actorId = actorType === 'human' ? actorLabel()
      : actorType === 'rule_engine' ? '规则引擎 ' + D.META.ruleSetVersion
      : actorType === 'model' ? '模型 ' + ((S.modelCfg && S.modelCfg.model) || '-')
      : 'Agent（' + D.META.dataMode + '）';
    S.audit.push(E.Audit.make(S.seq, actorType, actorId, action, objType, objId, before, after, extra));
  }

  /* ------------------------------------------------------------ 差异高亮
     先按中英文标点切成短语做 LCS（避免中文逐字比对产生碎片化高亮），
     再对配对的「删除段 / 新增段」剥离公共前后缀，把高亮收敛到真正改动的词。 */
  function segment(s) {
    s = String(s || '');
    var out = [], buf = '', breakers = '，。；：、！？,;:.!?\n';
    for (var i = 0; i < s.length; i++) {
      buf += s.charAt(i);
      if (breakers.indexOf(s.charAt(i)) >= 0) { out.push(buf); buf = ''; }
    }
    if (buf) out.push(buf);
    return out;
  }

  function commonPrefixLen(a, b) {
    var n = Math.min(a.length, b.length), i = 0;
    while (i < n && a.charAt(i) === b.charAt(i)) i++;
    return i;
  }
  function commonSuffixLen(a, b, skip) {
    var n = Math.min(a.length, b.length) - skip, i = 0;
    while (i < n && a.charAt(a.length - 1 - i) === b.charAt(b.length - 1 - i)) i++;
    return i;
  }

  function diffHtml(a, b, which) {
    var A = segment(a), B = segment(b);
    var n = A.length, m = B.length;
    var dp = [], i, j;
    for (i = 0; i <= n; i++) dp.push(new Int32Array(m + 1));
    for (i = n - 1; i >= 0; i--) {
      for (j = m - 1; j >= 0; j--) {
        dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    var ops = []; i = 0; j = 0;
    while (i < n && j < m) {
      if (A[i] === B[j]) { ops.push({ t: 'same', v: A[i] }); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ t: 'del', v: A[i] }); i++; }
      else { ops.push({ t: 'ins', v: B[j] }); j++; }
    }
    while (i < n) ops.push({ t: 'del', v: A[i++] });
    while (j < m) ops.push({ t: 'ins', v: B[j++] });

    // 合并同类连续段
    var runs = [];
    ops.forEach(function (o) {
      if (runs.length && runs[runs.length - 1].t === o.t) runs[runs.length - 1].v += o.v;
      else runs.push({ t: o.t, v: o.v });
    });

    // 配对的 del→ins 剥离公共前后缀
    var refined = [];
    for (i = 0; i < runs.length; i++) {
      if (runs[i].t === 'del' && runs[i + 1] && runs[i + 1].t === 'ins') {
        var o1 = runs[i].v, n1 = runs[i + 1].v;
        var p = commonPrefixLen(o1, n1);
        var s2 = commonSuffixLen(o1, n1, p);
        if (p) refined.push({ t: 'same', v: o1.slice(0, p) });
        var oMid = o1.slice(p, o1.length - s2), nMid = n1.slice(p, n1.length - s2);
        if (oMid) refined.push({ t: 'del', v: oMid });
        if (nMid) refined.push({ t: 'ins', v: nMid });
        if (s2) refined.push({ t: 'same', v: o1.slice(o1.length - s2) });
        i++;
      } else refined.push(runs[i]);
    }

    var html = '', buf = '', mode = '';
    function flush() {
      if (!buf) return;
      if (mode === 'same') html += esc(buf);
      else if (mode === 'del') html += '<del>' + esc(buf) + '</del>';
      else html += '<ins>' + esc(buf) + '</ins>';
      buf = '';
    }
    refined.forEach(function (p) {
      if (which === 'old' && p.t === 'ins') return;
      if (which === 'new' && p.t === 'del') return;
      if (p.t !== mode) { flush(); mode = p.t; }
      buf += p.v;
    });
    flush();
    return html;
  }

  /* 新增 / 删除 / 无法确定三类不做逐词比对：两侧文本本无对应关系，
     逐词比对只会产生噪声。整块标注为新增或删除，或按原样呈现。 */
  function diffPane(c, which, overrideNew) {
    var oldT = c.old_text, newT = overrideNew || c.proposed_text;
    if (c.diff_class === 'added') {
      return which === 'old' ? esc(oldT) : '<ins>' + esc(newT) + '</ins>';
    }
    if (c.diff_class === 'removed') {
      return which === 'old' ? '<del>' + esc(oldT) + '</del>' : esc(newT);
    }
    if (c.diff_class === 'undetermined') {
      return which === 'old' ? esc(oldT) : esc(newT);
    }
    return diffHtml(oldT, newT, which);
  }

  /* ---------------------------------------------- 通用组件 */
  function riskPill(level) {
    // 反馈：即使只是措辞调整也需人工判断 —— 合同里每个字句都重要。
    // 所以三档只影响排序与提示强度，不影响「要不要看」：没有一档是可以不看的。
    var map = { high: ['high', '🔴 高风险 · 必须逐项确认'], medium: ['medium', '🟡 中风险 · 需人工判断'], low: ['low', '⚪ 低风险 · 仍需过目'] };
    return '<span class="pill ' + map[level][0] + '">' + map[level][1] + '</span>';
  }
  function confBar(c) {
    var cls = c >= 0.85 ? 'hi' : (c >= 0.7 ? 'mid' : 'lo');
    return '<span class="conf"><span class="conf-bar"><i class="' + cls + '" style="width:' +
      Math.round(c * 100) + '%"></i></span><span class="conf-num">' + (c * 100).toFixed(0) + '%</span></span>';
  }
  function statusPill(st) {
    var s = D.TASK_STATUS[st] || { label: st, tone: 'neutral' };
    return '<span class="pill ' + s.tone + '">' + s.label + '</span>';
  }

  /* ======================================================== 侧栏 */
  /* 主流程的五个阶段 —— 全站唯一的一套编号。
     侧栏序号、页头「第 N 步 / 共 5 步」、工作台的进度卡都从这里取，
     不允许任何界面另起一套步骤编号。 */
  var STAGES = [
    { view: 'docs', n: 1, ic: '❶', label: '上传与识别材料',
      todo: '载入上年度合同、本年度模板与客户资料，系统自动识别关键字段',
      next: 'workbench', nextLabel: '核对识别结果', lock: '需先创建任务' },
    { view: 'workbench', n: 2, ic: '❷', label: '核对识别结果',
      todo: '逐项核对识别出的客户与项目信息，查看每个字段的来源与置信度',
      next: 'changes', nextLabel: '处理待确认事项', lock: '需先完成识别' },
    { view: 'changes', n: 3, ic: '❸', label: '确认变更事项',
      todo: '按风险等级逐项决定接受 / 编辑 / 拒绝；高风险项必须逐一确认',
      next: 'preview', nextLabel: '生成合同预览', lock: '需先完成识别' },
    { view: 'preview', n: 4, ic: '❹', label: '预览与导出合同',
      todo: '查看中英双语初稿与一致性检查结果，导出供内部复核的版本',
      next: 'audit', nextLabel: '查看审计记录', lock: '需先完成识别' },
    { view: 'audit', n: 5, ic: '❺', label: '审计记录',
      todo: '查看这份合同从识别到确认的完整留痕，可导出归档',
      next: null, nextLabel: null, lock: '需先创建任务' }
  ];
  var STAGE_TOTAL = STAGES.length;
  function stageOf(view) {
    for (var i = 0; i < STAGES.length; i++) if (STAGES[i].view === view) return STAGES[i];
    return null;
  }
  /* 统一的页头：标题 +「第 N 步 / 共 5 步 · 这一步做什么」+ 指向下一步的主按钮。
     right 用于放该页特有的控件（语言切换、导出按钮等）。 */
  function stageHead(view, title, sub, right) {
    var g = stageOf(view);
    var meta = '<span class="step-tag">第 ' + g.n + ' 步 / 共 ' + STAGE_TOTAL + ' 步</span>';
    var line = sub || g.todo;
    var nextBtn = '';
    if (g.next && stageReady(g.next)) {
      nextBtn = '<button class="btn primary" data-act="nav" data-view="' + g.next +
        '">下一步：' + stageOf(g.next).label + ' →</button>';
    }
    return '<div class="page-head"><div><div class="page-title">' + (title || g.label) + '</div>' +
      '<div class="page-sub">' + meta + esc(line) + '</div></div>' +
      '<div class="spacer"></div>' + (right || '') + nextBtn + '</div>';
  }
  function stageReady(view) {
    var n = null;
    NAV.forEach(function (x) { if (x.view === view) n = x; });
    if (!n) return true;
    if (n.needAnalysis && !S.analyzed) return false;
    if (n.needTask && !S.created) return false;
    return true;
  }

  var NAV = [
    { sec: '任务' },
    { view: 'home', ic: '▤', label: '首页 / 合同任务列表' },
    { view: 'newtask', ic: '＋', label: '新建年度更新' },
    { view: 'newcontract', ic: '✎', label: '生成新合同' },
    { sec: 'CURRENT' },   // 运行时替换为「当前任务 · <客户><年度>」
    { view: 'docs', stage: 1, needTask: true },
    { view: 'workbench', stage: 2, needAnalysis: true },
    { view: 'changes', stage: 3, needAnalysis: true, badge: true },
    { view: 'preview', stage: 4, needAnalysis: true },
    { view: 'audit', stage: 5, needTask: true },
    { sec: '真实文件' },
    { view: 'realmode', ic: '⇄', label: '真实文件比对', needTask: true },
    { sec: '配置' },
    { view: 'rules', ic: '⚙', label: '模板与规则管理' },
    { view: 'model', ic: '🧠', label: '模型接入' }
  ];

  function stageDone(g) {
    var rs = analysis ? E.riskSummary(analysis.changes, S.decisions) : null;
    if (g.view === 'docs') return S.analyzed;
    if (g.view === 'workbench') return S.analyzed;
    if (g.view === 'changes') return !!rs && rs.done === rs.total && rs.highPending === 0;
    if (g.view === 'preview') return S.exports.length > 0;
    return false;
  }

  function renderNav() {
    var rs = analysis ? E.riskSummary(analysis.changes, S.decisions) : null;
    var h = '';
    NAV.forEach(function (n) {
      if (n.sec) {
        if (n.sec === 'CURRENT') {
          // 分区标题带上是哪个任务；没有任务时直接说清楚，而不是留五个灰条让人猜
          var t = S.created ? task() : null;
          h += '<div class="nav-sec"><span>当前任务</span>' +
            (t ? '<span class="nav-sec-x">' + esc(t.engagement_year + ' · ' + t.client_short) + '</span>'
               : '<span class="nav-sec-x">尚未创建</span>') + '</div>';
          // 只在真的没任务时提示（解释这 5 条为什么是灰的），有任务后自动消失
          if (!S.created) h += '<div class="nav-hint">创建任务后依次解锁</div>';
        } else {
          h += '<div class="nav-sec">' + n.sec + '</div>';
          if (n.hint) h += '<div class="nav-hint">' + n.hint + '</div>';
        }
        return;
      }
      var disabled = (n.needTask && !S.created) || (n.needAnalysis && !S.analyzed);
      var g = n.stage ? stageOf(n.view) : null;
      var ic = g ? g.ic : n.ic;
      var label = g ? g.label : n.label;
      var badge = '';
      if (n.badge && rs && rs.highPending > 0) badge = '<span class="badge">' + rs.highPending + '</span>';
      // 已走完的阶段打勾，当前阶段高亮 —— 一眼看出进度
      if (g && !disabled && stageDone(g)) badge = badge || '<span class="nav-ok">✓</span>';
      h += '<button class="nav-item' + (S.view === n.view ? ' active' : '') + (disabled ? ' disabled' : '') +
        '" data-act="nav" data-view="' + n.view + '"' + (disabled ? ' disabled' : '') +
        (disabled && g ? ' title="' + esc(g.lock) + '"' : '') + '>' +
        '<span class="ic">' + ic + '</span><span>' + label + '</span>' + badge + '</button>';
    });
    h += '<div class="nav-sec">演示控制</div>';
    h += '<button class="nav-item" data-act="reset"><span class="ic">⟲</span><span>重置演示数据</span></button>';
    $('sidebar').innerHTML = h;
  }

  /* ======================================================== 首页 */
  function viewHome() {
    var tasks = D.PRESET_TASKS;
    var rs = analysis ? E.riskSummary(analysis.changes, S.decisions) : null;
    var h = '';
    h += '<div class="page-head"><div><div class="page-title">合同任务列表</div>' +
      '<div class="page-sub">' + D.META.productNameCn + ' · ' + D.META.version + ' · 全部数据为虚构演示资料</div></div>' +
      '<div class="spacer"></div><div class="btn-row">' +
      '<button class="btn primary lg" data-act="nav" data-view="newtask">＋ 新建年度更新</button>' +
      '<button class="btn lg" data-act="nav" data-view="newcontract">✎ 新建合同</button></div></div>';

    var openHigh = 0, openTasks = 0;
    tasks.forEach(function (t) {
      var r = t.is_demo_main ? (rs || { high: 0 }) : (t.static_risk || { high: 0 });
      openHigh += r.high || 0;
      if (t.status !== 'exported') openTasks++;
    });

    h += '<div class="metrics">' +
      metric('进行中任务', openTasks, '', '') +
      metric('待确认高风险项', rs ? rs.highPending : openHigh, '', (rs ? rs.highPending : openHigh) > 0 ? 'high' : 'ok') +
      metric('本月已导出初稿', 1, '', 'ok') +
      metric('预置规则数', D.RULES.length, ' 条', '') +
      metric('条款库条目', D.CLAUSES.length, ' 条', '') +
      '</div>';

    h += '<div class="card"><div class="card-h"><h3>最近任务</h3>' +
      '<span class="sub">共 ' + tasks.length + ' 项 · 点击行进入任务</span></div>' +
      '<div class="card-b tight" style="padding:0"><table class="tbl"><tr>' +
      '<th>任务编号 / 项目名称</th><th>客户</th><th>年度</th><th>语言</th><th>状态</th>' +
      '<th>风险事项</th><th>进度</th><th>创建人 / 更新时间</th></tr>';

    tasks.forEach(function (t) {
      var isMain = t.is_demo_main;
      var r = isMain ? rs : t.static_risk;
      var prog = isMain ? (rs ? rs.progress : (S.created ? 5 : 0)) : t.static_progress;
      var st = isMain ? currentTaskStatus() : t.status;
      h += '<tr class="task-row' + (isMain ? ' clickable' : '') + '"' +
        (isMain ? ' data-act="open-task" data-id="' + t.task_id + '"' : '') + '>' +
        '<td><div class="tname">' + esc(t.project_name) + (isMain ? ' <span class="pill info">演示主流程</span>' : '') + '</div>' +
        '<div class="tmeta mono">' + esc(t.task_id) + ' · ' + esc(t.contract_no) + '</div></td>' +
        '<td>' + esc(t.client_short) + '</td><td>' + esc(t.engagement_year) + '</td><td>' + esc(t.language) + '</td>' +
        '<td>' + statusPill(st) + '</td>' +
        '<td>' + (r ? '<div class="risk-chips"><span class="chip h">高 ' + (isMain ? r.highPending : r.high) +
          '</span><span class="chip m">中 ' + r.medium + '</span><span class="chip l">低 ' + r.low + '</span></div>'
          : '<span class="note-sm">待分析</span>') + '</td>' +
        '<td style="min-width:110px"><div class="pbar' + (prog === 100 ? ' ok' : '') + '"><i style="width:' + prog + '%"></i></div>' +
        '<div class="note-sm">' + prog + '%</div></td>' +
        '<td><div>' + esc(t.owner) + '</div><div class="tmeta">' + esc(t.updated_at) + '</div></td></tr>';
    });
    h += '</table></div></div>';

    h += '<div class="card"><div class="card-h"><h3>本演示的数据与 AI 边界</h3></div><div class="card-b">' +
      '<div class="grid2"><div>' +
      '<div class="note-sm" style="font-size:12.5px;line-height:1.8">' +
      '<b>预置虚构数据集</b>：客户「星海智能科技（深圳）有限公司」的 2025 年已签双语合同、2025/2026 标准模板、' +
      '2026 客户信息表、费用批准信息，共 ' + D.DOCUMENTS.length + ' 份文件，全部随应用打包，断网可用。</div></div><div>' +
      '<div class="note-sm" style="font-size:12.5px;line-height:1.8"><b>实时计算 vs 预置结果</b>：' +
      esc(D.META.engineNote) + '<br>模型端点：' + esc(D.META.modelEndpoint) + '</div></div></div></div></div>';
    return h;
  }

  function metric(k, v, unit, cls) {
    return '<div class="metric ' + (cls || '') + '"><div class="k">' + k + '</div>' +
      '<div class="v">' + v + '<small>' + (unit || '') + '</small></div></div>';
  }

  function currentTaskStatus() {
    if (!S.created) return 'files_pending';
    if (!S.docsLoaded) return 'files_pending';
    if (S.analyzing) return 'analyzing';
    if (!S.analyzed) return 'files_pending';
    if (S.exports.length) return 'exported';
    var rs = E.riskSummary(analysis.changes, S.decisions);
    if (rs.escalated) return 'manager_review';
    if (rs.highPending) return 'consultant_review';
    if (rs.done === rs.total) return 'draft_ready';
    return 'info_pending';
  }

  /* ======================================================== 新建任务 */
  function viewNewTask() {
    var t = mainTask();
    var h = '';
    h += '<div class="page-head"><div><div class="page-title">新建年度更新任务</div>' +
      '<div class="page-sub">系统将生成唯一任务编号</div></div></div>';
    h += '<div class="split wide"><div class="card"><div class="card-h"><h3>任务信息</h3></div><div class="card-b">' +
      '<div class="field"><label for="f_project">项目名称 <span class="req">*</span></label>' +
      '<input id="f_project" value="' + esc(t.project_name) + '"></div>' +
      '<div class="field"><label for="f_client">客户简称 <span class="req">*</span></label>' +
      '<input id="f_client" value="' + esc(t.client_short) + '"></div>' +
      '<div class="grid2"><div class="field"><label for="f_year">合同年度 <span class="req">*</span></label>' +
      '<select id="f_year"><option>2026</option><option>2025</option></select></div>' +
      '<div class="field"><label for="f_lang">合同语言 <span class="req">*</span></label>' +
      '<select id="f_lang"><option>中英双语（中文为准）</option><option>中文</option><option>英文</option></select></div></div>' +
      '<div class="grid2"><div class="field"><label for="f_service">业务类型 <span class="req">*</span></label>' +
      '<select id="f_service"><option>转让定价文档准备服务</option><option>转让定价咨询</option>' +
      '<option>预约定价安排（APA）协助</option></select></div>' +
      '<div class="field"><label for="f_owner">负责人 <span class="req">*</span></label>' +
      '<select id="f_owner"><option>Emma Clarke（TP 顾问）</option><option>Nathan Boyd（TP 顾问）</option></select></div></div>' +
      '<div class="field"><label for="f_reviewer">复核人</label><select id="f_reviewer">' +
      '<option>Daniel Reed（TP 项目经理）</option></select><div class="hint">高风险条款须由经理或合伙人确认</div></div>' +
      '<div class="btn-row" style="margin-top:6px">' +
      '<button class="btn primary lg" data-act="create-task">创建任务并上传材料 →</button>' +
      '<button class="btn" data-act="nav" data-view="home">取消</button></div>' +
      '</div></div>' +
      '<div class="stack"><div class="card"><div class="card-h"><h3>创建后要走的 ' + STAGE_TOTAL + ' 步</h3>' +
      '<span class="sub">与左侧导航一致</span></div><div class="card-b">' +
      '<div class="pipe">' + STAGES.map(function (g) {
        return '<div class="pipe-row wait"><span class="st">' + g.n + '</span>' +
          '<span><b>' + esc(g.label) + '</b><div class="note-sm">' + esc(g.todo) + '</div></span></div>';
      }).join('') + '</div></div></div>' +
      '<div class="card"><div class="card-h"><h3>提示</h3></div><div class="card-b">' +
      '<div class="note-sm">演示环境已内置该客户的全部虚构文件，创建任务后可一键载入，无需现场上传真实文件。</div>' +
      '</div></div></div></div>';
    return h;
  }

  /* ======================================================== 文件与信息识别 */
  var PIPE_STAGES = [
    { t: '文档接收与哈希校验', d: 520, note: '5 份文件 · 记录 SHA 前缀，保证输入版本可验证' },
    { t: '解析与字段提取 Agent', d: 900, note: '保留段落 / 标题 / 表格 / 条款编号；15 段 + 20 行结构化字段' },
    { t: '证据定位与冲突检测', d: 780, note: '每个字段至少关联一处来源引用；检出 1 处资料冲突' },
    { t: '模板差异分析 Agent', d: 860, note: '2025 v3.2 ↔ 2026 v4.0 结构差异实时计算 + 语义分类' },
    { t: '确定性规则引擎', d: 640, note: D.RULES.length + ' 条规则求值' },
    { t: '条款建议 Agent', d: 700, note: '生成新增 / 保留 / 修改 / 删除 / 升级建议' },
    { t: '风险分类与人工确认路由', d: 520, note: '按高 / 中 / 低分档，高风险强制人工确认' }
  ];

  /* ---------------------------------------------------- 真实文件模式 */
  /* 按 id 找一条待回答的条件性问题。
     两个来源：模板指引抽出来的（analyzeReal 里算好的），
     以及你批准的规则提议带出来的（每次按当前 ruleProposals 现算）。
     两处都要找 —— 只找前者会让批准的规则问题点不动（实测踩过）。 */
  function findRealQuestion(qid) {
    var hit = null;
    if (S.realAnalysis) S.realAnalysis.questions.forEach(function (x) { if (x.id === qid) hit = x; });
    if (!hit) {
      global.TPReal.proposalQuestions(S.ruleProposals).forEach(function (x) { if (x.id === qid) hit = x; });
    }
    return hit;
  }

  // 某条条件性问题是否已有模型起草的条款
  function draftFor(qid) {
    var hit = null;
    (S.clauseDrafts || []).forEach(function (c) { if (c.question_id === qid) hit = c; });
    return hit;
  }

  function realCandidates() {
    return S.extraDocs.filter(function (d) {
      return d.parse_status === 'parsed' && d.kind === 'docx' && (d.clauses || []).length >= 5;
    });
  }

  function runRealAnalysis(oldId, newId) {
    var docs = realCandidates();
    var o = null, n = null;
    docs.forEach(function (d) { if (d.document_id === oldId) o = d; if (d.document_id === newId) n = d; });
    if (!o || !n) { toast('请先选择上年度合同与本年度模板'); return; }
    if (o === n) { toast('两份必须是不同的文件'); return; }
    var A;
    try {
      A = global.TPReal.analyzeReal(o, n, S.realAnswers);
    } catch (e) { toast('无法比对：' + e.message); return; }
    A.computedAt = E.nowStamp();
    A.old_id = o.document_id; A.new_id = n.document_id;
    S.realAnalysis = A;
    log('agent', '真实文件比对完成（确定性层）', '文档对', o.document_id + '→' + n.document_id, '',
      '匹配 ' + A.diff.matched + ' 条 · 变化 ' + A.diff.modified.length +
      ' · 新增 ' + A.diff.added.length + ' · 已删 ' + A.diff.removed.length +
      ' · 字段 ' + A.fieldsFound + '/' + A.fields.length,
      { basis: '按标题相似度匹配（阈值 ' + A.diff.threshold + '）+ 正则抽字段，均为确定性计算' });

    // 模型接入时，让它接手正则做不好的部分；每一步都过引文核对护栏
    var mdl = global.TPModel;
    if (mdl && mdl.enabled()) {
      toast('确定性层已完成，正在请模型接手语义部分…');
      mdl.enhanceReal(A, o, n).then(function (r) {
        A.modelResult = r;
        (r.applied || []).forEach(function (j) {
          log('agent', '模型任务生效：' + j, '文档对', o.document_id + '→' + n.document_id, '', '',
            { basis: '模型输出已通过引文逐字核对；数值与门禁仍由确定性程序负责' });
        });
        (r.fallbacks || []).forEach(function (f) {
          log('agent', '模型任务未生效：' + f.job, '文档对', o.document_id + '→' + n.document_id, '',
            f.reason, { basis: '任一失败即回退确定性结果，不中断流程' });
        });
        (r.guards || []).forEach(function (g) {
          log('rule_engine', '防幻觉护栏拦截：' + g.guard, '字段', g.field || '-', '', g.why,
            { basis: '模型提议、程序核验 —— 引文核对不通过的一律丢弃' });
        });
        if (A.ruleProposalsRaw && A.ruleProposalsRaw.length) {
          S.ruleProposals = global.TPReal.newRuleProposals(A.ruleProposalsRaw);
          log('agent', '从模板指引提炼出 ' + S.ruleProposals.length + ' 条规则提议',
            '规则库', '待批准', '', '', { basis: '每条都能回溯到模板原文；默认为草稿，需人批准后才参与求值' });
        }
        A.questionSummary = global.TPReal.questionSummary(A.questions, S.realAnswers);
        persist(); render();
        toast('模型已参与 ' + (r.applied || []).length + ' 项' +
          ((r.guards || []).length ? '，护栏拦下 ' + r.guards.length + ' 处' : ''));
      }).catch(function (e) {
        log('agent', '模型增强失败，已回退确定性结果', '文档对', o.document_id, '', String(e.message || e),
          { basis: '模型不可用不影响确定性结论' });
        persist(); render();
      });
    }
    persist(); S.view = 'realmode'; render();
    toast('真实比对完成' + (mdl && mdl.enabled() ? '（模型增强进行中）' : '（模型未接入，为纯确定性结果）'));
  }

  function viewRealMode() {
    var A = S.realAnalysis;
    var h = stageHead('docs', '真实文件比对结果',
      A ? '上年度：' + A.old_file + '　↔　本年度模板：' + A.new_file : '尚未运行');
    if (!A) {
      h += '<div class="card"><div class="card-b"><div class="empty">' +
        '还没有真实比对结果。回到 ❶ 上传两份 DOCX（上年度已签合同 + 本年度标准模板）后运行。' +
        '</div></div></div>';
      return h;
    }
    var d = A.diff;
    h += '<div class="metrics">' +
      metric('条款匹配上', d.matched + ' / ' + d.oldCount, '按标题相似度，非按 ID', 'ok') +
      metric('文本有变化', String(d.modified.length), '需逐条人工判断', 'medium') +
      metric('模板新增', String(d.added.length), '旧合同里没有', 'high') +
      metric('模板已删', String(d.removed.length), '旧合同里有', 'medium') +
      '</div>';

    var mr = A.modelResult;
    h += '<div class="box-lite"><b>谁得出了这些结论：</b>' +
      '条款匹配' + (d.provenance === 'model' ? '<span class="pill ai">模型语义匹配</span>'
        : '<span class="pill det">程序按标题相似度（阈值 ' + d.threshold + '）</span>') +
      '　字段提取<span class="pill det">程序正则</span>' +
      (mr && (mr.applied || []).indexOf('真实合同字段提取') >= 0 ? '<span class="pill ai">+ 模型补齐</span>' : '') +
      '　差异分级' + (mr && (mr.applied || []).indexOf('差异语义分级') >= 0
        ? '<span class="pill ai">模型</span>' : '<span class="pill neutral">未分级（需接入模型）</span>') +
      '<br>编号不参与相似度，因为编号本来就会变。' +
      '<b>模型给的每一处引文都要能在原文里逐字找到，找不到就丢弃并记入审计</b> —— ' +
      '模型提议、程序核验。数值、门禁、审计一律不交给模型。</div>';
    if (mr && (mr.guards || []).length) {
      h += '<div class="box-lite" style="border-color:var(--danger-line);background:var(--danger-soft)">' +
        '<b>防幻觉护栏本次拦下 ' + mr.guards.length + ' 处模型输出：</b><br>' +
        mr.guards.map(function (g) {
          return '· [' + esc(g.guard) + '] ' + esc(g.field || '') + '：' + esc(g.why);
        }).join('<br>') + '</div>';
    }
    if (mr && (mr.fallbacks || []).length) {
      h += '<div class="note-sm" style="margin-bottom:10px">模型未生效的任务：' +
        mr.fallbacks.map(function (f) { return esc(f.job) + '（' + esc(f.reason) + '）'; }).join('；') +
        '　—— 已回退确定性结果。</div>';
    }

    /* 字段提取 */
    h += '<div class="card"><div class="card-h"><h3>从上年度合同抽出的字段</h3>' +
      '<span class="pill ' + (A.fieldsFound ? 'ok' : 'warn') + '">抽到 ' + A.fieldsFound +
      ' / ' + A.fields.length + '</span>' +
      '<div class="spacer"></div><span class="sub">置信度低于 0.7 的一律需人工核对</span>' +
      '</div><div class="card-b" style="padding:0"><table class="tbl">' +
      '<tr><th style="width:16%">字段</th><th style="width:24%">抽到的值</th>' +
      '<th style="width:11%">置信度</th><th>来源 / 未抽到的原因</th></tr>';
    A.fields.forEach(function (f) {
      h += '<tr><td><b>' + esc(f.label) + '</b><div class="note-sm mono">' + esc(f.field) + '</div></td>' +
        '<td>' + (f.value ? esc(String(f.value)) : '<span class="note-sm">未抽到</span>') + '</td>' +
        '<td>' + (f.value ? confBar(f.confidence) : '<span class="note-sm">—</span>') + '</td>' +
        '<td class="note-sm">' + (f.source
          ? '<b>' + esc(f.source.clause_title) + '</b><br>' + esc(f.source.quote)
          : esc(f.reason || '—')) + '</td></tr>';
    });
    h += '</table></div></div>';

    /* 模板自己写明的条件性条款 → 待回答 */
    var qs = A.questionSummary;
    h += '<div class="card"><div class="card-h"><h3>模板注明的条件性条款</h3>' +
      '<span class="pill ' + (qs.gateOpen ? 'ok' : 'high') + '">已回答 ' + qs.answered +
      ' / ' + qs.total + '</span>' +
      '<div class="spacer"></div><span class="sub">来自本年度模板自己写的使用说明</span>' +
      '</div><div class="card-b">' +
      '<div class="box-lite">这些不是我们编的规则，是<b>模板里原文写着「什么情况下要加什么条款」</b>，' +
      '由解析层抽出来的。系统不替你判断适用与否 —— 每一条都要你回答，回答进审计。' +
      (qs.gateOpen ? '' : '<b>还有 ' + qs.pending + ' 条未回答。</b>') + '</div>';
    A.questions.forEach(function (q) {
      var a = S.realAnswers[q.id];
      h += '<div class="qa' + (a ? ' answered' : '') + '">' +
        '<div class="q"><span class="pill neutral">' + esc(q.topic) + '</span> ' + esc(q.text) + '</div>' +
        (q.suggestion
          ? '<div class="why" style="color:var(--ai)">🤖 模型建议：<b>' +
            ({ applicable: '适用', not_applicable: '不适用', need_more_info: '需更多信息' }[q.suggestion] || q.suggestion) +
            '</b>' + (q.suggestion_confidence != null ? '（置信 ' + q.suggestion_confidence + '）' : '') +
            '　' + esc(String(q.suggestion_reason || '').slice(0, 130)) +
            (q.suggestion_evidence ? '<br>依据原文：「' + esc(String(q.suggestion_evidence).slice(0, 110)) + '」'
              : '<br><b>无可核对的原文依据 —— 仅供参考，必须自行判断</b>') +
            '<br><b>这只是建议，决定权在你。</b></div>'
          : '') +
        '<div class="btn-row" style="margin-top:7px">' +
        (a
          ? '<span class="pill ' + (a === 'applicable' ? 'warn' : 'ok') + '">' +
            (a === 'applicable' ? '适用 —— 需加入该条款' : '不适用 —— 不加入') + '</span>' +
            '<button class="btn sm" data-act="rq-ans" data-id="' + q.id + '" data-val="">撤销</button>' +
            // 答「适用」只得到「该加」这个结论，条款正文还得有人写 —— 交给模型起草，人批准
            (a === 'applicable'
              ? (draftFor(q.id)
                  ? '<span class="pill ai">已起草，见下方待批区</span>'
                  : modelOn()
                    ? '<button class="btn sm" data-act="cd-draft" data-id="' + q.id + '">🤖 请模型起草这条</button>'
                    : '<span class="note-sm">条款正文需人工撰写（未接模型）</span>')
              : '')
          : '<button class="btn sm" data-act="rq-ans" data-id="' + q.id + '" data-val="applicable">适用</button>' +
            '<button class="btn ok sm" data-act="rq-ans" data-id="' + q.id + '" data-val="not_applicable">不适用</button>') +
        '</div></div>';
    });
    h += '</div></div>';

    /* 已批准的规则提议 → 也变成必须回答的问题（批准才有后果） */
    var pqs = global.TPReal.proposalQuestions(S.ruleProposals);
    if (pqs.length) {
      var psum = global.TPReal.questionSummary(pqs, S.realAnswers);
      h += '<div class="card"><div class="card-h"><h3>你已批准的规则带出的问题</h3>' +
        '<span class="pill ' + (psum.gateOpen ? 'ok' : 'high') + '">已回答 ' + psum.answered +
        ' / ' + psum.total + '</span><div class="spacer"></div>' +
        '<span class="sub">来自你批准的模型提炼规则</span></div><div class="card-b">' +
        '<div class="box-lite">这些问题是<b>你批准某条规则之后才出现的</b> —— 批准不是走个形式，' +
        '它会真的往流程里加一道必须回答的关口。规则的条件是自然语言，' +
        '程序不会替你判断是否成立，所以仍然要你回答。' +
        '<b>拒绝或撤销那条规则，对应的问题也随之消失。</b></div>';
      pqs.forEach(function (q) {
        var pa = S.realAnswers[q.id], pd = draftFor(q.id);
        h += '<div class="qa' + (pa ? ' answered' : '') + '">' +
          '<div class="q"><span class="pill ' +
          (q.risk_level === 'high' ? 'high' : q.risk_level === 'medium' ? 'medium' : 'low') + '">' +
          esc(q.topic) + '</span> ' + esc(q.text) + '</div>' +
          '<div class="why">规则来自模板原文：「' +
          esc(String(q.source_quote || '').slice(0, 110)) + '」</div>' +
          '<div class="btn-row" style="margin-top:7px">' +
          (pa
            ? '<span class="pill ' + (pa === 'applicable' ? 'warn' : 'ok') + '">' +
              (pa === 'applicable' ? '适用 —— 需加入该条款' : '不适用 —— 不加入') + '</span>' +
              '<button class="btn sm" data-act="rq-ans" data-id="' + q.id + '" data-val="">撤销</button>' +
              (pa === 'applicable'
                ? (pd ? '<span class="pill ai">已起草，见下方待批区</span>'
                      : modelOn()
                        ? '<button class="btn sm" data-act="cd-draft" data-id="' + q.id + '">🤖 请模型起草这条</button>'
                        : '<span class="note-sm">条款正文需人工撰写（未接模型）</span>')
                : '')
            : '<button class="btn sm" data-act="rq-ans" data-id="' + q.id + '" data-val="applicable">适用</button>' +
              '<button class="btn ok sm" data-act="rq-ans" data-id="' + q.id + '" data-val="not_applicable">不适用</button>') +
          '</div></div>';
      });
      h += '</div></div>';
    }

    /* 模型起草的条款 → 逐条待批 */
    if ((S.clauseDrafts || []).length) {
      var cds = S.clauseDrafts;
      var okN = cds.filter(function (c) { return c.state === 'approved'; }).length;
      var blkN = cds.filter(function (c) { return c.approvable === false; }).length;
      // 起草依据是否还在（撤销规则会让对应问题消失）
      var liveIds = (S.realAnalysis ? S.realAnalysis.questions : []).map(function (x) { return x.id; })
        .concat(pqs.map(function (x) { return x.id; }));
      var orphans = {};
      global.TPReal.orphanDrafts(cds, liveIds).forEach(function (c) { orphans[c.id] = true; });
      var orphN = Object.keys(orphans).length;
      h += '<div class="card"><div class="card-h"><h3>模型起草的条款（待批准）</h3>' +
        '<span class="pill ai">共 ' + cds.length + '</span>' +
        '<span class="pill ' + (okN ? 'ok' : 'neutral') + '">已批准 ' + okN + '</span>' +
        (blkN ? '<span class="pill high">护栏拦下 ' + blkN + '</span>' : '') +
        (orphN ? '<span class="pill warn">起草依据已撤销 ' + orphN + '</span>' : '') +
        '</div><div class="card-b">' +
        '<div class="box-lite">这些正文是<b>模型写的</b>，默认状态是「草稿」。' +
        '草稿<b>不会</b>进入合同正文 —— 只有你逐条批准的才会。' +
        '起草时要求它金额、期限一律用 <code>{{占位符}}</code>、不得自行设定赔偿倍数；' +
        '这几条不是靠提示词约束，而是由程序在下面逐条核对，' +
        '<b>违规的草稿连批准按钮都不给</b>。三语数字是否真的一致也由程序重新数过。</div>';
      cds.forEach(function (c) {
        var hard = c.violations.filter(function (x) { return x.level === 'hard'; });
        var soft = c.violations.filter(function (x) { return x.level === 'soft'; });
        h += '<div class="qa' + (c.state === 'approved' ? ' answered' : '') + '">' +
          '<div class="q"><span class="pill ai">🤖 模型起草</span> ' +
          '<span class="pill ' + (c.state === 'approved' ? 'ok' : c.state === 'rejected' ? 'neutral' : 'warn') + '">' +
          ({ draft: '草稿 · 未进正文', approved: '已批准 · 进正文', rejected: '已拒绝' }[c.state]) +
          '</span> <b>' + esc(c.title_cn) + '</b>' +
          (c.title_en ? ' <span class="note-sm">' + esc(c.title_en) + '</span>' : '') + '</div>' +
          // 用途来自模板指引原文，可能是一整段 —— 截断显示，全文在上方的条件性条款卡里
          (orphans[c.id]
            ? '<div class="box-warn" style="margin:6px 0">⚠️ <b>起草依据已撤销</b>：' +
              '当初让这条被起草的规则/条件已经不在流程里了' +
              (c.state === 'approved'
                ? '，但正文里这一条是你批准写入的 —— 系统不会替你删。请确认是否保留。'
                : '。请确认是否还需要这份草稿。') + '</div>'
            : '') +
          '<div class="note-sm" style="margin:4px 0">用途：' +
          esc(String(c.purpose).replace(/^[a-z_]+：/i, '').slice(0, 130)) +
          (String(c.purpose).length > 130 ? '…' : '') + '</div>' +
          '<div class="clause-3l">' +
          '<div><div class="l3-t">中文</div><div class="l3-b">' + esc(c.text_cn) + '</div></div>' +
          '<div><div class="l3-t">English</div><div class="l3-b">' + esc(c.text_en) + '</div></div>' +
          '<div><div class="l3-t">日本語</div><div class="l3-b">' + esc(c.text_ja) + '</div></div>' +
          '</div>' +
          (c.placeholders.length
            ? '<div class="note-sm">占位符（实际值由程序填，不由模型写）：<code>' +
              esc(c.placeholders.join('</code> <code>')) + '</code></div>'
            : '<div class="note-sm"><b>没有任何占位符 —— 请确认这条确实不需要填任何具体值。</b></div>') +
          '<div class="why">起草依据：' + esc(String(c.basis || '（未说明）').slice(0, 200)) + '</div>' +
          (c.caveats.length
            ? '<div class="why">模型自陈需复核之处：<ul style="margin:3px 0 0 16px">' +
              c.caveats.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>'
            : '') +
          (c.violations.length
            ? '<div class="box-warn" style="margin-top:6px">' +
              c.violations.map(function (x) {
                return '<div>' + (x.level === 'hard' ? '⛔' : '⚠️') + ' <b>' + esc(x.guard) + '</b>（' +
                  (x.level === 'hard' ? '阻断批准' : '仅提示') + '）：' + esc(x.why) + '</div>';
              }).join('') + '</div>'
            : '<div class="note-sm" style="color:var(--ok)">✓ 程序核对通过：无具体金额、无自设倍数、三语数字一致</div>') +
          '<div class="btn-row" style="margin-top:7px">' +
          (c.state === 'draft'
            ? (hard.length
                ? '<span class="pill high">护栏阻断，不能批准 —— 请改用人工撰写或重新起草</span>' +
                  '<button class="btn sm" data-act="cd-decide" data-id="' + c.id + '" data-val="rejected">丢弃这份草稿</button>'
                : '<button class="btn primary sm" data-act="cd-decide" data-id="' + c.id + '" data-val="approved">' +
                  '批准并写入正文' + (soft.length ? '（已知' + soft.length + '项提示）' : '') + '</button>' +
                  '<button class="btn sm" data-act="cd-decide" data-id="' + c.id + '" data-val="rejected">拒绝</button>')
            : '<button class="btn sm" data-act="cd-decide" data-id="' + c.id + '" data-val="draft">撤销决定</button>' +
              (c.decided_by ? '<span class="note-sm">' + esc(c.decided_by) + ' · ' + esc(c.decided_at) + '</span>' : '')) +
          '</div></div>';
      });
      h += '</div></div>';
    }

    /* 条款差异明细 */
    function clauseList(title, items, cls, getT, getX) {
      if (!items.length) return '';
      var x = '<div class="card"><div class="card-h"><h3>' + title + '（' + items.length + '）</h3></div>' +
        '<div class="card-b" style="padding:0"><table class="tbl">' +
        '<tr><th style="width:26%">条款</th><th>正文摘要</th></tr>';
      items.slice(0, 30).forEach(function (it) {
        x += '<tr><td><b>' + esc(String(getT(it)).slice(0, 34)) + '</b>' +
          (it.diff_class
            ? '<div style="margin-top:4px"><span class="pill ' +
              (it.risk_level === 'high' ? 'high' : it.risk_level === 'medium' ? 'medium' : 'low') + '">' +
              ({ substantive: '实质性变化', wording_only: '仅措辞', format_only: '仅格式' }[it.diff_class] || it.diff_class) +
              '</span> <span class="pill ai">模型分级</span></div>'
            : '') +
          (it.title_similarity != null
            ? '<div class="note-sm">标题相似 ' + it.title_similarity + ' · 正文相似 ' + it.body_similarity + '</div>'
            : it.match_confidence != null
              ? '<div class="note-sm">模型配对 置信 ' + it.match_confidence + '：' + esc(String(it.match_reason || '').slice(0, 50)) + '</div>'
              : '') + '</td>' +
          '<td class="note-sm">' +
          (it.plain_explanation ? '<div style="color:var(--ai);margin-bottom:4px">🤖 ' + esc(it.plain_explanation) + '</div>' : '') +
          esc(String(getX(it)).slice(0, 200)) + '</td></tr>';
      });
      if (items.length > 30) x += '<tr><td colspan="2" class="note-sm">…另有 ' + (items.length - 30) + ' 条</td></tr>';
      return x + '</table></div></div>';
    }
    h += clauseList('文本有变化的条款', d.modified, 'medium',
      function (i) { return i.new_title; }, function (i) { return i.new_text; });
    h += clauseList('模板新增、旧合同没有的条款', d.added, 'high',
      function (i) { return i.new_title; }, function (i) { return i.new_text; });
    h += clauseList('旧合同有、模板已删的条款', d.removed, 'medium',
      function (i) { return i.old_title; }, function (i) { return i.old_text; });

    /* ---- 模型提炼的规则提议：默认草稿，需人逐条批准 ---- */
    if (S.ruleProposals.length) {
      var ps = global.TPReal.proposalSummary(S.ruleProposals);
      h += '<div class="card"><div class="card-h"><h3>模型从模板指引提炼的规则提议</h3>' +
        '<span class="pill ai">模型提炼</span>' +
        '<span class="pill ' + (ps.draft ? 'high' : 'ok') + '">待批 ' + ps.draft +
        ' · 已批 ' + ps.approved + ' · 已拒 ' + ps.rejected + '</span>' +
        '</div><div class="card-b">' +
        '<div class="box-lite">模型读了本年度模板自己写的使用说明，提炼出这些「条件 → 动作」规则。' +
        '<b>全部默认为草稿，不参与任何判断</b> —— 只有你批准的那些才会进入规则库。' +
        '每条都带模板原文引用，可以核对模型有没有编。</div>';
      S.ruleProposals.forEach(function (p) {
        h += '<div class="qa' + (p.state !== 'draft' ? ' answered' : '') + '">' +
          '<div class="q">' + esc(p.name) +
          ' <span class="pill ' + (p.risk_level === 'high' ? 'high' : p.risk_level === 'medium' ? 'medium' : 'low') + '">' +
          esc(p.risk_level) + '</span>' +
          ' <span class="pill neutral">须 ' + ({ consultant: '顾问', manager: '经理及以上', partner: '合伙人' }[p.approval] || p.approval) + '确认</span></div>' +
          '<div class="why"><b>触发条件：</b>' + esc(p.when_text) + '<br>' +
          '<b>触发后：</b>' + esc(p.then_text) + '<br>' +
          '<b>模板原文：</b>「' + esc(String(p.source_quote).slice(0, 140)) + '」　' +
          '<span class="note-sm">模型置信 ' + p.confidence + '</span></div>' +
          '<div class="btn-row" style="margin-top:7px">' +
          (p.state === 'draft'
            ? '<button class="btn ok sm" data-act="rp-decide" data-id="' + p.id + '" data-val="approved">批准，纳入规则库</button>' +
              '<button class="btn danger sm" data-act="rp-decide" data-id="' + p.id + '" data-val="rejected">拒绝</button>'
            : '<span class="pill ' + (p.state === 'approved' ? 'ok' : 'neutral') + '">' +
              (p.state === 'approved' ? '✓ 已批准，已纳入规则库' : '✕ 已拒绝，不纳入') + '</span>' +
              '<span class="note-sm">' + esc(p.decided_by || '') + '　' + esc(p.decided_at || '') + '</span>' +
              '<button class="btn sm" data-act="rp-decide" data-id="' + p.id + '" data-val="draft">撤销</button>') +
          '</div></div>';
      });
      h += '</div></div>';
    }

    /* ---- 逐条决定采用哪一版，并装配初稿 ---- */
    var dr = global.TPReal.assembleRealDraft(A, S.realDecisions, S.clauseDrafts);
    h += '<div class="card"><div class="card-h"><h3>装配本年度初稿</h3>' +
      '<span class="pill ' + (dr.draftComplete ? 'ok' : 'high') + '">' +
      (dr.draftComplete ? '✓ 全部条款已决定' : '待决定 ' + dr.undecided + ' 条') + '</span>' +
      '<span class="pill neutral">已入正文 ' + dr.sections.length + ' 节 · 未纳入 ' + dr.skipped.length + ' 项</span>' +
      '</div><div class="card-b">' +
      '<div class="box-lite">每一节都标明来源。<b>模型起草的条款未获批准不会写入正文</b>，' +
      '模板新增条款也要你明确接受才加入 —— 未决定的条款会阻塞初稿完成。</div>';
    if (Object.keys(dr.byOrigin).length) {
      h += '<div class="btn-row" style="margin-bottom:10px">' +
        Object.keys(dr.byOrigin).map(function (k) {
          var CN = { prior_contract: '沿用上年度', new_template: '采用本年度模板',
            model_draft_approved: '模型起草·已批准', undecided: '未决定' };
          return '<span class="pill ' + (k === 'undecided' ? 'high' : k === 'model_draft_approved' ? 'ai' : 'neutral') + '">' +
            (CN[k] || k) + ' ' + dr.byOrigin[k] + ' 节</span>';
        }).join('') + '</div>';
    }
    if (d.modified.length || d.added.length) {
      h += '<table class="tbl"><tr><th style="width:26%">条款</th><th style="width:16%">类型</th>' +
        '<th style="width:14%">来源</th><th>你的决定</th></tr>';
      d.modified.forEach(function (p, i) {
        var key = 'M' + i, dec = S.realDecisions[key];
        h += '<tr><td><b>' + esc(String(p.new_title).slice(0, 30)) + '</b></td>' +
          '<td>' + (p.diff_class
            ? '<span class="pill ai">' + ({ substantive: '实质性', wording_only: '仅措辞', format_only: '仅格式' }[p.diff_class] || p.diff_class) + '</span>'
            : '<span class="note-sm">未分级</span>') + '</td>' +
          '<td class="note-sm">模板有变化</td><td>' +
          (dec
            ? '<span class="pill ok">' + (dec === 'accept_new' ? '采用模板' : '保留旧条款') + '</span>' +
              '<button class="btn sm" data-act="rd-set" data-id="' + key + '" data-val="">撤销</button>'
            : '<button class="btn ok sm" data-act="rd-set" data-id="' + key + '" data-val="accept_new">采用模板</button> ' +
              '<button class="btn sm" data-act="rd-set" data-id="' + key + '" data-val="keep_old">保留旧条款</button>') +
          '</td></tr>';
      });
      d.added.forEach(function (p, i) {
        var key = 'A' + i, dec = S.realDecisions[key];
        h += '<tr><td><b>' + esc(String(p.new_title).slice(0, 30)) + '</b></td>' +
          '<td><span class="pill high">模板新增</span></td>' +
          '<td class="note-sm">旧合同无此条</td><td>' +
          (dec === 'accept_new'
            ? '<span class="pill ok">已加入</span>' +
              '<button class="btn sm" data-act="rd-set" data-id="' + key + '" data-val="">撤销</button>'
            : '<button class="btn ok sm" data-act="rd-set" data-id="' + key + '" data-val="accept_new">加入</button>' +
              ' <span class="note-sm">默认不加入</span>') +
          '</td></tr>';
      });
      h += '</table>';
    }
    if (dr.skipped.length) {
      h += '<div class="note-sm" style="margin-top:10px"><b>未纳入正文的项：</b><br>' +
        dr.skipped.map(function (x) { return '· ' + esc(x.title) + ' —— ' + esc(x.reason); }).join('<br>') +
        '</div>';
    }
    h += '</div></div>';

    return h;
  }

  function viewDocs() {
    var t = task();
    var h = '';
    h += stageHead('docs', null,
      S.analyzed ? '材料已载入并完成识别 —— ' + esc(t.project_name)
        : '载入上年度合同、本年度模板与客户资料，系统自动识别关键字段');

    /* 材料 */
    h += '<div class="card"><div class="card-h"><h3>载入材料</h3>' +
      '<span class="sub">必传：上年度已签合同、本年度标准模板；选传：客户信息表、报价 / 批准信息、团队名单</span></div><div class="card-b">';
    if (!S.docsLoaded) {
      h += '<div class="empty"><span class="ic">⬆</span>尚未载入材料。演示环境已内置该客户的全部虚构文件。</div>' +
        '<div class="btn-row" style="justify-content:center">' +
        '<button class="btn primary lg" data-act="load-docs">使用预置演示文件（5 份）</button>' +
        '<label class="btn lg">选择本地文件…<input type="file" id="fileInput" multiple style="display:none"></label></div>' +
        '<div class="note-sm" style="text-align:center;margin-top:8px">支持 DOCX / PDF / XLSX。' +
        '演示环境仅内置预置样例文件的解析适配，其他文件将明确提示解析失败，不会静默忽略。</div>';
    } else {
      D.DOCUMENTS.forEach(function (d) { h += docRow(d); });
      S.extraDocs.forEach(function (d) { h += docRow(d); });
      var cand = realCandidates();
      if (cand.length >= 2) {
        var opt = function (sel) {
          return cand.map(function (d) {
            return '<option value="' + d.document_id + '">' + esc(d.filename.slice(0, 44)) +
              '（' + d.clauses.length + ' 条' +
              (d.looks_like === 'template' ? ' · 像模板' : d.looks_like === 'signed_contract' ? ' · 像已签合同' : '') +
              '）</option>';
          }).join('');
        };
        var guessOld = cand.filter(function (d) { return d.looks_like !== 'template'; })[0] || cand[0];
        var guessNew = cand.filter(function (d) { return d.looks_like === 'template'; })[0] ||
                       cand.filter(function (d) { return d !== guessOld; })[0];
        h += '<div class="real-run"><div class="rr-t">用这些真实文件跑比对</div>' +
          '<div class="rr-d">已解析出条款的 DOCX 有 ' + cand.length + ' 份。选一份上年度已签合同、' +
          '一份本年度标准模板 —— 系统按<b>标题相似度</b>匹配条款（真实合同没有条款 ID），' +
          '并把模板自己写明的条件性条款变成待你回答的问题。</div>' +
          '<div class="btn-row" style="margin-top:8px">' +
          '<label class="note-sm">上年度合同 <select id="rrOld">' + opt() + '</select></label>' +
          '<label class="note-sm">本年度模板 <select id="rrNew">' + opt() + '</select></label>' +
          '<button class="btn primary sm" data-act="run-real">▶ 跑真实比对</button></div></div>';
        setTimeout(function () {
          if ($('rrOld') && guessOld) $('rrOld').value = guessOld.document_id;
          if ($('rrNew') && guessNew) $('rrNew').value = guessNew.document_id;
        }, 0);
      }
      h += '<div class="btn-row" style="margin-top:4px">' +
        '<label class="btn sm">追加本地文件…<input type="file" id="fileInput" multiple style="display:none"></label>' +
        '<span class="note-sm">文件哈希用于核对输入版本，确保分析结果可回溯到具体文件。</span></div>';
    }
    h += '</div></div>';

    /* 分析 */
    if (S.docsLoaded && !S.analyzed) {
      h += '<div class="card"><div class="card-h"><h3>自动识别中</h3>' +
        '<span class="sub">Agent 编排层 · ' + D.RULES.length + ' 条规则 · ' + D.CLAUSES.length + ' 条条款库</span></div><div class="card-b">';
      h += '<div class="pipe" id="pipeBox">' + PIPE_STAGES.map(function (p, i) {
        var cls = S.pipeStage > i ? 'done' : (S.pipeStage === i ? 'run' : 'wait');
        var st = S.pipeStage > i ? '✓' : (S.pipeStage === i ? '<span class="spin"></span>' : '○');
        return '<div class="pipe-row ' + cls + '"><span class="st">' + st + '</span><span>' + esc(p.t) +
          '</span><span class="dur">' + (S.pipeStage >= i ? esc(p.note) : '') + '</span></div>';
      }).join('') + '</div>';
      if (S.modelPhase) {
        h += '<div class="pipe-row run" style="margin-top:6px"><span class="st"><span class="spin"></span></span>' +
          '<span>模型调用中（字段提取 / 语义分类 / 解释 / 双语比对）</span>' +
          '<span class="dur">失败将自动回退预置结果</span></div>';
      }
      if (!S.analyzing) {
        h += '<div class="btn-row" style="margin-top:12px">' +
          '<button class="btn primary lg" data-act="run-analysis">开始分析</button>' +
          '<span class="note-sm">' + (modelOn()
            ? '已接入模型 ' + esc(modelInfo().model) + '：字段提取与语义分类将实时调用模型，失败自动回退预置结果。'
            : '演示环境：结构差异与规则求值实时计算，字段提取与语义分类使用预置分析结果。') + '</span></div>';
      }
      h += '</div></div>';
    }

    /* 提取结果 */
    if (S.analyzed) {
      var groups = [
        { k: 'client', n: '客户信息', ic: '🏢' },
        { k: 'project', n: '项目信息', ic: '📋' },
        { k: 'special', n: '特殊情形', ic: '⚠︎' }
      ];
      var askCount = 0, queueCount = 0;
      D.FACTS.forEach(function (f) {
        var st = E.classifyFact(f);
        if (st.ask && !S.factConfirms[f.fact_id]) askCount++;
        else if (st.route === 'suggest_require_confirm') queueCount++;
      });
      var autoCount = D.FACTS.length - askCount - queueCount;
      h += '<div class="card"><div class="card-h"><h3>识别结果 · 提取字段（' + D.FACTS.length + ' 项）</h3>' +
        '<span class="pill ok">已自动预填 ' + autoCount + ' 项</span>' +
        '<span class="pill ' + (askCount ? 'warn' : 'ok') + '">需追问 ' + askCount + ' 项</span>' +
        '<span class="pill info">进入变更确认队列 ' + queueCount + ' 项</span>' +
        '<div class="spacer"></div><span class="sub">每项均显示来源文件与段落、置信度，可人工更正</span></div><div class="card-b">';
      groups.forEach(function (g) {
        h += '<div class="fact-group-h">' + g.ic + ' ' + g.n + '</div>';
        h += '<table class="tbl"><tr><th style="width:22%">字段</th><th style="width:24%">上年度合同</th>' +
          '<th style="width:28%">本年度提取结果</th><th style="width:12%">置信度</th><th style="width:14%">来源 / 操作</th></tr>';
        D.FACTS.filter(function (f) { return f.group === g.k; }).forEach(function (f) {
          h += factRow(f);
        });
        h += '</table>';
      });
      h += '</div></div>';
    }
    return h;
  }

  function docRow(d) {
    var ext = (d.filename.split('.').pop() || '').toLowerCase();
    var cls = ext === 'xlsx' ? 'xlsx' : (ext === 'pdf' ? 'pdf' : '');
    var fail = d.parse_status !== 'parsed';
    return '<div class="doc' + (fail ? ' parse-fail' : '') + '">' +
      '<div class="icon ' + cls + '">' + esc(ext.toUpperCase()) + '</div>' +
      '<div style="min-width:0"><div class="fn">' + esc(d.filename) + '</div>' +
      '<div class="meta"><span class="pill ' + (d.required ? 'info' : 'neutral') + '">' + esc(d.document_type_cn) + '</span> ' +
      (d.required ? '<span class="pill neutral">必传</span> ' : '<span class="pill neutral">选传</span> ') +
      '<span class="pill ' + (fail ? 'high' : 'ok') + '">' + (fail ? '✕ 解析失败' : '✓ 解析成功') + '</span> ' +
      (d.real_parse ? '<span class="pill info">真实解析</span> ' : '') +
      (d.looks_like === 'template' ? '<span class="pill ai">识别为标准模板</span> '
        : d.looks_like === 'signed_contract' ? '<span class="pill neutral">识别为已签合同</span> ' : '') +
      '<br>' +
      '版本：' + esc(d.version) + '　·　' + (d.pages ? d.pages + ' 页　·　' : '') +
      '哈希 <span class="mono">' + esc(d.hash) + '</span>　·　载入 ' + esc(d.upload_time) + '<br>' +
      esc(d.parse_note) +
      (d.clauses && d.clauses.length
        ? '<details class="parsed-detail"><summary>查看切出的 ' + d.clauses.length + ' 条条款</summary>' +
          d.clauses.slice(0, 40).map(function (c) {
            return '<div class="pc"><b>' + esc(c.title.slice(0, 40)) + '</b>' +
              '<span>' + esc(c.text.slice(0, 150)) + (c.text.length > 150 ? '…' : '') + '</span></div>';
          }).join('') +
          (d.clauses.length > 40 ? '<div class="note-sm">…另有 ' + (d.clauses.length - 40) + ' 条</div>' : '') +
          '</details>'
        : '') +
      (d.guidance && d.guidance.filter(function (g) { return g.conditional; }).length
        ? '<details class="parsed-detail"><summary>模板注明的条件性条款规则 ' +
          d.guidance.filter(function (g) { return g.conditional; }).length + ' 条' +
          '（什么情况下要加什么条款）</summary>' +
          d.guidance.filter(function (g) { return g.conditional; }).slice(0, 20).map(function (g) {
            return '<div class="pc"><span>' + esc(g.text.slice(0, 220)) + '</span></div>';
          }).join('') + '</details>'
        : '') +
      '</div></div>' +
      '<div class="doc-actions">' +
      (fail ? '' : '<button class="btn sm" data-act="doc-view" data-id="' + d.document_id + '">查看解析结果</button>') +
      '</div></div>';
  }

  function factRow(f) {
    var st = E.classifyFact(f);
    var edited = Object.prototype.hasOwnProperty.call(S.factEdits, f.fact_id);
    var cur = edited ? S.factEdits[f.fact_id] : (f.current ? f.current.value : null);
    var confirmed = !!S.factConfirms[f.fact_id];
    var valHtml;
    if (cur === null || cur === undefined || cur === '') {
      valHtml = '<span class="val-missing">未提供（资料缺失）</span>';
    } else {
      valHtml = '<span class="val-new">' + esc(cur) + '</span>';
    }
    var badges = '';
    if (st.conflict) badges += ' <span class="pill high">✕ 资料冲突 · 不选边</span>';
    else if (st.missing) badges += ' <span class="pill high">? 需追问</span>';
    else if (st.changed) badges += ' <span class="pill info">↻ 与上年度不同</span>';
    if (edited) badges += ' <span class="pill ai">✎ 人工更正</span>';
    if (confirmed) badges += ' <span class="pill ok">✓ 已确认</span>';
    if (f.current && f.current.deterministic) badges += ' <span class="pill info">⚙ 确定性字段</span>';
    if (modelOn() || (f.current && f.current.provenance === 'model')) {
      badges += provTag(f.current && f.current.provenance === 'model' ? 'model' : 'preset');
    }

    var conf = f.current ? f.current.confidence : 0;
    return '<tr><td><b>' + esc(f.label_cn) + '</b><div class="note-sm mono">' + esc(f.field_name) + '</div></td>' +
      '<td><span class="' + (st.changed ? 'val-old' : 'note-sm') + '">' +
      esc(f.prior ? f.prior.value : '—') + '</span></td>' +
      '<td>' + valHtml + badges + '</td>' +
      '<td>' + confBar(conf) + '<div class="note-sm">' + routeLabel(st.route) + '</div></td>' +
      '<td><button class="src-btn" data-act="evidence" data-kind="fact" data-id="' + f.fact_id + '">查看依据 ›</button><br>' +
      '<button class="src-btn" data-act="fact-edit" data-id="' + f.fact_id + '">编辑 ›</button></td></tr>';
  }

  function routeLabel(r) {
    return {
      autofill: '自动预填', ask: '主动追问', confirm_with_source: '需确认来源',
      suggest_require_confirm: '需人工确认', conflict_escalate: '列出冲突并升级'
    }[r] || r;
  }

  /* ======================================================== 工作台 */
  function viewWorkbench() {
    var t = task();
    var rs = E.riskSummary(analysis.changes, S.decisions);
    var td = analysis.templateDiff;
    var h = '';
    h += stageHead('workbench', esc(t.engagement_year) + ' 年度 ' + esc(t.client_short) + '客户合同更新',
      '逐项核对识别结果 · 负责人 ' + t.owner + ' · 复核人 ' + t.reviewer,
      '<div style="min-width:230px"><div class="note-sm" style="display:flex;justify-content:space-between">' +
      '<span>处理进度</span><b>' + rs.progress + '%</b></div>' +
      '<div class="pbar' + (rs.progress === 100 ? ' ok' : '') + '"><i style="width:' + rs.progress + '%"></i></div>' +
      '<div class="note-sm">已处理 ' + rs.done + ' / ' + rs.total + ' 项变更</div></div>');

    h += '<div class="split"><div class="stack">';

    /* 任务步骤 */
    // 与侧栏、页头共用 STAGES，不再另起一套步骤名
    h += '<div class="card"><div class="card-h"><h3>任务进度</h3>' +
      '<span class="sub">共 ' + STAGE_TOTAL + ' 步</span></div><div class="card-b tight" style="padding:8px">';
    var NOTE = {
      docs: S.analyzed ? D.FACTS.length + ' 项字段' : '待载入',
      workbench: S.analyzed ? '可核对' : '待识别',
      changes: rs.done + ' / ' + rs.total,
      preview: rs.highPending ? '门禁未开' : (S.exports.length ? '已导出' : '可预览'),
      audit: S.audit.length + ' 条'
    };
    STAGES.forEach(function (g) {
      var done = stageDone(g), cur = !done && S.view === g.view;
      var ic = done ? '✓' : (cur ? '●' : '○');
      h += '<div class="pipe-row ' + (done ? 'done' : (cur ? 'run' : 'wait')) + '">' +
        '<span class="st">' + ic + '</span><span>' + g.n + '. ' + esc(g.label) + '</span>' +
        '<span class="dur">' + esc(NOTE[g.view]) + '</span></div>';
    });
    h += '</div></div>';

    /* 风险概览 */
    h += '<div class="card"><div class="card-h"><h3>风险概览</h3></div><div class="card-b">' +
      '<div class="metrics" style="flex-direction:column">' +
      metric('高风险 · 必须确认', rs.highDone + ' / ' + rs.high, '', rs.highPending ? 'high' : 'ok') +
      metric('中风险 · 建议复核', rs.mediumDone + ' / ' + rs.medium, '', 'medium') +
      metric('低风险 · 仍需过目', rs.lowDone + ' / ' + rs.low, '', 'low') +
      '</div>' +
      (rs.escalated ? '<div class="escalated-note">⬆ 有 ' + rs.escalated + ' 项已升级，等待经理 / 合伙人裁定。</div>' : '') +
      '<div class="btn-row" style="margin-top:12px"><button class="btn primary" data-act="nav" data-view="changes">逐项确认 →</button>' +
      '<button class="btn" data-act="nav" data-view="changes">查看全部变更</button></div></div></div>';

    /* 版本信息 */
    h += '<div class="card"><div class="card-h"><h3>本次使用的版本</h3></div><div class="card-b">' +
      '<dl class="kv"><dt>标准模板</dt><dd>' + esc(D.META.templateVersionUsed) + '</dd>' +
      '<dt>规则库</dt><dd>' + esc(D.META.ruleSetVersion) + '（触发 ' + analysis.ruleResult.fired.length + ' / ' + D.RULES.length + '）</dd>' +
      '<dt>条款库</dt><dd>' + esc(D.META.clauseLibVersion) + '</dd>' +
      '<dt>分析时间</dt><dd>' + esc(analysis.computedAt) + '</dd>' +
      '<dt>模型端点</dt><dd>' + (modelOn()
        ? '<span class="pill ok">● 已接入 ' + esc(modelInfo().model) + '</span>'
        : esc(D.META.modelEndpoint)) + '</dd></dl></div></div>';

    h += '</div><div class="stack">';

    /* 已自动完成 */
    /* 逐项复核（主模式）——
       事务所反馈：真实流程里通常没有「今年的客户信息表」，每年基本依照去年
       信息更新。所以主模式是「摘出去年的值 + 标出哪些今年可能变 + 人逐项判断」，
       而不是先要一份今年的资料再比差异。痛点正是「可能变化的信息容易被忽视」。 */
    var rq = E.reviewQueue(D.FACTS, S.reviewDecisions || {});
    var rqs = E.reviewSummary(rq);
    h += '<div class="card"><div class="card-h"><h3>逐项复核去年的信息</h3>' +
      '<span class="pill ' + (rqs.reviewGateOpen ? 'ok' : 'high') + '">易变项 ' +
      (rqs.highVolTotal - rqs.highVolPending) + ' / ' + rqs.highVolTotal + ' 已复核</span>' +
      '<span class="pill neutral">沿用 ' + rqs.unchanged + ' · 有变化 ' + rqs.changed +
      ' · 待复核 ' + rqs.pending + '</span>' +
      '<div class="spacer"></div><span class="sub">按易变程度排序，最容易被忽视的排在最前</span>' +
      '</div><div class="card-b">';
    h += '<div class="box-lite">这里<b>不需要你先准备一份今年的客户信息表</b>。' +
      '系统把去年合同里的信息逐项摘出来，并标出<b>哪些字段今年很可能变</b> —— ' +
      '你只需要对每一项回答「跟去年一样」还是「今年变了」。' +
      '易变程度高的字段全部复核完之前，这一步不算完成。</div>';
    h += '<table class="tbl"><tr><th style="width:15%">字段</th><th style="width:11%">今年可能变吗</th>' +
      '<th>去年合同里的值</th><th style="width:23%">你的判断</th></tr>';
    rq.forEach(function (q) {
      var vcls = q.volatility === 'high' ? 'high' : (q.volatility === 'medium' ? 'medium' : 'low');
      var done = q.decision !== null;
      h += '<tr' + (done ? ' class="rq-done"' : '') + '>' +
        '<td><b>' + esc(q.label_cn) + '</b><div class="note-sm mono">' + esc(q.field_name) + '</div></td>' +
        '<td><span class="pill ' + vcls + '">' + esc(q.volatility_label) + '</span>' +
        '<div class="note-sm" style="margin-top:3px">' + esc(q.volatility_why) + '</div></td>' +
        '<td>' + (q.prior_value === null
          ? '<span class="note-sm">去年合同未约定</span>'
          : '<span class="val-old">' + esc(String(q.prior_value)) + '</span>') +
        (q.prior_source ? '<div class="note-sm">来源：' + esc(q.prior_source.document_id) +
          ' · ' + esc(q.prior_source.section) + '</div>' : '') + '</td>' +
        '<td>';
      if (q.decision === 'unchanged') {
        h += '<span class="pill ok">✓ 沿用去年</span>' +
          '<button class="btn sm" data-act="rq-undo" data-id="' + q.fact_id + '">撤销</button>';
      } else if (q.decision === 'changed') {
        h += '<span class="pill warn">今年有变化</span>' +
          '<div class="note-sm">新值：' + esc(String(q.new_value || '（待填写）')) + '</div>' +
          '<button class="btn sm" data-act="rq-undo" data-id="' + q.fact_id + '">撤销</button>';
      } else {
        h += '<button class="btn ok sm" data-act="rq-same" data-id="' + q.fact_id + '">跟去年一样</button> ' +
          '<button class="btn sm" data-act="rq-changed" data-id="' + q.fact_id + '">今年变了…</button>';
      }
      h += '</td></tr>';
    });
    h += '</table></div></div>';

    h += '<div class="card"><div class="card-h"><h3>Agent 已自动完成</h3>' +
      '<span class="pill ok">无需你参与</span></div><div class="card-b">' +
      '<table class="tbl"><tr><th>工作项</th><th>结果</th><th>由谁负责</th></tr>' +
      row2('提取客户与项目信息', D.FACTS.length + ' 个字段，其中 ' +
        D.FACTS.filter(function (f) { return !E.classifyFact(f).ask; }).length + ' 项无需追问', 'AI 提取 + 规则校验') +
      row2('文件来源定位', '每个字段至少关联 1 处来源文件与段落引用', 'AI 提取') +
      row2('新旧模板结构差异', '新增 ' + td.added.length + ' 条 · 删除 ' + td.removed.length + ' 条 · 修改 ' +
        td.modified.length + ' 条 · 未变 ' + td.unchanged.length + ' 条 · 编号顺延 ' + td.renumbered.length + ' 处',
        '程序实时计算') +
      row2('格式层差异', analysis.formatDiff.length + ' 处（版式 / 页脚 / 附件命名）', '程序实时计算') +
      row2('普通字段更新', '年度、合同编号、联系人等确定性字段已按规则生成', '规则引擎') +
      row2('规则求值', analysis.ruleResult.fired.length + ' 条规则触发：' +
        analysis.ruleResult.fired.slice(0, 6).join('、') + (analysis.ruleResult.fired.length > 6 ? ' 等' : ''), '规则引擎') +
      '</table>' +
      '<div class="computed">它没有让你重填已经存在的信息 —— ' + D.FACTS.length + ' 个字段中 ' +
      D.FACTS.filter(function (f) { return !E.classifyFact(f).ask; }).length +
      ' 项无需追问，只把真正缺失、冲突或置信度不足的内容作为问题交给你；高风险变化统一进入下方变更确认队列。</div>' +
      '</div></div>';

    /* 追问 §7.1 步骤4 */
    var asks = D.FACTS.filter(function (f) {
      var st = E.classifyFact(f);
      return st.ask && !S.factConfirms[f.fact_id];
    });
    h += '<div class="card"><div class="card-h"><h3>Agent 的追问（' + asks.length + ' 项）</h3>' +
      '<span class="sub">仅询问未找到 / 冲突 / 低置信度且影响条款的信息；高置信度字段不重复询问</span></div><div class="card-b">';
    if (!asks.length) {
      h += '<div class="empty"><span class="ic">✓</span>全部追问已处理。</div>';
    } else {
      asks.forEach(function (f) {
        var st = E.classifyFact(f);
        h += '<div class="qa"><div class="q">' + (st.conflict ? '🔴 ' : (st.missing ? '🟡 ' : '🟡 ')) +
          esc(f.label_cn) + '</div><div class="why">' +
          (st.conflict ? '资料冲突：' + esc(f.conflict.summary)
            : (st.missing ? '本年度资料未提供该信息，且影响条款选择。'
              : '置信度 ' + (f.current.confidence * 100).toFixed(0) + '%，低于自动写入阈值，请核对来源后确认。')) +
          '</div>';
        if (st.conflict) {
          h += '<div class="btn-row" style="margin-top:9px">' +
            '<button class="btn primary sm" data-act="goto-change" data-id="CH-US-CONFLICT">前往处理冲突项 →</button>' +
            '<button class="btn sm" data-act="evidence" data-kind="fact" data-id="' + f.fact_id + '">查看两份资料原文</button></div>';
        } else {
          h += '<div class="note-sm" style="margin-top:6px">当前提取值：<b>' +
            esc(f.current.value === null ? '（空）' : f.current.value) + '</b>　' +
            (f.current.derivation ? '推导依据：' + esc(f.current.derivation) : '') + '</div>' +
            '<div class="btn-row" style="margin-top:9px">' +
            '<button class="btn ok sm" data-act="fact-confirm" data-id="' + f.fact_id + '">确认该取值</button>' +
            '<button class="btn sm" data-act="fact-edit" data-id="' + f.fact_id + '">更正</button>' +
            '<button class="btn sm" data-act="evidence" data-kind="fact" data-id="' + f.fact_id + '">查看依据</button></div>';
        }
        h += '</div>';
      });
    }
    h += '</div></div>';

    /* 需要你确认 */
    h += '<div class="card"><div class="card-h"><h3>需要你确认</h3>' +
      '<span class="pill high">高风险 ' + rs.highPending + '</span>' +
      '<span class="pill medium">中风险 ' + (rs.medium - rs.mediumDone) + '</span>' +
      '<span class="pill low">低风险 ' + (rs.low - rs.lowDone) + '</span></div><div class="card-b">';
    var pending = analysis.changes.filter(function (c) {
      var d = S.decisions[c.change_id];
      return !d || !E.isDecided(d.status);
    }).slice(0, 8);
    if (!pending.length) h += '<div class="empty"><span class="ic">✓</span>全部变更均已处理。</div>';
    pending.forEach(function (c) {
      var icon = c.risk_level === 'high' ? '🔴' : (c.risk_level === 'medium' ? '🟡' : '⚪');
      h += '<div class="pipe-row" style="cursor:pointer;padding:9px 10px;border-bottom:1px solid var(--line-2)" ' +
        'data-act="goto-change" data-id="' + c.change_id + '">' +
        '<span class="st">' + icon + '</span><span style="flex:1"><b>' + esc(c.title) + '</b>' +
        '<div class="note-sm">' + esc(c.change_type_cn) + ' · 规则 ' + esc(c.source_rule) +
        (c.is_conflict ? ' · <b style="color:var(--danger)">资料冲突，系统不选边</b>' : '') + '</div></span>' +
        '<span class="dur">处理 ›</span></div>';
    });
    h += '<div class="btn-row" style="margin-top:12px">' +
      '<button class="btn primary" data-act="nav" data-view="changes">逐项确认</button>' +
      '<button class="btn" data-act="filter-goto" data-f="high">只看高风险</button></div></div></div>';

    h += '</div></div>';
    return h;
  }

  function row2(a, b, c) {
    return '<tr><td><b>' + esc(a) + '</b></td><td>' + esc(b) + '</td><td><span class="pill ' +
      (c === '规则引擎' || c === '程序实时计算' ? 'info' : 'ai') + '">' + esc(c) + '</span></td></tr>';
  }

  /* ======================================================== 待确认事项 */
  function viewChanges() {
    var rs = E.riskSummary(analysis.changes, S.decisions);
    var h = '';
    h += stageHead('changes', null,
      '共 ' + rs.total + ' 项变更，按风险等级排序 —— 高风险 ' + rs.high +
      ' 项必须逐一确认，已确认 ' + rs.highDone + ' 项');

    /* 门禁 */
    h += '<div class="gate ' + (rs.gateOpen ? 'open' : 'blocked') + '"><div class="gate-t">' +
      (rs.gateOpen ? '✓ 人工确认门禁已通过' : '⛔ 人工确认门禁未通过') + '</div>' +
      '<div class="gate-d">高风险项 ' + rs.highDone + ' / ' + rs.high + ' 已由授权人员确认' +
      (rs.escalated ? '，其中 ' + rs.escalated + ' 项已升级待裁定' : '') + '。' +
      (rs.gateOpen ? '现在可以生成预览并导出带水印的内部初稿。'
        : '未确认全部高风险项前，任务不能标记为已完成，也不能导出无水印版本。') + '</div>' +
      '<div class="pbar' + (rs.gateOpen ? ' ok' : ' warn') + '" style="margin-top:9px">' +
      '<i style="width:' + (rs.high ? Math.round(rs.highDone / rs.high * 100) : 0) + '%"></i></div></div>';

    /* 批量操作 */
    h += '<div class="card" style="margin-top:14px"><div class="card-b tight" style="padding:12px 14px">' +
      '<div class="filters">' +
      [['all', '全部 ' + rs.total], ['high', '只看高风险 ' + rs.high], ['medium', '中风险 ' + rs.medium],
        ['low', '低风险 ' + rs.low], ['pending', '未处理 ' + (rs.total - rs.done)], ['done', '已处理 ' + rs.done]]
        .map(function (f) {
          return '<button class="fbtn' + (S.changeFilter === f[0] ? ' on' : '') + '" data-act="filter" data-f="' + f[0] + '">' + f[1] + '</button>';
        }).join('') +
      '<div class="spacer"></div>' +
      '<button class="btn ok sm" data-act="accept-low">✓ 接受全部低风险（' + (rs.low - rs.lowDone) + '）</button>' +
      '<button class="btn sm" data-act="accept-medium">接受全部中风险（' + (rs.medium - rs.mediumDone) + '）</button>' +
      '</div></div></div>';

    /* 分组 */
    var CATS = [
      { k: 'template', n: 'A · 标准模板版本变化', sub: '2025 v3.2 ↔ 2026 v4.0 · 模板不定时更新，随时可重比' },
      { k: 'fact', n: 'B · 客户事实变化', sub: '上年度合同 ↔ 今年客户资料' },
      { k: 'clause', n: 'C · 条款适用性变化', sub: '按客户事实与规则判断' }
    ];
    var list = analysis.changes.filter(function (c) {
      var d = S.decisions[c.change_id] || { status: 'pending' };
      if (S.changeFilter === 'all') return true;
      if (S.changeFilter === 'pending') return !E.isDecided(d.status);
      if (S.changeFilter === 'done') return E.isDecided(d.status);
      return c.risk_level === S.changeFilter;
    });

    if (!list.length) h += '<div class="card"><div class="empty"><span class="ic">☑</span>当前筛选下没有变更项。</div></div>';

    CATS.forEach(function (cat) {
      var items = list.filter(function (c) { return c.category === cat.k; });
      if (!items.length) return;
      h += '<div class="card" style="margin-top:14px"><div class="card-h"><h3>' + cat.n + '</h3>' +
        '<span class="sub">' + cat.sub + ' · ' + items.length + ' 项</span></div><div class="card-b">';
      items.forEach(function (c) { h += changeCard(c); });
      h += '</div></div>';
    });
    return h;
  }

  var DIFF_CLASS_LABEL = {
    format_only: '纯格式变化', wording_only: '文字优化，不改变含义', substantive: '实质性权利义务变化',
    added: '新增条款', removed: '删除条款', undetermined: '无法确定，需人工判断',
    deterministic: '确定性字段替换'
  };

  function changeCard(c) {
    var d = S.decisions[c.change_id] || { status: 'pending' };
    var decided = E.isDecided(d.status);
    var open = S.openChange === c.change_id;
    var need = E.requiredRoleFor(c);
    var h = '';
    h += '<div class="chg ' + c.risk_level + (decided ? ' resolved' : '') + '" id="chg-' + c.change_id + '">';
    h += '<div class="chg-h" data-act="chg-toggle" data-id="' + c.change_id + '">' +
      '<span style="font-size:15px;line-height:1.4">' + (decided ? '✅' : (c.risk_level === 'high' ? '🔴' : c.risk_level === 'medium' ? '🟡' : '⚪')) + '</span>' +
      '<span class="chg-t">' + esc(c.title) +
      
      '<div class="chg-tags">' + riskPill(c.risk_level) +
      '<span class="pill neutral">' + esc(DIFF_CLASS_LABEL[c.diff_class] || c.diff_class) +
      (c.provenance_class === 'model' ? ' ◆' : '') + '</span>' +
      '<span class="pill info">规则 ' + esc(c.source_rule) + '</span>' +
      '<span class="pill neutral">条款 ' + esc(c.clause_id) + '</span>' +
      '<span class="pill ' + (c.confidence >= 0.85 ? 'ok' : c.confidence >= 0.7 ? 'warn' : 'high') + '">置信度 ' +
      (c.confidence * 100).toFixed(0) + '%</span>' +
      (decided ? '<span class="pill ok">' + esc(E.DECISION_LABEL[d.status]) + (d.resolution ? ' · 选项 ' + d.resolution : '') + '</span>' : '') +
      (d.status === 'escalated' ? '<span class="pill warn">⬆ 已升级给经理</span>' : '') +
      (need ? '<span class="pill tier" title="这一项在你们的授权体系里该由谁签字批准。本演示不做系统内的提交与等待，只把该谁批记录下来">该谁批：' +
        (need === 'partner' ? '合伙人 / 风险审批人' : '经理及以上') + '</span>' : '') +
      '</div></span><span class="note-sm">' + (open ? '收起 ▲' : '展开 ▼') + '</span></div>';

    if (open) {
      h += '<div class="chg-b">';
      h += '<div class="chg-meta">' +
        '<div><b>变化类型：</b>' + esc(c.change_type_cn) + '　<b>比较类别：</b>' +
        ({ template: 'A 标准模板版本变化', fact: 'B 客户事实变化', clause: 'C 条款适用性变化' }[c.category]) + '</div>' +
        '<div><b>触发原因：</b>' + esc(c.reason) + '</div>' +
        '<div><b>来源：</b>' + esc(c.source) + '</div>' +
        (c.impact ? '' : '') +
        '<div><b>是否需人工审批：</b>' + (c.risk_level === 'high'
          ? '是 — 要求层级：' + (c.approver === 'partner' ? '合伙人 / 风险审批人' : '经理及以上')
          : '否 — 可由操作者直接处理') + '</div>' +
        '</div>';

      /* 对照 */
      h += '<div class="diff"><div class="diff-col">' +
        '<div class="diff-h old">◀ 原文（上年度合同 / 旧模板）</div>' +
        '<div class="diff-txt old">' + diffPane(c, 'old') +
        (c.old_text_en ? '<div class="diff-en">EN: ' + esc(c.old_text_en) + '</div>' : '') + '</div></div>' +
        '<div class="diff-col"><div class="diff-h new">▶ 建议文本（2026 标准模板 / Agent 建议）</div>' +
        '<div class="diff-txt">' +
        (d.status === 'edited' && d.edited ? esc(d.edited.proposed_text) : diffPane(c, 'new')) +
        (c.proposed_text_en ? '<div class="diff-en">EN: ' + esc(d.status === 'edited' && d.edited && d.edited.proposed_text_en ? d.edited.proposed_text_en : c.proposed_text_en) + '</div>' : '') +
        '</div></div></div>' +
        '<div class="legend" style="margin-top:7px"><span><ins>绿色底</ins> 新增文字</span>' +
        '<span><del>红色底</del> 删除文字</span><span>颜色之外同时以「新增 / 删除」文字与图标标注，不依赖颜色区分</span></div>';

      if (c.computed_note) h += '<div class="computed">⚙ 程序实时计算：' + esc(c.computed_note) + '</div>';
      if (c.impact) h += '<div class="impact">⚠︎ 影响：' + esc(c.impact) + '</div>';
      h += '<div class="agent-say"><span class="lbl">AGENT 解释（大白话）' +
        (c.provenance_explain === 'model' ? '　◆ 模型输出' : (modelOn() ? '　预置' : '')) +
        '</span>' + nl2br(c.agent_explanation) + '</div>';
      if (c.linked) h += '<div class="computed">🔗 联动项：' + c.linked.map(function (id) {
        return '<button class="src-btn" data-act="goto-change" data-id="' + id + '">' + esc(D.CHANGE_TEMPLATES[id].title) + ' ›</button>';
      }).join('　') + '</div>';

      /* 冲突项：A/B/C */
      if (c.is_conflict) {
        var f = null;
        D.FACTS.forEach(function (x) { if (x.fact_id === c.fact_id) f = x; });
        h += '<div class="conflict-opts">';
        h += '<div class="note-sm" style="font-weight:650;color:var(--ink)">系统不选边。请选择结论：</div>';
        f.conflict.options.forEach(function (o) {
          h += '<button class="copt' + (d.resolution === o.key ? ' sel' : '') + '" data-act="conflict" data-id="' +
            c.change_id + '" data-key="' + o.key + '">' +
            '<div class="k">' + o.key + '. ' + esc(o.label) + '</div>' +
            '<div class="e">' + esc(o.effect) + '</div></button>';
        });
        h += '</div>';
      }

      /* 决策记录 */
      if (decided) {
        h += '<div class="decided">✓ ' + esc(E.DECISION_LABEL[d.status]) +
          (d.resolution ? '（选项 ' + esc(d.resolution) + '）' : '') +
          '　处理人：' + esc(d.actor) + '　时间：' + esc(d.at) +
          '<button class="btn sm" data-act="undo" data-id="' + c.change_id + '">撤销此决定</button></div>';
      }
      if (d.status === 'escalated') {
        h += '<div class="escalated-note">⬆ 已升级：' + esc(d.actor) + ' 于 ' + esc(d.at) +
          ' 标记为「需要上级判断」。任务在此项裁定前不能标记为已完成 —— 升级是一条真实的出口，不是把问题算作已解决。</div>';
      }
      if (d.note) h += '<div class="chg-meta"><div><b>复核备注：</b>' + nl2br(d.note) + '</div></div>';

      /* 审批层级说明（标注，非拦截）——
         多用户审批流是 PRD F18（P1）/ F19（P2），不在本次范围内。 */
      if (need) {
        h += '<div class="tier-note">真实部署中此项须<b>' + (need === 'partner' ? '合伙人 / 风险审批人' : '经理及以上') +
          '</b>签字批准。本演示由一个人从头做到尾（实际工作里通常也是这样），所以这里不做「提交给上级、等对方在系统里点同意」这套流程；但「这一项该谁批」会和你的确认动作一起写进审计记录，交给谁批仍然清楚。</div>';
      }

      /* 编辑区 */
      if (S.editing === c.change_id) {
        h += '<div class="note-box"><label class="note-sm" style="font-weight:650" for="editCn">编辑建议文本（中文）</label>' +
          '<textarea id="editCn" style="min-height:110px">' + esc(d.edited && d.edited.proposed_text ? d.edited.proposed_text : c.proposed_text) + '</textarea>' +
          '<label class="note-sm" style="font-weight:650" for="editEn">编辑建议文本（英文）</label>' +
          '<textarea id="editEn" style="min-height:90px">' + esc(d.edited && d.edited.proposed_text_en ? d.edited.proposed_text_en : c.proposed_text_en) + '</textarea>' +
          '<div class="btn-row" style="margin-top:8px">' +
          '<button class="btn ok sm" data-act="edit-save" data-id="' + c.change_id + '">保存并接受</button>' +
          '<button class="btn sm" data-act="edit-cancel">取消</button>' +
          '<span class="note-sm">编辑内容将记入审计日志。条款文本只能来自已批准条款库或经人工确认的编辑。</span></div></div>';
      }

      /* 备注 */
      h += '<div class="note-box"><label class="note-sm" style="font-weight:650" for="note-' + c.change_id + '">复核备注</label>' +
        '<textarea id="note-' + c.change_id + '" placeholder="填写复核意见，将记入审计日志…">' + esc(d.note || '') + '</textarea>' +
        '<div class="btn-row" style="margin-top:6px"><button class="btn sm" data-act="note-save" data-id="' +
        c.change_id + '">保存备注</button></div></div>';

      /* 操作栏 */
      h += '<div class="decision-bar">';
      if (!c.is_conflict) {
        h += '<button class="btn ok" data-act="decide" data-id="' + c.change_id + '" data-status="accepted">✓ 接受建议</button>' +
          '<button class="btn" data-act="edit-open" data-id="' + c.change_id + '">✎ 编辑后接受</button>' +
          '<button class="btn danger" data-act="decide" data-id="' + c.change_id + '" data-status="rejected">✕ 拒绝建议</button>' +
          '<button class="btn" data-act="decide" data-id="' + c.change_id + '" data-status="kept_old">↩ 保留旧条款</button>';
      }
      h += '<button class="btn" data-act="decide" data-id="' + c.change_id + '" data-status="escalated">⬆ 升级给经理</button>' +
        '<div class="spacer"></div>' +
        '<button class="btn sm" data-act="evidence" data-kind="change" data-id="' + c.change_id + '">🔍 查看依据</button>' +
        '</div>';
      h += '</div>';
    }
    h += '</div>';
    return h;
  }

  /* ======================================================== 合同预览 / 导出 */
  function viewPreview() {
    var t = task();
    var contract = E.buildContract(analysis, t, D.FACTS, S.factEdits, S.decisions, S.fixes,
      global.TPReal.approvedTranslations(S.jaDrafts));
    var ck = E.consistencyCheck(contract, analysis, t, S.decisions, D.FACTS, S.factEdits);
    var rs = E.riskSummary(analysis.changes, S.decisions);
    var lang = S.previewLang;
    var h = '';

    h += stageHead('preview', null, '查看中英双语初稿与一致性检查，导出仅供内部复核的版本',
      '<div class="prev-tabs">' +
      [['cn', '中文'], ['en', '英文'], ['ja', '日文（附带译文）'], ['both', '中英双语']].map(function (l) {
        return '<button class="fbtn' + (lang === l[0] ? ' on' : '') + '" data-act="prev-lang" data-lang="' + l[0] + '">' + l[1] + '</button>';
      }).join('') + '</div>');

    /* 门禁 + 导出 */
    h += '<div class="gate ' + (rs.gateOpen ? 'open' : 'blocked') + '">' +
      '<div class="gate-t">' + (rs.gateOpen ? '✓ 可导出：全部高风险项已确认' : '⛔ 导出受限：仍有 ' + rs.highPending + ' 项高风险未确认') + '</div>' +
      '<div class="gate-d">' + (rs.gateOpen
        ? '所有 ' + rs.high + ' 项高风险变更均已由授权人员确认。导出件仍带「仅供内部复核」水印 —— 本产品不生成可直接发送客户的版本。'
        : '仍可预览，但不能标记为"已完成"、也不能导出无水印版本。请先在待确认事项中处理高风险项。') + '</div>' +
      '<div class="btn-row" style="margin-top:11px">' +
      '<button class="btn primary" data-act="export" data-kind="both"' + (rs.gateOpen ? '' : ' disabled') + '>⬇ 导出 DOCX（中英双语）</button>' +
      '<button class="btn" data-act="export" data-kind="cn"' + (rs.gateOpen ? '' : ' disabled') + '>⬇ 中文 DOCX</button>' +
      '<button class="btn" data-act="export" data-kind="en"' + (rs.gateOpen ? '' : ' disabled') + '>⬇ 英文 DOCX</button>' +
      '<button class="btn" data-act="export" data-kind="csv">⬇ 变更清单 CSV</button>' +
      '<button class="btn" data-act="export" data-kind="json">⬇ 审计记录 JSON</button>' +
      '<button class="btn" data-act="print">🖨 PDF 预览 / 打印</button>' +
      '<button class="btn ok" data-act="mark-done"' + (rs.gateOpen && ck.highFailed === 0 ? '' : ' disabled') +
      '>标记为初稿已完成</button></div>' +
      (S.exports.length ? '<div class="note-sm" style="margin-top:8px">已导出：' +
        S.exports.map(function (x) { return esc(x.name); }).join('、') + '</div>' : '') +
      '</div>';

    /* 一致性检查 */
    h += '<div class="card" style="margin-top:14px"><div class="card-h"><h3>一致性检查</h3>' +
      '<span class="pill ' + (ck.allPass ? 'ok' : 'warn') + '">通过 ' + ck.passed + ' / ' + ck.total + '</span>' +
      (ck.highFailed ? '<span class="pill high">' + ck.highFailed + ' 项高优先级需处理</span>' : '') +
      '<div class="spacer"></div><span class="sub">共 11 项检查，全部由确定性程序执行</span></div>' +
      '<div class="card-b" style="padding:0">';
    ck.results.forEach(function (r) {
      h += '<div class="ck ' + (r.ok ? '' : 'fail') + '"><span class="st">' + (r.ok ? '✅' : (r.severity === 'high' ? '🔴' : r.severity === 'medium' ? '🟡' : '⚪')) + '</span>' +
        '<div style="flex:1"><div class="n">' + esc(r.name) +
        (r.ok ? '' : ' <span class="pill ' + (r.severity === 'high' ? 'high' : r.severity === 'medium' ? 'medium' : 'low') + '">需处理</span>') +
        '</div><div class="d">' + esc(r.detail) +
        (!r.ok && r.fix_note ? '<div class="note-sm" style="margin-top:5px">' + esc(r.fix_note) + '</div>' : '') +
        '</div></div>' +
        (!r.ok && r.fixable
          ? '<div class="act">' +
            (r.fix_role ? '<span class="pill tier" title="这一项该由谁裁定。本演示不做系统内的提交与等待，只把该谁批记录下来">该谁批：' +
              (r.fix_role === 'partner' ? '合伙人 / 风险审批人' : '经理') + '</span>' : '') +
            '<button class="btn sm" data-act="fix" data-id="' + r.check_id + '">' + esc(r.fix_label || '程序性修正') + '</button></div>'
          : '') +
        '</div>';
    });
    h += '</div></div>';

    /* 变更摘要 */
    h += '<div class="card"><div class="card-h"><h3>变更摘要与待复核清单</h3>' +
      '<span class="sub">' + rs.total + ' 项变更 · 已处理 ' + rs.done + ' 项</span></div>' +
      '<div class="card-b" style="padding:0"><table class="tbl"><tr><th>变更项</th><th>类型</th><th>风险</th>' +
      '<th>触发规则</th><th>人工决定</th><th>处理人 / 时间</th></tr>';
    analysis.changes.forEach(function (c) {
      var d = S.decisions[c.change_id] || { status: 'pending' };
      h += '<tr><td>' + esc(c.title) + '</td><td>' + esc(c.change_type_cn) + '</td>' +
        '<td>' + riskPill(c.risk_level) + '</td><td class="mono">' + esc(c.source_rule) + '</td>' +
        '<td>' + (E.isDecided(d.status) ? '<span class="pill ok">' : '<span class="pill warn">') +
        esc(E.DECISION_LABEL[d.status]) + (d.resolution ? ' · ' + d.resolution : '') + '</span>' +
        (d.note ? '<div class="note-sm">备注：' + esc(d.note) + '</div>' : '') + '</td>' +
        '<td class="note-sm">' + esc(d.actor || '—') + '<br>' + esc(d.at || '—') + '</td></tr>';
    });
    h += '</table></div></div>';

    /* 机器补译：已批准的译文，以及每条的草稿 */
    // 只用于算「还缺几条」：正文里的译文由 buildContract 统一挂载
    var jaApproved = global.TPReal.approvedTranslations(S.jaDrafts);
    var jaDraftFor = function (cid) {
      var hit = null;
      (S.jaDrafts || []).forEach(function (x) { if (x.clause_id === cid) hit = x; });
      return hit;
    };
    var jaMissing = contract.sections.filter(function (x) {
      return !x.text_ja && !jaApproved[x.clause_id];
    });

    /* 合同正文 */
    h += '<div class="card"><div class="card-h"><h3>合同初稿</h3>' +
      '<div class="legend"><span><i style="background:var(--ok)"></i>新增</span>' +
      '<span><i style="background:var(--rule)"></i>修改</span>' +
      '<span><i style="background:var(--warn)"></i>保留旧条款</span>' +
      '<span><i style="background:#c3ccd8"></i>删除</span>' +
      '<span><i style="background:var(--danger)"></i>待确认（未获授权确认）</span></div></div>' +
      '<div class="card-b"><div class="prev-doc" id="printArea">' +
      '<div class="wm"><span>' +
      new Array(40).join(esc(D.META.watermarkEn) + '　' + esc(D.META.watermarkCn) + '<br>') +
      '</span></div>' +
      '<div class="prev-body">' +
      '<div class="prev-title">转让定价服务协议' +
      (lang !== 'cn' ? '<span class="en">Transfer Pricing Services Agreement</span>' : '') + '</div>' +
      '<div class="prev-sub">' + esc(t.client_name) + '　·　' + esc(t.engagement_year) + ' 年度　·　合同编号 ' +
      esc(contract.placeholders.contract_no) + '<br>' + esc(D.META.watermarkCn) + '　|　使用模板 ' +
      esc(D.META.templateVersionUsed) + '</div>';

    contract.sections.forEach(function (s) {
      var STL = { added: '新增条款', modified: '本年度修改', removed: '已删除', kept_old: '保留上年度条款', pending: '待确认', unchanged: '沿用标准条款' };
      h += '<div class="psec ' + s.status + '"><div class="psec-h">' +
        (s.no === '首部' || s.no === '附件一' ? esc(s.no) : '第 ' + esc(s.no) + ' 条') + '　' + esc(s.title_cn) +
        (lang !== 'cn' ? ' <span class="en">' + esc(s.title_en) + '</span>' : '') +
        ' <span class="pill ' + (s.status === 'pending' ? 'high' : s.status === 'added' ? 'ok' : s.status === 'modified' ? 'info' : 'neutral') + '">' +
        (STL[s.status] || s.status) + '</span>' +
        (s.xref_fixed ? ' <span class="pill info">交叉引用已修正</span>' : '') + '</div>';
      // 日文是附带非正式译文（中文为准），所以它有自己的视图，
      // 在中英双语视图里不混排 —— 免得让人误以为三语等效。
      if (lang === 'ja') {
        // 译文来自哪里只看 ja_provenance —— 装配层已经把已批准的补译挂上去了，
        // 这里再查一遍 approvedTranslations 就变成两个真相来源（先前写重了）
        var jd = jaDraftFor(s.clause_id);
        if (s.text_ja) {
          h += '<div class="psec-cn">' + nl2br(s.text_ja) + '</div>' +
            '<div class="psec-ja-note">' +
            (s.ja_provenance === 'model_approved'
              ? '🤖 模型补译 · 已经人批准 · 以中文为准 · 未经母语复核'
              : '附带非正式译文 · 以中文为准') + '</div>';
        } else {
          h += '<div class="psec-ja-missing">（本条未提供日文附带译文）' +
            (jd
              ? '　<span class="pill ' + (jd.approvable ? 'ai' : 'high') + '">' +
                (jd.approvable ? '模型已补译，待你批准（见页底）' : '模型补译被护栏拦下（见页底）') + '</span>'
              : '') + '</div>';
        }
      } else {
        if (lang !== 'en') h += '<div class="psec-cn">' + nl2br(s.text_cn) + '</div>';
        if (lang !== 'cn') h += '<div class="psec-en">' + nl2br(s.text_en) + '</div>';
      }
      h += '</div>';
    });
    h += '</div></div></div></div>';

    /* 机器补译日文：缺译的条款可交给模型，译文默认未批准 */
    if (lang === 'ja' && (jaMissing.length || (S.jaDrafts || []).length)) {
      var jds = S.jaDrafts || [];
      var jOk = jds.filter(function (x) { return x.state === 'approved'; }).length;
      var jBlk = jds.filter(function (x) { return x.approvable === false; }).length;
      h += '<div class="card"><div class="card-h"><h3>日文附带译文的补齐</h3>' +
        '<span class="pill ' + (jaMissing.length ? 'warn' : 'ok') + '">缺译 ' + jaMissing.length + ' 条</span>' +
        (jOk ? '<span class="pill ok">已批准补译 ' + jOk + '</span>' : '') +
        (jBlk ? '<span class="pill high">护栏拦下 ' + jBlk + '</span>' : '') +
        '<div class="spacer"></div>' +
        (jaMissing.length && modelOn()
          ? '<button class="btn primary sm" data-act="ja-translate">🤖 请模型补译这 ' +
            jaMissing.length + ' 条</button>'
          : jaMissing.length
            ? '<span class="note-sm">接入模型后可请它补译</span>' : '') +
        '</div><div class="card-b">' +
        '<div class="box-lite">日文是<b>附带非正式译文，以中文为准</b>。' +
        '机器补译默认<b>不算已覆盖</b> —— 未批准的译文不进正文、不计入语言覆盖率。' +
        '事务所反馈里明确提到「人工修改不同语言版本很容易发生漏改」，' +
        '所以每条译文都由程序把中文里的数字重新数一遍再跟译文比；' +
        '数字不一致、没有假名（等于照抄中文）、混入其他语种字符的，一律不给批准按钮。' +
        '<b>批准后仍标注「未经母语复核」。</b></div>';
      if (!jds.length) {
        h += '<div class="note-sm">尚未补译。缺译条款：' +
          esc(jaMissing.map(function (x) { return x.title_cn; }).join('、')) + '</div>';
      }
      jds.forEach(function (d) {
        var jHard = d.violations.filter(function (x) { return x.level === 'hard'; });
        h += '<div class="qa' + (d.state === 'approved' ? ' answered' : '') + '">' +
          '<div class="q"><span class="pill ai">🤖 模型补译</span> ' +
          '<span class="pill ' + (d.state === 'approved' ? 'ok' : d.state === 'rejected' ? 'neutral' : 'warn') + '">' +
          ({ draft: '草稿 · 不计入覆盖率', approved: '已批准 · 计入覆盖率', rejected: '已拒绝' }[d.state]) +
          '</span> <b>' + esc(d.title_cn) + '</b></div>' +
          '<div class="clause-3l" style="grid-template-columns:1fr 1fr">' +
          '<div><div class="l3-t">中文（为准）</div><div class="l3-b">' + esc(d.source_cn) + '</div></div>' +
          '<div><div class="l3-t">日本語（機械翻訳）</div><div class="l3-b">' + esc(d.text) + '</div></div>' +
          '</div>' +
          (d.numbers_checked.length
            ? '<div class="note-sm">模型自称已核对的数字：<code>' +
              esc(d.numbers_checked.join('</code> <code>')) + '</code>' +
              '（下面的结论由程序独立重数，不采信这一行）</div>'
            : '<div class="note-sm"><b>模型没有列出它核对过的数字。</b></div>') +
          (d.uncertain && d.uncertain !== '无'
            ? '<div class="why">模型自陈不确定：' + esc(d.uncertain) + '</div>' : '') +
          (d.violations.length
            ? '<div class="box-warn" style="margin-top:6px">' +
              d.violations.map(function (x) {
                return '<div>' + (x.level === 'hard' ? '⛔' : '⚠️') + ' <b>' + esc(x.guard) +
                  '</b>：' + esc(x.why) + '</div>';
              }).join('') + '</div>'
            : '<div class="note-sm" style="color:var(--ok)">✓ 程序核对通过：数字与中文一致、确为日文</div>') +
          '<div class="btn-row" style="margin-top:7px">' +
          (d.state === 'draft'
            ? (jHard.length
                ? '<span class="pill high">护栏阻断，不能批准</span>' +
                  '<button class="btn sm" data-act="ja-decide" data-id="' + d.clause_id + '" data-val="rejected">丢弃</button>'
                : '<button class="btn primary sm" data-act="ja-decide" data-id="' + d.clause_id + '" data-val="approved">批准，计入覆盖率</button>' +
                  '<button class="btn sm" data-act="ja-decide" data-id="' + d.clause_id + '" data-val="rejected">拒绝</button>')
            : '<button class="btn sm" data-act="ja-decide" data-id="' + d.clause_id + '" data-val="draft">撤销决定</button>' +
              (d.decided_by ? '<span class="note-sm">' + esc(d.decided_by) + ' · ' + esc(d.decided_at) + '</span>' : '')) +
          '</div></div>';
      });
      h += '</div></div>';
    }
    return h;
  }

  /* ======================================================== 审计记录 */
  function viewAudit() {
    var t = task();
    var h = '';
    h += stageHead('audit', null,
      '共 ' + S.audit.length + ' 条事件，记录每一次识别、建议与人工决定 · 任务 ' + t.task_id,
      '<button class="btn" data-act="export" data-kind="json">⬇ 导出审计记录 JSON</button>');

    h += '<div class="mode-note">下面每一条都记着：<b>谁</b>在<b>什么时候</b>、对<b>哪一项</b>、做了<b>什么决定</b>、<b>依据是什么</b>。' +
      '本演示由 ' + esc(actorLabel()) + ' 一个人从头做到尾（实际工作里通常也是这样），' +
      '所以没有「提交给上级、等对方在系统里点同意」这一步；' +
      '但每项高风险变更<b>该由谁签字批准</b>会和你的确认动作一起记进去 —— 交给谁批，事后查得到。</div>';

    h += '<div class="grid3">' +
      '<div class="card"><div class="card-h"><h3>输入版本可验证</h3></div><div class="card-b">' +
      (S.docsLoaded ? D.DOCUMENTS.map(function (d) {
        return '<div class="note-sm" style="margin-bottom:6px"><b>' + esc(d.filename) + '</b><br>' +
          esc(d.version) + ' · 哈希 <span class="mono">' + esc(d.hash) + '</span></div>';
      }).join('') : '<div class="note-sm">尚未载入文件。</div>') + '</div></div>' +
      '<div class="card"><div class="card-h"><h3>使用的版本</h3></div><div class="card-b">' +
      '<dl class="kv"><dt>标准模板</dt><dd>' + esc(D.META.templateVersionUsed) + '</dd>' +
      '<dt>规则库</dt><dd>' + esc(D.META.ruleSetVersion) + '</dd>' +
      '<dt>条款库</dt><dd>' + esc(D.META.clauseLibVersion) + '</dd>' +
      '<dt>数据模式</dt><dd>' + esc(D.META.dataMode) + '</dd>' +
      '<dt>模型端点</dt><dd>' + esc(D.META.modelEndpoint) + '</dd></dl></div></div>' +
      '<div class="card"><div class="card-h"><h3>导出记录</h3></div><div class="card-b">' +
      (S.exports.length ? S.exports.map(function (x) {
        return '<div class="note-sm" style="margin-bottom:5px">✓ <b>' + esc(x.name) + '</b><br>' +
          esc(x.at) + ' · ' + esc(x.actor) + '</div>';
      }).join('') : '<div class="note-sm">尚未导出。</div>') + '</div></div></div>';

    h += '<div class="card"><div class="card-h"><h3>事件流</h3><span class="sub">谁改的 · 为什么改 · 依据是什么</span></div>' +
      '<div class="card-b" style="padding:0"><table class="tbl"><tr>' +
      '<th>事件</th><th>时间</th><th>操作者</th><th>动作</th><th>对象</th><th>变更前 → 变更后</th><th>依据</th></tr>';
    if (!S.audit.length) h += '<tr><td colspan="7"><div class="empty">暂无审计事件。</div></td></tr>';
    S.audit.slice().reverse().forEach(function (e) {
      var cls = e.actor_type === 'human' ? 'actor-human'
        : e.actor_type === 'rule_engine' ? 'actor-rule'
        : e.actor_type === 'model' ? 'actor-model' : 'actor-ai';
      var icon = e.actor_type === 'human' ? '👤'
        : e.actor_type === 'rule_engine' ? '⚙'
        : e.actor_type === 'model' ? '🧠' : '◆';
      h += '<tr class="audit-row"><td class="mono">' + esc(e.event_id) + '</td>' +
        '<td class="mono">' + esc(e.timestamp) + '</td>' +
        '<td><span class="actor ' + cls + '">' + icon + ' ' + esc(e.actor_id) + '</span></td>' +
        '<td>' + esc(e.action) + '</td>' +
        '<td>' + esc(e.object_type) + '<div class="note-sm mono">' + esc(e.object_id) + '</div></td>' +
        '<td class="audit-diff">' + (e.before_value ? '<span class="b">' + esc(e.before_value) + '</span><br>' : '') +
        (e.after_value ? '<span class="a">' + esc(e.after_value) + '</span>' : '') + '</td>' +
        '<td class="note-sm">' + esc(e.basis || '—') + '</td></tr>';
    });
    h += '</table></div></div>';
    return h;
  }

  /* ======================================================== 模板与规则 */
  function viewRules() {
    var fired = analysis ? analysis.ruleResult.fired : [];
    var h = '';
    h += '<div class="page-head"><div><div class="page-title">模板与规则管理</div>' +
      '<div class="page-sub">' + D.RULES.length + ' 条规则 · ' + D.CLAUSES.length +
      ' 条条款 · 条款与规则可维护，无需修改程序代码</div></div>' +
      '<div class="spacer"></div><span class="pill neutral" title="本演示为预置只读">只读 · ' +
      '模板与规则由模板管理员维护 · 本演示不含编辑功能</span></div>';

    h += '<div class="card"><div class="card-h"><h3>标准模板版本</h3></div><div class="card-b" style="padding:0">' +
      '<table class="tbl"><tr><th>模板</th><th>版本</th><th>条款数</th><th>状态</th><th>维护人</th></tr>' +
      '<tr><td>PwC TP 标准模板</td><td>2025 v3.2</td><td>' + D.TEMPLATE_2025_SECTIONS.length +
      '</td><td><span class="pill neutral">历史版本（比对基准）</span></td><td>Oliver Grant（模板管理员）</td></tr>' +
      '<tr><td>PwC TP 标准模板</td><td>2026 v4.0（2026-01-05 发布）</td><td>' + D.TEMPLATE_2026_SECTIONS.length +
      '</td><td><span class="pill ok">当前生效</span></td><td>Oliver Grant（模板管理员）</td></tr></table></div></div>';

    if (analysis) {
      var td = analysis.templateDiff;
      h += '<div class="card"><div class="card-h"><h3>新版模板变更记录（程序实时计算）</h3></div><div class="card-b">' +
        '<div class="metrics">' + metric('新增条款', td.added.length, ' 条', 'ok') +
        metric('删除条款', td.removed.length, ' 条', 'medium') +
        metric('修改条款', td.modified.length, ' 条', 'high') +
        metric('未变条款', td.unchanged.length, ' 条', '') +
        metric('条款号变化', td.renumbered.length, ' 处', '') + '</div>' +
        '<div class="note-sm" style="margin-top:10px">新增：' + (td.added.join('、') || '—') +
        '　删除：' + (td.removed.join('、') || '—') + '　修改：' + (td.modified.join('、') || '—') + '</div>' +
        '<div class="note-sm" style="margin-top:6px">两版模板中留存条款的编号均未移动（' +
        td.renumbered.length + ' 处）：送达条款被删除后，新增的 AI 条款正好补入第 13 条，第 14 条位置不变。' +
        '但原第 8 条对「第 13 条」的交叉引用因此指向了新条款，该问题由一致性检查捕获。</div></div></div>';
    }

    h += '<div class="card"><div class="card-h"><h3>条款规则库</h3>' +
      '<span class="sub">规则决定条款的加入 / 保留 / 修改 / 删除；求值结果可追溯</span></div><div class="card-b">';
    D.RULES.forEach(function (r) {
      var isFired = fired.indexOf(r.rule_id) >= 0;
      h += '<div class="rule' + (isFired ? ' fired' : '') + '"><div class="rule-h">' +
        '<span class="id">' + esc(r.rule_id) + '</span><span class="nm">' + esc(r.name) + '</span>' +
        '<span class="pill neutral">' + esc(r.version) + '</span>' +
        '<span class="pill ' + (r.status === '生效' ? 'ok' : 'neutral') + '">' + esc(r.status) + '</span>' +
        '<div class="spacer"></div>' +
        (analysis ? '<span class="pill ' + (isFired ? 'ok' : 'neutral') + '">' +
          (isFired ? '✓ 本任务已触发' : '未触发') + '</span>' : '') + '</div>' +
        '<div class="yaml">rule_id: ' + esc(r.rule_id) + '\nname: ' + esc(r.name) +
        '\nwhen:\n  ' + esc(r.when_text) + '\nthen:\n  ' + esc(r.then_text) + '</div>' +
        '<div class="rule-exp"><b>说明：</b>' + esc(r.explanation) + '</div></div>';
    });
    h += '</div></div>';

    h += '<div class="card"><div class="card-h"><h3>条款库</h3><span class="sub">每条包含 ID、中英名称与标准文本、版本、' +
      '生效日期、适用服务类型、触发条件、风险等级、是否允许自动加入、是否必须审批、替代条款、来源模板、维护人、状态</span></div>' +
      '<div class="card-b" style="padding:0"><table class="tbl"><tr><th>条款 ID</th><th>中文 / 英文名称</th><th>版本 / 生效</th>' +
      '<th>触发条件</th><th>风险</th><th>自动加入</th><th>审批</th><th>替代条款</th><th>来源模板</th><th>状态</th></tr>';
    D.CLAUSES.forEach(function (c) {
      h += '<tr class="clickable" data-act="clause-view" data-id="' + c.clause_id + '">' +
        '<td class="mono">' + esc(c.clause_id) + '</td>' +
        '<td><b>' + esc(c.title_cn) + '</b><div class="note-sm">' + esc(c.title_en) + '</div></td>' +
        '<td>' + esc(c.version) + '<div class="note-sm">' + esc(c.effective_date) + '</div></td>' +
        '<td class="note-sm">' + esc(c.trigger_condition) + '</td>' +
        '<td>' + riskPill(c.risk_level) + '</td>' +
        '<td>' + (c.auto_add_allowed ? '<span class="pill ok">允许</span>' : '<span class="pill high">禁止</span>') + '</td>' +
        '<td class="note-sm">' + esc(c.approval_required) + '</td>' +
        '<td class="note-sm">' + esc(c.alternative_clause) + '</td>' +
        '<td class="note-sm">' + esc(c.source_template) + '</td>' +
        '<td><span class="pill ' + (c.status === '生效' ? 'ok' : 'neutral') + '">' + esc(c.status) + '</span></td></tr>';
    });
    h += '</table></div></div>';
    
    /* ---- 服务内容库（生成新合同时按服务类型取用）---- */
    h += '<div class="card"><div class="card-h"><h3>服务内容库</h3>' +
      '<span class="pill neutral">' + D.SERVICE_LIBRARY.length + ' 类服务</span>' +
      '<div class="spacer"></div><span class="sub">生成新合同时按服务类型取用；分类来自事务所提供的常见服务类型业务约定书</span>' +
      '</div><div class="card-b" style="padding:0">' +
      '<table class="tbl"><tr><th style="width:22%">服务类型</th><th style="width:20%">计费方式</th>' +
      '<th>服务范围（要点）</th><th style="width:13%">除外项目</th><th style="width:10%">明细</th></tr>';
    D.SERVICE_LIBRARY.forEach(function (v) {
      h += '<tr><td><b>' + esc(v.name_cn) + '</b><div class="note-sm mono">' + esc(v.service_id) + '</div></td>' +
        '<td>' + esc(v.billing_cn) + '</td>' +
        '<td>' + v.scope_items.map(function (x) { return esc(x); }).join('；') + '</td>' +
        '<td class="note-sm">' + v.exclusions.map(function (x) { return esc(x); }).join('；') + '</td>' +
        '<td><span class="pill ' + (v.detail_status === 'preset' ? 'ok' : 'warn') + '">' +
        (v.detail_status === 'preset' ? '已内置' : '待补充') + '</span></td></tr>';
    });
    h += '</table></div></div>';

    /* ---- 国家转让定价法规库 ---- */
    var pend = D.TP_REGULATION_LIBRARY.filter(function (x) { return x.detail_status === 'pending'; }).length;
    h += '<div class="card"><div class="card-h"><h3>国家转让定价法规库</h3>' +
      '<span class="pill neutral">' + D.TP_REGULATION_LIBRARY.length + ' 个国家 / 地区</span>' +
      (pend ? '<span class="pill warn">' + pend + ' 个待补充法规要点</span>' : '') +
      '<div class="spacer"></div><span class="sub">非中国的转让定价文档需把当地法规写入「项目背景」</span>' +
      '</div><div class="card-b">' +
      '<div class="box-lite">法规要点<b>必须由事务所提供并确认</b>才会写入合同背景。' +
      '标为「待补充」的国家，系统不会拿未经确认的法规内容去生成文本 —— ' +
      '宁可空着让人填，也不编一段看起来像法规的话。</div>' +
      '<table class="tbl"><tr><th style="width:16%">国家 / 地区</th>' +
      '<th style="width:28%">文档要求</th><th>法规要点</th><th style="width:12%">状态</th></tr>';
    D.TP_REGULATION_LIBRARY.forEach(function (r) {
      h += '<tr><td><b>' + esc(r.name_cn) + '</b><div class="note-sm mono">' + esc(r.code) + '</div></td>' +
        '<td>' + esc(r.doc_requirement) + '</td>' +
        '<td>' + (r.key_points.length
          ? r.key_points.map(function (x) { return esc(x); }).join('；')
          : '<span class="note-sm">（待事务所提供）</span>') + '</td>' +
        '<td><span class="pill ' + (r.detail_status === 'preset' ? 'ok' : 'warn') + '">' +
        (r.detail_status === 'preset' ? '已确认' : '待补充') + '</span></td></tr>';
    });
    h += '</table></div></div>';

    return h;
  }


  /* ======================================================== 模型接入 */
  function modelOn() { return global.TPModel && global.TPModel.enabled(); }

  /* 生效中的模型配置的单一来源。
     S.modelCfg 只是界面回显，TPModel 内部那份才决定是否真的发请求 ——
     两者可能不一致（localStorage 被清、状态恢复失败、或绕过界面直接配置），
     所以任何地方都不要直接读 S.modelCfg.xxx（实测因此崩过一次）。 */
  function modelInfo() {
    var g = (global.TPModel && global.TPModel.getConfig) ? global.TPModel.getConfig() : null;
    var c = S.modelCfg || {};
    return {
      model: (g && g.model) || c.model || '-',
      endpoint: (g && g.endpoint) || c.endpoint || '-',
      protocol: (g && g.protocol) || c.protocol || '-',
      effort: (g && g.effort) || c.effort || '-',
      timeoutMs: (g && g.timeoutMs) || c.timeoutMs || 0
    };
  }

  /* 各协议的默认参数与可用模型。切换协议时据此联动，避免用户手工对齐。 */
  var PROTO = {
    anthropic: {
      label: 'Claude Messages API（api.anthropic.com）',
      endpoint: 'https://api.anthropic.com/v1/messages',
      models: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'],
      timeoutMs: 60000, effort: true,
      note: '结构化输出由服务端按 schema 强约束；浏览器直连需带 anthropic-dangerous-direct-browser-access 头。'
    },
    openai: {
      label: 'OpenAI 兼容 /chat/completions（DeepSeek 等）',
      endpoint: 'https://api.deepseek.com/chat/completions',
      models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
      timeoutMs: 120000, effort: false,
      note: 'JSON 模式只保证合法 JSON、不校验 schema，因此由本地再做一次 schema 校验兜底；实测单轮约 28—29 秒，超时默认放宽到 120 秒。'
    },
    gateway: {
      label: '企业内网网关（鉴权与 CORS 由网关负责）',
      endpoint: '', // 无默认，必须由使用者填写
      models: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5', 'deepseek-v4-flash', 'deepseek-v4-pro'],
      timeoutMs: 60000, effort: true,
      note: '沿用 Messages API 请求形状，密钥由网关持有，客户合同原文不出内网。'
    }
  };

  // 所有协议的默认端点/超时集合 —— 用于判断某个值是否仍是「未被用户改过的默认值」
  function isDefaultEndpoint(v) {
    for (var k in PROTO) if (PROTO[k].endpoint && PROTO[k].endpoint === v) return true;
    return !v;
  }
  function isDefaultTimeout(v) {
    for (var k in PROTO) if (String(PROTO[k].timeoutMs) === String(v)) return true;
    return false;
  }

  /**
   * 协议切换后联动其余字段。
   * 原则：只覆盖「仍是某个协议默认值」的字段，用户手工填过的内容一律保留。
   */
  function syncProtocolFields(prevProto) {
    var pSel = $('m_protocol'); if (!pSel) return;
    var proto = pSel.value, cfg = PROTO[proto] || PROTO.anthropic;
    var epEl = $('m_endpoint'), mEl = $('m_model'), eEl = $('m_effort'), tEl = $('m_timeout');
    var changed = [];

    // 端点：仅当当前值是某协议默认值（或为空）时替换，避免覆盖自填的网关地址
    if (epEl && isDefaultEndpoint(epEl.value.trim())) {
      if (epEl.value.trim() !== cfg.endpoint) {
        epEl.value = cfg.endpoint;
        changed.push(cfg.endpoint ? '端点 URL' : '端点 URL（已清空，请填写网关地址）');
      }
    }

    // 模型：重建候选列表；当前选择不在新列表里则切到该协议首选
    if (mEl) {
      var cur = mEl.value;
      mEl.innerHTML = cfg.models.map(function (x) { return '<option value="' + x + '">' + x + '</option>'; }).join('');
      if (cfg.models.indexOf(cur) >= 0) { mEl.value = cur; }
      else { mEl.value = cfg.models[0]; changed.push('模型 → ' + cfg.models[0]); }
    }

    // effort：只有 Messages API 形状生效，其余协议置灰
    if (eEl) {
      eEl.disabled = !cfg.effort;
      eEl.title = cfg.effort ? '' : '该协议不支持 effort 参数，此项不会发送';
      var lab = document.querySelector('label[for="m_effort"] .note-sm');
      if (lab) lab.textContent = cfg.effort ? '（仅 Claude 协议生效）' : '（当前协议不支持，不会发送）';
    }

    // 超时：同样只在仍是默认值时调整
    if (tEl && isDefaultTimeout(tEl.value) && String(cfg.timeoutMs) !== String(tEl.value)) {
      tEl.value = cfg.timeoutMs;
      changed.push('超时 → ' + (cfg.timeoutMs / 1000) + ' 秒');
    }

    var noteEl = $('m_proto_note');
    if (noteEl) noteEl.textContent = cfg.note;

    if (prevProto && prevProto !== proto) {
      toast('已切换为「' + cfg.label + '」' + (changed.length ? '，已同步：' + changed.join('、') : ''));
    }
  }

  function provTag(kind) {
    if (kind === 'model') return ' <span class="pill ai">◆ 模型输出</span>';
    if (kind === 'computed') return ' <span class="pill info">⚙ 程序计算</span>';
    return ' <span class="pill neutral">预置</span>';
  }

  function viewModelCfg() {
    var cfg = S.modelCfg || {};
    var live = global.TPModel.getConfig();
    var on = modelOn();
    var calls = global.TPModel.log();
    var h = '';

    h += '<div class="page-head"><div><div class="page-title">模型接入</div>' +
      '<div class="page-sub">可切换到真实模型；模型只负责提取、语义分类、解释与双语比对，数值与规则始终由程序计算</div></div>' +
      '<div class="spacer"></div><span class="pill ' + (on ? 'ok' : 'neutral') + '">' +
      (on ? '● 已接入 ' + esc(live.model) : '○ 未配置 · 预计算模式') + '</span></div>';

    h += '<div class="gate ' + (on ? 'open' : '') + '"><div class="gate-t">' +
      (on ? '✓ 已接入模型，失败自动回退预置结果' : '○ 当前为纯离线预计算模式') + '</div>' +
      '<div class="gate-d">' + (on
        ? '字段提取、语义分类、Agent 解释、双语比对四项将改由模型产出，并在界面逐条标注「◆ 模型输出」。' +
          '任一调用失败 / 超时 / 校验不通过 / 被安全拒答，该项自动回退预置结果并记入审计。'
        : '未配置端点时全站零网络请求，与断网演示完全一致。填写下方配置后才会发起调用。') + '</div></div>';

    h += '<div class="split wide" style="margin-top:14px"><div class="card"><div class="card-h"><h3>端点配置</h3></div><div class="card-b">' +
      '<div class="field"><label for="m_protocol">协议</label><select id="m_protocol">' +
      ['anthropic', 'openai', 'gateway'].map(function (x) {
        return '<option value="' + x + '"' + ((cfg.protocol || 'anthropic') === x ? ' selected' : '') + '>' +
          PROTO[x].label + '</option>';
      }).join('') + '</select>' +
      '<div class="hint" id="m_proto_note">' + esc(PROTO[cfg.protocol || 'anthropic'].note) + '</div></div>' +
      '<div class="field"><label for="m_endpoint">端点 URL</label>' +
      '<input id="m_endpoint" value="' + esc(cfg.endpoint || global.TPModel.DEFAULT_ENDPOINT) + '"></div>' +
      '<div class="field"><label for="m_key">API Key</label>' +
      '<div class="key-row">' +
      '<input id="m_key" type="text" class="masked" inputmode="text" spellcheck="false"' +
      ' autocomplete="off" autocapitalize="off" autocorrect="off"' +
      ' data-lpignore="true" data-1p-ignore data-bwignore data-form-type="other"' +
      ' placeholder="' + (MODEL_KEY ? '（已在本次会话中设置）' : '粘贴 API Key') + '">' +
      '<button class="btn sm" type="button" data-act="model-key-peek">显示</button></div>' +
      '<div class="hint">仅驻留内存：不写入 localStorage、不进入任何导出文件、刷新页面即失效。' +
      '此处刻意<b>不使用密码输入框</b> —— 否则浏览器密码管理器会提示保存，' +
      '把 Key 存进本机凭据库，与上面这条承诺相悖。</div></div>' +
      '<div class="grid2"><div class="field"><label for="m_model">模型</label><select id="m_model">' +
      PROTO[cfg.protocol || 'anthropic'].models.map(function (x) {
        return '<option value="' + x + '"' + ((cfg.model || '') === x ? ' selected' : '') + '>' + x + '</option>';
      }).join('') + '</select></div>' +
      '<div class="field"><label for="m_effort">推理档位 effort<span class="note-sm">' +
      (PROTO[cfg.protocol || 'anthropic'].effort ? '（仅 Claude 协议生效）' : '（当前协议不支持，不会发送）') +
      '</span></label><select id="m_effort"' +
      (PROTO[cfg.protocol || 'anthropic'].effort ? '' : ' disabled') + '>' +
      ['low', 'medium', 'high'].map(function (x) {
        return '<option value="' + x + '"' + ((cfg.effort || 'low') === x ? ' selected' : '') + '>' + x + '</option>';
      }).join('') + '</select></div></div>' +
      '<div class="field"><label for="m_timeout">单次调用超时（毫秒）</label>' +
      '<input id="m_timeout" type="number" value="' +
      (cfg.timeoutMs || PROTO[cfg.protocol || 'anthropic'].timeoutMs) + '"></div>' +
      '<div class="btn-row" style="margin-top:4px">' +
      '<button class="btn primary" data-act="model-save">保存配置</button>' +
      '<button class="btn" data-act="model-test">测试连接</button>' +
      '<button class="btn danger" data-act="model-off">断开并清除</button></div>' +
      '</form>' +
      '<div class="computed">结构化输出强度按协议不同：Claude 的 <span class="mono">output_config.format</span> ' +
      '由服务端按 schema 强约束；OpenAI 兼容的 <span class="mono">response_format:json_object</span> ' +
      '只保证是合法 JSON、不校验 schema。因此本适配层一律在客户端再做一次 schema 校验，' +
      '不符即视为失败并回退预置结果 —— 这对 DeepSeek 这类 OpenAI 兼容端点是必需的兜底。</div>' +
      '<div class="warnbox">浏览器直连 Claude API 需带 <span class="mono">anthropic-dangerous-direct-browser-access</span> 头，' +
      '这会把 API Key 暴露在前端代码里。官方仅在两种情况下认为可接受：' +
      '① 使用者可信的内部工具；② 短期、可轮换、与生产隔离的开发凭据。' +
      '<b>本演示属前者，请使用一枚可随时作废的测试 Key，演示结束后轮换。</b>' +
      '正式部署请改用「企业内网网关」协议，由网关持有密钥，客户合同原文不出内网。</div>' +
      '</div></div>';

    h += '<div class="stack"><div class="card"><div class="card-h"><h3>模型负责什么 / 不负责什么</h3></div>' +
      '<div class="card-b" style="padding:0"><table class="tbl"><tr><th>环节</th><th>接入后由谁做</th></tr>' +
      row2m('字段提取（24 项，含来源与置信度）', 'model') +
      row2m('语义分类（实质性 / 措辞 / 格式）', 'model') +
      row2m('Agent 大白话解释（高风险项）', 'model') +
      row2m('双语语义比对（数值倍数之外的覆盖）', 'model') +
      row2m('真实合同字段提取（正则抽不到时接手，须带可核对引文）', 'model') +
      row2m('真实合同条款语义匹配（确定性匹配率低于 70% 才接手）', 'model') +
      row2m('真实合同差异语义分级', 'model') +
      row2m('条件性条款适用性建议（建议不算回答，关口仍要人过）', 'model') +
      row2m('从模板指引提炼规则', 'model_draft') +
      row2m('起草条款正文（中 / 英 / 日，值一律用占位符）', 'model_draft') +
      row2m('补齐缺失的日文附带译文', 'model_draft') +
      row2m('模型起草文本的护栏：倍数 / 金额 / 三语数字 / 语种自检', 'prog') +
      row2m('模板结构差异（按 clause_id 匹配 + 文本比较）', 'prog') +
      row2m('16 条规则求值', 'prog') +
      row2m('金额数字与中文大写生成及校验', 'prog') +
      row2m('条款编号重排与交叉引用检查', 'prog') +
      row2m('11 项一致性检查与门禁判定', 'prog') +
      row2m('责任限额口径、条款增删、导出授权', 'human') +
      '</table><div class="card-b"><div class="note-sm">' + esc(D.META.modelNote) + '</div></div></div></div>';

    if (S.modelResult) {
      var r = S.modelResult;
      h += '<div class="card"><div class="card-h"><h3>最近一次分析的模型使用情况</h3></div><div class="card-b">' +
        (r.applied && r.applied.length
          ? '<div class="decided">◆ 模型完成：' + r.applied.join('、') + '</div>' : '') +
        (r.fallbacks && r.fallbacks.length
          ? '<div class="escalated-note">⚠︎ 已回退预置结果：' + r.fallbacks.map(function (f) {
              return f.task + '（' + esc(f.reason) + '）';
            }).join('；') + '</div>'
          : '<div class="note-sm" style="margin-top:6px">无回退。</div>') +
        (r.guards && r.guards.length
          ? '<div class="impact" style="margin-top:10px"><b>确定性护栏拦下了 ' + r.guards.length +
            ' 处模型输出：</b><br>' + r.guards.map(function (g) {
              return '· <span class="mono">' + esc(g.field) + '</span>｜' + esc(g.guard) + '：' + esc(g.why) +
                (g.quote ? '（引文「' + esc(g.quote) + '」）' : '');
            }).join('<br>') + '</div>'
          : '') + '</div></div>';
    }
    h += '</div></div>';

    h += '<div class="card"><div class="card-h"><h3>调用记录（' + calls.length + '）</h3>' +
      '<span class="sub">本次会话内的每次模型调用；同时记入审计日志</span></div><div class="card-b" style="padding:0">';
    if (!calls.length) h += '<div class="empty"><span class="ic">🧠</span>尚无调用记录。</div>';
    else {
      h += '<table class="tbl"><tr><th>任务</th><th>结果</th><th>耗时</th><th>输入 / 输出 tokens</th><th>说明</th></tr>' +
        calls.slice().reverse().map(function (c) {
          return '<tr><td class="mono">' + esc(c.task) + '</td>' +
            '<td>' + (c.ok ? '<span class="pill ok">成功</span>' : '<span class="pill high">失败 → 回退</span>') + '</td>' +
            '<td class="mono">' + c.ms + ' ms</td>' +
            '<td class="mono">' + (c.input_tokens == null ? '—' : c.input_tokens + ' / ' + c.output_tokens) + '</td>' +
            '<td class="note-sm">' + esc(c.detail) + '</td></tr>';
        }).join('') + '</table>';
    }
    h += '</div></div>';
    return h;
  }

  function row2m(a, who) {
    var m = { model: ['◆ 模型', 'ai'],
              model_draft: ['◆ 模型起草 → 👤 人批准', 'warn'],
              prog: ['⚙ 确定性程序', 'info'],
              human: ['👤 人（不可交给模型）', 'high'] }[who];
    if (!m) throw new Error('row2m: 未知归属 ' + who);
    return '<tr><td>' + esc(a) + '</td><td><span class="pill ' + m[1] + '">' + m[0] + '</span></td></tr>';
  }

  /* ======================================================== 新建合同（F16） */
  function viewNewContract() {
    var a = S.qAnswers;
    var h = '';
    h += '<div class="page-head"><div><div class="page-title">生成新合同</div>' +
      '<div class="page-sub">动态问卷：后续问题由前述答案决定，不展示不相关的问题</div></div>' +
      '<div class="spacer"></div><span class="pill info">比赛主流程为「年度续约」，本页为路线图展示</span></div>';

    var visible = D.QUESTIONNAIRE.filter(function (q) {
      if (!q.conditional) return true;
      var cond = D.QUESTION_CONDITIONS[q.id];
      return cond ? cond(a) : true;
    });
    var answered = visible.filter(function (q) { return a[q.id] !== undefined && a[q.id] !== null && (!Array.isArray(a[q.id]) || a[q.id].length); });

    h += '<div class="split"><div class="stack"><div class="card"><div class="card-h"><h3>动态问卷</h3>' +
      '<span class="pill ' + (answered.length === visible.length ? 'ok' : 'warn') + '">' +
      answered.length + ' / ' + visible.length + '</span></div><div class="card-b">';
    visible.forEach(function (q) {
      var v = a[q.id];
      var isAns = v !== undefined && v !== null && (!Array.isArray(v) || v.length);
      h += '<div class="qa' + (isAns ? ' answered' : '') + '"><div class="q">' + esc(q.question) +
        (q.conditional ? ' <span class="pill info">条件出现</span>' : '') + '</div>' +
        '<div class="why">为什么需要这个问题：' + esc(q.why) + '　影响：<b>' + esc(q.affects) + '</b></div>' +
        '<div class="opt-row" style="margin-top:8px">';
      q.options.forEach(function (o) {
        var sel = q.type === 'multi' ? (Array.isArray(v) && v.indexOf(o) >= 0) : v === o;
        h += '<button class="opt' + (sel ? ' sel' : '') + '" data-act="q-ans" data-q="' + q.id +
          '" data-v="' + esc(o) + '" data-multi="' + (q.type === 'multi' ? '1' : '0') + '">' + esc(o) + '</button>';
      });
      h += '</div></div>';
    });
    h += '<div class="btn-row"><button class="btn primary" data-act="q-generate"' +
      (answered.length === visible.length ? '' : ' disabled') + '>组装条款并生成待确认事项 →</button>' +
      '<button class="btn" data-act="q-reset">清空作答</button></div>';
    h += '</div></div></div>';

    /* 组装结果 */
    h += '<div class="stack">';
    if (!S.qGenerated) {
      h += '<div class="card"><div class="card-h"><h3>条款组装结果</h3></div><div class="card-b">' +
        '<div class="empty"><span class="ic">⚙</span>完成问卷后，系统按规则自动选择基础模板与条件触发条款。</div></div></div>';
    } else {
      var res = assembleFromQuestionnaire(a);
      h += '<div class="card"><div class="card-h"><h3>基础模板</h3></div><div class="card-b">' +
        '<div class="note-sm"><b>' + esc(res.template) + '</b><br>依据：服务类型「' + esc(a.q_service) +
        '」+ 语言「' + esc(a.q_lang) + '」</div></div></div>';
      h += '<div class="card"><div class="card-h"><h3>必选与条件触发条款（' + res.clauses.length + '）</h3></div>' +
        '<div class="card-b" style="padding:0"><table class="tbl"><tr><th>条款</th><th>类型</th><th>触发条件</th><th>风险</th><th>审批</th></tr>';
      res.clauses.forEach(function (c) {
        h += '<tr><td><b>' + esc(c.title_cn) + '</b><div class="note-sm mono">' + esc(c.clause_id) + '</div></td>' +
          '<td>' + (c.conditional ? '<span class="pill info">条件触发</span>' : '<span class="pill neutral">必选</span>') + '</td>' +
          '<td class="note-sm">' + esc(c.trigger) + '</td><td>' + riskPill(c.risk_level) + '</td>' +
          '<td class="note-sm">' + esc(c.approval_required) + '</td></tr>';
      });
      h += '</table></div></div>';
      h += '<div class="card"><div class="card-h"><h3>待确认风险事项（' + res.risks.length + '）</h3></div><div class="card-b">';
      if (!res.risks.length) h += '<div class="note-sm">无高风险事项。</div>';
      res.risks.forEach(function (r) {
        h += '<div class="qa"><div class="q">' + (r.level === 'high' ? '🔴 ' : '🟡 ') + esc(r.title) + '</div>' +
          '<div class="why">' + esc(r.reason) + '</div></div>';
      });
      h += '<div class="note-sm" style="margin-top:8px">简化版仅演示"动态问卷 → 条款组装 → 待确认事项"闭环；' +
        '完整起草与导出请使用年度续约主流程。</div></div></div>';
    }
    h += '</div></div>';
    return h;
  }

  function assembleFromQuestionnaire(a) {
    var out = { template: '', clauses: [], risks: [] };
    out.template = 'PwC TP 标准模板 2026 v4.0 · ' +
      (a.q_service === '转让定价文档准备' ? '文档准备版' : a.q_service === '转让定价咨询' ? '咨询版' : 'APA 协助版') +
      (a.q_lang === '中文' ? '（中文单语）' : a.q_lang === '英文' ? '（英文单语）' : '（中英双语）');

    function push(id, conditional, trigger) {
      var c = null;
      D.CLAUSES.forEach(function (x) { if (x.clause_id === id) c = x; });
      if (!c) return;
      out.clauses.push({
        clause_id: c.clause_id, title_cn: c.title_cn, risk_level: c.risk_level,
        approval_required: c.approval_required, conditional: conditional, trigger: trigger
      });
    }
    push('C-SCOPE-001', false, '必选条款');
    push('C-FEE-001', false, '必选条款');
    push('C-TEAM-001', false, '必选条款');
    push('C-CONF-001', false, '必选条款');
    push('C-DATA-005', false, '必选条款');
    push('C-LIAB-002', false, '必选条款');
    push('C-LAW-001', false, '必选条款');

    if ((a.q_countries || []).indexOf('美国') >= 0) {
      push('C-US-001', true, 'R-US-001：服务涉及美国');
      out.risks.push({
        level: 'high', title: '涉及美国业务，须适用美国关联方特别约定',
        reason: '规则 R-US-001 触发。' + (a.q_us_filing === '是，将用于美国申报'
          ? '工作成果将用于美国申报，申报者责任表述须经风险审批人确认。'
          : a.q_us_filing === '尚不确定' ? '申报用途尚不确定，需在签约前澄清。' : '仅内部参考，按标准表述处理。')
      });
    }
    if (a.q_member_firm === '是') {
      push('C-GROUP-002', true, 'R-GROUP-001：涉及其他成员所');
      out.risks.push({ level: 'high', title: '成员所协作责任分担安排', reason: '规则 R-GROUP-001 触发，须经理及以上确认。' });
    }
    if ((a.q_channels || []).indexOf('微信') >= 0) {
      push('C-COMM-003', true, 'R-WECHAT-001：使用非标准即时通讯');
      out.risks.push({ level: 'medium', title: '微信等非标准渠道使用与留存约定', reason: '规则 R-WECHAT-001 触发，建议复核。' });
    }
    if (a.q_data === '是') {
      out.risks.push({ level: 'high', title: '数据出境前置要求', reason: '规则 R-DATA-002 触发：须签署标准合同条款并完成备案 / 评估。' });
    } else if (a.q_data === '尚不确定') {
      out.risks.push({ level: 'high', title: '数据出境情形尚不确定', reason: '信息不足，系统不写入结论，升级确认 —— 低置信度的推断不会写进合同。' });
    }
    if (a.q_ai === '同意') {
      push('C-AI-DATA-004', true, 'R-AI-DATA-001：2026 模板必选 + 客户同意');
      out.risks.push({ level: 'high', title: 'AI 辅助服务及数据处理条款', reason: '2026 模板新增条款，须人工确认后写入。' });
    } else if (a.q_ai === '不同意') {
      out.risks.push({ level: 'high', title: '客户不同意使用 AI 辅助工具', reason: '应适用替代条款 C-AI-DATA-004-OPT，并另行商定时间与费用。' });
    } else {
      out.risks.push({ level: 'medium', title: 'AI 使用尚未与客户沟通', reason: '条款暂停处理，避免在未取得同意的情况下写入。' });
    }
    if (a.q_liab !== '采用标准限额') {
      out.risks.push({
        level: 'high', title: '责任限额非标准安排',
        reason: '责任限额禁止系统自动决定，须合伙人 / 风险审批人批准。'
      });
    }
    return out;
  }

  /* ======================================================== 证据抽屉 */
  function openDrawer(title, body) {
    $('drawerTitle').textContent = title;
    $('drawerBody').innerHTML = body;
    $('drawer').classList.add('show');
    $('drawerMask').classList.add('show');
  }
  function closeDrawer() {
    $('drawer').classList.remove('show');
    $('drawerMask').classList.remove('show');
  }

  function docName(id) {
    var n = id;
    D.DOCUMENTS.forEach(function (d) { if (d.document_id === id) n = d.filename; });
    return n;
  }

  function evidenceForFact(id) {
    var f = null;
    D.FACTS.forEach(function (x) { if (x.fact_id === id) f = x; });
    if (!f) return '';
    var st = E.classifyFact(f);
    var h = '';
    h += '<div class="ev"><div class="k">字段</div><div class="v"><b>' + esc(f.label_cn) + '</b> / ' + esc(f.label_en) +
      '<div class="note-sm mono">' + esc(f.fact_id) + ' · ' + esc(f.field_name) + '</div></div></div>';
    h += '<div class="ev"><div class="k">上年度合同取值</div><div class="v">' + esc(f.prior ? f.prior.value : '—') + '</div>' +
      (f.prior && f.prior.source ? '<div class="quote" style="margin-top:8px">' + esc(f.prior.source.quote) +
        '<span class="src">来源：' + esc(docName(f.prior.source.document_id)) + ' · ' + esc(f.prior.source.section) + '</span></div>' : '') +
      '</div>';
    h += '<div class="ev"><div class="k">本年度提取结果</div><div class="v">' +
      (f.current.value === null ? '<span class="val-missing">未提供（资料缺失）</span>' : esc(f.current.value)) +
      '　' + confBar(f.current.confidence) + '</div>';
    (f.current.sources || []).forEach(function (s) {
      h += '<div class="quote" style="margin-top:8px">' + esc(s.quote || '（该字段在此文件中无对应文本）') +
        '<span class="src">来源：' + esc(docName(s.document_id)) + ' · ' + esc(s.section) + '</span></div>';
    });
    if (f.current.derivation) h += '<div class="note-sm" style="margin-top:8px">推导依据：' + esc(f.current.derivation) + '</div>';
    h += '</div>';
    h += '<div class="ev"><div class="k">系统路由（按置信度）</div><div class="v">' + routeLabel(st.route) +
      '　' + (st.needs_review ? '<span class="pill warn">需人工处理</span>' : '<span class="pill ok">可自动预填</span>') + '</div></div>';
    if (f.conflict) {
      h += '<div class="ev" style="border-color:var(--danger-line);background:var(--danger-soft)">' +
        '<div class="k">资料冲突</div><div class="v">' + esc(f.conflict.summary) +
        '<div class="note-sm" style="margin-top:6px">系统不选边，仅列出冲突并升级。</div></div></div>';
    }
    if (f.note_cn) h += '<div class="ev"><div class="k">备注</div><div class="v">' + esc(f.note_cn) + '</div></div>';
    var edited = Object.prototype.hasOwnProperty.call(S.factEdits, f.fact_id);
    h += '<div class="ev"><div class="k">人工状态</div><div class="v">' +
      (edited ? '已人工更正为「' + esc(S.factEdits[f.fact_id]) + '」' : (S.factConfirms[f.fact_id] ? '已人工确认' : 'Agent 提取，未经人工确认')) +
      '</div></div>';
    return h;
  }

  function evidenceForChange(id) {
    var c = null;
    analysis.changes.forEach(function (x) { if (x.change_id === id) c = x; });
    if (!c) return '';
    var rule = null;
    D.RULES.forEach(function (r) { if (r.rule_id === c.source_rule) rule = r; });
    var clause = null;
    D.CLAUSES.forEach(function (x) { if (x.clause_id === c.clause_id) clause = x; });
    var d = S.decisions[c.change_id] || { status: 'pending' };
    var h = '';
    h += '<div class="ev"><div class="k">变更项</div><div class="v"><b>' + esc(c.title) + '</b>' +
      '<div class="note-sm mono">' + esc(c.change_id) + '</div>' +
      '<div style="margin-top:6px">' + riskPill(c.risk_level) + ' <span class="pill neutral">' +
      esc(DIFF_CLASS_LABEL[c.diff_class] || c.diff_class) + '</span></div></div></div>';
    h += '<div class="ev"><div class="k">来源文件 / 条款编号</div><div class="v">' + esc(c.source) +
      '<div class="note-sm">关联条款：' + esc(c.clause_id) + (clause ? '（' + esc(clause.title_cn) + ' · ' + esc(clause.version) + '）' : '') + '</div></div></div>';
    h += '<div class="ev"><div class="k">原文摘录</div><div class="quote">' + nl2br(c.old_text) +
      (c.old_text_en ? '<span class="src">EN: ' + esc(c.old_text_en) + '</span>' : '') + '</div></div>';
    h += '<div class="ev"><div class="k">建议文本</div><div class="quote">' + nl2br(c.proposed_text) +
      (c.proposed_text_en ? '<span class="src">EN: ' + esc(c.proposed_text_en) + '</span>' : '') + '</div></div>';
    if (rule) {
      h += '<div class="ev"><div class="k">触发规则</div><div class="v"><b>' + esc(rule.rule_id) + ' ' + esc(rule.name) +
        '</b>（' + esc(rule.version) + '）</div><div class="yaml">when:\n  ' + esc(rule.when_text) +
        '\nthen:\n  ' + esc(rule.then_text) + '</div>' +
        '<div class="note-sm" style="margin-top:7px">' + esc(rule.explanation) + '</div></div>';
    }
    h += '<div class="ev"><div class="k">Agent 解释</div><div class="v">' + nl2br(c.agent_explanation) + '</div></div>';
    if (clause) {
      h += '<div class="ev"><div class="k">条款库属性</div><div class="v"><dl class="kv">' +
        '<dt>版本 / 生效</dt><dd>' + esc(clause.version) + ' · ' + esc(clause.effective_date) + '</dd>' +
        '<dt>触发条件</dt><dd>' + esc(clause.trigger_condition) + '</dd>' +
        '<dt>允许自动加入</dt><dd>' + (clause.auto_add_allowed ? '允许' : '禁止') + '</dd>' +
        '<dt>必须审批</dt><dd>' + esc(clause.approval_required) + '</dd>' +
        '<dt>替代条款</dt><dd>' + esc(clause.alternative_clause) + '</dd>' +
        '<dt>来源模板</dt><dd>' + esc(clause.source_template) + '</dd>' +
        '<dt>维护人</dt><dd>' + esc(clause.maintainer) + '</dd>' +
        '<dt>状态</dt><dd>' + esc(clause.status) + '</dd></dl></div></div>';
    }
    h += '<div class="ev"><div class="k">处理人与处理时间</div><div class="v">' +
      (E.isDecided(d.status) || d.status === 'escalated'
        ? esc(E.DECISION_LABEL[d.status]) + (d.resolution ? '（选项 ' + esc(d.resolution) + '）' : '') +
        '<br>' + esc(d.actor) + '　' + esc(d.at) + (d.note ? '<br>备注：' + esc(d.note) : '')
        : '尚未处理') + '</div></div>';
    return h;
  }

  function docDrawer(id) {
    var d = null;
    D.DOCUMENTS.forEach(function (x) { if (x.document_id === id) d = x; });
    if (!d) return;
    var h = '<div class="ev"><div class="k">文件</div><div class="v"><b>' + esc(d.filename) + '</b>' +
      '<div class="note-sm">' + esc(d.document_type_cn) + ' · ' + esc(d.version) +
      ' · 哈希 <span class="mono">' + esc(d.hash) + '</span></div>' +
      '<div class="note-sm">' + esc(d.parse_note) + '</div></div></div>';
    if (d.sections) {
      d.sections.forEach(function (s) {
        h += '<div class="ev"><div class="k">' + esc(s.no) + '　' + esc(s.title_cn) + '</div>' +
          '<div class="v">' + nl2br(s.text_cn) + '</div>' +
          (s.text_en ? '<div class="note-sm" style="margin-top:6px">EN: ' + esc(s.text_en) + '</div>' : '') +
          '<div class="note-sm mono" style="margin-top:5px">clause_id: ' + esc(s.clause_id) + '</div></div>';
      });
    }
    if (d.rows) {
      h += '<div class="ev"><div class="k">结构化字段（' + d.rows.length + ' 行）</div>' +
        '<table class="tbl" style="margin-top:6px"><tr><th>字段</th><th>值</th></tr>' +
        d.rows.map(function (r) {
          return '<tr><td>' + esc(r.field) + '</td><td>' +
            (r.value === '' ? '<span class="val-missing">（空值）</span>' : esc(r.value)) + '</td></tr>';
        }).join('') + '</table></div>';
    }
    openDrawer('解析结果 · ' + d.filename, h);
  }

  function clauseDrawer(id) {
    var c = null;
    D.CLAUSES.forEach(function (x) { if (x.clause_id === id) c = x; });
    if (!c) return;
    var secCn = '', secEn = '';
    D.TEMPLATE_2026_SECTIONS.forEach(function (s) {
      if (s.clause_id === id) { secCn = s.text_cn; secEn = s.text_en; }
    });
    var h = '<div class="ev"><div class="k">条款</div><div class="v"><b>' + esc(c.title_cn) + '</b><br>' +
      esc(c.title_en) + '<div class="note-sm mono">' + esc(c.clause_id) + ' · ' + esc(c.version) + '</div></div></div>' +
      '<div class="ev"><div class="k">中文标准文本</div><div class="quote">' + nl2br(secCn || '（本条款文本随客户事实生成）') + '</div></div>' +
      '<div class="ev"><div class="k">英文标准文本</div><div class="quote">' + nl2br(secEn || '(Generated from client facts)') + '</div></div>' +
      '<div class="ev"><div class="k">条款属性</div><div class="v"><dl class="kv">' +
      '<dt>生效日期</dt><dd>' + esc(c.effective_date) + '</dd>' +
      '<dt>适用服务类型</dt><dd>' + esc(c.applicable_service_types.join('、')) + '</dd>' +
      '<dt>触发条件</dt><dd>' + esc(c.trigger_condition) + '</dd>' +
      '<dt>风险等级</dt><dd>' + esc(c.risk_level) + '</dd>' +
      '<dt>允许自动加入</dt><dd>' + (c.auto_add_allowed ? '允许' : '禁止') + '</dd>' +
      '<dt>必须审批</dt><dd>' + esc(c.approval_required) + '</dd>' +
      '<dt>替代条款</dt><dd>' + esc(c.alternative_clause) + '</dd>' +
      '<dt>来源模板</dt><dd>' + esc(c.source_template) + '</dd>' +
      '<dt>维护人</dt><dd>' + esc(c.maintainer) + '</dd>' +
      '<dt>状态</dt><dd>' + esc(c.status) + '</dd></dl></div></div>';
    openDrawer('条款详情 · ' + c.clause_id, h);
  }

  /* ======================================================== 弹窗 */
  var modalCb = null;
  function showModal(title, body, okLabel, cb) {
    $('modalTitle').textContent = title;
    $('modalBody').innerHTML = body;
    $('modalOk').textContent = okLabel || '确认';
    modalCb = cb;
    $('modalMask').classList.add('show');
  }
  function hideModal() { $('modalMask').classList.remove('show'); modalCb = null; }

  /* ======================================================== 决策动作 */
  function decide(id, status, resolution) {
    var c = null;
    analysis.changes.forEach(function (x) { if (x.change_id === id) c = x; });
    if (!c) return;
    var prev = S.decisions[id] || { status: 'pending' };
    var noteEl = $('note-' + id);
    S.decisions[id] = {
      status: status,
      resolution: resolution || prev.resolution || null,
      note: noteEl ? noteEl.value : (prev.note || ''),
      actor: actorLabel(), at: E.nowStamp(),
      edited: prev.edited || null
    };
    log('human', status === 'escalated' ? '升级给经理' : '人工决定：' + E.DECISION_LABEL[status],
      '变更项', id, E.DECISION_LABEL[prev.status] || prev.status,
      E.DECISION_LABEL[status] + (resolution ? '（选项 ' + resolution + '）' : ''),
      { basis: c.source_rule + ' / ' + c.source, risk_level: c.risk_level });

    // 冲突项裁定后联动
    if (id === 'CH-US-CONFLICT' && resolution && E.isDecided(status)) {
      log('rule_engine', resolution === 'A' ? '规则 R-US-001 触发：保留 C-US-001' : '按人工结论移除 C-US-001',
        '条款', 'C-US-001', '暂停处理', resolution === 'A' ? '保留' : '删除',
        { basis: 'R-US-002 → 人工裁定选项 ' + resolution });
    }
    persist(); render();
    toast('已记录：' + E.DECISION_LABEL[status] + (resolution ? '（选项 ' + resolution + '）' : ''));
  }

  function acceptBatch(level) {
    var items = analysis.changes.filter(function (c) {
      var d = S.decisions[c.change_id];
      return c.risk_level === level && (!d || !E.isDecided(d.status));
    });
    if (!items.length) { toast('没有待处理的' + (level === 'low' ? '低' : '中') + '风险项'); return; }
    var body = '<div>将一次性接受以下 <b>' + items.length + '</b> 项' + (level === 'low' ? '低' : '中') + '风险变更：</div>' +
      '<ul style="margin:10px 0 0;padding-left:20px">' + items.map(function (c) {
        return '<li>' + esc(c.title) + ' <span class="note-sm">（' + esc(c.change_type_cn) + ' · ' + esc(c.source_rule) + '）</span></li>';
      }).join('') + '</ul>' +
      (level === 'medium'
        ? '<div class="warnbox">中风险项为「建议人工复核」。批量接受前请确认已抽查上方清单，操作将逐项记入审计日志。</div>'
        : '<div class="warnbox">低风险项为年份、格式、编号、普通联系人等非实质性变化，允许批量接受。每项仍会单独记入审计日志。</div>');
    showModal('批量接受' + (level === 'low' ? '低' : '中') + '风险变更', body, '确认接受 ' + items.length + ' 项', function () {
      items.forEach(function (c) {
        S.decisions[c.change_id] = {
          status: 'accepted', resolution: null,
          note: (S.decisions[c.change_id] && S.decisions[c.change_id].note) || '',
          actor: actorLabel(), at: E.nowStamp(), edited: null
        };
        log('human', '批量接受（' + (level === 'low' ? '低' : '中') + '风险）', '变更项', c.change_id,
          '待处理', '已接受建议', { basis: c.source_rule + ' / ' + c.source, risk_level: c.risk_level });
      });
      hideModal(); persist(); render();
      toast('已接受 ' + items.length + ' 项' + (level === 'low' ? '低' : '中') + '风险变更');
    });
  }

  /* ======================================================== 分析流程 */
  function runAnalysis() {
    S.analyzing = true; S.pipeStage = 0; render();
    log('agent', '开始分析（' + (modelOn() ? '已接入模型 + 确定性规则引擎' : '预置数据集 + 确定性规则引擎') + '）',
      '任务', task().task_id, '', modelOn() ? modelInfo().model : D.META.dataMode,
      { basis: modelOn() ? D.META.modelNote : D.META.engineNote });
    var i = 0;
    function step() {
      if (i >= PIPE_STAGES.length) {
        if (modelOn()) { runModelThenFinish(); return; }
        finishAnalysis();
        return;
      }
      S.pipeStage = i;
      renderMain();
      var dur = PIPE_STAGES[i].d;
      i++;
      setTimeout(step, dur);
    }

    /* 先用确定性程序算出 ctx（模型的语义分类需要知道哪些条款被修改），
       再调模型增强，最后重新跑一遍 analyze 让规则在新事实上求值。 */
    function runModelThenFinish() {
      S.modelPhase = '正在调用模型…';
      renderMain();
      var pre = E.analyze(D.FACTS);
      global.TPModel.enhance(D.FACTS, pre.ctx).then(function (res) {
        S.modelResult = res;
        (res.applied || []).forEach(function (t) {
          log('model', '模型完成：' + t, '任务', task().task_id, '预置结果', '模型输出',
            { basis: '端点 ' + res.config.endpoint + ' · 模型 ' + res.config.model + ' · effort ' + res.config.effort });
        });
        (res.guards || []).forEach(function (g) {
          log('rule_engine', '确定性护栏拦下模型输出：' + g.guard, '字段', g.field,
            '模型输出' + (g.quote ? '（引文「' + g.quote + '」）' : ''), g.why,
            { basis: '防幻觉规则：无来源、引文不可核对、以无证据为证据的断言，一律不写入合同' });
        });
        (res.fallbacks || []).forEach(function (f) {
          log('model', '模型调用失败，已回退预置结果：' + f.task, '任务', task().task_id, '模型输出', '预置结果',
            { basis: '失败原因：' + f.reason + '（模型调用失败时自动回退预置结果）' });
        });
        global.TPModel.log().forEach(function (c) {
          if (c._logged) return; c._logged = true;
          log('model', '模型调用 ' + c.task + '：' + (c.ok ? '成功' : '失败'), '模型调用', c.task,
            '', (c.ok ? '成功' : c.detail) + ' · ' + c.ms + ' ms' +
              (c.input_tokens != null ? ' · tokens ' + c.input_tokens + '/' + c.output_tokens : ''),
            { basis: '端点 ' + c.endpoint + ' · 模型 ' + (c.served_model || c.model) });
        });
        S.modelPhase = null;
        finishAnalysis();
      }).catch(function (e) {
        S.modelPhase = null;
        S.modelResult = { used: false, applied: [], fallbacks: [{ task: '全部', reason: e.message }] };
        log('model', '模型接入整体失败，全部回退预置结果', '任务', task().task_id, '模型输出', '预置结果',
          { basis: e.message });
        finishAnalysis();
      });
    }

    function finishAnalysis() {
      {
        analysis = E.analyze(D.FACTS);
        S.analyzing = false; S.analyzed = true; S.pipeStage = PIPE_STAGES.length;
        var td = analysis.templateDiff;
        log('agent', '字段提取完成', '任务', task().task_id, '', D.FACTS.length + ' 个字段，' +
          D.FACTS.filter(function (f) { return E.classifyFact(f).ask; }).length + ' 项需人工处理',
          { basis: '来源：' + D.DOCUMENTS.length + ' 份预置文件' });
        log('rule_engine', '模板结构差异计算完成', '模板', 'PwC TP 2025 v3.2 → 2026 v4.0',
          D.TEMPLATE_2025_SECTIONS.length + ' 条款', '新增 ' + td.added.length + ' / 删除 ' + td.removed.length +
          ' / 修改 ' + td.modified.length + ' / 未变 ' + td.unchanged.length,
          { basis: '程序实时计算（按 clause_id 匹配 + 文本比较）' });
        log('rule_engine', '规则求值完成', '规则库', D.META.ruleSetVersion,
          D.RULES.length + ' 条规则', '触发 ' + analysis.ruleResult.fired.join('、'),
          { basis: '确定性条件求值，输入为提取字段与模板差异' });
        var rs = E.riskSummary(analysis.changes, S.decisions);
        log('agent', '生成变更建议与风险分级', '任务', task().task_id, '',
          '共 ' + rs.total + ' 项：高 ' + rs.high + ' / 中 ' + rs.medium + ' / 低 ' + rs.low,
          { basis: '风险分级完成；高风险项强制人工确认' });
        S.view = 'workbench';
        persist(); render();
        toast('分析完成：' + rs.total + ' 项变更，其中 ' + rs.high + ' 项高风险须人工确认' +
          (S.modelResult && S.modelResult.used ? '（含模型输出）' : ''));
      }
    }

    setTimeout(step, 200);
  }

  function loadDocs() {
    S.docsLoaded = true;
    D.DOCUMENTS.forEach(function (d) {
      log('human', '上传文件', '文档', d.document_id, '', d.filename + '（' + d.document_type_cn + '）',
        { basis: '哈希 ' + d.hash + ' · ' + d.version });
      log('agent', '文档解析', '文档', d.document_id, '', d.parse_note,
        { basis: '保留段落 / 标题 / 表格 / 条款编号' });
    });
    persist(); render();
    toast('已载入 5 份预置演示文件');
  }

  /* ======================================================== 渲染 */
  function renderMain() {
    var h = '';
    switch (S.view) {
      case 'home': h = viewHome(); break;
      case 'newtask': h = viewNewTask(); break;
      case 'newcontract': h = viewNewContract(); break;
      case 'docs': h = S.created ? viewDocs() : viewHome(); break;
      case 'workbench': h = S.analyzed ? viewWorkbench() : viewDocs(); break;
      case 'changes': h = S.analyzed ? viewChanges() : viewDocs(); break;
      case 'preview': h = S.analyzed ? viewPreview() : viewDocs(); break;
      case 'audit': h = viewAudit(); break;
      case 'realmode': h = S.created ? viewRealMode() : viewHome(); break;
      case 'rules': h = viewRules(); break;
      case 'model': h = viewModelCfg(); break;
      default: h = viewHome();
    }
    $('main').innerHTML = h;
    var fi = $('fileInput');
    if (fi) fi.addEventListener('change', onFilePick);
    var ps = $('m_protocol');
    if (ps) {
      ps.addEventListener('change', function () { syncProtocolFields(ps._prev || null); ps._prev = ps.value; });
      ps._prev = ps.value;
      syncProtocolFields(null);   // 首次渲染即对齐一次（不弹 toast）
    }
  }

  function render() {
    renderNav();
    renderMain();
    var r = roleObj();
    $('roleAvatar').textContent = r.initials;
    $('roleName').textContent = r.name_cn;
    $('roleHint').textContent = r.person + ' · 单人操作模式';
    window.scrollTo({ top: 0 });
  }

  /* 真实文件上传：不再靠文件名白名单，而是真的解析。
     DOCX / XLSX 走原生解压 + OOXML 解析；PDF 不支持文本提取，如实报出。 */
  function onFilePick(ev) {
    var files = Array.prototype.slice.call(ev.target.files || []);
    if (!files.length) return;
    if (!S.docsLoaded) S.docsLoaded = true;
    toast('正在解析 ' + files.length + ' 个文件…');

    var seq = Promise.resolve();
    files.forEach(function (f) {
      seq = seq.then(function () {
        return f.arrayBuffer().then(function (ab) {
          // 内容哈希（不是文件名哈希）—— 同名不同内容必须能区分出来
          var u8 = new Uint8Array(ab), h = 2166136261;
          for (var k = 0; k < u8.length; k++) { h ^= u8[k]; h = (h * 16777619) >>> 0; }
          var hash = ('00000000' + h.toString(16)).slice(-8);
          return global.TPParse.parseFile(f.name, ab).then(function (r) {
            var doc = {
              document_id: 'D-U' + (S.extraDocs.length + 1), task_id: task().task_id,
              document_type: 'user_upload', document_type_cn: '用户上传',
              filename: f.name, version: '用户提供', hash: hash,
              upload_time: E.nowStamp(), pages: null, required: false,
              parse_status: r.ok ? 'parsed' : 'failed',
              real_parse: true, kind: r.kind
            };
            if (r.ok) {
              var bits = [];
              if (r.kind === 'docx') {
                doc.clauses = r.clauses;
                doc.guidance = r.guidance || [];
                bits.push('段落 ' + r.paragraphs.length, '表格 ' + r.tables.length,
                  '切出条款 ' + r.clauses.length + ' 条');
                var cond = doc.guidance.filter(function (g) { return g.conditional; }).length;
                if (doc.guidance.length) {
                  bits.push('模板指引 ' + doc.guidance.length + ' 条（条件性 ' + cond + ' 条）');
                }
                // 模板有使用说明、已签合同没有 —— 据此判断这是模板还是合同
                doc.looks_like = doc.guidance.length >= 20 ? 'template' : 'signed_contract';
              } else if (r.kind === 'xlsx') {
                doc.sheets = r.sheets;
                bits.push('工作表 ' + r.sheets.length,
                  '行 ' + r.sheets.reduce(function (a, x) { return a + x.rows.length; }, 0));
              }
              doc.parse_note = '解析成功（真实解析，非样例适配）：' + bits.join(' · ') + '。';
            } else {
              doc.parse_note = '解析失败：' + r.error;
            }
            S.extraDocs.push(doc);
            log('human', '上传文件', '文档', doc.document_id, '', f.name,
              { basis: '内容哈希 ' + hash + ' · ' + (f.size / 1024).toFixed(1) + ' KB' });
            log('agent', '文档解析' + (r.ok ? '成功' : '失败'), '文档', doc.document_id, '', doc.parse_note,
              { basis: r.ok ? '由原生解压 + OOXML 解析，无第三方库'
                            : '解析失败必须明确提示，不得静默忽略' });
          });
        });
      });
    });

    seq.then(function () {
      persist(); render();
      var ok = S.extraDocs.filter(function (d) { return d.parse_status === 'parsed'; }).length;
      var usable = realCandidates();
      toast('解析完成：' + ok + ' 成功 / ' + (S.extraDocs.length - ok) + ' 失败' +
        (usable.length >= 2 ? '　可以跑真实比对了' : ''));
    }).catch(function (e) {
      persist(); render();
      toast('解析过程出错：' + (e && e.message ? e.message : e));
    });
  }

  /* ======================================================== 事件 */
  document.addEventListener('click', function (ev) {
    var el = ev.target.closest ? ev.target.closest('[data-act]') : null;
    if (!el) return;
    var act = el.getAttribute('data-act');
    var id = el.getAttribute('data-id');

    if (act === 'nav') {
      if (el.disabled) return;
      S.view = el.getAttribute('data-view'); closeNav(); persist(); render(); return;
    }
    if (act === 'reset') {
      showModal('重置演示数据', '将清除本次演示中的全部人工决定、备注、审计事件与导出记录，' +
        '恢复到「任务待创建」初始状态。预置虚构数据集不受影响。', '确认重置', function () {
          E.Store.clear();
          S.view = 'home'; S.created = false; S.docsLoaded = false;
          S.analyzed = false; S.analyzing = false; S.pipeStage = -1;
          S.decisions = {}; S.factEdits = {}; S.factConfirms = {}; S.reviewDecisions = {}; S.fixes = {};
          S.realAnalysis = null; S.realAnswers = {};
          S.ruleProposals = []; S.clauseDrafts = []; S.realDecisions = {}; S.jaDrafts = [];
          S.audit = []; S.seq = 0; S.exports = []; S.extraDocs = [];
          S.qAnswers = {}; S.qGenerated = false; S.changeFilter = 'all'; S.openChange = null;
          S.modelCfg = null; S.modelResult = null; S.modelPhase = null;
          MODEL_KEY = ''; if (global.TPModel) global.TPModel.reset();
          analysis = null;
          hideModal(); persist(); render(); toast('演示数据已重置');
        });
      return;
    }
    if (act === 'create-task') {
      var t = mainTask();
      t.project_name = $('f_project').value || t.project_name;
      t.client_short = $('f_client').value || t.client_short;
      t.engagement_year = $('f_year').value;
      t.language = $('f_lang').value;
      t.service_type = $('f_service').value;
      t.owner = $('f_owner').value;
      t.reviewer = $('f_reviewer').value;
      S.created = true; S.taskId = t.task_id; S.view = 'docs';
      log('human', '创建年度更新任务', '任务', t.task_id, '',
        t.project_name + ' · ' + t.engagement_year + ' 年度 · ' + t.language,
        { basis: '系统生成唯一任务编号 ' + t.task_id + ' / 合同编号 ' + t.contract_no });
      persist(); render();
      toast('任务已创建：' + t.task_id);
      return;
    }
    if (act === 'open-task') { S.created = true; S.taskId = id; S.view = S.analyzed ? 'workbench' : 'docs'; persist(); render(); return; }
    if (act === 'load-docs') { loadDocs(); return; }
    if (act === 'run-analysis') { runAnalysis(); return; }
    if (act === 'doc-view') { docDrawer(id); return; }
    if (act === 'clause-view') { clauseDrawer(id); return; }
    if (act === 'evidence') {
      var kind = el.getAttribute('data-kind');
      if (kind === 'fact') openDrawer('查看依据 · 字段来源', evidenceForFact(id));
      else openDrawer('查看依据 · 变更项', evidenceForChange(id));
      return;
    }
    if (act === 'filter') { S.changeFilter = el.getAttribute('data-f'); render(); return; }
    if (act === 'filter-goto') { S.changeFilter = el.getAttribute('data-f'); S.view = 'changes'; persist(); render(); return; }
    if (act === 'chg-toggle') { S.openChange = S.openChange === id ? null : id; S.editing = null; render(); return; }
    if (act === 'goto-change') {
      S.view = 'changes'; S.changeFilter = 'all'; S.openChange = id; S.editing = null;
      persist(); render();
      var node = $('chg-' + id);
      if (node) node.scrollIntoView({ block: 'center' });
      return;
    }
    if (act === 'decide') { decide(id, el.getAttribute('data-status')); return; }
    if (act === 'conflict') {
      var key = el.getAttribute('data-key');
      if (key === 'C') { decide(id, 'escalated', 'C'); }
      else { decide(id, 'accepted', key); }
      return;
    }
    if (act === 'undo') {
      var prev = S.decisions[id];
      log('human', '撤销人工决定', '变更项', id, E.DECISION_LABEL[prev.status], '待处理', { basis: '人工操作' });
      delete S.decisions[id]; persist(); render(); toast('已撤销该决定'); return;
    }
    if (act === 'edit-open') { S.editing = id; S.openChange = id; render(); return; }
    if (act === 'edit-cancel') { S.editing = null; render(); return; }
    if (act === 'edit-save') {
      var c = null;
      analysis.changes.forEach(function (x) { if (x.change_id === id) c = x; });
      var cn = $('editCn').value, en = $('editEn').value;
      var pv = S.decisions[id] || { status: 'pending' };
      S.decisions[id] = {
        status: 'edited', resolution: pv.resolution || null,
        note: pv.note || '', actor: actorLabel(), at: E.nowStamp(),
        edited: { proposed_text: cn, proposed_text_en: en }
      };
      log('human', '编辑后接受（修改建议文本）', '变更项', id, c.proposed_text, cn,
        { basis: '人工编辑，条款文本经人工确认' });
      S.editing = null; persist(); render(); toast('已保存编辑并接受');
      return;
    }
    if (act === 'note-save') {
      var ta = $('note-' + id);
      var pv2 = S.decisions[id] || { status: 'pending', actor: null, at: null };
      var before = pv2.note || '';
      pv2.note = ta.value;
      S.decisions[id] = pv2;
      log('human', '添加复核备注', '变更项', id, before, ta.value, { basis: '人工备注' });
      persist(); render(); toast('备注已保存');
      return;
    }
    if (act === 'accept-low') { acceptBatch('low'); return; }
    if (act === 'accept-medium') { acceptBatch('medium'); return; }
    if (act === 'ja-translate') {
      if (!modelOn()) { toast('未接入模型，无法补译'); return; }
      // engine 里没有 assemble()，装配函数是 buildContract（我一开始写错过）
      var ctr = E.buildContract(E.analyze(D.FACTS), task(), D.FACTS,
        S.factEdits, S.decisions, S.fixes);
      var miss = ctr.sections.filter(function (x) {
        return !x.text_ja && !global.TPReal.approvedTranslations(S.jaDrafts)[x.clause_id];
      });
      if (!miss.length) { toast('没有缺译的条款'); return; }
      el.disabled = true;
      toast('正在请模型补译 ' + miss.length + ' 条…');
      global.TPModel.translateClauses(miss.map(function (x) {
        return { clause_id: x.clause_id, title_cn: x.title_cn, text_cn: x.text_cn };
      }), 'ja').then(function (r) {
        var added = 0, blocked = 0;
        (r.items || []).forEach(function (it) {
          var sec = null;
          miss.forEach(function (x) { if (x.clause_id === it.clause_id) sec = x; });
          if (!sec) return;   // 模型返回了没让它译的条款 —— 丢弃
          var d = global.TPReal.newTranslationDraft(sec.clause_id, sec.title_cn, sec.text_cn, it, 'ja');
          // 同一条只留最新一份
          S.jaDrafts = S.jaDrafts.filter(function (x) { return x.clause_id !== d.clause_id; });
          S.jaDrafts.push(d);
          added++;
          d.violations.filter(function (x) { return x.level === 'hard'; }).forEach(function (x) {
            blocked++;
            log('agent', '护栏拦截：' + x.guard, '日文补译', d.clause_id, '', '该译文不允许批准',
              { basis: x.why });
          });
        });
        var skipped = (r.items || []).length - added;
        log('agent', '模型补译日文（草稿，未计入覆盖率）', '日文补译', '', '',
          '收到 ' + (r.items || []).length + ' 条，采纳 ' + added + ' 条' +
          (skipped > 0 ? '，丢弃 ' + skipped + ' 条（返回了未请求的条款）' : ''),
          { basis: '译文默认未批准；数字一致性由程序独立重数，不采信模型自述' });
        toast('补译完成 ' + added + ' 条' + (blocked ? '，护栏拦下 ' + blocked + ' 项' : ''));
        persist(); render();
      }, function (e) {
        log('agent', '模型补译失败', '日文补译', '', '', String(e.message || e),
          { basis: '补译失败不影响其余流程；缺译条款仍如实标注为未提供' });
        toast('补译失败：' + String(e.message || e).slice(0, 60));
        persist(); render();
      });
      return;
    }
    if (act === 'ja-decide') {
      var jv = el.getAttribute('data-val'), jhit = null;
      try {
        jhit = global.TPReal.decideTranslation(S.jaDrafts, id, jv || 'draft',
          actorLabel(), E.nowStamp());
      } catch (e) {
        log('human', '试图批准被护栏阻断的译文，已拒绝执行', '日文补译', id, '',
          String(e.message || e), { basis: '译文数字与中文不一致时，点了按钮也不能生效' });
        toast(String(e.message || e).slice(0, 80));
        persist(); render();
        return;
      }
      if (jhit) {
        log('human', jv === 'approved' ? '批准模型补译的日文，计入语言覆盖率'
              : jv === 'rejected' ? '拒绝模型补译的日文' : '撤销对补译的决定',
          '日文补译', id, '', jhit.title_cn,
          { basis: '批准前程序已重数中文里的数字并与译文比对一致；仍标注为未经母语复核' });
        persist(); render();
      }
      return;
    }
    if (act === 'cd-draft') {
      var mq = findRealQuestion(id);
      if (!mq) { toast('找不到该条件性条款'); return; }
      if (!modelOn()) { toast('未接入模型，无法起草'); return; }
      if (draftFor(id)) { toast('这条已经起草过了'); return; }
      var mdl = global.TPModel;
      toast('正在请模型起草「' + mq.topic + '」…');
      el.disabled = true;
      mdl.draftClause({
        purpose: mq.topic + '：' + mq.text,
        service: (S.realAnalysis.fields || []).filter(function (f) { return f.field === 'service_scope'; })
          .map(function (f) { return f.value; })[0] || '转让定价服务',
        condition: mq.text,
        // 给同类条款做风格参照：用本年度模板里标题最相近的一条正文
        reference: (function () {
          var best = null, bs = 0, R = global.TPReal;
          (S.realAnalysis.diff.added || []).concat(S.realAnalysis.diff.modified || [])
            .forEach(function (p) {
              var t = p.new_title || '', s = R.dice ? R.dice(t, mq.topic) : 0;
              if (s > bs) { bs = s; best = p.new_text; }
            });
          return bs >= 0.3 ? best : '';
        })()
      }).then(function (d) {
        var cd = global.TPReal.newClauseDraft({ purpose: mq.topic + '：' + mq.text }, d);
        cd.question_id = id;
        cd.id = 'CD-' + (S.clauseDrafts.length + 1);
        S.clauseDrafts.push(cd);
        var hard = cd.violations.filter(function (x) { return x.level === 'hard'; });
        log('agent', '模型起草条款（草稿，未进正文）', '条款草稿', cd.id, '', cd.title_cn,
          { basis: '模型依据：' + String(cd.basis || '').slice(0, 80) +
              '；占位符 ' + cd.placeholders.length + ' 个；程序核对' +
              (cd.violations.length ? '发现 ' + cd.violations.length + ' 项问题' : '通过') });
        if (hard.length) {
          hard.forEach(function (x) {
            log('agent', '护栏拦截：' + x.guard, '条款草稿', cd.id, '', '该草稿不允许批准',
              { basis: x.why });
          });
          toast('起草完成，但护栏拦下 ' + hard.length + ' 项 —— 不能批准');
        } else {
          toast('起草完成，请复核后批准');
        }
        persist(); render();
      }, function (e) {
        log('agent', '模型起草失败', '条款草稿', id, '', String(e.message || e),
          { basis: '起草失败不影响其余流程；该条需人工撰写' });
        toast('起草失败：' + String(e.message || e).slice(0, 60));
        persist(); render();
      });
      return;
    }
    if (act === 'cd-decide') {
      var cv = el.getAttribute('data-val'), chit = null;
      try {
        chit = global.TPReal.decideClauseDraft(S.clauseDrafts, id, cv || 'draft',
          actorLabel(), E.nowStamp());
      } catch (e) {
        // 护栏抛错 = 门禁生效，这本身要进审计
        log('human', '试图批准被护栏阻断的草稿，已拒绝执行', '条款草稿', id, '',
          String(e.message || e), { basis: '模型起草的内容不因人点了按钮就能绕过程序核对' });
        toast(String(e.message || e).slice(0, 80));
        persist(); render();
        return;
      }
      if (chit) {
        log('human', cv === 'approved' ? '批准模型起草的条款，写入合同正文'
              : cv === 'rejected' ? '拒绝模型起草的条款' : '撤销对条款草稿的决定',
          '条款草稿', id, '', chit.title_cn,
          { basis: '批准前程序已核对：无具体金额、无自设赔偿倍数、三语数字一致' });
        persist(); render();
      }
      return;
    }
    if (act === 'rp-decide') {
      var v = el.getAttribute('data-val');
      var hit = global.TPReal.decideProposal(S.ruleProposals, id, v || 'draft',
        actorLabel(), E.nowStamp());
      if (hit) {
        log('human', v === 'approved' ? '批准模型提炼的规则，纳入规则库'
              : v === 'rejected' ? '拒绝模型提炼的规则' : '撤销对模型规则提议的决定',
          '规则提议', id, '', hit.name,
          { basis: '模板原文：' + String(hit.source_quote).slice(0, 90) });
        persist(); render();
      }
      return;
    }
    if (act === 'rd-set') {
      var rv = el.getAttribute('data-val');
      if (rv) S.realDecisions[id] = rv; else delete S.realDecisions[id];
      log('human', rv ? '真实模式条款决定：' + (rv === 'accept_new' ? '采用本年度模板' : '保留上年度条款')
            : '撤销真实模式条款决定',
        '条款', id, '', rv || '',
        { basis: '未决定的条款会阻塞初稿完成，不会被静默采用任一版' });
      persist(); render();
      return;
    }
    if (act === 'run-real') {
      runRealAnalysis($('rrOld') ? $('rrOld').value : '', $('rrNew') ? $('rrNew').value : '');
      return;
    }
    if (act === 'rq-ans') {
      var val = el.getAttribute('data-val');
      var q = findRealQuestion(id);
      if (!val) {
        delete S.realAnswers[id];
        log('human', '撤销条件性条款判定', '模板条件', id, '', '', { basis: '撤销同样记入审计' });
      } else {
        S.realAnswers[id] = val;
        log('human', '判定模板条件性条款', '模板条件', id, '',
          val === 'applicable' ? '适用 —— 需加入该条款' : '不适用 —— 不加入',
          { basis: '依据本年度模板原文写明的适用条件：' + (q ? q.text.slice(0, 90) : id) });
      }
      if (S.realAnalysis) {
        S.realAnalysis.questionSummary =
          global.TPReal.questionSummary(S.realAnalysis.questions, S.realAnswers);
      }
      persist(); render();
      return;
    }
    if (act === 'rq-same' || act === 'rq-changed' || act === 'rq-undo') {
      var rf = null;
      D.FACTS.forEach(function (x) { if (x.fact_id === id) rf = x; });
      if (!rf) return;
      if (act === 'rq-undo') {
        delete S.reviewDecisions[id];
        log('human', '撤销逐项复核判断', '字段', id, '', '',
          { basis: '复核判断可撤销，撤销动作同样记入审计' });
        persist(); render(); toast('已撤销：' + rf.label_cn);
        return;
      }
      if (act === 'rq-same') {
        S.reviewDecisions[id] = { status: 'unchanged', value: null, at: E.nowStamp() };
        log('human', '逐项复核：确认沿用去年', '字段', id,
          String(rf.prior ? rf.prior.value : ''), String(rf.prior ? rf.prior.value : ''),
          { basis: '易变程度「' + (rf.volatility === 'high' ? '每年都要重新确认'
            : rf.volatility === 'medium' ? '有时会变' : '基本不变') + '」，由人确认今年未变化' });
        persist(); render(); toast('已确认沿用去年：' + rf.label_cn);
        return;
      }
      // 今年变了 —— 必须填新值，不允许只标记「变了」而不给值
      var priorTxt = rf.prior ? String(rf.prior.value) : '';
      showModal('今年有变化 · ' + rf.label_cn,
        '<div class="note-sm">去年合同里的值：' + esc(priorTxt || '（未约定）') + '</div>' +
        '<div class="note-sm" style="margin-bottom:8px">易变程度：' + esc(rf.volatility_why || '') + '</div>' +
        '<label class="note-sm" for="rqVal" style="font-weight:650;display:block;margin-bottom:4px">今年的值</label>' +
        '<textarea id="rqVal" style="width:100%;min-height:80px;border:1px solid var(--line);border-radius:6px;padding:8px">' +
        esc(priorTxt) + '</textarea>' +
        '<div class="warnbox">必须填写具体的新值 —— 只标记「变了」而不给值，合同里就会留下一个说不清的字段。' +
        '此处填写视为人工确认，并记入审计。</div>',
        '保存新值', function () {
          var v = $('rqVal') ? String($('rqVal').value || '').trim() : '';
          if (!v) { toast('新值不能为空'); return; }
          S.reviewDecisions[id] = { status: 'changed', value: v, at: E.nowStamp() };
          S.factEdits[rf.fact_id] = v;
          S.factConfirms[rf.fact_id] = true;
          log('human', '逐项复核：标记今年有变化并填入新值', '字段', id, priorTxt, v,
            { basis: '人工判断该字段今年发生变化，新值由人填写并确认' });
          hideModal(); persist(); render(); toast('已记录变化：' + rf.label_cn);
        });
      return;
    }
    if (act === 'fact-confirm') {
      S.factConfirms[id] = true;
      var f0 = null; D.FACTS.forEach(function (x) { if (x.fact_id === id) f0 = x; });
      log('human', '确认字段取值', '字段', id, '', String(f0.current.value),
        { basis: '置信度 ' + (f0.current.confidence * 100).toFixed(0) + '% · 来源已核对' });
      persist(); render(); toast('已确认：' + f0.label_cn);
      return;
    }
    if (act === 'fact-edit') {
      var f1 = null; D.FACTS.forEach(function (x) { if (x.fact_id === id) f1 = x; });
      var cur = Object.prototype.hasOwnProperty.call(S.factEdits, id) ? S.factEdits[id] : (f1.current.value || '');
      showModal('更正字段 · ' + f1.label_cn,
        '<div class="note-sm">上年度合同取值：' + esc(f1.prior ? f1.prior.value : '—') + '</div>' +
        '<div class="note-sm" style="margin-bottom:8px">Agent 提取值：' +
        esc(f1.current.value === null ? '（空）' : f1.current.value) + '　置信度 ' +
        (f1.current.confidence * 100).toFixed(0) + '%</div>' +
        '<label class="note-sm" for="factVal" style="font-weight:650;display:block;margin-bottom:4px">更正后的取值</label>' +
        '<textarea id="factVal" style="width:100%;min-height:80px;border:1px solid var(--line);border-radius:6px;padding:8px">' +
        esc(cur) + '</textarea>' +
        '<div class="warnbox">人工更正将记入审计日志。无来源的客户事实不得作为事实写入合同。</div>',
        '保存更正', function () {
          var v = $('factVal').value;
          var b = f1.current.value === null ? '（空）' : f1.current.value;
          S.factEdits[id] = v; S.factConfirms[id] = true;
          log('human', '人工更正字段', '字段', id, b, v, { basis: '人工输入，已记入审计' });
          hideModal(); persist(); render(); toast('已更正：' + f1.label_cn);
        });
      return;
    }
    if (act === 'prev-lang') { S.previewLang = el.getAttribute('data-lang'); persist(); render(); return; }
    if (act === 'fix') {
      S.fixes[id] = true;
      if (id === 'CK-BILINGUAL') {
        log('human', '合伙人裁定：以中文口径统一双语责任限额', '一致性检查', id,
          '中文「两倍」/ 英文「three times」不一致',
          '英文改为「two times」，与中文口径一致',
          { basis: '责任限额不得由系统决定 · 由合伙人 / 风险审批人裁定' });
      } else {
        log('human', '应用程序性修正（一致性检查）', '一致性检查', id, '交叉引用指向已删除条款',
          '改为引用合同首部联络信息', { basis: '一致性检查 · 非实质性程序修正' });
      }
      persist(); render(); toast(id === 'CK-BILINGUAL' ? '已按中文口径统一英文文本' : '已应用程序性修正');
      return;
    }
    if (act === 'export') {
      var kind = el.getAttribute('data-kind');
      var t2 = task();
      var contract = E.buildContract(analysis, t2, D.FACTS, S.factEdits, S.decisions, S.fixes,
        global.TPReal.approvedTranslations(S.jaDrafts));
      var ck = E.consistencyCheck(contract, analysis, t2, S.decisions, D.FACTS, S.factEdits);
      var ctx = {
        task: t2, contract: contract, consistency: ck, analysis: analysis,
        decisions: S.decisions, factEdits: S.factEdits, audit: S.audit, actor: actorLabel()
      };
      var name;
      if (kind === 'csv') name = X.exportChangesCsv(ctx);
      else if (kind === 'json') name = X.exportAuditJson(ctx);
      else name = X.exportContract(ctx, kind);
      S.exports.push({ name: name, at: E.nowStamp(), actor: actorLabel() });
      log('human', '导出文件', '导出物', name, '', name,
        {
          basis: '模板 ' + D.META.templateVersionUsed + ' · 规则库 ' + D.META.ruleSetVersion +
            ' · 高风险项已全部确认：' + (E.riskSummary(analysis.changes, S.decisions).highPending === 0 ? '是' : '否')
        });
      persist(); render(); toast('已导出：' + name);
      return;
    }
    if (act === 'print') { window.print(); return; }
    if (act === 'mark-done') {
      log('human', '标记初稿已完成（仅供内部复核）', '任务', task().task_id, '初稿已生成', '初稿已完成 · 待内部复核',
        { basis: '未经授权人员确认不得标记为"可发送客户"；本次仅标记为内部初稿完成' });
      persist(); render(); toast('已标记为「初稿已完成 · 仅供内部复核」');
      return;
    }

    if (act === 'model-key-peek') {
      var ki = $('m_key');
      var masked = ki.classList.contains('masked');
      if (masked) ki.classList.remove('masked'); else ki.classList.add('masked');
      el.textContent = masked ? '隐藏' : '显示';
      return;
    }
    if (act === 'model-save') {
      var key = $('m_key').value;
      if (key) MODEL_KEY = key;
      S.modelCfg = {
        protocol: $('m_protocol').value,
        endpoint: $('m_endpoint').value.trim(),
        model: $('m_model').value,
        effort: $('m_effort').value,
        timeoutMs: Math.max(5000, Number($('m_timeout').value) || 60000)
      };
      global.TPModel.configure({
        protocol: S.modelCfg.protocol, endpoint: S.modelCfg.endpoint,
        model: S.modelCfg.model, effort: S.modelCfg.effort,
        timeoutMs: S.modelCfg.timeoutMs, apiKey: MODEL_KEY
      });
      log('human', '配置模型端点', '模型配置', S.modelCfg.model, D.META.modelEndpoint,
        S.modelCfg.protocol + ' · ' + S.modelCfg.endpoint + ' · effort ' + S.modelCfg.effort,
        { basis: 'API Key 仅驻留内存，不写入本地存储、不进入导出物' });
      persist(); render();
      toast(modelOn() ? '已保存并启用模型接入' : '已保存；仍缺少 API Key，当前仍为预计算模式');
      return;
    }
    if (act === 'model-test') {
      if (!modelOn()) { toast('请先填写端点与 API Key 并保存'); return; }
      toast('正在测试连接…');
      global.TPModel.testConnection().then(function (r) {
        log('model', '连通性测试成功', '模型配置', modelInfo().model, '', r.model + ' · ' + r.ms + ' ms',
          { basis: '端点 ' + modelInfo().endpoint });
        persist(); render();
        showModal('连接成功', '<div style="line-height:1.9">端点：<span class="mono">' + esc(modelInfo().endpoint) +
          '</span><br>实际服务模型：<span class="mono">' + esc(r.model) + '</span><br>往返耗时：' + r.ms + ' ms' +
          '<br>结构化输出校验：通过</div>' +
          '<div class="warnbox">现在点「开始分析」，字段提取与语义分类会实时调用模型；' +
          '任一环节失败都会自动回退预置结果，演示不会中断。</div>', '知道了', hideModal);
      }).catch(function (e) {
        log('model', '连通性测试失败', '模型配置', modelInfo().model, '', e.message,
          { basis: '端点 ' + modelInfo().endpoint });
        persist(); render();
        var tip = /CORS|网络/.test(e.message)
          ? '<div class="warnbox">多数情况是浏览器跨域被拦。若用「直连」协议，请确认 Key 有效且未被网络代理拦截；' +
            '若在企业网内，改用「企业内网网关」协议，由网关代理并返回 CORS 头。</div>'
          : /401|authentication/i.test(e.message)
            ? '<div class="warnbox">Key 无效或已失效，请检查后重新保存。</div>'
            : '<div class="warnbox">该项失败不会影响演示：分析流程会自动回退到预置结果。</div>';
        showModal('连接失败', '<div>' + esc(e.message) + '</div>' + tip, '知道了', hideModal);
      });
      return;
    }
    if (act === 'model-off') {
      MODEL_KEY = ''; S.modelCfg = null; S.modelResult = null;
      global.TPModel.reset();
      log('human', '断开模型接入，回到预计算模式', '模型配置', '-', '已接入', '未配置（预计算模式）',
        { basis: '断开后全站零网络请求' });
      persist(); render(); toast('已断开模型接入，恢复纯离线预计算模式');
      return;
    }
    if (act === 'q-ans') {
      var q = el.getAttribute('data-q'), v = el.getAttribute('data-v'), multi = el.getAttribute('data-multi') === '1';
      if (multi) {
        var arr = S.qAnswers[q] || [];
        var ix = arr.indexOf(v);
        if (ix >= 0) arr.splice(ix, 1); else arr.push(v);
        S.qAnswers[q] = arr;
      } else { S.qAnswers[q] = v; }
      persist(); render(); return;
    }
    if (act === 'q-generate') {
      S.qGenerated = true;
      log('rule_engine', '按动态问卷组装条款', '新建合同问卷', 'QUESTIONNAIRE', '',
        JSON.stringify(S.qAnswers), { basis: '规则库 ' + D.META.ruleSetVersion });
      persist(); render(); toast('已按规则组装条款并生成待确认事项'); return;
    }
    if (act === 'q-reset') { S.qAnswers = {}; S.qGenerated = false; persist(); render(); return; }
  });

  $('drawerClose').addEventListener('click', closeDrawer);
  $('drawerMask').addEventListener('click', closeDrawer);
  $('modalCancel').addEventListener('click', hideModal);
  $('modalOk').addEventListener('click', function () { if (modalCb) modalCb(); else hideModal(); });
  $('demoBadge').addEventListener('click', function () {
    showModal('数据与 AI 边界说明',
      '<div style="line-height:1.8"><b>数据：</b>' + esc(D.META.dataMode) + '。全部客户、合同、模板、金额与人员均为虚构，' +
      '随应用打包，断网可完整运行，不向任何外部服务发送数据。<br><br>' +
      '<b>实时计算：</b>新旧模板结构差异（按条款 ID 匹配 + 文本比较）、客户事实比对、' +
      D.RULES.length + ' 条规则求值、金额大写生成与校验、条款编号与交叉引用检查、一致性检查、合同装配与门禁判定，' +
      '均由本地确定性程序在你操作时实时计算。<br><br>' +
      '<b>预置结果：</b>字段提取值、置信度、语义分类（实质性 / 措辞优化 / 纯格式）与 Agent 解释文案为预先准备的分析结果，' +
      '用于保证现场演示稳定。<br><br>' +
      (modelOn()
        ? '<b>本次已接入真实模型。</b>端点：' + esc(modelInfo().endpoint) + '，模型：' + esc(modelInfo().model) +
          '。字段提取、语义分类、Agent 解释与双语比对由模型实时产出，界面逐条标注「◆ 模型输出」；' +
          '任一调用失败即自动回退预置结果并记入审计。' + esc(D.META.modelNote)
        : '<b>本演示未连接任何模型。</b>模型端点：' + esc(D.META.modelEndpoint) +
          '。可在侧栏「模型接入」中配置端点接入真实模型。') + '</div>',
      '知道了', function () { hideModal(); });
  });

  /* ======================================================== 启动 */
  /* ---------------------------------------------- 窄屏导航抽屉 */
  function navOpen() { return document.body.classList.contains('nav-open'); }
  function closeNav() {
    document.body.classList.remove('nav-open');
    var t = $('navToggle'); if (t) t.setAttribute('aria-expanded', 'false');
  }
  function toggleNav() {
    var open = !navOpen();
    document.body.classList.toggle('nav-open', open);
    var t = $('navToggle'); if (t) t.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  (function init() {
    var nt = $('navToggle'); if (nt) nt.addEventListener('click', toggleNav);
    var nm = $('navMask'); if (nm) nm.addEventListener('click', closeNav);
    // 转到宽屏时清掉 nav-open，否则会留下一个已经不该存在的状态
    if (global.matchMedia) {
      var mq = global.matchMedia('(min-width: 861px)');
      var onWide = function (e) { if (e.matches) closeNav(); };
      if (mq.addEventListener) mq.addEventListener('change', onWide);
      else if (mq.addListener) mq.addListener(onWide);
    }
    restore();
    if (!E.Store.available) {
      setTimeout(function () { toast('提示：当前环境不支持本地存储，刷新后将回到初始状态（预置任务仍可用）'); }, 800);
    }
    render();
  })();

  global.TPUI = { state: S, getAnalysis: function () { return analysis; }, render: render,
    syncProtocolFields: syncProtocolFields };
})(window);

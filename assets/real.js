/* ============================================================================
   TP Engagement Agent · 真实文件模式的分析层
   ----------------------------------------------------------------------------
   演示数据集里每个条款都有 clause_id，可以精确匹配。真实合同没有 —— 只有标题
   和编号，而且新旧两份的标题措辞还可能不同。所以真实模式必须：
     1. 按标题相似度匹配新旧条款（而不是按 id）
     2. 用确定性正则从正文里抽字段，每一项都记来源段落 —— 不能回溯的不算数
     3. 把模板自己写的「什么情况下要加什么条款」变成待人回答的问题
   全部为确定性程序：无模型调用、无网络请求。模型（如已配置）只在此之外补充。
   ========================================================================== */
(function (global) {
  'use strict';

  /* ------------------------------------------------------------ 文本工具 */
  function norm(s) {
    return String(s == null ? '' : s)
      .replace(/[\s　]+/g, '')
      .replace(/[（）()【】\[\]「」“”"'’‘·．\.，,、；;：:]/g, '')
      .toLowerCase();
  }

  // 标题里的编号不参与相似度 —— 编号本来就会变（第 10 条可能变成第 13 条）
  function titleKey(t) {
    return norm(String(t)
      .replace(/^第\s*[0-9一二三四五六七八九十]+\s*条/, '')
      .replace(/^[0-9]+(\.[0-9]+)*[\.、]?\s*/, '')
      .replace(/^(附录|附件|Appendix|Annex)\s*[一二三四五六七八九十0-9IVX]*/i, '$1'));
  }

  /* 二元组 Dice 系数：对中文比编辑距离更稳，且不需要 O(nm) 空间 */
  function bigrams(s) {
    var out = {};
    for (var i = 0; i < s.length - 1; i++) {
      var g = s.slice(i, i + 2);
      out[g] = (out[g] || 0) + 1;
    }
    return out;
  }

  function dice(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
    var ga = bigrams(a), gb = bigrams(b), hit = 0, total = 0;
    Object.keys(ga).forEach(function (k) { total += ga[k]; });
    Object.keys(gb).forEach(function (k) {
      total += gb[k];
      if (ga[k]) hit += Math.min(ga[k], gb[k]);
    });
    return total ? (2 * hit) / total : 0;
  }

  /* ====================================================== 条款匹配与差异
     贪心最优匹配：先算所有配对的相似度，从高到低取，已配对的不再参与。
     阈值 0.62 是对 8 份真实合同调出来的 —— 再低会把「服务范围」和
     「服务团队」这类同前缀标题错配到一起。 */
  var TITLE_THRESHOLD = 0.62;

  function matchClauses(oldClauses, newClauses, opts) {
    opts = opts || {};
    var th = opts.threshold == null ? TITLE_THRESHOLD : opts.threshold;
    var pairs = [];
    oldClauses.forEach(function (o, oi) {
      newClauses.forEach(function (n, ni) {
        var ts = dice(titleKey(o.title), titleKey(n.title));
        if (ts < th) return;
        // 标题相近时，正文相似度用于区分「同名不同条」的情况
        var bs = dice(norm(o.text).slice(0, 400), norm(n.text).slice(0, 400));
        pairs.push({ oi: oi, ni: ni, score: ts * 0.75 + bs * 0.25, titleScore: ts, bodyScore: bs });
      });
    });
    pairs.sort(function (a, b) { return b.score - a.score; });

    var usedO = {}, usedN = {}, matched = [];
    pairs.forEach(function (p) {
      if (usedO[p.oi] || usedN[p.ni]) return;
      usedO[p.oi] = usedN[p.ni] = 1;
      matched.push(p);
    });

    var modified = [], unchanged = [], renumbered = [];
    matched.forEach(function (p) {
      var o = oldClauses[p.oi], n = newClauses[p.ni];
      var same = norm(o.text) === norm(n.text);
      var rec = {
        old_index: p.oi, new_index: p.ni,
        old_title: o.title, new_title: n.title,
        old_text: o.text, new_text: n.text,
        title_similarity: Math.round(p.titleScore * 100) / 100,
        body_similarity: Math.round(p.bodyScore * 100) / 100
      };
      if (same) unchanged.push(rec); else modified.push(rec);
      if (norm(o.title) !== norm(n.title)) renumbered.push(rec);
    });

    var added = newClauses.filter(function (_, ni) { return !usedN[ni]; })
      .map(function (c, i) { return { new_title: c.title, new_text: c.text, new_index: i }; });
    var removed = oldClauses.filter(function (_, oi) { return !usedO[oi]; })
      .map(function (c, i) { return { old_title: c.title, old_text: c.text, old_index: i }; });

    return {
      matched: matched.length, modified: modified, unchanged: unchanged,
      added: added, removed: removed, renumbered: renumbered,
      oldCount: oldClauses.length, newCount: newClauses.length,
      threshold: th
    };
  }

  /* ========================================================== 字段提取
     只用确定性正则，且每一项必须带来源（哪一条条款 / 哪段文字）。
     抽不到就返回 null 并给出原因 —— 不猜。 */
  var EXTRACTORS = [
    {
      field: 'engagement_year', label: '服务年度',
      run: function (all) {
        var m = /((?:19|20)\d{2})\s*(?:年度|财政年度|会计年度)/.exec(all)
          || /FY\s*((?:19|20)\d{2})/i.exec(all);
        return m ? { value: m[1], conf: 0.95 } : null;
      }
    },
    {
      field: 'contract_no', label: '合同编号',
      run: function (all) {
        var m = /(?:合同编号|档案编号|Engagement Letter No\.?)\s*[:：]?\s*([A-Za-z0-9\-\/]{4,32})/.exec(all);
        return m ? { value: m[1], conf: 0.92 } : null;
      }
    },
    {
      field: 'fee', label: '服务费',
      table: function (doc) {
        // 护栏：一个看起来合理的错数字比抽不到更糟。
        // 4 位且落在 1900—2100 的极可能是年份（实测抽出过「RMB 2013」），
        // 没有千分位又小于 10000 的也不像服务费 —— 一律拒收。
        var r = fromTable(doc, /服务费|费用|金额|收费|Fee|Amount/i,
                          /([\d]{1,3}(?:,\d{3})+|\d{4,})/);
        if (!r) return null;
        var plain = String(r.value).replace(/,/g, '');
        var n = Number(plain);
        var hasSep = /,/.test(String(r.value));
        if (!isFinite(n)) return null;
        if (!hasSep && n >= 1900 && n <= 2100) return null;   // 年份
        if (!hasSep && n < 10000) return null;                // 太小，不像服务费
        return { value: 'RMB ' + r.value, conf: 0.88, tableSrc: r };
      },
      run: function (all) {
        // 表格里常见形态：「86,000元/每年」「服务费 74,000」「人民币 528,000」
        // （举例用合成数字：真实合同里的费用不写进随 Demo 分发的文件）
        var m = /(?:人民币|RMB)\s*([\d]{1,3}(?:,\d{3})+|\d{4,})/.exec(all)
          || /([\d]{1,3}(?:,\d{3})+|\d{5,})\s*元(?:\s*\/\s*每?年)?/.exec(all)
          || /服务费(?:用)?[^\d]{0,12}([\d]{1,3}(?:,\d{3})+|\d{4,})/.exec(all);
        return m ? { value: 'RMB ' + m[1], conf: 0.82 } : null;
      }
    },
    {
      field: 'contracting_entity', label: '我方签约主体',
      run: function (all) {
        /* 前缀要贪婪吃进来：实际签约主体名通常是「<地名><机构名><业务描述>有限公司」，
           从机构名起非贪婪匹配会把前面的地名丢掉（实测踩过）。
           这里刻意不写出任何真实主体全名 —— 本文件会随公开 Demo 一起分发。 */
        var LEAD = /^(谨代表|代表|由|与|向|及|和|系)/;
        var m = /([一-龥]{0,8}普华永道[一-龥（）()]{2,30}(?:有限公司|分公司))/.exec(all);
        if (m) { while (LEAD.test(m[1])) m[1] = m[1].replace(LEAD, ''); }
        m = m ||
          /((?:[A-Z][a-z]+\s)?PricewaterhouseCoopers[A-Za-z\s()\-–]{2,60}?(?:Limited|Ltd\.?|Branch))/.exec(all);
        return m ? { value: m[1].trim(), conf: 0.9 } : null;
      }
    },
    {
      field: 'client_name_cn', label: '客户名称',
      run: function (all) {
        var m = /向\s*([一-龥A-Za-z0-9（）()]{2,40}?)\s*[（(]\s*(?:“|")?(?:贵司|客户)/.exec(all)
          || /与\s*([一-龥A-Za-z0-9（）()]{2,40}?)\s*[（(]\s*(?:“|")?(?:贵司|客户|以下称)/.exec(all);
        return m ? { value: m[1].trim(), conf: 0.8 } : null;
      }
    },
    {
      field: 'contract_language', label: '合同语言',
      run: function (all) {
        if (/附带非正式的日文翻译|日文翻译|日本語/.test(all)) {
          return { value: '中英双语 + 附带非正式日文译文', conf: 0.88 };
        }
        if (/中英双语|中英文/.test(all)) return { value: '中英双语', conf: 0.85 };
        return null;
      }
    },
    {
      field: 'liability_cap', label: '责任上限口径',
      run: function (all) {
        var m = /责任上限[\s\S]{0,60}?服务费的(数额|[一二三四五]倍)/.exec(all)
          || /不超过[\s\S]{0,40}?服务费的([一二三四五]倍)/.exec(all);
        return m ? { value: '服务费的' + m[1], conf: 0.9 } : null;
      }
    },
    {
      field: 'billing_mode', label: '计费方式',
      run: function (all) {
        var hourly = /按(?:实际)?工时计费|每小时收费|时间あたり報酬|per hour|hourly rate/i.test(all);
        var staged = /分阶段|首期|第一期|签署后.{0,12}%/.test(all);
        if (hourly && staged) return { value: '固定 + 按工时（分职级费率）', conf: 0.82 };
        if (hourly) return { value: '按实际工时计费', conf: 0.85 };
        if (staged) return { value: '固定费用，分期支付', conf: 0.85 };
        return null;
      }
    }
  ];

  /* 把一份已解析文档的全部可读文本摊平。
     必须包含表格 —— 真实业务约定书的服务费、服务团队、付款安排全在表格里，
     只读条款正文会抽不到费用（这是实测踩出来的）。 */
  function flatten(doc) {
    var parts = [];
    (doc.clauses || []).forEach(function (c) { parts.push(c.title, c.text); });
    (doc.paragraphs || []).forEach(function (p) { parts.push(p.text); });
    (doc.tables || []).forEach(function (rows) {
      rows.forEach(function (r) { parts.push(r.join(' \t ')); });
    });
    (doc.aux || []).forEach(function (p) { parts.push(p.text); });
    (doc.sheets || []).forEach(function (sh) {
      sh.rows.forEach(function (r) { parts.push(r.join(' \t ')); });
    });
    return parts.filter(Boolean).join('\n');
  }

  /* 表格感知提取：真实业务约定书的费用表是「表头一行、数据另一行」，
     关键词与数值不在同一个单元格里，纯正则抓不到。
     做法：找出表头行里匹配关键词的那一列，再取数据行同列的值。 */
  function fromTable(doc, headerRe, valueRe) {
    var tables = doc.tables || [];
    for (var t = 0; t < tables.length; t++) {
      var rows = tables[t];
      for (var h = 0; h < Math.min(rows.length, 3); h++) {
        var col = -1;
        for (var c = 0; c < rows[h].length; c++) {
          if (headerRe.test(rows[h][c])) { col = c; break; }
        }
        if (col < 0) continue;
        for (var r = h + 1; r < rows.length; r++) {
          var cell = rows[r][col] || '';
          var m = valueRe.exec(cell);
          if (m) {
            return { value: m[1] || m[0],
                     quote: rows[h][col] + ' → ' + cell,
                     where: '表格 ' + (t + 1) + ' 第 ' + (r + 1) + ' 行第 ' + (col + 1) + ' 列' };
          }
        }
      }
    }
    return null;
  }

  function extractFields(doc) {
    var clauses = doc.clauses || [];
    var all = flatten(doc);
    return EXTRACTORS.map(function (ex) {
      var r = null;
      try { r = ex.run(all); } catch (e) { r = null; }
      // 正则抓不到时再试表格感知 —— 表格里的值往往比正文更权威
      if (!r && ex.table) { try { r = ex.table(doc); } catch (e) { r = null; } }
      if (!r) {
        return { field: ex.field, label: ex.label, value: null, confidence: 0,
                 source: null, reason: '正文中未匹配到可识别的表述 —— 需人工填写，不做推测' };
      }
      /* 定位来源：优先落在条款正文里；条款里找不到就落到表格。
         并且要求命中处的上下文里出现该字段的关键词 —— 否则来源不可信，
         宁可标「无来源」也不给一个看起来像来源的错位置（实测踩过：
         「2027」被标成了首部的称谓段）。 */
      var needle = String(r.value).replace(/^RMB\s*/, '');
      var src = null;
      if (r.tableSrc) {
        src = { clause_title: r.tableSrc.where, quote: r.tableSrc.quote.slice(0, 130) };
      }
      var CTX = {
        engagement_year: /年度|财政年度|会计年度|FY/, contract_no: /合同编号|档案编号|Engagement Letter No/,
        fee: /服务费|费用|人民币|RMB|收费/, contracting_entity: /普华永道|Pricewaterhouse/,
        client_name_cn: /贵司|客户|以下称/, contract_language: /语言|双语|翻译/,
        liability_cap: /责任|上限|赔偿/, billing_mode: /付款|收费|工时|分期/
      };
      var ctx = CTX[ex.field] || /./;
      for (var i = 0; !src && i < clauses.length; i++) {
        var hay = clauses[i].title + '\n' + clauses[i].text;
        var at = hay.indexOf(needle);
        if (at < 0) continue;
        var around = hay.slice(Math.max(0, at - 60), at + needle.length + 60);
        if (!ctx.test(around)) continue;         // 上下文不含关键词 → 不认这个来源
        // 标题过短（如「1」）说明标题识别失准，这种来源不可信
        if (clauses[i].title.replace(/[\s\d\.、]/g, '').length < 2) continue;
        src = { clause_title: clauses[i].title.slice(0, 40), quote: excerpt(hay, needle) };
        break;
      }
      if (!src && (doc.tables || []).length) {
        for (var t = 0; t < doc.tables.length && !src; t++) {
          for (var rr = 0; rr < doc.tables[t].length; rr++) {
            var line = doc.tables[t][rr].join(' | ');
            if (line.indexOf(needle) >= 0 && ctx.test(line)) {
              src = { clause_title: '表格 ' + (t + 1) + ' 第 ' + (rr + 1) + ' 行',
                      quote: line.slice(0, 130) };
              break;
            }
          }
        }
      }
      return { field: ex.field, label: ex.label, value: r.value,
               confidence: r.conf, source: src,
               reason: src ? '' : '已抽到值但未能定位到具体条款 —— 置信度下调，需人工核对' };
    }).map(function (f) {
      if (f.value && !f.source) f.confidence = Math.min(f.confidence, 0.6);
      return f;
    });
  }

  function excerpt(text, needle) {
    var i = text.indexOf(needle);
    if (i < 0) return text.slice(0, 90);
    var a = Math.max(0, i - 35), b = Math.min(text.length, i + needle.length + 45);
    return (a > 0 ? '…' : '') + text.slice(a, b) + (b < text.length ? '…' : '');
  }

  /* ============================================ 模板指引 → 待回答的问题
     官方模板自己写了「什么情况下要加什么条款」。把这些条件性说明变成问题，
     由人回答「适用 / 不适用」—— 回答本身进审计。系统不替人决定。 */
  function guidanceToQuestions(guidance) {
    return (guidance || []).filter(function (g) { return g.conditional; })
      .map(function (g, i) {
        return {
          id: 'GQ-' + (i + 1),
          text: g.text,
          from: g.from || 'document',
          // 只做粗分类，用于排序与提示强度；不影响是否必须回答
          topic: /国家秘密/.test(g.text) ? 'state_secrets'
            : /分公司|Branch|delete as appropriate|请选择使用/i.test(g.text) ? 'entity'
            : /集团|Group Compan/i.test(g.text) ? 'group'
            : /微信|WhatsApp|LINE|social/i.test(g.text) ? 'messaging'
            : /数据分析|data analytic/i.test(g.text) ? 'analytics'
            : /审计|Auditor/i.test(g.text) ? 'independence'
            : /分公司|Branch|请选择|delete as appropriate/i.test(g.text) ? 'entity'
            : 'other',
          answer: null   // 'applicable' | 'not_applicable'
        };
      });
  }

  function questionSummary(questions, answers) {
    answers = answers || {};
    var s = { total: questions.length, answered: 0, applicable: 0, not_applicable: 0, pending: 0 };
    questions.forEach(function (q) {
      var a = answers[q.id];
      if (a === 'applicable') { s.answered++; s.applicable++; }
      else if (a === 'not_applicable') { s.answered++; s.not_applicable++; }
      else s.pending++;
    });
    s.progress = s.total ? Math.round(s.answered / s.total * 100) : 100;
    // 门禁：模板自己写明的条件性条款，一条都不能不回答
    s.gateOpen = s.pending === 0;
    return s;
  }

  /* ------------------------------------------------------------ 总入口 */
  function analyzeReal(oldDoc, newDoc, answers) {
    if (!oldDoc || !newDoc) throw new Error('真实模式需要两份已解析的 DOCX：上年度合同与本年度模板');
    if (!(oldDoc.clauses || []).length || !(newDoc.clauses || []).length) {
      throw new Error('至少有一份文件没有切出条款，无法比对 —— 请检查文件是否为业务约定书正文');
    }
    var diff = matchClauses(oldDoc.clauses, newDoc.clauses);
    var fields = extractFields(oldDoc);
    var questions = guidanceToQuestions(newDoc.guidance);
    return {
      mode: 'real',
      old_file: oldDoc.filename, new_file: newDoc.filename,
      diff: diff,
      fields: fields,
      fieldsFound: fields.filter(function (f) { return f.value !== null; }).length,
      questions: questions,
      questionSummary: questionSummary(questions, answers),
      computedAt: null   // 由调用方打时间戳（引擎内不取当前时间，便于自检可复现）
    };
  }

  global.TPReal = {
    matchClauses: matchClauses, extractFields: extractFields,
    guidanceToQuestions: guidanceToQuestions, questionSummary: questionSummary,
    analyzeReal: analyzeReal,
    dice: dice, titleKey: titleKey, TITLE_THRESHOLD: TITLE_THRESHOLD
  };
})(typeof window !== 'undefined' ? window : globalThis);

/* ============================================================================
   审批闸门：模型生成的内容必须经人批准才能生效
   ----------------------------------------------------------------------------
   条款文本进了合同就是对客户的承诺。模型写的东西在被授权人员确认之前，
   不能有这个地位 —— 所以这里的数据结构强制区分「草稿」与「已批准」，
   而且没有任何一条路径能让草稿绕过批准直接进入合同。
   ========================================================================== */
(function (global) {
  'use strict';
  var R = global.TPReal;
  if (!R) return;

  var APPROVAL_STATES = ['draft', 'approved', 'rejected'];

  /* 规则提议：模型读模板指引提炼出来的规则，逐条待批 */
  function newRuleProposals(modelRules, guidance) {
    return (modelRules || []).map(function (r, i) {
      return {
        id: 'RP-' + (i + 1),
        name: r.name,
        when_text: r.when_text,
        then_text: r.then_text,
        clause_hint: r.clause_hint,
        risk_level: r.risk_level,
        approval: r.approval,
        source_quote: r.source_quote,
        confidence: r.confidence,
        provenance: 'model',
        // 关键：默认 draft。已批准的才会被规则引擎取用。
        state: 'draft',
        decided_by: null, decided_at: null, note: ''
      };
    });
  }

  function decideProposal(list, id, state, who, at, note) {
    if (APPROVAL_STATES.indexOf(state) < 0) throw new Error('非法状态：' + state);
    var hit = null;
    (list || []).forEach(function (p) { if (p.id === id) hit = p; });
    if (!hit) return null;
    hit.state = state;
    hit.decided_by = state === 'draft' ? null : (who || null);
    hit.decided_at = state === 'draft' ? null : (at || null);
    hit.note = note || '';
    return hit;
  }

  function proposalSummary(list) {
    var s = { total: (list || []).length, draft: 0, approved: 0, rejected: 0 };
    (list || []).forEach(function (p) { s[p.state] = (s[p.state] || 0) + 1; });
    s.progress = s.total ? Math.round((s.approved + s.rejected) / s.total * 100) : 100;
    return s;
  }

  /* 只有已批准的提议才会变成可用规则 —— 草稿一律不参与求值 */
  function activeRules(list) {
    return (list || []).filter(function (p) { return p.state === 'approved'; });
  }

  /* 已批准的规则提议 → 变成必须回答的条件性问题。
     提议的 when_text 是自然语言，程序无法机械求值，所以这里不假装自动判定：
     批准一条规则的后果是「流程里多一条必须由你回答的问题」，
     而不是「系统替你下了结论」。未批准的提议不产生任何问题 —— 批准才有后果。 */
  function proposalQuestions(proposals) {
    return activeRules(proposals).map(function (p) {
      return {
        id: 'PQ-' + p.id,
        topic: p.name,
        text: p.when_text + ' → ' + p.then_text,
        from_proposal: p.id,
        clause_hint: p.clause_hint,
        risk_level: p.risk_level,
        source_quote: p.source_quote,
        provenance: 'model_rule_approved'
      };
    });
  }

  /* ---------------------------------------------------------------------
     模型起草文本的护栏。
     提示词里已经写了「不得写入具体金额」「不得设定赔偿倍数」，但提示词只是
     请求模型不要这样做 —— 实测过模型在明确禁止下依然编造引文。所以真正管用
     的检查必须放在这里：模型做了也不会通过。
     hard 违规 → 不允许批准；soft 违规 → 允许批准但必须在界面上显示。
     --------------------------------------------------------------------- */

  // 抽出文本里的数字量：三语必须一致。全角数字先归一化，中文数字单独列。
  var CN_NUM = { 一: '1', 二: '2', 两: '2', 両: '2', 三: '3', 四: '4', 五: '5',
                 六: '6', 七: '7', 八: '8', 九: '9', 十: '10' };
  function numTokens(s) {
    var t = String(s || '').replace(/[０-９]/g, function (c) {
      return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
    });
    var out = [];
    /* 中文 / 日文的汉数字 + 量词也算数字量。
       日文量词必须一并认：中文写「5 个工作日」、日文写「五営業日」是同一个量，
       只认中文量词会把这种正常译法误判成「数字不一致」而拦掉一份好译文。 */
    t.replace(/([一二両两三四五六七八九十])\s*(倍|倍額|年|个?月|ヶ月|カ月|箇月|日|个工作日|営業日|日間|周|週|週間)/g,
      function (m, d) { out.push(CN_NUM[d]); return m; });
    // 先吃掉带千分位的整体，否则 888,000 会被拆成 888 和 000 —— 那既让提示看不懂，
    // 又会把「1,000」和「1000」判成不一致（三语里千分位写法本来就可能不同）。
    t = t.replace(/\d{1,3}(?:[,，]\d{3})+(?:\.\d+)?/g, function (m) {
      out.push(String(parseFloat(m.replace(/[,，]/g, '')))); return ' ';
    });
    (t.match(/\d+(?:\.\d+)?/g) || []).forEach(function (n) {
      out.push(String(parseFloat(n)));      // "2.0" 与 "2" 视为同一个量
    });
    return out.sort(function (a, b) { return Number(a) - Number(b); });
  }

  function draftGuards(drafted) {
    var v = [];
    var cn = String(drafted.text_cn || '');
    var all = cn + '\n' + (drafted.text_en || '') + '\n' + (drafted.text_ja || '');

    // 1) 不得自行设定赔偿倍数 —— 责任限额口径是人的决定，不是模型的
    if (/(\d+(\.\d+)?|[一二两三四五十])\s*倍/.test(all) ||
        /\b(double|triple|(\d+(\.\d+)?)\s*times)\s+(the\s+)?(fee|fees|charges)/i.test(all) ||
        /(двойн|倍額)/.test(all)) {
      v.push({ level: 'hard', guard: '模型不得设定赔偿倍数',
        why: '责任限额与赔偿倍数属于风险敞口，只能由授权人员定，不接受模型起草的数值。' });
    }
    // 2) 不得写入具体金额 —— 该用占位符
    var money = all.match(/(?:RMB|CNY|USD|HKD|JPY|人民币|美元|港币|日元|¥|￥|\$)\s*[\d,，]{4,}/g) ||
                all.match(/[\d,，]{5,}\s*(?:元|円)/g);
    if (money) {
      v.push({ level: 'hard', guard: '模型不得写入具体金额',
        why: '金额应为 {{占位符}}，由程序按已核对的字段填充。检出：' + money.slice(0, 3).join('、') });
    }
    // 3) 三语数字必须一致 —— 模型自称一致，这里真的去核对
    var a = numTokens(drafted.text_cn), b = numTokens(drafted.text_en), c = numTokens(drafted.text_ja);
    if (a.join('|') !== b.join('|') || a.join('|') !== c.join('|')) {
      v.push({ level: 'hard', guard: '三语数字不一致',
        why: '中 [' + a.join(',') + '] / 英 [' + b.join(',') + '] / 日 [' + c.join(',') +
             ']。三语版本的数字、倍数、期限必须完全对应。' });
    }
    // 4) 必须自陈需人工复核之处
    if (!(drafted.caveats || []).length) {
      v.push({ level: 'soft', guard: '未列出需复核之处',
        why: '起草模块被要求至少列一条不确定处；一条都没有本身就值得怀疑。' });
    }
    // 5) 三语缺任一版本
    ['text_cn', 'text_en', 'text_ja'].forEach(function (k) {
      if (!String(drafted[k] || '').trim()) {
        v.push({ level: 'hard', guard: '缺少' + ({ text_cn: '中文', text_en: '英文', text_ja: '日文' }[k]) + '版本',
          why: '合同需三语对照，缺任一版本不能进正文。' });
      }
    });
    return v;
  }

  /* 译文护栏。
     事务所反馈里明确说过「人工修改不同语言版本很容易发生漏改」——
     那么机器补译更要能被检出漏改，否则只是把同一个风险自动化了。
     （这套护栏工具箱放在这里是因为 numTokens 在这儿；它不只服务真实文件模式。） */
  function translationGuards(cn, tr, lang) {
    var v = [];
    if (!String(tr || '').trim()) {
      v.push({ level: 'hard', guard: '译文为空', why: '没有译文就不能声称已覆盖该语言。' });
      return v;
    }
    var a = numTokens(cn), b = numTokens(tr);
    if (a.join('|') !== b.join('|')) {
      v.push({ level: 'hard', guard: '译文数字与中文不一致',
        why: '中文 [' + a.join(',') + '] / 译文 [' + b.join(',') +
             ']。金额、倍数、期限译错是最危险的一类错误。' });
    }
    // 明显错语种：自己就把俄文词写进过日文文本，模型同样会
    if (/[Ѐ-ӿ؀-ۿ가-힯]/.test(tr)) {
      v.push({ level: 'hard', guard: '译文含非目标语种字符',
        why: '检出西里尔 / 阿拉伯 / 谚文字符，属明显错语种。' });
    }
    // 日文里一个假名都没有，基本就是照抄中文而非翻译
    if (lang === 'ja' && !/[぀-ヿ]/.test(tr)) {
      v.push({ level: 'hard', guard: '日文译文里没有任何假名',
        why: '很可能只是照抄了中文汉字，并未真正翻译。' });
    }
    // 不能用上面那个 IIFE 里的 norm()：本块是另一个 IIFE，取不到（实测报 norm is not defined）
    var bare = function (x) { return String(x || '').replace(/[\s　。、，,．.；;：:]/g, ''); };
    if (lang === 'ja' && bare(tr) === bare(cn)) {
      v.push({ level: 'hard', guard: '译文与中文完全相同', why: '未发生翻译。' });
    }
    return v;
  }

  /* 机器译文草稿：同样默认未批准，未批准不得当作已覆盖该语言 */
  function newTranslationDraft(clauseId, titleCn, cn, item, lang) {
    var v = translationGuards(cn, item.text, lang);
    return {
      clause_id: clauseId, title_cn: titleCn, lang: lang,
      text: item.text, source_cn: cn,
      numbers_checked: item.numbers_checked || [],
      uncertain: item.uncertain || '',
      provenance: 'model',
      violations: v,
      approvable: !v.some(function (x) { return x.level === 'hard'; }),
      state: 'draft', decided_by: null, decided_at: null
    };
  }

  function decideTranslation(list, clauseId, state, who, at) {
    if (APPROVAL_STATES.indexOf(state) < 0) throw new Error('非法状态：' + state);
    var hit = null;
    (list || []).forEach(function (c) { if (c.clause_id === clauseId) hit = c; });
    if (!hit) return null;
    if (state === 'approved' && hit.approvable === false) {
      throw new Error('该译文有未解决的护栏违规，不能批准：' +
        hit.violations.filter(function (x) { return x.level === 'hard'; })
          .map(function (x) { return x.guard; }).join('、'));
    }
    hit.state = state;
    hit.decided_by = state === 'draft' ? null : (who || null);
    hit.decided_at = state === 'draft' ? null : (at || null);
    return hit;
  }

  /* 已批准的译文才算数 —— 草稿不得计入语言覆盖率 */
  function approvedTranslations(list) {
    var out = {};
    (list || []).forEach(function (c) { if (c.state === 'approved') out[c.clause_id] = c.text; });
    return out;
  }

  /* 条款草稿：模型起草的条款文本，同样待批 */
  function newClauseDraft(spec, drafted) {
    var v = draftGuards(drafted);
    return {
      id: spec.id || ('CD-' + Math.abs(String(spec.purpose || '').length * 7 + 1)),
      purpose: spec.purpose,
      title_cn: drafted.title_cn, title_en: drafted.title_en,
      text_cn: drafted.text_cn, text_en: drafted.text_en, text_ja: drafted.text_ja,
      basis: drafted.basis, caveats: drafted.caveats || [],
      provenance: 'model',
      violations: v,
      // hard 违规的草稿连批准按钮都不该给 —— 门禁不是提示，是拦住
      approvable: !v.some(function (x) { return x.level === 'hard'; }),
      state: 'draft',
      decided_by: null, decided_at: null,
      // 起草文本一律带占位符，实际值由程序填 —— 模型不写具体金额与期限
      placeholders: (String(drafted.text_cn).match(/\{\{\w+\}\}/g) || [])
    };
  }

  /* 起草依据已经消失的草稿。
     场景：你批准了一条模型提炼的规则 → 它带出一个问题 → 你答「适用」→ 模型起草
     → 你批准写入正文 → 之后你又撤销了那条规则。此时条款的起草依据不在了，
     但正文里那一条是你亲手批准的。
     两种静默处理都不可接受：悄悄删掉是推翻人的决定，悄悄留着是隐瞒依据已失效。
     所以这里只负责把这种草稿找出来，交由界面显示、由人再决定一次。 */
  function orphanDrafts(clauseDrafts, liveQuestionIds) {
    var live = {};
    (liveQuestionIds || []).forEach(function (x) { live[x] = true; });
    return (clauseDrafts || []).filter(function (c) {
      return c.question_id && !live[c.question_id];
    });
  }

  /* 批准条款草稿。hard 违规的草稿无论谁点都不能批 —— 抛错，不静默降级。 */
  function decideClauseDraft(list, id, state, who, at) {
    if (APPROVAL_STATES.indexOf(state) < 0) throw new Error('非法状态：' + state);
    var hit = null;
    (list || []).forEach(function (c) { if (c.id === id) hit = c; });
    if (!hit) return null;
    if (state === 'approved' && hit.approvable === false) {
      throw new Error('该草稿有未解决的护栏违规，不能批准：' +
        hit.violations.filter(function (x) { return x.level === 'hard'; })
          .map(function (x) { return x.guard; }).join('、'));
    }
    hit.state = state;
    hit.decided_by = state === 'draft' ? null : (who || null);
    hit.decided_at = state === 'draft' ? null : (at || null);
    return hit;
  }

  /* 装配真实模式的初稿：每一节都必须标明来源，未批准的草稿不得写入正文 */
  function assembleRealDraft(realAnalysis, decisions, clauseDrafts) {
    decisions = decisions || {};
    var sections = [], skipped = [];
    var d = realAnalysis.diff;

    // 1) 匹配上且未变的：沿用旧合同文本
    d.unchanged.forEach(function (p, i) {
      sections.push({ key: 'U' + i, title: p.new_title, text: p.old_text,
        origin: 'prior_contract', origin_cn: '沿用上年度合同', needs_decision: false });
    });

    // 2) 有变化的：按人的决定取新或旧；未决定的写入占位并标注
    d.modified.forEach(function (p, i) {
      var key = 'M' + i, dec = decisions[key];
      if (dec === 'accept_new') {
        sections.push({ key: key, title: p.new_title, text: p.new_text,
          origin: 'new_template', origin_cn: '采用本年度模板',
          diff_class: p.diff_class || null, needs_decision: false });
      } else if (dec === 'keep_old') {
        sections.push({ key: key, title: p.old_title, text: p.old_text,
          origin: 'prior_contract', origin_cn: '保留上年度条款', needs_decision: false });
      } else {
        sections.push({ key: key, title: p.new_title,
          text: '［待确认：本条在本年度模板中有变化，尚未决定采用哪一版］\n\n' + p.new_text,
          origin: 'undecided', origin_cn: '未决定', diff_class: p.diff_class || null,
          needs_decision: true });
      }
    });

    // 3) 模板新增的：默认不写入，需人明确接受
    d.added.forEach(function (p, i) {
      var key = 'A' + i;
      if (decisions[key] === 'accept_new') {
        sections.push({ key: key, title: p.new_title, text: p.new_text,
          origin: 'new_template', origin_cn: '采用模板新增条款', needs_decision: false });
      } else {
        skipped.push({ key: key, title: p.new_title, reason: '模板新增条款，尚未确认是否加入' });
      }
    });

    // 4) 模型起草的条款：只有已批准的才进正文
    (clauseDrafts || []).forEach(function (cd) {
      if (cd.state === 'approved') {
        sections.push({ key: cd.id, title: cd.title_cn, text: cd.text_cn,
          origin: 'model_draft_approved', origin_cn: '模型起草 · 已经人批准',
          needs_decision: false });
      } else {
        skipped.push({ key: cd.id, title: cd.title_cn,
          reason: '模型起草的条款未获批准，不写入正文（状态：' + cd.state + '）' });
      }
    });

    var byOrigin = {};
    sections.forEach(function (x) { byOrigin[x.origin] = (byOrigin[x.origin] || 0) + 1; });
    return {
      sections: sections, skipped: skipped, byOrigin: byOrigin,
      undecided: sections.filter(function (x) { return x.needs_decision; }).length,
      // 门禁：还有未决定的条款就不能算初稿完成
      draftComplete: sections.filter(function (x) { return x.needs_decision; }).length === 0
                     && sections.length > 0
    };
  }

  R.newRuleProposals = newRuleProposals;
  R.decideProposal = decideProposal;
  R.proposalSummary = proposalSummary;
  R.activeRules = activeRules;
  R.proposalQuestions = proposalQuestions;
  R.orphanDrafts = orphanDrafts;
  R.translationGuards = translationGuards;
  R.newTranslationDraft = newTranslationDraft;
  R.decideTranslation = decideTranslation;
  R.approvedTranslations = approvedTranslations;
  R.newClauseDraft = newClauseDraft;
  R.decideClauseDraft = decideClauseDraft;
  R.draftGuards = draftGuards;
  R.numTokens = numTokens;
  R.assembleRealDraft = assembleRealDraft;
  R.APPROVAL_STATES = APPROVAL_STATES;
})(typeof window !== 'undefined' ? window : globalThis);

/* ============================================================================
   TP Engagement Agent · 模型接入适配层
   ----------------------------------------------------------------------------
   本文件是全项目【唯一】允许发起网络请求的文件。

   四条硬约束：
     1. 默认关闭。未配置端点时 enabled() === false，全站使用预置结果，零网络请求，
        离线保证与比赛现场稳定性完全不变。
     2. 结构化输出 + JSON Schema 校验。模型必须返回符合 schema 的 JSON；
        校验不通过视为失败。
     3. 超时 / 失败 / 校验不通过 / 安全拒答 → 抛错 → 上层捕获后回退预置结果，
        界面提示「已回退演示数据」（PRD §14.2、§18.3）。
     4. 每次调用记入审计（actor_type='model'），记录端点、模型、耗时、是否回退。

   责任边界不变（PRD §9.2 / §5.4）：模型只做提取、语义分类、解释、双语比对四件事；
   规则引擎求值、金额与大写、条款编号与交叉引用、一致性检查、门禁判定、
   责任限额与条款增删决定，一律仍由确定性程序与人负责，绝不交给模型。

   协议：
     · anthropic —— Claude Messages API 形状（api.anthropic.com）
     · openai    —— OpenAI 兼容形状（DeepSeek 等），/chat/completions
     · gateway   —— 企业内网网关，沿用 Messages API 形状，鉴权与 CORS 由网关负责

   注意两种协议的「结构化输出」强度不同：
     Messages API 的 output_config.format 由服务端按 schema 强约束；
     OpenAI 兼容的 response_format:{type:'json_object'} 只保证是合法 JSON、不校验 schema。
   因此本文件的客户端 schema 校验对 openai 协议是必需的兜底，而非冗余。
   ========================================================================== */
(function (global) {
  'use strict';

  var D = global.TPData;

  /* ------------------------------------------------------------------ 配置 */
  var CFG = {
    protocol: 'anthropic',
    endpoint: '',
    apiKey: '',
    model: 'claude-opus-5',
    effort: 'low',
    timeoutMs: 60000,
    maxTokens: 16000
  };

  var DEFAULT_ENDPOINT = 'https://api.anthropic.com/v1/messages';
  var DEFAULT_ENDPOINT_OPENAI = 'https://api.deepseek.com/chat/completions';
  var ANTHROPIC_VERSION = '2023-06-01';

  // 调用记录（供界面与审计展示）
  var callLog = [];

  function configure(cfg) {
    for (var k in cfg) {
      if (Object.prototype.hasOwnProperty.call(cfg, k) && Object.prototype.hasOwnProperty.call(CFG, k)) {
        CFG[k] = cfg[k];
      }
    }
    if (!CFG.endpoint) {
      if (CFG.protocol === 'anthropic') CFG.endpoint = DEFAULT_ENDPOINT;
      else if (CFG.protocol === 'openai') CFG.endpoint = DEFAULT_ENDPOINT_OPENAI;
    }
    return getConfig();
  }

  function getConfig() {
    return {
      protocol: CFG.protocol, endpoint: CFG.endpoint, model: CFG.model,
      effort: CFG.effort, timeoutMs: CFG.timeoutMs, maxTokens: CFG.maxTokens,
      hasKey: !!CFG.apiKey
    };
  }

  /** 未配置端点（anthropic 协议还需 API Key）时一律返回 false —— 全站零请求 */
  function enabled() {
    if (!CFG.endpoint) return false;
    if ((CFG.protocol === 'anthropic' || CFG.protocol === 'openai') && !CFG.apiKey) return false;
    return true;
  }

  function reset() {
    CFG.endpoint = ''; CFG.apiKey = ''; callLog = [];
    bilingualVerdict = null; guardLog = []; docIndex = null;
  }

  function log() { return callLog.slice(); }

  /* -------------------------------------------------------------- 请求封装 */
  function headers() {
    var h = { 'content-type': 'application/json' };
    if (CFG.protocol === 'anthropic') {
      h['x-api-key'] = CFG.apiKey;
      h['anthropic-version'] = ANTHROPIC_VERSION;
      // 浏览器直连 Claude API 必需。官方明确标注此方式会在前端暴露密钥，
      // 仅适用于「可控内部工具」或「短期/可轮换的开发凭据」——本演示属前者。
      // 生产部署应改用 gateway 协议，由企业内网网关持有密钥。
      h['anthropic-dangerous-direct-browser-access'] = 'true';
    } else if (CFG.apiKey) {
      // openai 兼容协议与企业网关均使用 Bearer
      h['authorization'] = 'Bearer ' + CFG.apiKey;
    }
    return h;
  }

  /**
   * 调用一次模型并取回结构化 JSON。
   * @param {string} task     任务标识（记入审计）
   * @param {string} system   系统提示
   * @param {string} user     用户消息
   * @param {object} schema   JSON Schema（结构化输出约束）
   * @returns {Promise<object>} 校验通过的对象
   */
  function callJson(task, system, user, schema) {
    var started = Date.now();
    var ctl = new AbortController();
    var timer = setTimeout(function () { ctl.abort(); }, CFG.timeoutMs);

    var body;
    if (CFG.protocol === 'openai') {
      // OpenAI 兼容：system 作为一条 message；JSON 模式只保证合法 JSON，
      // 不按 schema 约束，所以把 schema 明确写进提示，再靠客户端校验兜底。
      body = {
        model: CFG.model,
        max_tokens: CFG.maxTokens,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user + '\n\n只输出 json，且必须严格符合以下 JSON Schema（不要多出任何字段）：\n' + JSON.stringify(schema) }
        ]
      };
    } else {
      body = {
        model: CFG.model,
        max_tokens: CFG.maxTokens,
        system: system,
        messages: [{ role: 'user', content: user }],
        // 结构化输出：约束响应为符合 schema 的 JSON（不是已废弃的 output_format）
        output_config: {
          format: { type: 'json_schema', schema: schema },
          effort: CFG.effort
        }
      };
    }

    function record(ok, detail, extra) {
      var rec = {
        task: task, ok: ok, detail: detail,
        ms: Date.now() - started,
        endpoint: CFG.endpoint, model: CFG.model,
        at: global.TPEngine ? global.TPEngine.nowStamp() : ''
      };
      if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) rec[k] = extra[k];
      callLog.push(rec);
      return rec;
    }

    return fetch(CFG.endpoint, {
      method: 'POST', headers: headers(), body: JSON.stringify(body), signal: ctl.signal
    }).then(function (res) {
      return res.text().then(function (txt) { return { status: res.status, ok: res.ok, txt: txt }; });
    }).then(function (r) {
      clearTimeout(timer);
      if (!r.ok) {
        var msg = 'HTTP ' + r.status;
        try {
          var errObj = JSON.parse(r.txt);
          if (errObj && errObj.error && errObj.error.message) msg += '：' + errObj.error.message;
        } catch (e) { if (r.txt) msg += '：' + r.txt.slice(0, 200); }
        record(false, msg);
        throw new Error(msg);
      }
      var payload = JSON.parse(r.txt);
      var text = '', usage = payload.usage || {}, served = payload.model, stop = null;

      if (CFG.protocol === 'openai') {
        var ch = (payload.choices || [])[0];
        if (!ch) { record(false, '响应中无 choices'); throw new Error('空响应'); }
        stop = ch.finish_reason;
        if (stop === 'length') {
          record(false, '输出被 max_tokens 截断（finish_reason=length）', { truncated: true });
          throw new Error('输出被截断');
        }
        if (stop === 'content_filter') {
          record(false, '被内容过滤拦截（finish_reason=content_filter）', { refusal: true });
          throw new Error('模型拒答');
        }
        text = (ch.message && ch.message.content) || '';
      } else {
        stop = payload.stop_reason;
        // Claude Opus 5 的安全分类器可能拒答：HTTP 200 + stop_reason='refusal'，
        // 此时 content 为空或仅有部分内容 —— 必须先判断再读 content。
        if (stop === 'refusal') {
          var cat = (payload.stop_details && payload.stop_details.category) || '未分类';
          record(false, '模型安全拒答（category=' + cat + '）', { refusal: true });
          throw new Error('模型拒答');
        }
        (payload.content || []).forEach(function (b) { if (b.type === 'text' && b.text) text += b.text; });
      }

      if (!text) {
        record(false, '响应中无文本内容（finish/stop=' + stop + '）');
        throw new Error('空响应');
      }

      var obj;
      try { obj = JSON.parse(text); }
      catch (e) { record(false, 'JSON 解析失败'); throw new Error('JSON 解析失败'); }

      var v = validate(obj, schema, '$');
      if (v) { record(false, 'Schema 校验失败：' + v); throw new Error('Schema 校验失败：' + v); }

      record(true, '成功', {
        input_tokens: usage.input_tokens != null ? usage.input_tokens : usage.prompt_tokens,
        output_tokens: usage.output_tokens != null ? usage.output_tokens : usage.completion_tokens,
        stop_reason: stop, served_model: served
      });
      return obj;
    }).catch(function (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        record(false, '超时（>' + CFG.timeoutMs + 'ms）', { timeout: true });
        throw new Error('模型调用超时');
      }
      // fetch 本身失败（CORS / 网络 / DNS）时 message 通常很含糊，补充提示
      if (err instanceof TypeError) {
        record(false, '网络或 CORS 失败：' + err.message, { cors: true });
        throw new Error('网络或 CORS 失败');
      }
      throw err;
    });
  }

  /* ------------------------------------------------------ 轻量 Schema 校验 */
  /** 返回 null 表示通过，否则返回第一处错误路径说明 */
  function validate(v, s, path) {
    if (!s) return null;
    if (s.anyOf) {
      for (var i = 0; i < s.anyOf.length; i++) if (!validate(v, s.anyOf[i], path)) return null;
      return path + ' 不匹配 anyOf';
    }
    switch (s.type) {
      case 'object':
        if (v === null || typeof v !== 'object' || Array.isArray(v)) return path + ' 应为 object';
        var req = s.required || [];
        for (var r = 0; r < req.length; r++) {
          if (!Object.prototype.hasOwnProperty.call(v, req[r])) return path + '.' + req[r] + ' 缺失';
        }
        if (s.additionalProperties === false) {
          for (var key in v) {
            if (Object.prototype.hasOwnProperty.call(v, key) && !(s.properties && s.properties[key])) {
              return path + '.' + key + ' 为未声明字段';
            }
          }
        }
        for (var p in (s.properties || {})) {
          if (Object.prototype.hasOwnProperty.call(v, p)) {
            var e = validate(v[p], s.properties[p], path + '.' + p);
            if (e) return e;
          }
        }
        return null;
      case 'array':
        if (!Array.isArray(v)) return path + ' 应为 array';
        for (var j = 0; j < v.length; j++) {
          var ee = validate(v[j], s.items, path + '[' + j + ']');
          if (ee) return ee;
        }
        return null;
      case 'string':  return typeof v === 'string' ? null : path + ' 应为 string';
      case 'number':  return typeof v === 'number' && isFinite(v) ? null : path + ' 应为 number';
      case 'integer': return typeof v === 'number' && v % 1 === 0 ? null : path + ' 应为 integer';
      case 'boolean': return typeof v === 'boolean' ? null : path + ' 应为 boolean';
      case 'null':    return v === null ? null : path + ' 应为 null';
      default: return null;
    }
  }

  /* ------------------------------------------------------------ 文档序列化 */
  function docText(d) {
    var out = '【文件 ' + d.document_id + '｜' + d.document_type_cn + '｜' + d.filename + '】\n';
    if (d.sections) {
      d.sections.forEach(function (s) {
        out += '[' + s.no + '] ' + s.title_cn + '（' + s.clause_id + '）\n中文：' + s.text_cn + '\nEN：' + s.text_en + '\n';
      });
    }
    if (d.rows) {
      d.rows.forEach(function (r) { out += '- ' + r.field + '：' + (r.value === '' ? '（空值）' : r.value) + '\n'; });
    }
    return out + '\n';
  }

  /* ====================================================== 证据校验（确定性护栏）
     实测发现：真实模型会（a）为「未填写」的字段给出确定结论，并（b）编造一条
     文档里根本不存在的引文来支撑它 —— 一次真实运行中它对「是否涉及美国业务」
     断言「否」、置信度 0.99，引文之一是空值单元格，另一条是虚构的。
     这会直接关掉本 Demo 最核心的冲突检测。提示词无法可靠约束这件事，
     因此在确定性层设两道护栏（§9.6 防幻觉）：
       护栏 1（引文可核对）：每条来源的引文必须能在其声称的文档里找到，否则丢弃该来源。
       护栏 2（不得以「无证据」为证据）：若某个确定值剩下的引文全是空值标记，
                                        则该断言不成立 → 值归 null、置信度归 0。
     两道护栏都过不了（无任何可核对来源）→ 整个字段沿用预置值。
     ======================================================================== */

  var docIndex = null;
  function nrm(x) { return String(x == null ? '' : x).replace(/\s+/g, '').toLowerCase(); }

  function buildDocIndex() {
    docIndex = {};
    (D.DOCUMENTS || []).forEach(function (d) {
      var buf = [d.filename, d.document_type_cn, d.version];
      (d.sections || []).forEach(function (sec) {
        buf.push(sec.no, sec.title_cn, sec.title_en, sec.text_cn, sec.text_en, sec.clause_id);
      });
      (d.rows || []).forEach(function (r) { buf.push(r.field, r.value, r.field + '：' + r.value); });
      docIndex[d.document_id] = nrm(buf.join('\n'));
    });
  }

  // 空值标记：模型常用来表示「这一格没填」
  var EMPTY_MARK = /^(（空值）|\(空值\)|空值|空|未填写|未提供|未提及|无|n\/a|na|empty|blank|null|—|-)$/i;
  function quoteIsEmptyMark(q) {
    var body = String(q || '').replace(/^[^：:]{0,40}[：:]\s*/, '').trim();
    return !body || EMPTY_MARK.test(body);
  }

  /** 只保留引文能在所声称文档中核对到的来源 */
  function verifySources(sources) {
    if (!docIndex) buildDocIndex();
    var kept = [], dropped = [];
    (sources || []).forEach(function (sc) {
      var idx = docIndex[sc.document_id];
      if (idx === undefined) { dropped.push({ src: sc, why: '文档编号不存在' }); return; }
      if (quoteIsEmptyMark(sc.quote)) { kept.push(sc); return; }
      // 模型常在引文前带上「文件名：」或「字段名：」前缀，去掉前缀后再比一次，
      // 减少误杀；去掉前缀后的正文仍必须逐字出现在文档中，护栏强度不变。
      var raw = String(sc.quote || '');
      var cands = [raw];
      var stripped = raw.replace(/^[^：:]{0,60}[：:]\s*/, '');
      if (stripped && stripped !== raw) cands.push(stripped);
      for (var ci = 0; ci < cands.length; ci++) {
        var q = nrm(cands[ci]);
        if (q.length < 4) continue;
        if (idx.indexOf(q) >= 0) { kept.push(sc); return; }
      }
      if (nrm(raw).length < 4) { dropped.push({ src: sc, why: '引文过短，无法核对' }); return; }
      dropped.push({ src: sc, why: '引文在该文档中不存在（疑似编造）' });
    });
    return { sources: kept, dropped: dropped };
  }

  var BOUNDARY = '你只负责阅读、比较、摘要与解释。你绝不判断法律效力、绝不自行决定责任限额、' +
    '绝不凭空补全客户事实、绝不自行计算或修改费用、绝不自行决定是否删除条款。' +
    '没有来源支撑的信息必须留空并把置信度设为 0，不要猜测。只输出符合 schema 的 JSON。';

  /* ============================================================ 任务 1：字段提取 */
  var FACTS_SCHEMA = {
    type: 'object',
    properties: {
      facts: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            field_name: { type: 'string' },
            value: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            confidence: { type: 'number' },
            sources: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  document_id: { type: 'string' },
                  section: { type: 'string' },
                  quote: { type: 'string' }
                },
                required: ['document_id', 'section', 'quote'],
                additionalProperties: false
              }
            }
          },
          required: ['field_name', 'value', 'confidence', 'sources'],
          additionalProperties: false
        }
      }
    },
    required: ['facts'],
    additionalProperties: false
  };

  function extractFacts(facts, documents) {
    var fieldList = facts.map(function (f) {
      return '- ' + f.field_name + '（' + f.label_cn + '，组：' + f.group + '）';
    }).join('\n');

    var system = '你是转让定价合同签约助手的字段提取模块。' + BOUNDARY +
      '\n\n对每个字段，只从【本年度资料】（客户信息表、费用批准信息）中提取今年的取值，' +
      '不要用上年度合同的值填充今年。若本年度资料未提供该信息，value 置为 null、confidence 置为 0，' +
      '并在 sources 中指出你查过的位置（quote 可写「（空值）」）。' +
      'confidence 取 0 到 1 之间的小数，代表你对该取值的确信程度，不代表法律正确率。' +
      '每个字段至少给出一条 sources，document_id 必须是下方文件中出现过的编号。';

    var user = '需要提取的字段：\n' + fieldList + '\n\n以下是全部输入文件：\n\n' +
      documents.map(docText).join('') +
      '请提取上述每一个字段，返回 JSON。';

    return callJson('extractFacts', system, user, FACTS_SCHEMA);
  }

  /* ========================================================================
     真实文件模式的模型任务（任务 5—8）
     ------------------------------------------------------------------------
     这几项是正则做不好、必须交给模型的：
       5. 从真实合同里抽字段    —— 正则在真实合同上只有 3—5/8
       6. 条款语义匹配          —— 标题措辞变了，字符串相似度就失效
       7. 差异语义分级          —— 原来是一张写死的表，这是最该交给模型的一项
       8. 条件性条款适用判定辅助 —— 模型给建议与理由，人做决定

     不变的是验证层：模型给的每一处引文都要能在原文里逐字找到（护栏一），
     空值不能当证据（护栏二），数值一律由程序重算。模型提议，程序核验。
     ======================================================================== */

  function clausesText(doc, limit) {
    var cs = (doc.clauses || []).slice(0, limit || 60);
    return cs.map(function (c, i) {
      return '[' + (i + 1) + '] ' + c.title + '\n' + String(c.text).slice(0, 900);
    }).join('\n\n');
  }

  function tablesText(doc, limit) {
    return (doc.tables || []).slice(0, limit || 8).map(function (rows, ti) {
      return '表格 ' + (ti + 1) + '：\n' + rows.slice(0, 20).map(function (r) {
        return '  ' + r.join(' | ');
      }).join('\n');
    }).join('\n');
  }

  /* ---------------------------------------- 任务 5：真实合同字段提取 */
  var REALFIELDS_SCHEMA = {
    type: 'object',
    properties: {
      fields: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            field: { type: 'string' },
            value: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            confidence: { type: 'number' },
            quote: { type: 'string' },
            where: { type: 'string' }
          },
          required: ['field', 'value', 'confidence', 'quote', 'where'],
          additionalProperties: false
        }
      }
    },
    required: ['fields'],
    additionalProperties: false
  };

  function extractRealFields(doc, wanted) {
    var system = '你是转让定价业务约定书的字段提取模块。' + BOUNDARY +
      '\n\n只从下方给出的合同正文与表格中提取，不得使用任何外部知识补全。' +
      '每个字段必须给出 quote —— 从原文中逐字复制的一小段（含该值），' +
      'where 写明它出现在哪一条条款或哪个表格。' +
      '找不到就把 value 置为 null、confidence 置为 0、quote 写「（未找到）」——' +
      '绝不猜测，也不要用常见值或行业惯例填充。' +
      '注意：服务费等金额常常写在表格里（表头一格、数值另一格）。';
    var user = '需要提取的字段：\n' +
      wanted.map(function (w) { return '- ' + w.field + '（' + w.label + '）'; }).join('\n') +
      '\n\n合同条款：\n' + clausesText(doc) +
      '\n\n合同表格：\n' + tablesText(doc) +
      '\n\n请逐字段返回 JSON。';
    return callJson('extractRealFields', system, user, REALFIELDS_SCHEMA);
  }

  /* ---------------------------------------- 任务 6：条款语义匹配 */
  var MATCH_SCHEMA = {
    type: 'object',
    properties: {
      pairs: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            old_index: { type: 'integer' },
            new_index: { type: 'integer' },
            confidence: { type: 'number' },
            reason: { type: 'string' }
          },
          required: ['old_index', 'new_index', 'confidence', 'reason'],
          additionalProperties: false
        }
      },
      only_in_new: { type: 'array', items: { type: 'integer' } },
      only_in_old: { type: 'array', items: { type: 'integer' } }
    },
    required: ['pairs', 'only_in_new', 'only_in_old'],
    additionalProperties: false
  };

  function matchClausesSemantic(oldDoc, newDoc) {
    var system = '你是合同条款比对模块。' + BOUNDARY +
      '\n\n把「上年度合同」的条款与「本年度标准模板」的条款按**内容对应关系**配对。' +
      '标题措辞和条款编号都可能变，所以不要只看标题 —— 要看条款讲的是不是同一件事。' +
      '序号用我给出的方括号编号（从 1 开始）。' +
      '一个条款最多只能出现在一个配对里。' +
      '确实在另一份里没有对应条款的，放进 only_in_new / only_in_old。' +
      'confidence 表示你对这个配对的确信程度。reason 用一句话说明依据。';
    var user = '【上年度合同】\n' + clausesText(oldDoc) +
      '\n\n【本年度标准模板】\n' + clausesText(newDoc) +
      '\n\n请返回配对结果 JSON。';
    return callJson('matchClausesSemantic', system, user, MATCH_SCHEMA);
  }

  /* ---------------------------------------- 任务 7：差异语义分级 */
  var REALDIFF_SCHEMA = {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            pair_index: { type: 'integer' },
            diff_class: { type: 'string', enum: ['substantive', 'wording_only', 'format_only'] },
            risk_level: { type: 'string', enum: ['high', 'medium', 'low'] },
            rationale: { type: 'string' },
            plain_explanation: { type: 'string' }
          },
          required: ['pair_index', 'diff_class', 'risk_level', 'rationale', 'plain_explanation'],
          additionalProperties: false
        }
      }
    },
    required: ['items'],
    additionalProperties: false
  };

  function classifyRealDiffs(pairs) {
    var system = '你是合同差异分级模块。' + BOUNDARY +
      '\n\n对每一对条款判断本次改动属于哪一类：' +
      'substantive（实质性权利义务变化，例如责任上限、付款义务、数据处理方式、条款增删）；' +
      'wording_only（只是措辞更清楚，权利义务没变）；' +
      'format_only（仅版式、编号、标点）。' +
      '\n重要：即使判为 wording_only，也不代表可以不看 —— ' +
      '分级只用于排序与提示强度，不代表可以跳过人工确认。' +
      '\nrisk_level 表示漏看这条的后果严重程度。' +
      'rationale 写给专业人员看（可用术语）；plain_explanation 用非法律语言，' +
      '说清「改了什么、对我方意味着什么」，不超过 80 字。' +
      '\n不要臆测未给出的条款内容，只依据下方原文。';
    var user = pairs.map(function (p, i) {
      return '[' + (i + 1) + '] 条款：' + p.new_title +
        '\n旧：' + String(p.old_text).slice(0, 700) +
        '\n新：' + String(p.new_text).slice(0, 700);
    }).join('\n\n') + '\n\n请逐对返回 JSON。';
    return callJson('classifyRealDiffs', system, user, REALDIFF_SCHEMA);
  }

  /* ---------------------------------------- 任务 8：条件性条款适用判定辅助 */
  var COND_SCHEMA = {
    type: 'object',
    properties: {
      judgements: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            suggestion: { type: 'string', enum: ['applicable', 'not_applicable', 'need_more_info'] },
            confidence: { type: 'number' },
            reason: { type: 'string' },
            evidence: { type: 'string' }
          },
          required: ['id', 'suggestion', 'confidence', 'reason', 'evidence'],
          additionalProperties: false
        }
      }
    },
    required: ['judgements'],
    additionalProperties: false
  };

  function judgeConditionals(questions, doc) {
    var system = '你是条件性条款适用性判定的辅助模块。' + BOUNDARY +
      '\n\n下面每一条都是标准模板原文写明的「什么情况下要加什么条款」。' +
      '请根据上年度合同的实际内容判断该条件今年是否可能适用。' +
      '\n**你只给建议，不做决定** —— 最终由授权的专业人员确认。' +
      '\nevidence 必须是从合同原文逐字复制的一小段；' +
      '找不到支持或反对的依据时，suggestion 必须是 need_more_info、' +
      'evidence 写「（合同中无相关表述）」，不要用「未提及」推断出「不适用」——' +
      '资料缺失不等于条件不成立。';
    var user = '【标准模板写明的条件】\n' +
      questions.map(function (q) { return q.id + '：' + q.text; }).join('\n') +
      '\n\n【上年度合同条款】\n' + clausesText(doc, 40) +
      '\n\n请逐条返回 JSON。';
    return callJson('judgeConditionals', system, user, COND_SCHEMA);
  }

  /* ======================================================= 任务 2：语义差异分类 */
  var DIFF_SCHEMA = {
    type: 'object',
    properties: {
      classifications: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            clause_id: { type: 'string' },
            diff_class: { type: 'string' },
            rationale: { type: 'string' }
          },
          required: ['clause_id', 'diff_class', 'rationale'],
          additionalProperties: false
        }
      }
    },
    required: ['classifications'],
    additionalProperties: false
  };

  var VALID_DIFF_CLASS = ['format_only', 'wording_only', 'substantive', 'undetermined'];

  function classifyDiffs(clauseIds, oldSecs, newSecs) {
    function find(arr, id) { for (var i = 0; i < arr.length; i++) if (arr[i].clause_id === id) return arr[i]; return null; }

    var pairs = clauseIds.map(function (id) {
      var o = find(oldSecs, id), n = find(newSecs, id);
      if (!o || !n) return '';
      return '### ' + id + '\n【2025 v3.2】' + o.title_cn + '：' + o.text_cn +
        '\nEN：' + o.text_en + '\n【2026 v4.0】' + n.title_cn + '：' + n.text_cn +
        '\nEN：' + n.text_en + '\n';
    }).filter(Boolean).join('\n');

    var system = '你是转让定价合同签约助手的模板差异分析模块。' + BOUNDARY +
      '\n\n对每一条条款，比较 2025 与 2026 标准模板的文本，判断本次修改属于哪一类，' +
      'diff_class 只能取以下四个值之一：\n' +
      '- substantive：实质性权利义务变化（赔偿上限、责任分担、合规前置要求、客户权利等发生改变）\n' +
      '- wording_only：文字优化，权利义务未变（措辞更严谨、补充示例、同义替换）\n' +
      '- format_only：纯格式变化（排版、编号、页眉页脚）\n' +
      '- undetermined：无法确定，需要人工判断\n' +
      'rationale 用一句中文说明判断依据。判断不了就用 undetermined，不要勉强归类。';

    var user = '请对以下条款逐条分类：\n\n' + pairs + '\n返回 JSON。';

    return callJson('classifyDiffs', system, user, DIFF_SCHEMA);
  }

  /* ========================================================= 任务 3：大白话解释 */
  var EXPLAIN_SCHEMA = {
    type: 'object',
    properties: {
      explanations: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            change_id: { type: 'string' },
            explanation: { type: 'string' }
          },
          required: ['change_id', 'explanation'],
          additionalProperties: false
        }
      }
    },
    required: ['explanations'],
    additionalProperties: false
  };

  function explainChanges(changes) {
    var list = changes.map(function (c) {
      return '### ' + c.change_id + '｜' + c.title + '\n风险：' + c.risk_level +
        '\n触发原因：' + c.reason +
        '\n原文：' + String(c.old_text).slice(0, 600) +
        '\n建议文本：' + String(c.proposed_text).slice(0, 600) + '\n';
    }).join('\n');

    var system = '你是转让定价合同签约助手，负责用大白话向顾问解释「为什么这一项需要人来确认」。' + BOUNDARY +
      '\n\n每条解释 2 到 4 句中文，要求：说清这次到底变了什么、为什么它不是小事、' +
      '以及漏掉它会有什么后果。不要复述法条，不要用「综上所述」这类套话，' +
      '不要给出法律结论，也不要替人做决定 —— 你的作用是让人看懂后自己判断。';

    var user = '请为以下变更项各写一段解释：\n\n' + list + '\n返回 JSON。';

    return callJson('explainChanges', system, user, EXPLAIN_SCHEMA);
  }

  /* ======================================================= 任务 4：双语语义比对 */
  var BILINGUAL_SCHEMA = {
    type: 'object',
    properties: {
      consistent: { type: 'boolean' },
      detail: { type: 'string' }
    },
    required: ['consistent', 'detail'],
    additionalProperties: false
  };

  function checkBilingual(section) {
    var system = '你是转让定价合同签约助手的中英文一致性检查模块。' + BOUNDARY +
      '\n\n比较同一条款的中文与英文文本，判断两者语义是否一致，' +
      '特别注意数字、倍数、金额、期限、主体范围、义务方向这些容易出错的地方。' +
      'consistent=false 时，detail 必须用中文具体指出不一致在哪、中文说什么、英文说什么。' +
      '你只负责发现不一致，不要给出应当采用哪一版的结论 —— 责任限额一类的口径必须由人裁定。';

    var user = '条款：第 ' + section.no + ' 条 ' + section.title_cn +
      '\n中文：' + section.text_cn + '\n英文：' + section.text_en + '\n返回 JSON。';

    return callJson('checkBilingual', system, user, BILINGUAL_SCHEMA);
  }

  /* ====================================================== 连通性测试（设置面板） */
  var PING_SCHEMA = {
    type: 'object',
    properties: { ok: { type: 'boolean' }, note: { type: 'string' } },
    required: ['ok', 'note'],
    additionalProperties: false
  };

  function testConnection() {
    return callJson('testConnection',
      '你是连通性测试端点。只输出 JSON。',
      '请返回 {"ok": true, "note": "connected"}。',
      PING_SCHEMA
    ).then(function (r) {
      var last = callLog[callLog.length - 1] || {};
      return { ok: !!r.ok, note: r.note, ms: last.ms, model: last.served_model || CFG.model };
    });
  }

  /* ==========================================================================
     统一入口：在分析流程中增强预置结果
     每个子任务独立 try/catch —— 任何一个失败只影响它自己，其余仍生效，
     失败部分沿用预置结果并记录回退原因。
     ========================================================================*/
  /* 双语比对的模型结论；引擎的一致性检查会取用（null 表示无模型结论） */
  var bilingualVerdict = null;
  function getBilingualVerdict() { return bilingualVerdict; }

  /* 确定性护栏拦下的模型输出（供界面与审计展示） */
  var guardLog = [];
  function getGuardLog() { return guardLog.slice(); }

  /* ========================================================================
     生成类模型任务（任务 9—11）—— 模型从「读」走到「写」
     ------------------------------------------------------------------------
     生成的文本一律标记为「未批准草稿」，必须经人确认才能进入合同。
     这不是保守：条款文本进了合同就是对客户的承诺，模型写的东西
     没有经过授权人员确认之前不能有这个地位。
     ======================================================================== */

  /* ---------------------------------------- 任务 9：从模板指引反向生成规则 */
  var RULEPROP_SCHEMA = {
    type: 'object',
    properties: {
      rules: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            when_text: { type: 'string' },
            then_text: { type: 'string' },
            clause_hint: { type: 'string' },
            risk_level: { type: 'string', enum: ['high', 'medium', 'low'] },
            approval: { type: 'string', enum: ['consultant', 'manager', 'partner'] },
            source_quote: { type: 'string' },
            confidence: { type: 'number' }
          },
          required: ['name', 'when_text', 'then_text', 'clause_hint',
                     'risk_level', 'approval', 'source_quote', 'confidence'],
          additionalProperties: false
        }
      }
    },
    required: ['rules'],
    additionalProperties: false
  };

  function proposeRules(guidance) {
    var system = '你是条款规则的提炼模块。' + BOUNDARY +
      '\n\n下面每一条都是标准模板原文写明的使用说明，其中包含「什么情况下要加什么条款」。' +
      '请把它们提炼成可执行的规则：' +
      'when_text 写触发条件（用业务语言描述，不要写代码）；' +
      'then_text 写触发后要做什么；clause_hint 写涉及哪一类条款。' +
      '\nrisk_level 表示漏掉这条规则的后果严重程度；' +
      'approval 表示该情形下加入条款应由谁确认' +
      '（consultant 一般事项 / manager 需经理及以上 / partner 涉及责任限额等重大商业条款）。' +
      '\n**source_quote 必须是从我给你的说明里逐字复制的一段** —— ' +
      '这是为了让人能回溯到模板原文。凭空提炼的规则不要输出。' +
      '\n只提炼真正构成「条件 → 动作」的说明；纯排版提示、示例占位符请跳过。';
    var user = guidance.map(function (g, i) {
      return '[' + (i + 1) + '] ' + String(g.text).slice(0, 400);
    }).join('\n') + '\n\n请提炼成规则，返回 JSON。';
    return callJson('proposeRules', system, user, RULEPROP_SCHEMA);
  }

  /* ---------------------------------------- 任务 10：条款文本起草 */
  var DRAFT_SCHEMA = {
    type: 'object',
    properties: {
      title_cn: { type: 'string' }, title_en: { type: 'string' },
      text_cn: { type: 'string' }, text_en: { type: 'string' },
      text_ja: { type: 'string' },
      basis: { type: 'string' },
      caveats: { type: 'array', items: { type: 'string' } }
    },
    required: ['title_cn', 'title_en', 'text_cn', 'text_en', 'text_ja', 'basis', 'caveats'],
    additionalProperties: false
  };

  function draftClause(spec) {
    var system = '你是合同条款起草模块。' + BOUNDARY +
      '\n\n按给定的用途起草一条业务约定书条款，输出中文、英文与日文三个版本。' +
      '\n硬性要求：' +
      '\n· 中文为准，英文与日文是对中文的准确对应，**数字、倍数、期限、金额三语必须完全一致**' +
      '\n· 不得写入任何具体金额、期限、主体名称的实际值 —— 用 {{占位符}} 表示，由程序填充' +
      '\n· 不得自行设定责任限额、赔偿倍数或任何风险敞口相关的数值' +
      '\n· basis 写明你依据了哪些给定信息' +
      '\n· caveats 列出你不确定、需要人工复核的地方（至少一条；没有就写明为什么没有）' +
      '\n你起草的文本会被标记为「未批准草稿」，必须经授权人员确认才会进入合同。';
    var user = '条款用途：' + spec.purpose +
      '\n服务类型：' + (spec.service || '（未指定）') +
      '\n适用情形：' + (spec.condition || '（未指定）') +
      (spec.reference ? '\n可参照的同类条款（仅供风格与结构参考，不要照抄）：\n' +
        String(spec.reference).slice(0, 800) : '') +
      '\n\n请起草并返回 JSON。';
    return callJson('draftClause', system, user, DRAFT_SCHEMA);
  }

  /* ---------------------------------------- 任务 11：译文生成 */
  var TRANS_SCHEMA = {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            clause_id: { type: 'string' },
            text: { type: 'string' },
            numbers_checked: { type: 'array', items: { type: 'string' } },
            uncertain: { type: 'string' }
          },
          required: ['clause_id', 'text', 'numbers_checked', 'uncertain'],
          additionalProperties: false
        }
      }
    },
    required: ['items'],
    additionalProperties: false
  };

  function translateClauses(items, lang) {
    var LN = { ja: '日文', en: '英文' }[lang] || lang;
    var system = '你是合同译文生成模块。' + BOUNDARY +
      '\n\n把给定的中文条款译成' + LN + '。中文为准，译文必须与中文完全对应。' +
      '\n**numbers_checked 里必须逐一列出该条款中出现的所有数字、倍数、期限、比例，' +
      '并确认译文中的对应值与中文一致** —— 译文里数字错了是最危险的错误类型，' +
      '事务所反馈里明确提到「人工修改不同语言版本很容易发生漏改」。' +
      '\nuncertain 写明该条译文里你不确定的术语选择；没有就写「无」。' +
      '\n译文会被标记为「机器生成，未经母语复核」。';
    var user = items.map(function (it) {
      return '[' + it.clause_id + '] ' + it.title_cn + '\n' + it.text_cn;
    }).join('\n\n') + '\n\n请逐条翻译，返回 JSON。';
    return callJson('translateClauses', system, user, TRANS_SCHEMA);
  }

  /* ========================================================================
     真实模式的编排：模型提议 → 程序核验 → 交给人
     ------------------------------------------------------------------------
     这一层就是「模型参与更多」与「结论仍然可信」的接缝：
     模型负责读懂与判断，但它给的每一处引文都要能在原文里逐字找到，
     否则丢弃并记入审计；空值不能当证据；任何一步失败都退回确定性结果。
     ======================================================================== */
  function normQ(x) { return String(x == null ? '' : x).replace(/[\s　]+/g, ''); }

  /* 注意与上面无参的 buildDocIndex() 区分：那个给预置数据集建索引，
     这个给「一份已解析的真实文档」建索引。同名会互相覆盖（实测踩过）。 */
  function buildRealDocIndex(doc) {
    var parts = [];
    (doc.clauses || []).forEach(function (c) { parts.push(c.title, c.text); });
    (doc.tables || []).forEach(function (rows) {
      rows.forEach(function (r) { parts.push(r.join(' ')); });
    });
    (doc.paragraphs || []).forEach(function (p) { parts.push(p.text); });
    (doc.aux || []).forEach(function (p) { parts.push(p.text); });
    return normQ(parts.join('\n'));
  }

  /* 护栏：引文必须能在原文里逐字找到。这是防幻觉的第一道，
     实测过模型编造引文并给出 0.99 置信度。 */
  function quoteFound(idx, quote) {
    var q = normQ(quote);
    if (!q || q.length < 4) return false;
    if (idx.indexOf(q) >= 0) return true;
    // 允许模型顺手补了标点或省略号，取中段再试一次
    if (q.length > 24) {
      var mid = q.slice(Math.floor(q.length * 0.15), Math.floor(q.length * 0.85));
      return mid.length >= 8 && idx.indexOf(mid) >= 0;
    }
    return false;
  }

  function enhanceReal(realAnalysis, oldDoc, newDoc) {
    var out = {
      used: false, applied: [], fallbacks: [], guards: [], calls: [],
      config: getConfig()
    };
    if (!enabled()) {
      out.fallbacks.push({ job: '全部', reason: '未配置模型端点，真实模式沿用确定性结果' });
      return Promise.resolve(out);
    }
    out.used = true;
    var idxOld = buildRealDocIndex(oldDoc);

    function step(name, fn) {
      return fn().then(function (r) { out.applied.push(name); return r; })
        .catch(function (e) {
          out.fallbacks.push({ job: name, reason: String(e.message || e) });
          return null;
        });
    }

    var jobs = [];

    /* 5. 字段提取 —— 只覆盖确定性正则没抽到的，抽到的保留程序结果（可复现优先） */
    jobs.push(step('真实合同字段提取', function () {
      var missing = realAnalysis.fields.filter(function (f) { return f.value === null; });
      if (!missing.length) return Promise.resolve(null);
      return extractRealFields(oldDoc, missing.map(function (f) {
        return { field: f.field, label: f.label };
      })).then(function (r) {
        (r.fields || []).forEach(function (mf) {
          var target = null;
          realAnalysis.fields.forEach(function (f) { if (f.field === mf.field) target = f; });
          if (!target || target.value !== null) return;
          if (mf.value === null) return;
          // 护栏一：引文核对
          if (!quoteFound(idxOld, mf.quote)) {
            out.guards.push({ job: '真实合同字段提取', field: mf.field, guard: '引文必须可逐字核对',
              why: '模型给出「' + String(mf.value).slice(0, 30) + '」，但其引文在原文中不存在，已丢弃' });
            return;
          }
          // 护栏二：不得以「无证据」为证据
          if (quoteIsEmptyMark(mf.quote)) {
            out.guards.push({ job: '真实合同字段提取', field: mf.field, guard: '不得以无证据为证据',
              why: '引文仅为空值标记，不能支撑一个具体取值，已丢弃' });
            return;
          }
          target.value = mf.value;
          target.confidence = Math.min(0.9, Math.max(0, mf.confidence));
          target.source = { clause_title: mf.where || '（模型定位）', quote: mf.quote };
          target.provenance = 'model';
          target.reason = '';
        });
      });
    }));

    /* 6. 条款语义匹配 —— 只在确定性匹配率偏低时接管 */
    jobs.push(step('条款语义匹配', function () {
      var d = realAnalysis.diff;
      var rate = d.oldCount ? d.matched / d.oldCount : 1;
      if (rate >= 0.7) {
        out.fallbacks.push({ job: '条款语义匹配',
          reason: '确定性匹配率已达 ' + Math.round(rate * 100) + '%，无需模型接管' });
        return Promise.resolve(null);
      }
      return matchClausesSemantic(oldDoc, newDoc).then(function (r) {
        var oc = oldDoc.clauses, nc = newDoc.clauses;
        var mod = [], unc = [], usedO = {}, usedN = {};
        (r.pairs || []).forEach(function (p) {
          var o = oc[p.old_index - 1], n = nc[p.new_index - 1];
          if (!o || !n || usedO[p.old_index] || usedN[p.new_index]) return;
          usedO[p.old_index] = usedN[p.new_index] = 1;
          var rec = { old_index: p.old_index - 1, new_index: p.new_index - 1,
            old_title: o.title, new_title: n.title, old_text: o.text, new_text: n.text,
            title_similarity: null, body_similarity: null,
            match_provenance: 'model', match_confidence: p.confidence, match_reason: p.reason };
          if (normQ(o.text) === normQ(n.text)) unc.push(rec); else mod.push(rec);
        });
        if (!mod.length && !unc.length) throw new Error('模型未给出任何有效配对');
        d.modified = mod; d.unchanged = unc;
        d.matched = mod.length + unc.length;
        d.added = nc.filter(function (_, i) { return !usedN[i + 1]; })
          .map(function (c) { return { new_title: c.title, new_text: c.text }; });
        d.removed = oc.filter(function (_, i) { return !usedO[i + 1]; })
          .map(function (c) { return { old_title: c.title, old_text: c.text }; });
        d.provenance = 'model';
      });
    }));

    /* 7. 差异语义分级 —— 这项原来是写死的表，现在交给模型 */
    jobs.push(step('差异语义分级', function () {
      var pairs = realAnalysis.diff.modified.slice(0, 24);
      if (!pairs.length) return Promise.resolve(null);
      return classifyRealDiffs(pairs).then(function (r) {
        (r.items || []).forEach(function (it) {
          var p = pairs[it.pair_index - 1];
          if (!p) return;
          p.diff_class = it.diff_class;
          p.risk_level = it.risk_level;
          p.rationale = it.rationale;
          p.plain_explanation = it.plain_explanation;
          p.class_provenance = 'model';
        });
      });
    }));

    /* 8. 条件性条款判定辅助 —— 模型只给建议，人做决定 */
    jobs.push(step('条件性条款判定建议', function () {
      var qs = realAnalysis.questions;
      if (!qs.length) return Promise.resolve(null);
      return judgeConditionals(qs, oldDoc).then(function (r) {
        (r.judgements || []).forEach(function (j) {
          var q = null;
          qs.forEach(function (x) { if (x.id === j.id) q = x; });
          if (!q) return;
          var ok = j.evidence && quoteFound(idxOld, j.evidence);
          if (j.suggestion !== 'need_more_info' && !ok) {
            out.guards.push({ job: '条件性条款判定建议', field: j.id,
              guard: '引文必须可逐字核对',
              why: '模型建议「' + j.suggestion + '」但引文无法在原文中核对，已降级为「需更多信息」' });
            q.suggestion = 'need_more_info';
            q.suggestion_reason = j.reason;
            q.suggestion_evidence = null;
          } else {
            q.suggestion = j.suggestion;
            q.suggestion_confidence = j.confidence;
            q.suggestion_reason = j.reason;
            q.suggestion_evidence = ok ? j.evidence : null;
          }
          q.suggestion_provenance = 'model';
        });
      });
    }));

    /* 9. 从本年度模板的使用说明里提炼规则 —— 模型提议，默认草稿，需人批准 */
    jobs.push(step('从模板指引提炼规则', function () {
      var g = (newDoc.guidance || []).filter(function (x) { return x.conditional; });
      if (!g.length) return Promise.resolve(null);
      var idxNew = buildRealDocIndex(newDoc);
      return proposeRules(g.slice(0, 20)).then(function (r) {
        var kept = [];
        (r.rules || []).forEach(function (rr) {
          // 护栏：提炼出的规则必须能回溯到模板原文，否则丢弃
          if (!quoteFound(idxNew, rr.source_quote)) {
            out.guards.push({ job: '从模板指引提炼规则', field: rr.name,
              guard: '规则必须可回溯到模板原文',
              why: '模型提炼出「' + String(rr.name).slice(0, 24) + '」，但其引用在模板中不存在，已丢弃' });
            return;
          }
          kept.push(rr);
        });
        realAnalysis.ruleProposalsRaw = kept;
      });
    }));

    return Promise.all(jobs).then(function () {
      realAnalysis.fieldsFound = realAnalysis.fields.filter(function (f) {
        return f.value !== null;
      }).length;
      out.calls = log().slice(-8);
      return out;
    });
  }

  function enhance(facts, ctx) {
    if (!enabled()) {
      return Promise.resolve({ used: false, reason: '未配置模型端点', applied: [], fallbacks: [] });
    }

    var applied = [], fallbacks = [];

    function step(name, fn) {
      return fn().then(function (r) { applied.push(name); return r; })
        .catch(function (e) { fallbacks.push({ task: name, reason: e.message }); return null; });
    }

    var jobs = [];

    /* 1. 字段提取 */
    jobs.push(step('字段提取', function () {
      return extractFacts(facts, D.DOCUMENTS).then(function (r) {
        var byName = {};
        facts.forEach(function (f) { byName[f.field_name] = f; });
        var n = 0;
        guardLog = [];
        r.facts.forEach(function (mf) {
          var f = byName[mf.field_name];
          if (!f) return;                                    // 未知字段一律忽略

          // 护栏 1：逐条核对引文是否真的出现在其声称的文档里
          var v = verifySources(mf.sources);
          v.dropped.forEach(function (dp) {
            guardLog.push({ field: mf.field_name, guard: '引文可核对', why: dp.why,
                            quote: String(dp.src.quote || '').slice(0, 60) });
          });
          if (!v.sources.length) {                           // 无任何可核对来源 → 沿用预置（§9.6）
            guardLog.push({ field: mf.field_name, guard: '无可核对来源', why: '整字段回退预置值' });
            return;
          }

          var val = (mf.value === '' ? null : mf.value);
          var conf = Math.max(0, Math.min(1, mf.confidence));

          // 护栏 2：不得以「无证据」为证据 —— 确定值却只有空值标记支撑，则不成立
          if (val !== null && v.sources.every(function (sc) { return quoteIsEmptyMark(sc.quote); })) {
            guardLog.push({ field: mf.field_name, guard: '不得以无证据为证据',
                            why: '模型断言「' + val + '」但引文仅为空值标记，已归为「未提供」' });
            val = null; conf = 0;
          }

          f.current.value = val;
          f.current.confidence = conf;
          f.current.sources = v.sources;
          f.current.provenance = 'model';
          n++;
        });
        return n;
      });
    }));

    /* 2. 语义差异分类 */
    jobs.push(step('语义分类', function () {
      return classifyDiffs(ctx.templateModified, D.TEMPLATE_2025_SECTIONS, D.TEMPLATE_2026_SECTIONS)
        .then(function (r) {
          r.classifications.forEach(function (c) {
            if (VALID_DIFF_CLASS.indexOf(c.diff_class) < 0) return;   // 非法枚举丢弃
            var sem = D.SEMANTIC_DIFF_CLASS[c.clause_id];
            if (!sem) return;
            sem.diff_class = c.diff_class;
            sem.rationale = c.rationale;
            sem.provenance = 'model';
            var tpl = D.CHANGE_TEMPLATES[sem.change_id];
            if (tpl) { tpl.diff_class = c.diff_class; tpl.provenance_class = 'model'; }
          });
          return r.classifications.length;
        });
    }));

    /* 3. 大白话解释（只对高风险项，控制成本） */
    jobs.push(step('Agent 解释', function () {
      var targets = D.EXPECTED.high_risk_change_ids.map(function (id) { return D.CHANGE_TEMPLATES[id]; }).filter(Boolean);
      return explainChanges(targets).then(function (r) {
        r.explanations.forEach(function (e) {
          var tpl = D.CHANGE_TEMPLATES[e.change_id];
          if (tpl && e.explanation) { tpl.agent_explanation = e.explanation; tpl.provenance_explain = 'model'; }
        });
        return r.explanations.length;
      });
    }));

    /* 4. 双语语义比对（在 2026 模板责任限制条款上跑，供一致性检查取用）
          注意：中英文「倍数」的数值比对仍由确定性程序负责（§5.4 数字不交给模型），
          模型只在数值检查之外提供额外覆盖。两者任一发现问题即判为不一致。 */
    jobs.push(step('双语比对', function () {
      var liab = null;
      D.TEMPLATE_2026_SECTIONS.forEach(function (s) { if (s.clause_id === 'C-LIAB-002') liab = s; });
      if (!liab) return Promise.resolve(null);
      return checkBilingual(liab).then(function (r) {
        bilingualVerdict = { consistent: r.consistent, detail: r.detail, provenance: 'model' };
        return r;
      });
    }));

    return Promise.all(jobs).then(function () {
      return {
        used: applied.length > 0,
        applied: applied, fallbacks: fallbacks, guards: getGuardLog(),
        config: getConfig(), calls: log()
      };
    });
  }

  global.TPModel = {
    configure: configure, getConfig: getConfig, enabled: enabled, reset: reset, log: log,
    getBilingualVerdict: getBilingualVerdict, getGuardLog: getGuardLog,
    verifySources: verifySources, quoteIsEmptyMark: quoteIsEmptyMark,
    testConnection: testConnection, enhance: enhance,
    extractFacts: extractFacts, classifyDiffs: classifyDiffs,
    enhanceReal: enhanceReal, extractRealFields: extractRealFields,
    matchClausesSemantic: matchClausesSemantic, classifyRealDiffs: classifyRealDiffs,
    judgeConditionals: judgeConditionals,
    proposeRules: proposeRules, draftClause: draftClause, translateClauses: translateClauses,
    quoteFound: quoteFound, buildRealDocIndex: buildRealDocIndex,
    explainChanges: explainChanges, checkBilingual: checkBilingual,
    DEFAULT_ENDPOINT: DEFAULT_ENDPOINT,
    DEFAULT_ENDPOINT_OPENAI: DEFAULT_ENDPOINT_OPENAI,
    _validate: validate
  };
})(window);

/* ============================================================================
   TP Engagement Agent · 导出（PRD §7.1 步骤 10 / F13）
   ----------------------------------------------------------------------------
   DOCX：Word 兼容 HTML（.doc）Blob 本地下载，不请求任何外部资源。
   变更清单：CSV（Excel 可直接打开，含 UTF-8 BOM）。
   审计记录：JSON。
   ========================================================================== */
(function (global) {
  'use strict';

  var D = global.TPData, E = global.TPEngine;

  function downloadBlob(content, filename, mime) {
    // CSV 与 Word 兼容 HTML 需要 UTF-8 BOM 才能被 Excel / Word 正确识别中文；
    // JSON 加 BOM 会导致严格解析器报错，因此不加。
    var needBom = mime === 'text/csv' || mime === 'application/msword';
    var blob = new Blob([(needBom ? '﻿' : '') + content], { type: mime + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 250);
    return filename;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function para(s) { return esc(s).replace(/\n/g, '<br>'); }

  var DOC_CSS =
    'body{font-family:"宋体",SimSun,serif;font-size:11pt;color:#16202e;line-height:1.75;}' +
    'h1{text-align:center;font-size:18pt;margin:0 0 2pt;}' +
    'h2{font-size:12pt;margin:16pt 0 4pt;}' +
    '.sub{text-align:center;font-size:9pt;color:#555;}' +
    '.wm{text-align:center;color:#b3261e;font-weight:bold;font-size:10pt;border:1pt solid #b3261e;padding:6pt;margin:10pt 0;}' +
    '.en{font-family:"Times New Roman",serif;font-size:10pt;color:#334;}' +
    'table{border-collapse:collapse;width:100%;font-size:9pt;}' +
    'td,th{border:1px solid #9aa5b4;padding:4pt 6pt;vertical-align:top;}' +
    'th{background:#123f6d;color:#fff;text-align:left;}' +
    '.tag{font-size:8.5pt;color:#555;}' +
    '.newpage{page-break-before:always;}' +
    '.hold{color:#b3261e;font-weight:bold;}';

  function docShell(title, bodyHtml) {
    return '<html xmlns:o="urn:schemas-microsoft-com:office:office" ' +
      'xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">' +
      '<head><meta charset="utf-8"><title>' + esc(title) + '</title>' +
      '<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View></w:WordDocument></xml><![endif]-->' +
      '<style>' + DOC_CSS + '</style></head><body>' + bodyHtml + '</body></html>';
  }

  var STATUS_LABEL = {
    added: '新增条款', modified: '本年度修改', removed: '已删除',
    kept_old: '保留上年度条款', pending: '待确认（未获授权确认）', unchanged: '沿用标准条款'
  };

  /* ------------------------------------------------------------ 合同 DOCX */
  function buildContractHtml(ctx, lang) {
    var task = ctx.task, contract = ctx.contract, ck = ctx.consistency;
    var wm = '<div class="wm">' + esc(D.META.watermarkEn) + '<br>' + esc(D.META.watermarkCn) + '</div>';
    var h = '';
    h += '<h1>转让定价服务协议' + (lang === 'cn' ? '' : '<br><span class="en">Transfer Pricing Services Agreement</span>') + '</h1>';
    h += '<div class="sub">' + esc(task.client_name) + ' · ' + esc(task.engagement_year) + ' 年度 · 合同编号 ' +
      esc(contract.placeholders.contract_no) + '<br>任务编号 ' + esc(task.task_id) +
      ' · 使用模板 ' + esc(D.META.templateVersionUsed) + ' · 规则库 ' + esc(D.META.ruleSetVersion) + '</div>';
    h += wm;

    contract.sections.forEach(function (s) {
      if (s.omit) return;
      var tag = s.status !== 'unchanged' ? ' <span class="tag">［' + STATUS_LABEL[s.status] + '］</span>' : '';
      h += '<h2>' + (s.no === '首部' || s.no === '附件一' ? esc(s.no) : '第 ' + esc(s.no) + ' 条') + '　' + esc(s.title_cn) + tag;
      if (lang !== 'cn') h += '<br><span class="en">' + esc(s.title_en) + '</span>';
      h += '</h2>';
      if (lang !== 'en') h += '<p' + (s.status === 'pending' ? ' class="hold"' : '') + '>' + para(s.text_cn) + '</p>';
      if (lang !== 'cn') h += '<p class="en">' + para(s.text_en) + '</p>';
    });

    /* 变更摘要页 */
    h += '<div class="newpage"></div><h1>变更摘要 / Summary of Changes</h1>';
    h += '<p class="sub">本页由 TP Engagement Agent 生成，记录本年度合同相对上年度合同与标准模板的全部变更及人工决定。</p>';
    h += '<table><tr><th>变更项</th><th>类型</th><th>风险</th><th>触发规则</th><th>来源</th><th>人工决定</th><th>处理人 / 时间</th></tr>';
    ctx.analysis.changes.forEach(function (c) {
      var d = ctx.decisions[c.change_id] || { status: 'pending' };
      h += '<tr><td>' + esc(c.title) + '</td><td>' + esc(c.change_type_cn) + '</td><td>' +
        ({ high: '高', medium: '中', low: '低' }[c.risk_level]) + '</td><td>' + esc(c.source_rule) + '</td><td>' +
        esc(c.source) + '</td><td>' + esc(E.DECISION_LABEL[d.status] || d.status) +
        (d.resolution ? '（选项 ' + esc(d.resolution) + '）' : '') +
        (d.note ? '<br>备注：' + esc(d.note) : '') + '</td><td>' +
        esc(d.actor || '-') + '<br>' + esc(d.at || '-') + '</td></tr>';
    });
    h += '</table>';

    /* 待复核清单 */
    h += '<div class="newpage"></div><h1>待复核清单 / Review Checklist</h1>';
    h += '<table><tr><th>#</th><th>检查项</th><th>结果</th><th>说明</th></tr>';
    ck.results.forEach(function (r, i) {
      h += '<tr><td>' + (i + 1) + '</td><td>' + esc(r.name) + '</td><td>' + (r.ok ? '通过' : '需处理') +
        '</td><td>' + esc(r.detail) + '</td></tr>';
    });
    h += '</table>';
    h += '<p class="tag">生成时间：' + esc(E.nowStamp()) + '　导出人：' + esc(ctx.actor) +
      '　条款库：' + esc(D.META.clauseLibVersion) + '</p>';
    h += '<p class="tag">' + esc(D.META.disclaimer) + '</p>';
    h += wm;
    return docShell('转让定价服务协议 ' + task.engagement_year, h);
  }

  function exportContract(ctx, lang) {
    var suffix = { cn: '中文', en: '英文', both: '中英双语' }[lang] || '中英双语';
    var name = 'TP合同初稿_' + ctx.task.client_short + '_' + ctx.task.engagement_year + '_' + suffix + '.doc';
    downloadBlob(buildContractHtml(ctx, lang), name, 'application/msword');
    return name;
  }

  /* --------------------------------------------------------- 变更清单 CSV */
  function exportChangesCsv(ctx) {
    function cell(v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""').replace(/\n/g, ' ') + '"'; }
    var rows = [[
      '变更编号', '标题', '比较类别', '变更类型', '差异分类', '风险等级', '关联条款',
      '触发规则', '来源', '置信度', '原文', '建议文本', '人工决定', '冲突选项', '备注', '处理人', '处理时间',
      '真实部署所需审批层级（本演示为单人模式，仅标注）'
    ].map(cell).join(',')];
    var CAT = { template: 'A 标准模板版本变化', fact: 'B 客户事实变化', clause: 'C 条款适用性变化' };
    ctx.analysis.changes.forEach(function (c) {
      var d = ctx.decisions[c.change_id] || { status: 'pending' };
      rows.push([
        c.change_id, c.title, CAT[c.category], c.change_type_cn, c.diff_class,
        { high: '高风险', medium: '中风险', low: '低风险' }[c.risk_level],
        c.clause_id, c.source_rule, c.source, c.confidence,
        c.old_text, c.proposed_text,
        E.DECISION_LABEL[d.status] || d.status, d.resolution || '', d.note || '',
        d.actor || '', d.at || '',
        c.risk_level === 'high' ? (c.approver === 'partner' ? '合伙人 / 风险审批人' : '经理及以上') : '—'
      ].map(cell).join(','));
    });
    var name = '变更清单_' + ctx.task.client_short + '_' + ctx.task.engagement_year + '.csv';
    downloadBlob(rows.join('\r\n'), name, 'text/csv');
    return name;
  }

  /* --------------------------------------------------------- 审计 JSON */
  function exportAuditJson(ctx) {
    var payload = {
      product: D.META.productName, version: D.META.version,
      data_mode: D.META.dataMode, engine_note: D.META.engineNote,
      exported_at: E.nowStamp(), exported_by: ctx.actor,
      task: ctx.task,
      versions: {
        template: D.META.templateVersionUsed,
        rule_set: D.META.ruleSetVersion,
        clause_library: D.META.clauseLibVersion
      },
      documents: D.DOCUMENTS.map(function (d) {
        return {
          document_id: d.document_id, document_type: d.document_type, filename: d.filename,
          version: d.version, hash: d.hash, upload_time: d.upload_time, parse_status: d.parse_status
        };
      }),
      rules_fired: ctx.analysis.ruleResult.fired,
      rules_not_fired: ctx.analysis.ruleResult.skipped,
      extracted_facts: D.FACTS.map(function (f) {
        return {
          fact_id: f.fact_id, field_name: f.field_name,
          value: Object.prototype.hasOwnProperty.call(ctx.factEdits, f.fact_id) ? ctx.factEdits[f.fact_id] : (f.current ? f.current.value : null),
          confidence: f.current ? f.current.confidence : null,
          sources: f.current ? f.current.sources : [],
          human_status: Object.prototype.hasOwnProperty.call(ctx.factEdits, f.fact_id) ? 'edited' : 'agent_extracted',
          needs_review: !!(f.conflict) || (f.current && f.current.confidence < 0.7)
        };
      }),
      change_items: ctx.analysis.changes.map(function (c) {
        var d = ctx.decisions[c.change_id] || { status: 'pending' };
        return {
          change_id: c.change_id, clause_id: c.clause_id, change_type: c.change_type,
          risk_level: c.risk_level, reason: c.reason, source: c.source,
          source_rule: c.source_rule, confidence: c.confidence,
          requires_human_approval: c.risk_level === 'high',
          required_approval_tier: c.risk_level === 'high'
            ? (c.approver === 'partner' ? 'partner_risk_approver' : 'manager_or_above') : null,
          status: d.status, resolution: d.resolution || null,
          reviewer_note: d.note || null, actor: d.actor || null, decided_at: d.at || null
        };
      }),
      approval_mode: {
        mode: 'single_operator',
        operator: ctx.audit.length ? '见 audit_events.actor_id' : null,
        note: '本演示由一个人完成全流程，不做系统内的提交与审批等待；'
          + '每项变更「该谁签字批准」仍逐项记录在 required_approval_tier 字段。'
          + 'change_items.required_approval_tier 为真实部署中所需的审批层级，仅作标注。'
      },
      consistency_check: ctx.consistency.results,
      audit_events: ctx.audit
    };
    var name = '审计记录_' + ctx.task.task_id + '.json';
    downloadBlob(JSON.stringify(payload, null, 2), name, 'application/json');
    return name;
  }

  global.TPExport = {
    exportContract: exportContract,
    exportChangesCsv: exportChangesCsv,
    exportAuditJson: exportAuditJson,
    buildContractHtml: buildContractHtml,
    downloadBlob: downloadBlob
  };
})(window);

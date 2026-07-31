/* ============================================================================
   TP Engagement Agent · 真实文件解析层
   ----------------------------------------------------------------------------
   零依赖：DOCX / XLSX 都是 ZIP，用浏览器原生 DecompressionStream('deflate-raw')
   解压，不引任何第三方库，不发任何网络请求，file:// 下同样可用。

   支持范围（对能力边界如实报告，宁可报错也不假装读懂了）：
     · DOCX  段落 + 表格 + 页眉页脚      —— 完整支持
     · XLSX  工作表单元格（含共享字符串）—— 完整支持
     · PDF   不支持文本提取              —— 只登记文件与哈希，见下方说明
   ========================================================================== */
(function (global) {
  'use strict';

  /* ------------------------------------------------------------------ 工具 */
  function u16(dv, o) { return dv.getUint16(o, true); }
  function u32(dv, o) { return dv.getUint32(o, true); }

  function inflateRaw(bytes) {
    if (typeof DecompressionStream !== 'function') {
      return Promise.reject(new Error('当前环境不支持 DecompressionStream，无法解压'));
    }
    return new Promise(function (resolve, reject) {
      var ds, w;
      try { ds = new DecompressionStream('deflate-raw'); w = ds.writable.getWriter(); }
      catch (e) { reject(e); return; }
      // 写入侧和读取侧都会拒绝：只捕获读取侧会漏出未处理的 rejection
      var swallow = function () {};
      try { w.write(bytes).catch(swallow); w.close().catch(swallow); }
      catch (e) { /* 已关闭等同步异常交给读取侧处理 */ }
      new Response(ds.readable).arrayBuffer().then(
        function (ab) { resolve(new Uint8Array(ab)); }, reject);
    });
  }

  /* ============================================================== ZIP 读取
     只读中央目录 —— 比逐个扫本地文件头可靠（本地头的长度字段可能是 0，
     真实长度写在数据描述符里）。 */
  function readZip(arrayBuffer) {
    var u8 = new Uint8Array(arrayBuffer);
    var dv = new DataView(arrayBuffer);
    // 从尾部往前找 End of Central Directory（0x06054b50）
    var eocd = -1;
    for (var i = u8.length - 22; i >= 0 && i > u8.length - 66000; i--) {
      if (u32(dv, i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) return Promise.reject(new Error('不是有效的 ZIP（找不到中央目录）'));

    var count = u16(dv, eocd + 10);
    var cdOff = u32(dv, eocd + 16);
    var entries = [];
    var p = cdOff;
    for (var n = 0; n < count; n++) {
      if (u32(dv, p) !== 0x02014b50) break;
      var method = u16(dv, p + 10);
      var csize = u32(dv, p + 20);
      var nameLen = u16(dv, p + 28);
      var extraLen = u16(dv, p + 30);
      var commentLen = u16(dv, p + 32);
      var localOff = u32(dv, p + 42);
      var name = new TextDecoder('utf-8').decode(u8.subarray(p + 46, p + 46 + nameLen));
      entries.push({ name: name, method: method, csize: csize, localOff: localOff });
      p += 46 + nameLen + extraLen + commentLen;
    }

    // 逐个按本地文件头定位数据起点
    var out = {};
    var jobs = entries.map(function (e) {
      var lo = e.localOff;
      if (u32(dv, lo) !== 0x04034b50) return Promise.resolve();
      var nLen = u16(dv, lo + 26);
      var xLen = u16(dv, lo + 28);
      var start = lo + 30 + nLen + xLen;
      var data = u8.subarray(start, start + e.csize);
      if (e.method === 0) { out[e.name] = data; return Promise.resolve(); }
      if (e.method !== 8) return Promise.resolve();   // 只支持 stored / deflate
      return inflateRaw(data).then(function (d) { out[e.name] = d; })
        .catch(function () { /* 单个条目解压失败不拖垮整包 */ });
    });
    return Promise.all(jobs).then(function () { return out; });
  }

  function txt(bytes) { return bytes ? new TextDecoder('utf-8').decode(bytes) : ''; }

  /* ========================================================== XML → 纯文本
     不用 DOMParser：Node 环境没有它，而自检必须能在 Node 里跑。
     正则足够应付 OOXML 这种结构规整的文档。 */
  function xmlUnescape(s) {
    return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, function (_, d) { return String.fromCharCode(+d); })
      .replace(/&amp;/g, '&');
  }

  function stripTags(x) {
    return xmlUnescape(x.replace(/<[^>]*>/g, ''));
  }

  /* ---------------------------------------------------------------- DOCX */
  function parseDocxXml(xml) {
    var paras = [];
    // 逐段落切分，保留段落样式名（用于识别标题）
    var re = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g, m;
    while ((m = re.exec(xml)) !== null) {
      var body = m[1];
      var st = /<w:pStyle[^>]*w:val="([^"]*)"/.exec(body);
      var t = body.replace(/<w:tab[^>]*\/>/g, '\t').replace(/<w:br[^>]*\/>/g, '\n');
      t = stripTags(t).replace(/[ \t]+/g, ' ').trim();
      if (t) paras.push({ text: t, style: st ? st[1] : '' });
    }
    // 表格：按行 / 单元格切
    var tables = [];
    var tre = /<w:tbl>([\s\S]*?)<\/w:tbl>/g, tm;
    while ((tm = tre.exec(xml)) !== null) {
      var rows = [];
      var rre = /<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g, rm;
      while ((rm = rre.exec(tm[1])) !== null) {
        var cells = [];
        var cre = /<w:tc>([\s\S]*?)<\/w:tc>/g, cm;
        while ((cm = cre.exec(rm[1])) !== null) {
          cells.push(stripTags(cm[1].replace(/<\/w:p>/g, ' ')).replace(/\s+/g, ' ').trim());
        }
        if (cells.length) rows.push(cells);
      }
      if (rows.length) tables.push(rows);
    }
    return { paragraphs: paras, tables: tables };
  }

  function parseDocx(arrayBuffer) {
    return readZip(arrayBuffer).then(function (files) {
      var main = files['word/document.xml'];
      if (!main) throw new Error('DOCX 内没有 word/document.xml，可能不是 Word 文档');
      var r = parseDocxXml(txt(main));
      // 页眉页脚与脚注也读进来 —— 页脚里常有文件编号，脚注里常有条款适用说明
      var extra = [];
      Object.keys(files).forEach(function (k) {
        if (/^word\/(header|footer|footnotes|endnotes)\d*\.xml$/.test(k)) {
          parseDocxXml(txt(files[k])).paragraphs.forEach(function (p) {
            extra.push({ text: p.text, style: p.style, from: k.replace('word/', '') });
          });
        }
      });
      return {
        kind: 'docx',
        paragraphs: r.paragraphs,
        tables: r.tables,
        aux: extra,
        charCount: r.paragraphs.reduce(function (a, p) { return a + p.text.length; }, 0)
      };
    });
  }

  /* ---------------------------------------------------------------- XLSX */
  function colToIndex(ref) {
    var m = /^([A-Z]+)/.exec(ref);
    if (!m) return 0;
    var n = 0;
    for (var i = 0; i < m[1].length; i++) n = n * 26 + (m[1].charCodeAt(i) - 64);
    return n - 1;
  }

  function parseXlsx(arrayBuffer) {
    return readZip(arrayBuffer).then(function (files) {
      // 共享字符串表
      var shared = [];
      if (files['xl/sharedStrings.xml']) {
        var sx = txt(files['xl/sharedStrings.xml']);
        var sre = /<si>([\s\S]*?)<\/si>/g, sm;
        while ((sm = sre.exec(sx)) !== null) shared.push(stripTags(sm[1]));
      }
      // 工作表名
      var names = [];
      if (files['xl/workbook.xml']) {
        var wx = txt(files['xl/workbook.xml']);
        var nre = /<sheet[^>]*name="([^"]*)"/g, nm;
        while ((nm = nre.exec(wx)) !== null) names.push(xmlUnescape(nm[1]));
      }
      var sheetKeys = Object.keys(files)
        .filter(function (k) { return /^xl\/worksheets\/sheet\d+\.xml$/.test(k); })
        .sort(function (a, b) {
          return (+/(\d+)\.xml$/.exec(a)[1]) - (+/(\d+)\.xml$/.exec(b)[1]);
        });
      if (!sheetKeys.length) throw new Error('XLSX 内没有工作表，可能不是 Excel 文档');

      var sheets = sheetKeys.map(function (k, idx) {
        var x = txt(files[k]);
        var rows = [];
        var rre = /<row\b[^>]*>([\s\S]*?)<\/row>/g, rm;
        while ((rm = rre.exec(x)) !== null) {
          var cells = [];
          var cre = /<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/g, cm;
          while ((cm = cre.exec(rm[1])) !== null) {
            var attrs = cm[1] || cm[3] || '';
            var inner = cm[2] || '';
            var refM = /r="([A-Z]+\d+)"/.exec(attrs);
            var ci = refM ? colToIndex(refM[1]) : cells.length;
            var isShared = /t="s"/.test(attrs);
            var vM = /<v>([\s\S]*?)<\/v>/.exec(inner);
            var isM = /<is>([\s\S]*?)<\/is>/.exec(inner);
            var val = '';
            if (isShared && vM) val = shared[+vM[1]] || '';
            else if (isM) val = stripTags(isM[1]);
            else if (vM) val = xmlUnescape(vM[1]);
            else val = stripTags(inner);
            while (cells.length < ci) cells.push('');
            cells[ci] = String(val).trim();
          }
          if (cells.some(function (c) { return c !== ''; })) rows.push(cells);
        }
        return { name: names[idx] || ('Sheet' + (idx + 1)), rows: rows };
      });
      return {
        kind: 'xlsx', sheets: sheets,
        charCount: sheets.reduce(function (a, s) {
          return a + s.rows.reduce(function (b, r) { return b + r.join('').length; }, 0);
        }, 0)
      };
    });
  }

  /* ------------------------------------------------------------------ PDF
     实测结论：对 9 份真实 PDF 的文本提取全部返回 0 字符。
     原因是现代 PDF 普遍使用字体子集 + 自定义编码，字形码与 Unicode 没有直接
     对应关系，需要解析 ToUnicode CMap 才能还原文本 —— 纯前端无库做不到可靠。

     所以这里的定位是「不支持文本提取」，而不是「尽力而为」：
     一个从来没成功过的能力，说成尽力而为就是误导。
     仍保留这段实现，是为了处理少数未压缩、未子集化的简单 PDF；
     取不到就明确报失败，绝不返回一段看起来像正文的垃圾。 */
  function parsePdf(arrayBuffer) {
    var u8 = new Uint8Array(arrayBuffer);
    if (!(u8[0] === 0x25 && u8[1] === 0x50 && u8[2] === 0x44 && u8[3] === 0x46)) {
      return Promise.reject(new Error('不是有效的 PDF（文件头不是 %PDF）'));
    }
    var raw = new TextDecoder('latin1').decode(u8);
    var jobs = [];
    var re = /stream\r?\n/g, m;
    while ((m = re.exec(raw)) !== null) {
      var start = m.index + m[0].length;
      var end = raw.indexOf('endstream', start);
      if (end < 0) continue;
      // 只处理声明了 /FlateDecode 的流；盲试解压会产生大量无意义的失败
      var dict = raw.slice(Math.max(0, m.index - 400), m.index);
      if (/\/FlateDecode/.test(dict)) {
        var seg = u8.subarray(start, end);
        jobs.push(inflateRaw(seg).then(function (d) {
          return new TextDecoder('utf-8', { fatal: false }).decode(d);
        }, function () { return ''; }));
      }
      re.lastIndex = end;
    }
    return Promise.all(jobs).then(function (streams) {
      var text = [];
      streams.join('\n').replace(/\((?:\\.|[^\\()])*\)/g, function (lit) {
        var t = lit.slice(1, -1).replace(/\\([()\\])/g, '$1');
        if (t.trim()) text.push(t);
        return lit;
      });
      var joined = text.join(' ').replace(/\s+/g, ' ').trim();
      return {
        kind: 'pdf',
        text: joined,
        charCount: joined.length,
        // 如实标注：这条路不可靠，界面必须把它和 DOCX/XLSX 区分开
        supported: false,
        note: 'PDF 不支持文本提取（现代 PDF 普遍使用字体子集编码，需要 ToUnicode CMap 才能还原）。' +
              '实测 9 份真实 PDF 全部提取失败。请把 PDF 另存为 DOCX，或改用 DOCX / XLSX 原件。'
      };
    });
  }

  /* ============================================== 条款切分（真实合同结构）
     真实业务约定书没有 clause_id，只有标题与编号。按常见编号形态切段，
     切不出来就如实返回 0 条，让界面提示需要人工指定结构。 */
  var HEAD_PATTERNS = [
    /^第\s*([0-9一二三四五六七八九十]+)\s*条[\s　]*(.*)$/,     // 第 9 条 责任限制
    /^([0-9]+)[\.、]\s*([^\s。，].{0,40})$/,                    // 6. 服务费用及付款
    /^([0-9]+\.[0-9]+)\s+(.{0,40})$/,                          // 9.6 集团公司
    /^(附录|附件|Appendix|Annex)\s*([一二三四五六七八九十0-9IVX]*)[\s　:：]*(.*)$/i
  ];

  /* 真实业务约定书的标题常常既无编号也无样式（「服务」「项目背景和项目目的」），
     所以除了编号模式，再用一份常见节名词表 + 「短行后面跟长正文」的启发式。 */
  var HEAD_LEXICON = [
    '服务', '服务团队', '服务内容', '服务成果', '服务范围', '服务限制', '服务时间表',
    '服务的除外项目', '服务除外项目', '项目背景', '项目目的', '项目背景和项目目的',
    '贵司联系人', '贵司联络人', '审计师的独立性', '利益冲突', '服务费用及付款',
    '业务条款', '确认与接受', '数据分析条款', '国家秘密法', '收费标准',
    'the services', 'staffing', 'client contact', 'auditor independence',
    'conflicts of interest', 'fees and payment', 'terms of business',
    'acknowledgement and acceptance', 'background', 'objectives', 'inclusions',
    'exclusions', 'constraints', 'deliverables', 'timing',
    'サービス', 'サービス内容', 'サービス成果物', '一般契約条項', '確認及び承認',
    '貴社の連絡者', '監査の独立性', '利益衝突'
  ];

  function normHead(t) {
    return String(t).toLowerCase().replace(/[\s　:：。，,\.]+$/g, '').trim();
  }

  function isHeading(p, next) {
    // 模板使用说明不是标题也不是正文，单独处理
    if (isGuidance(p)) return false;
    if (/^Heading/i.test(p.style) || /^标题/.test(p.style)) return true;
    if (p.text.length > 46) return false;
    for (var i = 0; i < HEAD_PATTERNS.length; i++) {
      if (HEAD_PATTERNS[i].test(p.text)) return true;
    }
    var n = normHead(p.text);
    if (HEAD_LEXICON.indexOf(n) >= 0) return true;
    // 启发式：很短、不以句末标点结尾，且紧跟一段明显更长的正文
    if (p.text.length <= 24 && !/[。；，,;\.]$/.test(p.text) &&
        next && next.text && next.text.length > p.text.length * 2.2 && next.text.length > 40) {
      return true;
    }
    return false;
  }

  /* 模板使用说明：官方模板把「什么情况下要加什么条款」写在这里。
     它既不是合同正文也不是标题 —— 混进正文会污染比对结果。 */
  function isGuidance(p) {
    if (/^Subject$/i.test(p.style) || /^Comment/i.test(p.style)) return true;
    var t = p.text;
    if (/^\[.*\]$/.test(t)) return true;
    return /^(Include as appropriate|Insert |Include if|Delete |Please read|These are examples|The wording will need|If the client|If our engagement)/i
      .test(t);
  }

  function segmentClauses(paragraphs) {
    var out = [], cur = null;
    paragraphs.forEach(function (p, i) {
      if (isGuidance(p)) return;                  // 说明文字不进正文
      if (isHeading(p, paragraphs[i + 1])) {
        if (cur) out.push(cur);
        cur = { no: p.text, title: p.text, body: [] };
      } else if (cur) {
        cur.body.push(p.text);
      }
    });
    if (cur) out.push(cur);
    return out.map(function (c) {
      // 去掉标题尾部粘着的脚注编号（真实模板里常见：「服务的除外项目10」）
      var title = c.title.replace(/\s*\d{1,2}$/, '').trim() || c.title;
      return { no: c.no, title: title, raw_title: c.title, text: c.body.join('\n') };
    }).filter(function (c) { return c.text.length > 0; });
  }

  /* 把模板里的使用说明单独抽出来 —— 这正是「什么情况下要加什么条款」 */
  function extractGuidance(doc) {
    var all = (doc.paragraphs || []).concat(doc.aux || []);
    var seen = {}, out = [];
    all.forEach(function (p) {
      if (!isGuidance(p) && !/\[[^\]]{4,}\]/.test(p.text)) return;
      var t = p.text.trim();
      // 「Include as appropriate」这类没有具体内容的样板话不构成一条规则
      if (t.length < 14 || seen[t]) return;
      if (/^(Include as appropriate|Delete as appropriate|请选择使用|视情况选择)$/i.test(t)) return;
      seen[t] = 1;
      out.push({
        text: t,
        conditional: /(如适用|如果|若|请选择|请删除|视情况|if applicable|where applicable|as appropriate|Include if|Only include)/i.test(t),
        from: p.from || 'document'
      });
    });
    return out;
  }

  /* ------------------------------------------------------------------ 入口 */
  function parseFile(name, arrayBuffer) {
    var lower = String(name || '').toLowerCase();
    var p;
    if (/\.docx$/.test(lower)) p = parseDocx(arrayBuffer);
    else if (/\.xlsx$/.test(lower)) p = parseXlsx(arrayBuffer);
    else if (/\.pdf$/.test(lower)) p = parsePdf(arrayBuffer);
    else {
      return Promise.resolve({
        ok: false, kind: 'unsupported', filename: name,
        error: '仅支持 .docx / .xlsx / .pdf。.doc（旧版二进制）需先另存为 .docx。'
      });
    }
    return p.then(function (r) {
      // 解析出来是空的，一律算失败 —— 宁可报错也不让空结果流进后面的分析
      if (!r.charCount) {
        return { ok: false, kind: r.kind, filename: name,
                 error: '文件已读取但未提取到任何文本（可能是扫描版、加密或空文档）。' +
                        (r.note ? '　' + r.note : '') };
      }
      r.ok = true; r.filename = name;
      if (r.kind === 'docx') {
        r.clauses = segmentClauses(r.paragraphs);
        r.guidance = extractGuidance(r);
      }
      return r;
    }).catch(function (e) {
      return { ok: false, kind: 'error', filename: name, error: String(e.message || e) };
    });
  }

  global.TPParse = {
    parseFile: parseFile,
    parseDocx: parseDocx, parseXlsx: parseXlsx, parsePdf: parsePdf,
    readZip: readZip, segmentClauses: segmentClauses,
    isHeading: isHeading, isGuidance: isGuidance, extractGuidance: extractGuidance
  };
})(typeof window !== 'undefined' ? window : globalThis);

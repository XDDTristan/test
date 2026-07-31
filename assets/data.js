/* ============================================================================
   TP Engagement Agent · 预置演示数据集
   ----------------------------------------------------------------------------
   全部内容为虚构资料，用于 PwC 税务 AI 创新杯 Demo。
   对应 PRD §12.1 核心实体 / §12.2 Demo 数据集 / §8.4 条款库 / §8.5 条款规则。
   ========================================================================== */
(function (global) {
  'use strict';

  /* ---------------------------------------------------------------- 元信息 */
  var META = {
    productName: 'TP Engagement Agent',
    productNameCn: '转让定价签约助手',
    version: 'Demo v1.0',
    dataMode: '预置虚构数据集',
    disclaimer:
      '本工具用于辅助合同准备，不构成法律意见。所有合同内容须由具备授权的专业人员复核和批准。',
    // 反馈：事务所所有导出文件都带英文 Draft 水印，沿用既有做法而不是自创一套
    watermarkEn: 'DRAFT',
    watermarkCn: 'DRAFT · 仅供内部复核',
    engineNote:
      '演示环境：字段提取与语义分类使用预置分析结果（预计算），结构差异、字段比对、规则触发、一致性检查由本地确定性程序实时计算。未连接任何外部模型或网络。',
    modelEndpoint: '未配置（预计算模式）· 可接入企业内网模型',
    modelNote: '模型承担 11 项任务：8 项「读」（理解与判断）+ 3 项「写」（产出新内容）。' +
      '写类任务的产物一律以「草稿」落地，不进合同正文、不进规则库、不计入语言覆盖率 —— ' +
      '只有人逐条批准的才生效，模型自己打不开任何门禁。' +
      '规则求值、金额与大写、条款编号与交叉引用、一致性检查、门禁判定、责任限额与条款增删，' +
      '一律仍由确定性程序与人负责。任一模型调用失败、超时、' +
      '校验不通过或被安全拒答时，自动回退到预置结果并在界面与审计中标注。',
    templateVersionUsed: 'PwC TP 标准模板 2026 v4.0',
    ruleSetVersion: '条款规则库 v2026.02',
    clauseLibVersion: '条款库 v2026.02'
  };

  /* ------------------------------------------------------- 角色与权限 §13.1 */
  var ROLES = [
    /* 单人操作模式：本演示只有一个操作者身份。
       多用户与审批流是 PRD F18（P1）/ F19（P2），不在本次范围内 ——
       每项变更所需的审批层级仍然逐项标注并写入审计，但不靠切换身份来演。 */
    { id: 'manager', name_cn: 'TP 项目经理', name_en: 'Engagement Manager', person: 'Daniel Reed', initials: 'DR' }
  ];

  // 操作 -> 允许角色（PRD §13.1）
  
  /* ==========================================================================
     1. 文档（Document §12.1）—— 含可回溯的段落结构
     ========================================================================*/

  // 2025 年已签双语合同（基于 2025 标准模板 v3.2 定制）
  var PRIOR_CONTRACT_SECTIONS = [
    {
      no: '首部', clause_id: 'C-HEAD-000', title_cn: '合同首部与当事人', title_en: 'Parties',
      text_cn: '本转让定价服务协议（"本协议"）由星海智能科技（深圳）有限公司（注册地址：深圳市南山区科技园高新南七道 12 号星海大厦 20 层，以下称"客户"）与普华永道咨询（深圳）有限公司（以下称"我们"）于 2025 年 2 月 18 日签署。合同编号：EL-2025-TP-0417。',
      text_en: 'This Transfer Pricing Services Agreement (the "Agreement") is entered into on 18 February 2025 between Starwave Intelligence Technology (Shenzhen) Co., Ltd. (registered address: 20/F Starwave Tower, No.12 Gaoxin South 7th Road, Science Park, Nanshan District, Shenzhen, the "Client") and PwC Consulting (Shenzhen) Co., Ltd. ("we"). Engagement Letter No.: EL-2025-TP-0417.'
    },
    {
      no: '1', clause_id: 'C-SCOPE-001', title_cn: '服务范围', title_en: 'Scope of Services',
      text_cn: '我们将为客户 2025 财政年度提供转让定价文档准备服务，包括中国转让定价本地文档编制、关联交易可比性分析，以及就客户中国大陆、香港及美国关联方之间的服务与特许权使用交易提供文档支持。本协议项下关联方范围见附件一。',
      text_en: 'We will provide transfer pricing documentation services for the Client\'s FY2025, including preparation of the PRC Local File, comparability analysis of related party transactions, and documentation support for services and royalty transactions among the Client\'s related parties in Mainland China, Hong Kong and the United States. The related parties covered by this Agreement are listed in Annex I.'
    },
    {
      no: '2', clause_id: 'C-TERM-001', title_cn: '服务期间与交付安排', title_en: 'Term and Deliverables',
      text_cn: '服务期间自 2025 年 3 月 1 日起至 2025 年 11 月 30 日止。交付物包括：中文本地文档定稿、英文摘要、可比性分析附件。',
      text_en: 'The service period runs from 1 March 2025 to 30 November 2025. Deliverables include: final Local File in Chinese, an English summary, and the comparability analysis annex.'
    },
    {
      no: '3', clause_id: 'C-TEAM-001', title_cn: '服务团队', title_en: 'Engagement Team',
      text_cn: '本项目由合伙人 Victoria Hale 负责，项目经理为 Laura Finch，高级顾问为 Emma Clarke。项目经理为客户日常联络的主要对接人。',
      text_en: 'The engagement is led by Partner Victoria Hale, with Laura Finch as Engagement Manager and Emma Clarke as Senior Consultant. The Engagement Manager is the Client\'s primary day-to-day contact.'
    },
    {
      no: '4', clause_id: 'C-FEE-001', title_cn: '专业服务费', title_en: 'Professional Fees',
      text_cn: '本项目专业服务费为人民币肆拾捌万元整（RMB 480,000），不含增值税及代垫费用。',
      text_en: 'The professional fees for this engagement are RMB 480,000 (Renminbi four hundred and eighty thousand only), exclusive of VAT and out-of-pocket expenses.'
    },
    {
      no: '5', clause_id: 'C-PAY-001', title_cn: '付款条件', title_en: 'Payment Terms',
      text_cn: '客户应于本协议签署后 30 日内支付服务费的 50%，余款于交付定稿后 30 日内支付。',
      text_en: 'The Client shall pay 50% of the fees within 30 days of signing this Agreement, and the balance within 30 days after delivery of the final deliverables.'
    },
    {
      no: '6', clause_id: 'C-CLIENT-001', title_cn: '客户责任与资料提供', title_en: 'Client Responsibilities',
      text_cn: '客户应及时提供完整、准确的财务与业务资料。我们不对客户提供资料的真实性和完整性独立核查。',
      text_en: 'The Client shall provide complete and accurate financial and business information on a timely basis. We do not independently verify the authenticity or completeness of information provided by the Client.'
    },
    {
      no: '7', clause_id: 'C-CONF-001', title_cn: '保密', title_en: 'Confidentiality',
      text_cn: '双方应对本项目涉及的保密信息予以保密，但依法定或监管要求披露的除外。',
      text_en: 'Each party shall keep confidential information relating to this engagement confidential, save for disclosures required by law or regulators.'
    },
    {
      no: '8', clause_id: 'C-DATA-005', title_cn: '个人信息与数据保护', title_en: 'Personal Information and Data Protection',
      text_cn: '我们将依照适用的中国法律处理客户提供的个人信息，仅用于本协议目的。具体送达与通知方式适用第 13 条。',
      text_en: 'We will process personal information provided by the Client in accordance with applicable PRC laws and solely for the purposes of this Agreement. Notices are governed by Clause 13.'
    },
    {
      no: '9', clause_id: 'C-LIAB-002', title_cn: '责任限制', title_en: 'Limitation of Liability',
      text_cn: '我们与贵司已磋商并同意，根据业务条款第 9.1 条，我们就本协议承担的责任上限将相当于贵司就导致该责任产生的相应服务或工作所应支付的服务费的两倍，但最终认定该部分损失或损害是由于我们的恶意或欺诈行为所导致的情况除外。',
      text_en: 'We have negotiated and agreed with you that, pursuant to clause 9.1 of the Terms of Business, our liability under this Agreement shall be capped at two times the fees payable by you for the services or work giving rise to such liability, save where such loss or damage is finally determined to have been caused by our bad faith or fraudulent conduct.'
    },
    {
      no: '10', clause_id: 'C-US-001', title_cn: '美国关联方服务特别约定', title_en: 'US Affiliate Special Provisions',
      text_cn: '就涉及客户美国关联方 Starwave Intelligence US Inc. 的服务，本协议不构成美国税务意见；相关工作成果不得用于美国申报的实质性依据，且不适用 IRC §6694 下的申报者责任安排。',
      text_en: 'With respect to services involving the Client\'s US affiliate Starwave Intelligence US Inc., this Agreement does not constitute US tax advice; the work product shall not be relied upon as substantial authority for US filing purposes and no preparer responsibility under IRC §6694 is assumed.'
    },
    {
      no: '11', clause_id: 'C-GROUP-002', title_cn: '集团成员所协作', title_en: 'Member Firm Collaboration',
      text_cn: '本项目部分工作由普华永道香港成员所协助完成。各成员所仅就其自身工作承担责任。',
      text_en: 'Part of this engagement is supported by the PwC Hong Kong member firm. Each member firm is responsible only for its own work.'
    },
    {
      no: '12', clause_id: 'C-COMM-003', title_cn: '沟通方式', title_en: 'Communications',
      text_cn: '双方通过电子邮件及 Microsoft Teams 进行项目沟通。',
      text_en: 'The parties will communicate by email and Microsoft Teams.'
    },
    {
      no: '13', clause_id: 'C-NOTICE-007', title_cn: '送达', title_en: 'Notices',
      text_cn: '正式通知可通过挂号邮件、电子邮件或传真送达，传真送达以发送报告显示成功为准。',
      text_en: 'Formal notices may be served by registered mail, email or facsimile; facsimile service is effective upon a successful transmission report.'
    },
    {
      no: '14', clause_id: 'C-LAW-001', title_cn: '适用法律与争议解决', title_en: 'Governing Law and Dispute Resolution',
      text_cn: '本协议适用中华人民共和国法律。争议提交深圳国际仲裁院仲裁。',
      text_en: 'This Agreement is governed by the laws of the People\'s Republic of China. Disputes shall be submitted to the Shenzhen Court of International Arbitration.'
    },
    {
      no: '附件一', clause_id: 'C-ANNEX-001', title_cn: '附件一 关联方清单', title_en: 'Annex I List of Related Parties',
      text_cn: '1. 星海智能（香港）有限公司；2. Starwave Intelligence US Inc.（美国特拉华州）；3. 星海软件（成都）有限公司。',
      text_en: '1. Starwave Intelligence (Hong Kong) Limited; 2. Starwave Intelligence US Inc. (Delaware, USA); 3. Starwave Software (Chengdu) Co., Ltd.'
    }
  ];

  // 2025 标准模板 v3.2（结构与已签合同一致，文本为通用模板口径）
  var TEMPLATE_2025_SECTIONS = [
    { no: '1', clause_id: 'C-SCOPE-001', title_cn: '服务范围', title_en: 'Scope of Services', text_cn: '我们将为客户 {{engagement_year}} 财政年度提供 {{service_type}}，具体范围见本条约定。本协议项下关联方范围见附件一。', text_en: 'We will provide {{service_type_en}} for the Client\'s FY{{engagement_year}} as set out in this clause. The related parties covered by this Agreement are listed in Annex I.' },
    { no: '2', clause_id: 'C-TERM-001', title_cn: '服务期间与交付安排', title_en: 'Term and Deliverables', text_cn: '服务期间与交付物由双方在本条中约定。', text_en: 'The service period and deliverables are set out in this clause.' },
    { no: '3', clause_id: 'C-TEAM-001', title_cn: '服务团队', title_en: 'Engagement Team', text_cn: '本项目由 {{partner}} 负责，项目经理为 {{manager}}。', text_en: 'The engagement is led by {{partner}}, with {{manager}} as Engagement Manager.' },
    { no: '4', clause_id: 'C-FEE-001', title_cn: '专业服务费', title_en: 'Professional Fees', text_cn: '本项目专业服务费为 {{fee_cn_upper}}（{{fee_display}}），不含增值税及代垫费用。', text_en: 'The professional fees are {{fee_display}}, exclusive of VAT and out-of-pocket expenses.' },
    { no: '5', clause_id: 'C-PAY-001', title_cn: '付款条件', title_en: 'Payment Terms', text_cn: '{{payment_terms}}', text_en: '{{payment_terms_en}}' },
    { no: '6', clause_id: 'C-CLIENT-001', title_cn: '客户责任与资料提供', title_en: 'Client Responsibilities', text_cn: '客户应及时提供完整、准确的财务与业务资料。我们不对客户提供资料的真实性和完整性独立核查。', text_en: 'The Client shall provide complete and accurate financial and business information on a timely basis. We do not independently verify the authenticity or completeness of information provided by the Client.' },
    { no: '7', clause_id: 'C-CONF-001', title_cn: '保密', title_en: 'Confidentiality', text_cn: '双方应对本项目涉及的保密信息予以保密，但依法定或监管要求披露的除外。', text_en: 'Each party shall keep confidential information relating to this engagement confidential, save for disclosures required by law or regulators.' },
    { no: '8', clause_id: 'C-DATA-005', title_cn: '个人信息与数据保护', title_en: 'Personal Information and Data Protection', text_cn: '我们将依照适用的中国法律处理客户提供的个人信息，仅用于本协议目的。具体送达与通知方式适用第 13 条。', text_en: 'We will process personal information provided by the Client in accordance with applicable PRC laws and solely for the purposes of this Agreement. Notices are governed by Clause 13.' },
    { no: '9', clause_id: 'C-LIAB-002', title_cn: '责任限制', title_en: 'Limitation of Liability', text_cn: '我们与贵司已磋商并同意，根据业务条款第 9.1 条，我们就本协议承担的责任上限将相当于贵司就导致该责任产生的相应服务或工作所应支付的服务费的两倍，但最终认定该部分损失或损害是由于我们的恶意或欺诈行为所导致的情况除外。', text_en: 'We have negotiated and agreed with you that, pursuant to clause 9.1 of the Terms of Business, our liability under this Agreement shall be capped at two times the fees payable by you for the services or work giving rise to such liability, save where such loss or damage is finally determined to have been caused by our bad faith or fraudulent conduct.' },
    { no: '10', clause_id: 'C-US-001', title_cn: '美国关联方服务特别约定', title_en: 'US Affiliate Special Provisions', text_cn: '（条件条款）就涉及客户美国关联方的服务，本协议不构成美国税务意见……', text_en: '(Conditional) With respect to services involving the Client\'s US affiliates, this Agreement does not constitute US tax advice…' },
    { no: '11', clause_id: 'C-GROUP-002', title_cn: '集团成员所协作', title_en: 'Member Firm Collaboration', text_cn: '本项目部分工作由普华永道其他成员所协助完成。各成员所仅就其自身工作承担责任。', text_en: 'Part of this engagement is supported by other PwC member firms. Each member firm is responsible only for its own work.' },
    { no: '12', clause_id: 'C-COMM-003', title_cn: '沟通方式', title_en: 'Communications', text_cn: '双方通过电子邮件及 Microsoft Teams 进行项目沟通。', text_en: 'The parties will communicate by email and Microsoft Teams.' },
    { no: '13', clause_id: 'C-NOTICE-007', title_cn: '送达', title_en: 'Notices', text_cn: '正式通知可通过挂号邮件、电子邮件或传真送达，传真送达以发送报告显示成功为准。', text_en: 'Formal notices may be served by registered mail, email or facsimile; facsimile service is effective upon a successful transmission report.' },
    { no: '14', clause_id: 'C-LAW-001', title_cn: '适用法律与争议解决', title_en: 'Governing Law and Dispute Resolution', text_cn: '本协议适用中华人民共和国法律。争议提交深圳国际仲裁院仲裁。', text_en: 'This Agreement is governed by the laws of the People\'s Republic of China. Disputes shall be submitted to the Shenzhen Court of International Arbitration.' }
  ];

  // 2026 标准模板 v4.0（相对 2025 有新增/修改/删除/格式变化）
  var TEMPLATE_2026_SECTIONS = [
    { no: '1', clause_id: 'C-SCOPE-001', title_cn: '服务范围', title_en: 'Scope of Services', text_cn: '我们将为客户 {{engagement_year}} 财政年度提供 {{service_type}}，具体范围见本条约定。本协议项下关联方范围见附件一。', text_en: 'We will provide {{service_type_en}} for the Client\'s FY{{engagement_year}} as set out in this clause. The related parties covered by this Agreement are listed in Annex I.' },
    { no: '2', clause_id: 'C-TERM-001', title_cn: '服务期间与交付安排', title_en: 'Term and Deliverables', text_cn: '服务期间与交付物由双方在本条中约定。', text_en: 'The service period and deliverables are set out in this clause.' },
    { no: '3', clause_id: 'C-TEAM-001', title_cn: '服务团队', title_en: 'Engagement Team', text_cn: '本项目由 {{partner}} 负责，项目经理为 {{manager}}。', text_en: 'The engagement is led by {{partner}}, with {{manager}} as Engagement Manager.' },
    { no: '4', clause_id: 'C-FEE-001', title_cn: '专业服务费', title_en: 'Professional Fees', text_cn: '本项目专业服务费为 {{fee_cn_upper}}（{{fee_display}}），不含增值税及代垫费用。', text_en: 'The professional fees are {{fee_display}}, exclusive of VAT and out-of-pocket expenses.' },
    { no: '5', clause_id: 'C-PAY-001', title_cn: '付款条件', title_en: 'Payment Terms', text_cn: '{{payment_terms}}', text_en: '{{payment_terms_en}}' },
    { no: '6', clause_id: 'C-CLIENT-001', title_cn: '客户责任与资料提供', title_en: 'Client Responsibilities', text_cn: '客户应按双方约定的时间提供完整、准确的财务与业务资料。我们不对客户提供资料的真实性和完整性独立核查。', text_en: 'The Client shall provide complete and accurate financial and business information within the timeframes agreed by the parties. We do not independently verify the authenticity or completeness of information provided by the Client.' },
    { no: '7', clause_id: 'C-CONF-001', title_cn: '保密', title_en: 'Confidentiality', text_cn: '双方应对本项目涉及的保密信息予以保密，但依法律、法规或监管机构（包括税务机关）要求披露的除外。', text_en: 'Each party shall keep confidential information relating to this engagement confidential, save for disclosures required by laws, regulations or regulators (including the tax authorities).' },
    {
      no: '8', clause_id: 'C-DATA-005', title_cn: '个人信息与数据保护', title_en: 'Personal Information and Data Protection',
      text_cn: '我们将依照《中华人民共和国个人信息保护法》及其配套规定处理客户提供的个人信息，仅用于本协议目的。如涉及个人信息或重要数据出境，双方应另行签署标准合同条款并完成必要的备案或评估；未完成前不得进行相关传输。具体送达与通知方式适用第 13 条。',
      text_en: 'We will process personal information provided by the Client in accordance with the PRC Personal Information Protection Law and its implementing rules, and solely for the purposes of this Agreement. Where personal information or important data is transferred outside the PRC, the parties shall enter into the applicable standard contractual clauses and complete any required filing or assessment before such transfer takes place. Notices are governed by Clause 13.'
    },
    {
      no: '9', clause_id: 'C-LIAB-002', title_cn: '责任限制', title_en: 'Limitation of Liability',
      text_cn: '我们与贵司已磋商并同意，根据业务条款第 9.1 条，我们就本协议承担的责任上限将相当于贵司就导致该责任产生的相应服务或工作所应支付的服务费的数额，但最终认定该部分损失或损害是由于我们的恶意或欺诈行为所导致的情况除外。',
      text_en: 'We have negotiated and agreed with you that, pursuant to clause 9.1 of the Terms of Business, our liability under this Agreement shall be capped at two times the fees payable by you for the services or work giving rise to such liability, save where such loss or damage is finally determined to have been caused by our bad faith or fraudulent conduct.'
    },
    { no: '10', clause_id: 'C-US-001', title_cn: '美国关联方服务特别约定', title_en: 'US Affiliate Special Provisions', text_cn: '（条件条款）就涉及客户美国关联方的服务，本协议不构成美国税务意见……', text_en: '(Conditional) With respect to services involving the Client\'s US affiliates, this Agreement does not constitute US tax advice…' },
    {
      no: '11', clause_id: 'C-GROUP-002', title_cn: '集团成员所协作与责任分担', title_en: 'Member Firm Collaboration and Allocation of Responsibility',
      text_cn: '本项目部分工作由普华永道其他成员所协助完成。各成员所仅就其自身工作对客户承担责任，成员所之间不承担连带责任；客户同意其索赔仅可向签约成员所提出，且以该成员所本协议项下责任限额为限。',
      text_en: 'Part of this engagement is supported by other PwC member firms. Each member firm is responsible to the Client only for its own work and no joint and several liability arises between member firms. The Client agrees that any claim may only be brought against the contracting member firm and is subject to that firm\'s liability cap under this Agreement.'
    },
    { no: '12', clause_id: 'C-COMM-003', title_cn: '沟通方式', title_en: 'Communications', text_cn: '双方通过电子邮件及 Microsoft Teams 进行项目沟通。', text_en: 'The parties will communicate by email and Microsoft Teams.' },
    {
      no: '13', clause_id: 'C-AI-DATA-004', title_cn: 'AI 辅助服务及数据处理', title_en: 'AI-assisted Services and Data Processing',
      text_cn: '客户理解并同意，我们在提供本协议项下服务过程中可能使用经普华永道内部批准的人工智能辅助工具处理项目资料。相关处理仅在普华永道控制的环境内进行，不用于训练面向第三方的通用模型；所有人工智能输出均须经我们的专业人员复核后方可作为交付成果。客户可书面要求不使用人工智能辅助工具，届时双方将另行商定时间与费用安排。',
      text_en: 'The Client acknowledges and agrees that in performing the services we may use AI-assisted tools approved under PwC internal policy to process engagement materials. Such processing takes place solely within PwC-controlled environments and is not used to train general-purpose models made available to third parties. All AI output is reviewed by our professionals before being issued as a deliverable. The Client may request in writing that AI-assisted tools not be used, in which case the parties will agree revised timing and fees.'
    },
    {
      no: '14', clause_id: 'C-LAW-001', title_cn: '适用法律与争议解决', title_en: 'Governing Law and Dispute Resolution',
      text_cn: '本协议适用中华人民共和国现行有效的法律。因本协议引起的或与之相关的任何争议，应提交深圳国际仲裁院按其届时有效的仲裁规则仲裁解决。',
      text_en: 'This Agreement is governed by the laws of the People\'s Republic of China in force from time to time. Any dispute arising out of or in connection with this Agreement shall be submitted to the Shenzhen Court of International Arbitration for arbitration under its rules then in effect.'
    }
  ];

  /* 模板版式规范（格式层，非条款文本）—— 供程序比对得出「纯格式变化」 */
  var TEMPLATE_2025_FORMAT = {
    body_style: '正文小四号、行距 1.5、条款标题加粗不编号缩进',
    footer: 'PwC | TP Engagement Letter 2025 | 第 X 页 / 共 Y 页',
    annex_title: '附件一 关联方清单'
  };
  var TEMPLATE_2026_FORMAT = {
    body_style: '正文小四号、行距 1.5、条款标题加粗并统一左缩进 0 字符、段前 6 磅',
    footer: 'PwC | TP Engagement Letter 2026 | {{contract_no}} | 第 X 页 / 共 Y 页',
    annex_title: '附件一：关联方清单（{{engagement_year}}）'
  };
  var FORMAT_FIELD_MAP = {
    body_style: 'CH-FMT',
    footer: 'CH-HEADER',
    annex_title: 'CH-ANNEX-TITLE'
  };

  /* 语义分类（预置分析结果 / 预计算）—— 结构差异由程序实时计算，语义分级取自此表 */
  var SEMANTIC_DIFF_CLASS = {
    'C-LIAB-002': { diff_class: 'substantive', change_id: 'CH-LIAB' },
    'C-DATA-005': { diff_class: 'substantive', change_id: 'CH-DATA' },
    'C-GROUP-002': { diff_class: 'substantive', change_id: 'CH-GROUP' },
    'C-LAW-001': { diff_class: 'wording_only', change_id: 'CH-LAW' },
    'C-CLIENT-001': { diff_class: 'wording_only', change_id: 'CH-WORDING-1' },
    'C-CONF-001': { diff_class: 'wording_only', change_id: 'CH-WORDING-2' },
    'C-AI-DATA-004': { diff_class: 'added', change_id: 'CH-AI-DATA' },
    'C-NOTICE-007': { diff_class: 'removed', change_id: 'CH-NOTICE' }
  };

  // 2026 客户信息表（XLSX 结构化行）
  var CLIENT_INFO_ROWS = [
    { field: '客户中文名称', value: '星海智能科技（深圳）有限公司' },
    { field: '客户英文名称', value: 'Starwave Intelligence Technology (Shenzhen) Co., Ltd.' },
    { field: '注册地址', value: '深圳市南山区粤海街道深湾一路 8 号星海科技大厦 A 座 33 层' },
    { field: '法定代表人', value: 'Richard Chen' },
    { field: '授权联系人', value: '财务总监 Grace Zhou（gracezhou@starwave-demo.cn）' },
    { field: '集团名称', value: '星海科技集团 / Starwave Technology Group' },
    { field: '关联方（境内外）', value: '星海智能（香港）有限公司；星海软件（成都）有限公司' },
    { field: '服务年度', value: '2026' },
    { field: '服务类型', value: '转让定价文档准备服务（本地文档 + 集团主体文档更新协助）' },
    { field: '服务地区', value: '中国大陆、香港' },
    { field: '服务团队要求', value: '合伙人 Victoria Hale；项目经理 Daniel Reed' },
    { field: '预算费用', value: 'RMB 528,000（不含税）' },
    { field: '付款条件', value: '签约后 30 日内 50%，交付后 30 日内 50%' },
    { field: '合同语言', value: '中英双语（中文为准）' },
    { field: '沟通渠道', value: '电子邮件、Microsoft Teams、微信（客户财务团队要求）' },
    { field: '是否跨境传输数据', value: '是（部分财务数据存放于香港及新加坡云端）' },
    { field: '是否涉及第三方数据', value: '否' },
    { field: '是否存在分包', value: '否；由普华永道香港成员所协作' },
    { field: '是否涉及美国业务', value: '' },
    { field: '备注', value: '客户 2026 年组织架构调整仍在进行中，部分境外主体信息待确认。' }
  ];

  var DOCUMENTS = [
    {
      document_id: 'D-001', task_id: 'T-2026-0392', document_type: 'prior_contract',
      document_type_cn: '上年度已签合同', filename: '2025_Engagement_Letter_Starwave_CN-EN.docx',
      version: '已签署终稿', hash: 'a91f7c2e5b0d4488', upload_time: '2026-01-12 09:41',
      parse_status: 'parsed', parse_note: '解析成功：15 个段落 / 1 个附件 / 0 页无法读取',
      pages: 11, required: true, sections: PRIOR_CONTRACT_SECTIONS
    },
    {
      document_id: 'D-002', task_id: 'T-2026-0392', document_type: 'template_2026',
      document_type_cn: '本年度标准模板', filename: 'PwC_TP_Standard_Template_2026_v4.0.docx',
      version: '2026 v4.0（2026-01-05 发布）', hash: 'c47b90ae13f6d221', upload_time: '2026-01-12 09:41',
      parse_status: 'parsed', parse_note: '解析成功：14 个条款段落 / 0 页无法读取',
      pages: 12, required: true, sections: TEMPLATE_2026_SECTIONS
    },
    {
      document_id: 'D-003', task_id: 'T-2026-0392', document_type: 'client_info',
      document_type_cn: '当年客户信息表', filename: 'Starwave_Client_Info_2026.xlsx',
      version: '客户 2026-01-08 回填', hash: '5d2e8fb1c09a7734', upload_time: '2026-01-12 09:42',
      parse_status: 'parsed', parse_note: '解析成功：20 行字段 / 1 行为空值（是否涉及美国业务）',
      pages: 1, required: false, rows: CLIENT_INFO_ROWS
    },
    {
      document_id: 'D-004', task_id: 'T-2026-0392', document_type: 'template_2025',
      document_type_cn: '上年度标准模板（比对基准）', filename: 'PwC_TP_Standard_Template_2025_v3.2.docx',
      version: '2025 v3.2', hash: '8b3af5610d9e2c07', upload_time: '2026-01-12 09:42',
      parse_status: 'parsed', parse_note: '解析成功：14 个条款段落 / 0 页无法读取',
      pages: 11, required: false, sections: TEMPLATE_2025_SECTIONS
    },
    {
      document_id: 'D-005', task_id: 'T-2026-0392', document_type: 'fee_quote',
      document_type_cn: '服务报价 / 项目批准信息', filename: 'Starwave_Fee_Approval_2026.pdf',
      version: '内部批准 2026-01-06', hash: 'f0c6d34ba8271e95', upload_time: '2026-01-12 09:42',
      parse_status: 'parsed', parse_note: '解析成功：2 页；含费用批准金额 RMB 528,000',
      pages: 2, required: false,
      sections: [{ no: '1', clause_id: 'C-FEE-001', title_cn: '费用批准', title_en: 'Fee Approval', text_cn: '经业务负责人批准，星海智能科技 2026 年度转让定价文档服务费为 RMB 528,000（较 2025 年上调 10%，主要因新增集团主体文档更新协助）。', text_en: 'Approved fee for FY2026 TP documentation services: RMB 528,000 (a 10% increase over 2025, mainly due to the added Master File update support).' }]
    }
  ];

  /* ==========================================================================
     2. 提取字段（ExtractedFact §12.1 / §7.1 步骤3）
        prior = 从上年度合同提取；current = 从今年资料提取
        engine 会实时比较 prior/current 得出「客户事实变化」
     ========================================================================*/
  var FACTS = [
    /* ---- 客户信息 ---- */
    {
      fact_id: 'F-001', field_name: 'client_name_cn', group: 'client', label_cn: '客户中文名称', label_en: 'Client Name (CN)',
      prior: { value: '星海智能科技（深圳）有限公司', source: { document_id: 'D-001', section: '首部', quote: '星海智能科技（深圳）有限公司（注册地址：深圳市南山区科技园高新南七道 12 号星海大厦 20 层，以下称"客户"）' } },
      current: { value: '星海智能科技（深圳）有限公司', confidence: 0.98, sources: [{ document_id: 'D-003', section: '客户中文名称', quote: '星海智能科技（深圳）有限公司' }, { document_id: 'D-001', section: '首部', quote: '星海智能科技（深圳）有限公司' }] },
      risk_if_changed: 'medium',
      volatility: 'low', volatility_why: '基本不变，但仍需过目一次以防客户主体或口径调整'
    },
    {
      fact_id: 'F-002', field_name: 'client_name_en', group: 'client', label_cn: '客户英文名称', label_en: 'Client Name (EN)',
      prior: { value: 'Starwave Intelligence Technology (Shenzhen) Co., Ltd.', source: { document_id: 'D-001', section: 'Parties', quote: 'Starwave Intelligence Technology (Shenzhen) Co., Ltd.' } },
      current: { value: 'Starwave Intelligence Technology (Shenzhen) Co., Ltd.', confidence: 0.97, sources: [{ document_id: 'D-003', section: '客户英文名称', quote: 'Starwave Intelligence Technology (Shenzhen) Co., Ltd.' }] },
      risk_if_changed: 'medium',
      volatility: 'low', volatility_why: '基本不变，但仍需过目一次以防客户主体或口径调整'
    },
    {
      fact_id: 'F-003', field_name: 'registered_address', group: 'client', label_cn: '注册地址', label_en: 'Registered Address',
      prior: { value: '深圳市南山区科技园高新南七道 12 号星海大厦 20 层', source: { document_id: 'D-001', section: '首部', quote: '注册地址：深圳市南山区科技园高新南七道 12 号星海大厦 20 层' } },
      current: { value: '深圳市南山区粤海街道深湾一路 8 号星海科技大厦 A 座 33 层', confidence: 0.93, sources: [{ document_id: 'D-003', section: '注册地址', quote: '深圳市南山区粤海街道深湾一路 8 号星海科技大厦 A 座 33 层' }] },
      risk_if_changed: 'medium',
      volatility: 'medium', volatility_why: '有时会变，容易被当成「跟去年一样」而跳过'
    },
    {
      fact_id: 'F-004', field_name: 'legal_representative', group: 'client', label_cn: '法定代表人 / 授权联系人', label_en: 'Legal Rep. / Authorised Contact',
      prior: { value: 'Richard Chen（法定代表人）', source: { document_id: 'D-001', section: '签署页', quote: '客户授权代表：Richard Chen' } },
      current: { value: 'Richard Chen（法定代表人）· 授权联系人：财务总监 Grace Zhou', confidence: 0.90, sources: [{ document_id: 'D-003', section: '法定代表人 / 授权联系人', quote: 'Richard Chen；财务总监 Grace Zhou（gracezhou@starwave-demo.cn）' }] },
      risk_if_changed: 'low',
      volatility: 'medium', volatility_why: '有时会变，容易被当成「跟去年一样」而跳过'
    },
    {
      fact_id: 'F-005', field_name: 'group_name', group: 'client', label_cn: '集团名称', label_en: 'Group Name',
      prior: { value: '星海科技集团 / Starwave Technology Group', source: { document_id: 'D-001', section: '附件一 关联方清单', quote: '星海科技集团下属主体' } },
      current: { value: '星海科技集团 / Starwave Technology Group', confidence: 0.95, sources: [{ document_id: 'D-003', section: '集团名称', quote: '星海科技集团 / Starwave Technology Group' }] },
      risk_if_changed: 'low',
      volatility: 'low', volatility_why: '基本不变，但仍需过目一次以防客户主体或口径调整'
    },
    {
      fact_id: 'F-006', field_name: 'related_parties', group: 'client', label_cn: '涉及关联方', label_en: 'Related Parties',
      prior: { value: '星海智能（香港）有限公司；Starwave Intelligence US Inc.；星海软件（成都）有限公司', source: { document_id: 'D-001', section: '附件一 关联方清单', quote: '1. 星海智能（香港）有限公司；2. Starwave Intelligence US Inc.（美国特拉华州）；3. 星海软件（成都）有限公司。' } },
      current: { value: '星海智能（香港）有限公司；星海软件（成都）有限公司', confidence: 0.88, sources: [{ document_id: 'D-003', section: '关联方（境内外）', quote: '星海智能（香港）有限公司；星海软件（成都）有限公司' }] },
      risk_if_changed: 'high',
      volatility: 'high', volatility_why: '几乎每年都需重新确认 —— 漏看的代价最大',
      note_cn: '今年清单未包含 Starwave Intelligence US Inc.；客户信息表备注称境外主体信息待确认，因此不能直接认定该主体已不存在。'
    },

    /* ---- 项目信息 ---- */
    {
      fact_id: 'F-007', field_name: 'service_type', group: 'project', label_cn: '服务类型', label_en: 'Service Type',
      prior: { value: '转让定价文档准备服务（本地文档）', source: { document_id: 'D-001', section: '1 服务范围', quote: '提供转让定价文档准备服务，包括中国转让定价本地文档编制' } },
      current: { value: '转让定价文档准备服务（本地文档 + 集团主体文档更新协助）', confidence: 0.94, sources: [{ document_id: 'D-003', section: '服务类型', quote: '转让定价文档准备服务（本地文档 + 集团主体文档更新协助）' }] },
      risk_if_changed: 'medium',
      volatility: 'medium', volatility_why: '有时会变，容易被当成「跟去年一样」而跳过'
    },
    {
      fact_id: 'F-008', field_name: 'engagement_year', group: 'project', label_cn: '服务年度', label_en: 'Engagement Year',
      prior: { value: '2025', source: { document_id: 'D-001', section: '1 服务范围', quote: '为客户 2025 财政年度提供转让定价文档准备服务' } },
      current: { value: '2026', confidence: 1.0, deterministic: true, sources: [{ document_id: 'D-003', section: '服务年度', quote: '2026' }] },
      risk_if_changed: 'low',
      volatility: 'high', volatility_why: '几乎每年都需重新确认 —— 漏看的代价最大'
    },
    {
      fact_id: 'F-009', field_name: 'service_scope', group: 'project', label_cn: '服务范围', label_en: 'Scope of Services',
      prior: { value: '本地文档编制、可比性分析；覆盖中国大陆、香港及美国关联方交易', source: { document_id: 'D-001', section: '1 服务范围', quote: '就客户中国大陆、香港及美国关联方之间的服务与特许权使用交易提供文档支持' } },
      current: { value: '本地文档编制、可比性分析、集团主体文档更新协助；覆盖中国大陆、香港关联方交易', confidence: 0.90, sources: [{ document_id: 'D-003', section: '服务类型' }, { document_id: 'D-003', section: '服务地区', quote: '中国大陆、香港' }] },
      risk_if_changed: 'medium',
      volatility: 'high', volatility_why: '几乎每年都需重新确认 —— 漏看的代价最大'
    },
    {
      fact_id: 'F-010', field_name: 'service_regions', group: 'project', label_cn: '服务地区', label_en: 'Service Regions',
      prior: { value: '中国大陆、香港、美国', source: { document_id: 'D-001', section: '1 服务范围', quote: '中国大陆、香港及美国关联方之间的服务与特许权使用交易' } },
      current: { value: '中国大陆、香港', confidence: 0.61, sources: [{ document_id: 'D-003', section: '服务地区', quote: '中国大陆、香港' }] },
      risk_if_changed: 'high',
      volatility: 'high', volatility_why: '几乎每年都需重新确认 —— 漏看的代价最大',
      note_cn: '客户信息表「是否涉及美国业务」为空，服务地区未明确排除美国，属信息不足而非确认排除。'
    },
    {
      fact_id: 'F-011', field_name: 'deliverables', group: 'project', label_cn: '交付物', label_en: 'Deliverables',
      prior: { value: '中文本地文档定稿、英文摘要、可比性分析附件', source: { document_id: 'D-001', section: '2 服务期间与交付安排', quote: '交付物包括：中文本地文档定稿、英文摘要、可比性分析附件' } },
      current: { value: '中文本地文档定稿、英文摘要、可比性分析附件、集团主体文档更新建议稿', confidence: 0.87, sources: [{ document_id: 'D-003', section: '服务类型', quote: '本地文档 + 集团主体文档更新协助' }] },
      risk_if_changed: 'medium',
      volatility: 'high', volatility_why: '几乎每年都需重新确认 —— 漏看的代价最大'
    },
    {
      fact_id: 'F-012', field_name: 'timeline', group: 'project', label_cn: '时间安排', label_en: 'Timeline',
      prior: { value: '2025-03-01 至 2025-11-30', source: { document_id: 'D-001', section: '2 服务期间与交付安排', quote: '服务期间自 2025 年 3 月 1 日起至 2025 年 11 月 30 日止' } },
      current: { value: '2026-03-01 至 2026-11-30', confidence: 0.82, deterministic: true, sources: [{ document_id: 'D-003', section: '服务年度', quote: '2026' }],
        derivation: '按年度字段规则 R-YEAR-001 在上年度期间基础上顺延一年，需人工复核具体日期。' },
      risk_if_changed: 'low',
      volatility: 'high', volatility_why: '几乎每年都需重新确认 —— 漏看的代价最大'
    },
    {
      fact_id: 'F-013', field_name: 'service_team', group: 'project', label_cn: '服务团队', label_en: 'Engagement Team',
      prior: { value: '合伙人 Victoria Hale；项目经理 Laura Finch；高级顾问 Emma Clarke', source: { document_id: 'D-001', section: '3 服务团队', quote: '本项目由合伙人 Victoria Hale 负责，项目经理为 Laura Finch，高级顾问为 Emma Clarke。' } },
      current: { value: '合伙人 Victoria Hale；项目经理 Daniel Reed；高级顾问 Emma Clarke', confidence: 0.94, sources: [{ document_id: 'D-003', section: '服务团队要求', quote: '合伙人 Victoria Hale；项目经理 Daniel Reed' }] },
      risk_if_changed: 'medium',
      volatility: 'high', volatility_why: '几乎每年都需重新确认 —— 漏看的代价最大'
    },
    {
      fact_id: 'F-014', field_name: 'fee', group: 'project', label_cn: '费用', label_en: 'Professional Fees',
      prior: { value: 'RMB 480,000', source: { document_id: 'D-001', section: '4 专业服务费', quote: '本项目专业服务费为人民币肆拾捌万元整（RMB 480,000）' } },
      current: { value: 'RMB 528,000', confidence: 0.96, deterministic: true, sources: [{ document_id: 'D-003', section: '预算费用', quote: 'RMB 528,000（不含税）' }, { document_id: 'D-005', section: '费用批准', quote: '经业务负责人批准，星海智能科技 2026 年度转让定价文档服务费为 RMB 528,000' }] },
      risk_if_changed: 'medium',
      volatility: 'high', volatility_why: '几乎每年都需重新确认 —— 漏看的代价最大'
    },
    {
      fact_id: 'F-015', field_name: 'payment_terms', group: 'project', label_cn: '付款条件', label_en: 'Payment Terms',
      prior: { value: '签署后 30 日内 50%，交付定稿后 30 日内 50%', source: { document_id: 'D-001', section: '5 付款条件', quote: '客户应于本协议签署后 30 日内支付服务费的 50%，余款于交付定稿后 30 日内支付。' } },
      current: { value: '签署后 30 日内 50%，交付定稿后 30 日内 50%', confidence: 0.93, sources: [{ document_id: 'D-003', section: '付款条件', quote: '签约后 30 日内 50%，交付后 30 日内 50%' }] },
      risk_if_changed: 'medium',
      volatility: 'medium', volatility_why: '有时会变，容易被当成「跟去年一样」而跳过'
    },
    {
      fact_id: 'F-016', field_name: 'contract_language', group: 'project', label_cn: '合同语言', label_en: 'Contract Language',
      prior: { value: '中英双语（中文为准）', source: { document_id: 'D-001', section: '首部', quote: '中英双语版本，以中文为准' } },
      current: { value: '中英双语（中文为准）', confidence: 0.99, sources: [{ document_id: 'D-003', section: '合同语言', quote: '中英双语（中文为准）' }] },
      risk_if_changed: 'low',
      volatility: 'low', volatility_why: '基本不变，但仍需过目一次以防客户主体或口径调整'
    },

    /* ---- 条件性条款的判断依据（官方模板要求逐项确认才能决定加不加）---- */
    {
      fact_id: 'F-025', field_name: 'contracting_entity', group: 'project', label_cn: '我方签约主体', label_en: 'Contracting PwC Entity',
      prior: { value: '普华永道咨询（深圳）有限公司', source: { document_id: 'D-001', section: '首部', quote: '与普华永道咨询（深圳）有限公司（以下称"我们"）' } },
      current: { value: '普华永道咨询（深圳）有限公司', confidence: 0.95, sources: [{ document_id: 'D-002', section: '首部', quote: '［深圳／北京分公司／上海分公司／广州分公司］请选择使用' }] },
      risk_if_changed: 'medium',
      volatility: 'low', volatility_why: '基本不变，但仍需过目一次以防客户主体或口径调整'
    },
    {
      fact_id: 'F-026', field_name: 'client_is_group', group: 'client', label_cn: '是否按集团公司签约', label_en: 'Contracting with Group Companies',
      prior: { value: '是', source: { document_id: 'D-001', section: '首部', quote: '及列于附件一的实体（以下统称"客户"）' } },
      current: { value: '是', confidence: 0.92, sources: [{ document_id: 'D-003', section: '关联方（境内外）', quote: '星海智能（香港）有限公司；星海软件（成都）有限公司' }] },
      risk_if_changed: 'medium',
      volatility: 'medium', volatility_why: '有时会变，容易被当成「跟去年一样」而跳过'
    },
    {
      fact_id: 'F-027', field_name: 'involves_state_secrets', group: 'special', label_cn: '客户信息是否含国家秘密', label_en: 'Involves State Secrets',
      prior: { value: '否', source: { document_id: 'D-001', section: '—', quote: '上年度合同未加入国家秘密法条款' } },
      current: { value: '否', confidence: 0.88, sources: [{ document_id: 'D-003', section: '是否涉及第三方数据', quote: '否' }] },
      risk_if_changed: 'high',
      volatility: 'medium', volatility_why: '有时会变，容易被当成「跟去年一样」而跳过'
    },
    {
      fact_id: 'F-028', field_name: 'client_accesses_pwc_tech', group: 'special', label_cn: '客户人员是否访问我方技术平台', label_en: 'Client Access to PwC Technology',
      prior: { value: '否', source: { document_id: 'D-001', section: '—', quote: '上年度合同未加入技术使用条款' } },
      current: { value: '否', confidence: 0.86, sources: [{ document_id: 'D-003', section: '服务类型', quote: '转让定价文档准备服务（本地文档 + 集团主体文档更新协助）' }] },
      risk_if_changed: 'high',
      volatility: 'medium', volatility_why: '有时会变，容易被当成「跟去年一样」而跳过'
    },

    /* ---- 特殊情形 ---- */
    {
      fact_id: 'F-017', field_name: 'involves_us', group: 'special', label_cn: '是否涉及美国', label_en: 'US Involvement',
      prior: { value: '是', source: { document_id: 'D-001', section: '10 美国关联方服务特别约定', quote: '就涉及客户美国关联方 Starwave Intelligence US Inc. 的服务，本协议不构成美国税务意见……' } },
      current: { value: null, confidence: 0.42, sources: [{ document_id: 'D-003', section: '是否涉及美国业务', quote: '（空值）' }, { document_id: 'D-003', section: '备注', quote: '客户 2026 年组织架构调整仍在进行中，部分境外主体信息待确认。' }] },
      risk_if_changed: 'high',
      volatility: 'high', volatility_why: '几乎每年都需重新确认 —— 漏看的代价最大',
      conflict: {
        type: 'prior_vs_missing',
        summary: '上年度合同含美国关联方专项条款，今年客户信息表未提及美国业务且相关字段为空。',
        options: [
          { key: 'A', label: '今年仍涉及美国业务', effect: '保留 C-US-001 美国关联方条款，服务地区补回美国。' },
          { key: 'B', label: '今年不再涉及美国业务', effect: '删除 C-US-001，并从关联方清单与服务地区中移除美国主体。' },
          { key: 'C', label: '尚不确定，升级给经理', effect: '条款状态保持"暂停处理"，任务不可完成，需经理或合伙人裁定。' }
        ]
      },
      note_cn: '文件之间冲突时系统不选边，只列出冲突并升级给人判断。'
    },
    {
      fact_id: 'F-018', field_name: 'member_firm_involved', group: 'special', label_cn: '是否涉及其他成员所 / 集团关联方', label_en: 'Member Firm Involvement',
      prior: { value: '是（普华永道香港成员所）', source: { document_id: 'D-001', section: '11 集团成员所协作', quote: '本项目部分工作由普华永道香港成员所协助完成。' } },
      current: { value: '是（普华永道香港成员所）', confidence: 0.89, sources: [{ document_id: 'D-003', section: '是否存在分包', quote: '否；由普华永道香港成员所协作' }] },
      risk_if_changed: 'high',
      volatility: 'medium', volatility_why: '有时会变，容易被当成「跟去年一样」而跳过'
    },
    {
      fact_id: 'F-019', field_name: 'communication_channels', group: 'special', label_cn: '沟通渠道（含非标准即时通讯）', label_en: 'Communication Channels',
      prior: { value: '电子邮件、Microsoft Teams', source: { document_id: 'D-001', section: '12 沟通方式', quote: '双方通过电子邮件及 Microsoft Teams 进行项目沟通。' } },
      current: { value: '电子邮件、Microsoft Teams、微信', confidence: 0.91, sources: [{ document_id: 'D-003', section: '沟通渠道', quote: '电子邮件、Microsoft Teams、微信（客户财务团队要求）' }] },
      risk_if_changed: 'medium',
      volatility: 'medium', volatility_why: '有时会变，容易被当成「跟去年一样」而跳过'
    },
    {
      fact_id: 'F-020', field_name: 'cross_border_data_transfer', group: 'special', label_cn: '是否跨境传输数据', label_en: 'Cross-border Data Transfer',
      prior: { value: '未在合同中明确', source: { document_id: 'D-001', section: '8 个人信息与数据保护', quote: '我们将依照适用的中国法律处理客户提供的个人信息，仅用于本协议目的。' } },
      current: { value: '是（香港、新加坡云端存放部分财务数据）', confidence: 0.86, sources: [{ document_id: 'D-003', section: '是否跨境传输数据', quote: '是（部分财务数据存放于香港及新加坡云端）' }] },
      risk_if_changed: 'high',
      volatility: 'high', volatility_why: '几乎每年都需重新确认 —— 漏看的代价最大'
    },
    {
      fact_id: 'F-021', field_name: 'third_party_data', group: 'special', label_cn: '是否包含第三方数据', label_en: 'Third-party Data',
      prior: { value: '否', source: { document_id: 'D-001', section: '6 客户责任与资料提供', quote: '客户应及时提供完整、准确的财务与业务资料。' } },
      current: { value: '否', confidence: 0.80, sources: [{ document_id: 'D-003', section: '是否涉及第三方数据', quote: '否' }] },
      risk_if_changed: 'medium',
      volatility: 'medium', volatility_why: '有时会变，容易被当成「跟去年一样」而跳过'
    },
    {
      fact_id: 'F-022', field_name: 'subcontracting', group: 'special', label_cn: '是否存在分包', label_en: 'Subcontracting',
      prior: { value: '否', source: { document_id: 'D-001', section: '11 集团成员所协作', quote: '本项目部分工作由普华永道香港成员所协助完成。' } },
      current: { value: '否', confidence: 0.85, sources: [{ document_id: 'D-003', section: '是否存在分包', quote: '否；由普华永道香港成员所协作' }] },
      risk_if_changed: 'medium',
      volatility: 'medium', volatility_why: '有时会变，容易被当成「跟去年一样」而跳过'
    },
    {
      fact_id: 'F-023', field_name: 'special_liability_cap', group: 'special', label_cn: '是否存在特殊责任限制', label_en: 'Special Liability Cap',
      prior: { value: '磋商覆盖：服务费的两倍', source: { document_id: 'D-001', section: '9 责任限制', quote: '责任上限将相当于贵司就导致该责任产生的相应服务或工作所应支付的服务费的两倍' } },
      current: { value: '按 2026 标准模板磋商口径：相当于服务费的数额（一倍）', confidence: 0.88, sources: [{ document_id: 'D-002', section: '9 责任限制', quote: '责任上限将相当于贵司就导致该责任产生的相应服务或工作所应支付的服务费的数额' }] },
      risk_if_changed: 'high',
      volatility: 'high', volatility_why: '几乎每年都需重新确认 —— 漏看的代价最大',
      note_cn: '责任限额不得由系统自动决定，须合伙人 / 风险审批人批准。'
    },
    {
      fact_id: 'F-024', field_name: 'ai_assisted_processing', group: 'special', label_cn: '是否使用 AI 辅助处理客户资料', label_en: 'AI-assisted Processing',
      prior: { value: '未在合同中约定', source: { document_id: 'D-001', section: '（全文未见）', quote: '2025 年合同与 2025 v3.2 模板均无对应条款。' } },
      current: { value: '是（2026 模板新增标准条款）', confidence: 0.92, sources: [{ document_id: 'D-002', section: '13 AI 辅助服务及数据处理', quote: '我们在提供本协议项下服务过程中可能使用经普华永道内部批准的人工智能辅助工具处理项目资料。' }] },
      risk_if_changed: 'high',
      volatility: 'high', volatility_why: '几乎每年都需重新确认 —— 漏看的代价最大'
    }
  ];

  /* ==========================================================================
     服务内容库 —— 生成新合同时按服务类型取用
     --------------------------------------------------------------------------
     服务分类取自事务所提供的 5 份常见服务类型业务约定书；每类的服务范围、
     除外项目、成果物、计费方式结构不同。事务所表示会另行提供各类的「常用服务
     范围」明细，届时替换 detail_status = 'pending' 的条目即可，无需改程序。
     ========================================================================*/
  var SERVICE_LIBRARY = [
    {
      service_id: 'SVC-TPD', name_cn: '转让定价同期资料（本地文档 / 主体文档）',
      name_en: 'TP Documentation (Local File / Master File)',
      billing: 'fixed', billing_cn: '固定费用，可按年度分期',
      scope_items: ['主体文档的准备', '本地文档的更新', '资本弱化特殊事项文档的准备',
                    '企业年度关联业务往来报告表的审阅'],
      exclusions: ['税务机关现场检查的应对', '境外国家的本地文档编制'],
      deliverables: ['中文本地文档定稿', '英文摘要', '可比性分析附件'],
      typical_clauses: ['C-SCOPE-001', 'C-TERM-001', 'C-FEE-001', 'C-DATA-005'],
      detail_status: 'preset', source: '事务所提供的中英文官方模板'
    },
    {
      service_id: 'SVC-DEF', name_cn: '中国转让定价防御性支持服务',
      name_en: 'PRC TP Defence Support',
      billing: 'hourly', billing_cn: '部分固定 + 部分按实际工时计费（分职级费率）',
      scope_items: ['更新测算所需的可比性分析', '对贵司提供的测算结果进行复核审阅',
                    '重新审阅可比性分析结果', '识别并分析特殊因素影响',
                    '审阅依据税务机关要求准备的相关资料', '与税务机关进行各类沟通交涉'],
      exclusions: ['正式行政复议与诉讼代理'],
      deliverables: ['可比性分析更新说明', '复核意见', '沟通交涉记录'],
      typical_clauses: ['C-SCOPE-001', 'C-FEE-001', 'C-DATA-005'],
      detail_status: 'preset', source: '事务所提供的常见服务类型业务约定书'
    },
    {
      service_id: 'SVC-BM', name_cn: '转让定价同行业可比性分析服务',
      name_en: 'TP Industry Comparability Analysis',
      billing: 'fixed', billing_cn: '固定费用，签约 50% / 出具初稿 50%',
      scope_items: ['同行业可比性分析'],
      exclusions: ['本地文档编制', '税务机关应对'],
      deliverables: ['可比性分析报告'],
      typical_clauses: ['C-SCOPE-001', 'C-FEE-001'],
      detail_status: 'preset', source: '事务所提供的常见服务类型业务约定书'
    },
    {
      service_id: 'SVC-ADV', name_cn: '税务及转让定价咨询（含常年咨询）',
      name_en: 'Tax and TP Advisory (incl. Annual Retainer)',
      billing: 'mixed', billing_cn: '分阶段固定费用 + 超出工时按职级费率',
      scope_items: ['专项服务（分阶段：辅导实施 / 分析制定与实施）',
                    '转让定价筹划分析服务', '常年税务咨询服务'],
      exclusions: ['审计意见、鉴证或其他形式的认证'],
      deliverables: ['分析与建议报告', '咨询意见'],
      typical_clauses: ['C-SCOPE-001', 'C-FEE-001', 'C-LIAB-002'],
      detail_status: 'preset', source: '事务所提供的常见服务类型业务约定书'
    },
    {
      service_id: 'SVC-MULTI', name_cn: '多年期转让定价文档服务',
      name_en: 'Multi-year TP Documentation Service',
      billing: 'fixed', billing_cn: '按年固定费用，逐年分期（如 2025—2027）',
      scope_items: ['各年度本地文档的准备与更新'],
      exclusions: ['服务期间外的年度'],
      deliverables: ['各年度本地文档定稿'],
      typical_clauses: ['C-SCOPE-001', 'C-TERM-001', 'C-FEE-001'],
      detail_status: 'preset', source: '事务所提供的常见服务类型业务约定书'
    }
  ];

  /* ==========================================================================
     国家转让定价法规库 —— 非中国的 TP 文档需把当地法规写进「项目背景」
     --------------------------------------------------------------------------
     事务所表示会另行提供「常用国家的法规」。下列条目为占位骨架：
     detail_status = 'pending' 表示法规要点待事务所提供，界面会如实标注，
     不会拿未经确认的法规内容去生成合同背景。
     ========================================================================*/
  var TP_REGULATION_LIBRARY = [
    { code: 'CN', name_cn: '中国', doc_requirement: '本地文档 / 主体文档 / 特殊事项文档',
      key_points: ['国家税务总局公告 2016 年第 42 号', '关联申报与同期资料准备门槛'],
      detail_status: 'preset' },
    { code: 'HK', name_cn: '中国香港', doc_requirement: '主体文档 / 本地文档（符合门槛时）',
      key_points: [], detail_status: 'pending' },
    { code: 'JP', name_cn: '日本', doc_requirement: 'ローカルファイル / マスターファイル',
      key_points: [], detail_status: 'pending' },
    { code: 'US', name_cn: '美国', doc_requirement: 'Section 6662 documentation',
      key_points: [], detail_status: 'pending' },
    { code: 'SG', name_cn: '新加坡', doc_requirement: 'TP Documentation（符合门槛时）',
      key_points: [], detail_status: 'pending' }
  ];

  /* ==========================================================================
     日文附带译文（clause_id -> 译文）
     --------------------------------------------------------------------------
     真实合同的口径是「中英双语（中文为准），附带非正式的日文翻译」——
     日文不是等效版本，但译文里数字错了同样是漏改。事务所反馈的痛点三正是
     「人工修改不同语言版本很容易发生漏改」，所以一致性检查要覆盖三语。
     本演示只对下列条款提供日文译文，覆盖率会在一致性检查中如实报出。
     ========================================================================*/
  var TEMPLATE_JA = {
    'C-HEAD-000': '本移転価格サービス契約（以下「本契約」）は、星海智能科技（深圳）有限公司（以下「貴社」）と普華永道咨詢（深圳）有限公司（以下「当社」）との間で締結されます。',
    'C-SCOPE-001': '当社は、貴社の {{engagement_year}} 会計年度につき、{{service_type}} を提供します。本契約が対象とする関連者の範囲は付属書一に記載します。',
    'C-TERM-001': 'サービス期間および成果物の提出時期は、本契約に定めるところによります。',
    'C-TEAM-001': '本業務は {{partner}} が統括し、{{manager}} がエンゲージメント・マネージャーを務めます。',
    'C-FEE-001': '本業務の専門サービス報酬は人民元 {{fee_display}} とし、増値税および立替費用を含みません。',
    'C-PAY-001': '貴社は、本契約締結後 30 日以内に報酬の 50% を、成果物の最終版提出後 30 日以内に残額を支払うものとします。',
    'C-CLIENT-001': '貴社は、当社が本サービスを提供するために必要な資料および情報を、合意した時期までに正確に提供するものとします。',
    'C-CONF-001': '両当事者は、本契約の履行過程で知り得た相手方の秘密情報を保持します。',
    'C-LIAB-002': '当社は貴社との協議の結果、業務条件書第 9.1 条に基づき、本契約に基づく当社の責任上限を、当該責任の発生原因となったサービスまたは業務につき貴社が支払うべき報酬額の二倍とすることに合意しました。ただし、当該損失または損害が当社の悪意または詐欺的行為に起因すると最終的に認定された場合を除きます。',
    'C-DATA-005': '当社は、適用される個人情報保護法令に従って貴社の資料を取り扱います。データの国外移転については、所要の手続が完了するまで実施しません。',
    'C-AI-DATA-004': '当社は、本サービスの提供に際し人工知能を活用した補助ツールを使用する場合があります。貴社は、当該ツールを使用しないよう当社に求める権利を有します。',
    'C-GROUP-002': 'グループ・メンバーファームが本業務に関与する場合の協力体制および責任分担は、本条の定めによります。',
    'C-LAW-001': '本契約は中華人民共和国の現行法令に準拠し、紛争は仲裁により解決します。',
    'C-ANNEX-001': '付属書一　関連者一覧'
  };

  /* ==========================================================================
     3. 条款库（Clause §8.4）
     ========================================================================*/
  var CLAUSES = [
    {
      clause_id: 'C-AI-DATA-004', title_cn: 'AI 辅助服务及数据处理', title_en: 'AI-assisted Services and Data Processing',
      version: '2026 v1.0', effective_date: '2026-01-05', applicable_service_types: ['转让定价文档', '税务合规', '税务咨询'],
      trigger_condition: '2026 标准模板必选条款；服务过程使用经批准的 AI 辅助工具',
      risk_level: 'high', auto_add_allowed: false, approval_required: '经理及以上',
      alternative_clause: 'C-AI-DATA-004-OPT（客户拒绝使用 AI 工具时适用）',
      source_template: 'PwC TP 标准模板 2026 v4.0 · 第 13 条', maintainer: 'Oliver Grant（模板管理员）', status: '生效'
    },
    {
      clause_id: 'C-LIAB-002', title_cn: '责任限制', title_en: 'Limitation of Liability',
      version: '2026 v2.0', effective_date: '2026-01-05', applicable_service_types: ['全部'],
      trigger_condition: '必选条款；责任限额调整须风险审批人批准',
      risk_level: 'high', auto_add_allowed: false, approval_required: '合伙人 / 风险审批人',
      alternative_clause: 'C-LIAB-002（2025 v1.3，磋商覆盖为服务费两倍）',
      source_template: 'PwC TP 标准模板 2026 v4.0 · 第 9 条', maintainer: 'Oliver Grant（模板管理员）', status: '生效'
    },
    {
      clause_id: 'C-DATA-005', title_cn: '个人信息与数据保护', title_en: 'Personal Information and Data Protection',
      version: '2026 v2.0', effective_date: '2026-01-05', applicable_service_types: ['全部'],
      trigger_condition: '必选条款；涉及数据出境时适用跨境传输段',
      risk_level: 'high', auto_add_allowed: false, approval_required: '经理及以上',
      alternative_clause: 'C-DATA-005（2025 v1.1）',
      source_template: 'PwC TP 标准模板 2026 v4.0 · 第 8 条', maintainer: 'Oliver Grant（模板管理员）', status: '生效'
    },
    {
      clause_id: 'C-US-001', title_cn: '美国关联方服务特别约定', title_en: 'US Affiliate Special Provisions',
      version: '2026 v1.2', effective_date: '2026-01-05', applicable_service_types: ['转让定价文档', '税务咨询'],
      trigger_condition: 'involved_countries 含 US 或服务涉及美国实体 / 美国税务事项',
      risk_level: 'high', auto_add_allowed: false, approval_required: '经理及以上',
      alternative_clause: '无', source_template: 'PwC TP 标准模板 2026 v4.0 · 第 10 条（条件条款）',
      maintainer: 'Oliver Grant（模板管理员）', status: '生效'
    },
    /* ---- 以下四条为条件性条款：官方模板以脚注/方括号注明「什么情况下要加」。
           条件满足才加入，不满足则在「未触发规则」中列出原因，不会悄悄加进合同。 ---- */
    {
      clause_id: 'C-SOCIAL-001', title_cn: '即时通讯工具沟通与保密信息传输', title_en: 'Instant Messaging and Transmission of Confidential Information',
      version: '2026 v1.0', effective_date: '2026-01-05', applicable_service_types: ['全部'],
      trigger_condition: 'communication_channels 含微信 / WhatsApp / LINE 等即时通讯工具',
      risk_level: 'medium', auto_add_allowed: false, approval_required: '经理及以上',
      alternative_clause: '无', source_template: 'PwC TP 标准模板 2026 v4.0 · 条件条款（模板内注明按需加入）',
      maintainer: 'Oliver Grant（模板管理员）', status: '生效'
    },
    {
      clause_id: 'C-GC-996', title_cn: '集团公司（业务条款第 9.6 条增补）', title_en: 'Group Companies (Addition to Clause 9.6 of Terms of Business)',
      version: '2026 v1.0', effective_date: '2026-01-05', applicable_service_types: ['全部'],
      trigger_condition: 'client_is_group = 是（按可识别集团公司签约，而非单一法律主体）',
      risk_level: 'medium', auto_add_allowed: false, approval_required: '经理及以上',
      alternative_clause: '单一主体签约时不加入本条，且不附实体清单',
      source_template: 'PwC TP 标准模板 2026 v4.0 · 业务条款增补（模板内注明按签约对象选择）',
      maintainer: 'Oliver Grant（模板管理员）', status: '生效'
    },
    {
      clause_id: 'C-SECRET-001', title_cn: '国家秘密法', title_en: 'State Secrets Law',
      version: '2026 v1.0', effective_date: '2026-01-05', applicable_service_types: ['全部'],
      trigger_condition: 'involves_state_secrets = 是（客户提供的信息可能包含国家秘密）',
      risk_level: 'high', auto_add_allowed: false, approval_required: '合伙人 / 风险审批人',
      alternative_clause: '无', source_template: 'PwC TP 标准模板 2026 v4.0 · 条件条款（模板内以方括号标注按需保留）',
      maintainer: 'Oliver Grant（模板管理员）', status: '生效'
    },
    {
      clause_id: 'C-TECH-001', title_cn: '普华永道技术使用条款', title_en: 'Use of PwC Technology',
      version: '2026 v1.0', effective_date: '2026-01-05', applicable_service_types: ['全部'],
      trigger_condition: 'client_accesses_pwc_tech = 是（客户人员将访问或使用我方技术平台）',
      risk_level: 'high', auto_add_allowed: false, approval_required: '经理及以上',
      alternative_clause: '无', source_template: 'PwC TP 标准模板 2026 v4.0 · 条件条款（含跨境传输单独同意要求）',
      maintainer: 'Oliver Grant（模板管理员）', status: '生效'
    },
    {
      clause_id: 'C-GROUP-002', title_cn: '集团成员所协作与责任分担', title_en: 'Member Firm Collaboration and Allocation of Responsibility',
      version: '2026 v2.0', effective_date: '2026-01-05', applicable_service_types: ['全部'],
      trigger_condition: 'member_firm_involved = true',
      risk_level: 'high', auto_add_allowed: false, approval_required: '经理及以上',
      alternative_clause: 'C-GROUP-002（2025 v1.0，仅协作声明）',
      source_template: 'PwC TP 标准模板 2026 v4.0 · 第 11 条', maintainer: 'Oliver Grant（模板管理员）', status: '生效'
    },
    {
      clause_id: 'C-COMM-003', title_cn: '沟通方式（含非标准即时通讯）', title_en: 'Communications (incl. Non-standard Instant Messaging)',
      version: '2026 v1.1', effective_date: '2026-01-05', applicable_service_types: ['全部'],
      trigger_condition: 'communication_channels 含微信 / WhatsApp 等非标准渠道',
      risk_level: 'medium', auto_add_allowed: false, approval_required: '顾问确认 + 经理知悉',
      alternative_clause: 'C-COMM-003-BASE（仅邮件与 Teams）',
      source_template: 'PwC TP 标准模板 2026 v4.0 · 第 12 条', maintainer: 'Oliver Grant（模板管理员）', status: '生效'
    },
    {
      clause_id: 'C-NOTICE-007', title_cn: '送达（含传真）', title_en: 'Notices (incl. Facsimile)',
      version: '2025 v1.0', effective_date: '2025-01-10', applicable_service_types: ['全部'],
      trigger_condition: '2025 模板必选；2026 模板已删除该条款',
      risk_level: 'medium', auto_add_allowed: false, approval_required: '顾问确认',
      alternative_clause: '并入 C-DATA-005 与合同首部联络信息',
      source_template: 'PwC TP 标准模板 2025 v3.2 · 第 13 条', maintainer: 'Oliver Grant（模板管理员）', status: '已废止（2026 起）'
    },
    {
      clause_id: 'C-LAW-001', title_cn: '适用法律与争议解决', title_en: 'Governing Law and Dispute Resolution',
      version: '2026 v1.1', effective_date: '2026-01-05', applicable_service_types: ['全部'],
      trigger_condition: '必选条款',
      risk_level: 'high', auto_add_allowed: false, approval_required: '经理及以上',
      alternative_clause: '无', source_template: 'PwC TP 标准模板 2026 v4.0 · 第 14 条',
      maintainer: 'Oliver Grant（模板管理员）', status: '生效'
    },
    {
      clause_id: 'C-SCOPE-001', title_cn: '服务范围', title_en: 'Scope of Services',
      version: '2026 v1.0', effective_date: '2026-01-05', applicable_service_types: ['全部'],
      trigger_condition: '必选条款；内容随客户事实变化',
      risk_level: 'medium', auto_add_allowed: false, approval_required: '顾问确认',
      alternative_clause: '无', source_template: 'PwC TP 标准模板 2026 v4.0 · 第 1 条',
      maintainer: 'Oliver Grant（模板管理员）', status: '生效'
    },
    {
      clause_id: 'C-FEE-001', title_cn: '专业服务费', title_en: 'Professional Fees',
      version: '2026 v1.0', effective_date: '2026-01-05', applicable_service_types: ['全部'],
      trigger_condition: '必选条款；金额由批准信息带入，系统不得自行计算',
      risk_level: 'medium', auto_add_allowed: false, approval_required: '顾问确认',
      alternative_clause: '无', source_template: 'PwC TP 标准模板 2026 v4.0 · 第 4 条',
      maintainer: 'Oliver Grant（模板管理员）', status: '生效'
    },
    {
      clause_id: 'C-TEAM-001', title_cn: '服务团队', title_en: 'Engagement Team',
      version: '2026 v1.0', effective_date: '2026-01-05', applicable_service_types: ['全部'],
      trigger_condition: '必选条款',
      risk_level: 'medium', auto_add_allowed: false, approval_required: '顾问确认',
      alternative_clause: '无', source_template: 'PwC TP 标准模板 2026 v4.0 · 第 3 条',
      maintainer: 'Oliver Grant（模板管理员）', status: '生效'
    },
    {
      clause_id: 'C-HEAD-000', title_cn: '合同首部与当事人', title_en: 'Parties',
      version: '2026 v1.0', effective_date: '2026-01-05', applicable_service_types: ['全部'],
      trigger_condition: '必选段落',
      risk_level: 'low', auto_add_allowed: true, approval_required: '无',
      alternative_clause: '无', source_template: 'PwC TP 标准模板 2026 v4.0 · 首部',
      maintainer: 'Oliver Grant（模板管理员）', status: '生效'
    },
    {
      clause_id: 'C-FMT-000', title_cn: '页眉页脚、编号与排版', title_en: 'Header/Footer, Numbering and Layout',
      version: '2026 v1.0', effective_date: '2026-01-05', applicable_service_types: ['全部'],
      trigger_condition: '模板级格式规范',
      risk_level: 'low', auto_add_allowed: true, approval_required: '无',
      alternative_clause: '无', source_template: 'PwC TP 标准模板 2026 v4.0 · 版式规范',
      maintainer: 'Oliver Grant（模板管理员）', status: '生效'
    },
    {
      clause_id: 'C-ANNEX-001', title_cn: '附件一 关联方清单', title_en: 'Annex I List of Related Parties',
      version: '2026 v1.0', effective_date: '2026-01-05', applicable_service_types: ['转让定价文档'],
      trigger_condition: '必选附件；内容随关联方事实变化',
      risk_level: 'medium', auto_add_allowed: false, approval_required: '顾问确认',
      alternative_clause: '无', source_template: 'PwC TP 标准模板 2026 v4.0 · 附件一',
      maintainer: 'Oliver Grant（模板管理员）', status: '生效'
    }
  ];

  /* ==========================================================================
     4. 规则库（Rule §8.5）—— when 为确定性判定函数（对预置事实实时求值）
     ========================================================================*/
  var RULES = [
    {
      rule_id: 'R-YEAR-001', name: '年度字段替换', version: 'v2026.02', status: '生效',
      when_text: 'engagement_year(prior) ≠ engagement_year(current)',
      then_text: '全篇替换年度引用；risk_level=low；允许批量接受',
      explanation: '年度是确定性字段，由程序替换而非模型推断。',
      emits: ['CH-YEAR', 'CH-CONTRACT-NO'],
      when: function (f) { return f.engagement_year.prior !== f.engagement_year.current; }
    },
    {
      rule_id: 'R-US-001', name: '美国业务特殊条款', version: 'v2026.02', status: '生效',
      when_text: 'involved_countries_contains: US（本年度已确认）',
      then_text: 'include_clause: C-US-001；risk_level=high；requires_human_approval=true',
      explanation: '客户服务范围涉及美国实体或美国税务事项。',
      emits: ['CH-US-KEEP'],
      when: function (f) { return f.involves_us.current === '是'; }
    },
    {
      rule_id: 'R-US-002', name: '美国业务信息冲突升级', version: 'v2026.02', status: '生效',
      when_text: 'involves_us(prior)=是 AND involves_us(current)=空/未知',
      then_text: 'hold_clause: C-US-001；risk_level=high；escalate=true；不选边',
      explanation: '上年度存在美国关联方专项条款，今年资料未提及美国业务。资料缺失不等于业务终止，系统不得自行删除或沿用。',
      emits: ['CH-US-CONFLICT'],
      when: function (f) { return f.involves_us.prior === '是' && (f.involves_us.current === null || f.involves_us.current === undefined); }
    },
    {
      rule_id: 'R-AI-DATA-001', name: 'AI 辅助服务及数据处理条款', version: 'v2026.02', status: '生效',
      when_text: 'template_2026 新增 C-AI-DATA-004 AND 上年度合同不含该条款',
      then_text: 'include_clause: C-AI-DATA-004；risk_level=high；requires_human_approval=true',
      explanation: '2026 标准模板新增人工智能辅助服务及数据处理条款，属实质性权利义务变化，须专业人员确认后写入。',
      emits: ['CH-AI-DATA'],
      when: function (f, ctx) { return ctx.templateAdded.indexOf('C-AI-DATA-004') >= 0; }
    },
    {
      rule_id: 'R-LIAB-001', name: '责任限制条款变更', version: 'v2026.02', status: '生效',
      when_text: 'liability_cap(2026 模板) ≠ liability_cap(上年度合同)',
      then_text: 'modify_clause: C-LIAB-002；risk_level=high；approver=partner',
      explanation: '责任限额属重大条款，禁止系统自动决定，须合伙人 / 风险审批人批准。',
      emits: ['CH-LIAB'],
      when: function (f, ctx) { return ctx.templateModified.indexOf('C-LIAB-002') >= 0; }
    },
    {
      rule_id: 'R-DATA-002', name: '跨境数据传输条款', version: 'v2026.02', status: '生效',
      when_text: 'cross_border_data_transfer = true',
      then_text: 'modify_clause: C-DATA-005（启用跨境传输段）；risk_level=high；requires_human_approval=true',
      explanation: '客户存在个人信息或重要数据出境情形，须适用 2026 模板的标准合同条款与备案要求段落。',
      emits: ['CH-DATA'],
      when: function (f) { return /^是/.test(String(f.cross_border_data_transfer.current || '')); }
    },
    {
      rule_id: 'R-GROUP-001', name: '集团成员协作条款', version: 'v2026.02', status: '生效',
      when_text: 'member_firm_involved = true',
      then_text: 'include_clause: C-GROUP-002；risk_level=high；requires_human_approval=true',
      explanation: '涉及其他成员所协作，须适用责任分担安排条款。2026 模板对该条款作了实质性修改。',
      emits: ['CH-GROUP'],
      when: function (f) { return /^是/.test(String(f.member_firm_involved.current || '')); }
    },
    {
      rule_id: 'R-WECHAT-001', name: '非标准即时通讯条款', version: 'v2026.02', status: '生效',
      when_text: 'communication_channels_contains: WeChat',
      then_text: 'include_clause: C-COMM-003（非标准渠道段）；risk_level=medium；requires_human_approval=true',
      explanation: '客户要求使用微信沟通，需加入非标准即时通讯渠道的使用与留存约定。',
      emits: ['CH-WECHAT'],
      when: function (f) { return String(f.communication_channels.current || '').indexOf('微信') >= 0; }
    },
    {
      rule_id: 'R-FEE-001', name: '费用变动复核', version: 'v2026.02', status: '生效',
      when_text: 'abs(fee(current) - fee(prior)) / fee(prior) > 5%',
      then_text: 'flag_change: C-FEE-001；risk_level=medium；金额数字与大写一致性校验',
      explanation: '费用由批准信息带入，系统不得自行计算；变动超过 5% 需人工复核，并校验中文大写金额一致。',
      emits: ['CH-FEE'],
      when: function (f, ctx) { return ctx.feeDeltaPct !== null && Math.abs(ctx.feeDeltaPct) > 5; }
    },
    {
      rule_id: 'R-TEAM-001', name: '关键人员变化', version: 'v2026.02', status: '生效',
      when_text: 'service_team(prior) ≠ service_team(current)',
      then_text: 'flag_change: C-TEAM-001；risk_level=medium',
      explanation: '项目经理等关键人员变化影响客户联络与责任分工，需人工复核。',
      emits: ['CH-TEAM'],
      when: function (f) { return f.service_team.prior !== f.service_team.current; }
    },
    {
      rule_id: 'R-ADDR-001', name: '客户主体或地址变化', version: 'v2026.02', status: '生效',
      when_text: 'registered_address(prior) ≠ registered_address(current) OR client_name 变化',
      then_text: 'flag_change: C-HEAD-000；risk_level=medium',
      explanation: '客户主体信息变化须复核是否同一法律主体，并同步更新全篇引用。',
      emits: ['CH-ADDR', 'CH-CONTACT'],
      when: function (f) { return f.registered_address.prior !== f.registered_address.current || f.client_name_cn.prior !== f.client_name_cn.current; }
    },
    {
      rule_id: 'R-SCOPE-001', name: '服务范围与交付物变化', version: 'v2026.02', status: '生效',
      when_text: 'service_scope 或 deliverables 发生变化',
      then_text: 'flag_change: C-SCOPE-001 / C-TERM-001；risk_level=medium',
      explanation: '服务范围变化影响费用、交付物与工作量安排，需人工复核。',
      emits: ['CH-SCOPE', 'CH-DELIVERABLE'],
      when: function (f) { return f.service_scope.prior !== f.service_scope.current || f.deliverables.prior !== f.deliverables.current; }
    },
    {
      rule_id: 'R-NOTICE-001', name: '模板删除条款不自动删除', version: 'v2026.02', status: '生效',
      when_text: 'clause 存在于上年度合同 AND 不存在于本年度模板',
      then_text: 'flag_change: 建议删除；risk_level=medium；禁止自动删除',
      explanation: '模板删除的条款可能仍对特定客户适用，系统仅提出建议，由人工判断。',
      emits: ['CH-NOTICE'],
      when: function (f, ctx) { return ctx.templateRemoved.length > 0; }
    },
    {
      rule_id: 'R-FMT-001', name: '纯格式与编号变化', version: 'v2026.02', status: '生效',
      when_text: 'diff_class = format_only',
      then_text: 'risk_level=low；允许批量接受',
      explanation: '页眉页脚、条款编号与排版调整不改变权利义务。',
      emits: ['CH-FMT', 'CH-NUMBER', 'CH-HEADER', 'CH-ANNEX-TITLE'],
      when: function (f, ctx) { return ctx.templateFormatChanged; }
    },
    {
      rule_id: 'R-LAW-001', name: '适用法律条款措辞优化', version: 'v2026.02', status: '生效',
      when_text: 'diff_class = wording_only AND clause_id = C-LAW-001',
      then_text: 'risk_level=low；允许批量接受；但需保留原文对照',
      explanation: '2026 模板对适用法律条款作措辞优化，语义未变；仍保留原文对照供复核。',
      emits: ['CH-LAW', 'CH-WORDING-1', 'CH-WORDING-2'],
      when: function (f, ctx) { return ctx.templateWordingOnly.indexOf('C-LAW-001') >= 0; }
    },
    /* ---- 条件性条款规则：来自官方模板「什么情况下要加什么条款」的注明。
           条件不满足的规则会出现在「未触发规则」列表里并给出原因 ——
           不加某条条款是一个可被审计的决定，不是遗漏。 ---- */
    {
      rule_id: 'R-COND-SOCIAL-001', name: '即时通讯沟通条款', version: 'v2026.02', status: '生效',
      when_text: 'communication_channels 含微信 / WhatsApp / LINE',
      then_text: 'include_clause: C-SOCIAL-001；risk_level=medium；需人工判断',
      explanation: '通过即时通讯工具传输保密信息存在风险，模板要求在此情形下加入专门约定。',
      emits: ['CH-SOCIAL'],
      when: function (f) { return /微信|WhatsApp|LINE/i.test(String(f.communication_channels.current || '')); }
    },
    {
      rule_id: 'R-COND-GC-996', name: '集团公司签约增补条款', version: 'v2026.02', status: '生效',
      when_text: 'client_is_group = 是',
      then_text: 'include_clause: C-GC-996；附实体清单；risk_level=medium',
      explanation: '按可识别集团公司签约时，模板要求增补业务条款第 9.6 条并附实体清单；单一主体签约则不加。',
      emits: ['CH-GC-996'],
      when: function (f) { return f.client_is_group.current === '是'; }
    },
    {
      rule_id: 'R-ENTITY-001', name: '我方签约主体选择', version: 'v2026.02', status: '生效',
      when_text: 'contracting_entity 已确认（模板首部为四选一的占位符）',
      then_text: 'replace_placeholder: 首部签约主体；risk_level=low',
      explanation: '模板首部列出深圳及各分公司供选择，必须确认后才能替换，不能默认沿用。',
      emits: ['CH-ENTITY'],
      when: function (f) { return !!f.contracting_entity.current; }
    },
    {
      rule_id: 'R-COND-SECRET-001', name: '国家秘密法条款', version: 'v2026.02', status: '生效',
      when_text: 'involves_state_secrets = 是',
      then_text: 'include_clause: C-SECRET-001；risk_level=high；须合伙人批准',
      explanation: '客户提供的信息可能含国家秘密时才加入。本案例为「否」，故不加入 —— 这是一个决定，会记入审计。',
      emits: ['CH-SECRET'],
      when: function (f) { return f.involves_state_secrets.current === '是'; }
    },
    {
      rule_id: 'R-COND-TECH-001', name: '普华永道技术使用条款', version: 'v2026.02', status: '生效',
      when_text: 'client_accesses_pwc_tech = 是',
      then_text: 'include_clause: C-TECH-001；risk_level=high；含跨境传输单独同意要求',
      explanation: '客户人员将访问我方技术平台时才加入，涉及个人信息跨境传输的单独同意。本案例为「否」，故不加入。',
      emits: ['CH-TECH'],
      when: function (f) { return f.client_accesses_pwc_tech.current === '是'; }
    },
    {
      rule_id: 'R-ANNEX-001', name: '附件与正文引用一致', version: 'v2026.02', status: '生效',
      when_text: 'related_parties 发生变化',
      then_text: 'flag_change: C-ANNEX-001；risk_level=medium；与冲突项联动',
      explanation: '关联方清单变化须与服务范围、条件条款保持一致。',
      emits: ['CH-ANNEX'],
      when: function (f) { return f.related_parties.prior !== f.related_parties.current; }
    }
  ];

  /* ==========================================================================
     5. 变更项模板（ChangeItem §12.1）—— 由规则触发后实例化
        category: template(模板版本变化) | fact(客户事实变化) | clause(条款适用性)
        diff_class: format_only | wording_only | substantive | added | removed | undetermined
     ========================================================================*/
  var CHANGE_TEMPLATES = {
    'CH-AI-DATA': {
      change_id: 'CH-AI-DATA', category: 'template', clause_id: 'C-AI-DATA-004',
      title: '2026 标准模板新增「AI 辅助服务及数据处理」条款',
      change_type: 'add', change_type_cn: '新增条款', diff_class: 'added',
      risk_level: 'high', approver: 'manager',
      old_text: '（2025 年合同与 2025 v3.2 模板均无对应条款）',
      old_text_en: '(No corresponding clause in the 2025 signed contract or template v3.2)',
      proposed_text: TEMPLATE_2026_SECTIONS[12].text_cn,
      proposed_text_en: TEMPLATE_2026_SECTIONS[12].text_en,
      reason: '2026 v4.0 模板新增第 13 条 AI 辅助服务及数据处理条款，涉及客户资料处理方式与拒绝权，属实质性权利义务变化。',
      agent_explanation: '这是今年模板里最容易被漏掉的一条：去年整份合同里没有任何 AI 相关约定，今年模板新增了一条，说明我们可能用 AI 工具处理客户资料、客户也有权要求不用。它同时牵涉数据处理和客户权利，因此不能自动写入，需要你确认后才进合同。',
      source: 'PwC TP 标准模板 2026 v4.0 · 第 13 条',
      source_rule: 'R-AI-DATA-001', confidence: 0.92,
      impact: '若漏加：客户未就 AI 辅助处理其资料作出同意，存在数据处理合规与执业风险。',
      highlight: 1
    },
    'CH-LIAB': {
      change_id: 'CH-LIAB', category: 'template', clause_id: 'C-LIAB-002',
      title: '责任限制条款：磋商覆盖的赔偿上限收紧（服务费两倍 → 相当于服务费的数额）',
      change_type: 'modify', change_type_cn: '实质性权利义务变化', diff_class: 'substantive',
      risk_level: 'high', approver: 'partner',
      old_text: PRIOR_CONTRACT_SECTIONS[9].text_cn,
      old_text_en: PRIOR_CONTRACT_SECTIONS[9].text_en,
      proposed_text: TEMPLATE_2026_SECTIONS[8].text_cn,
      proposed_text_en: TEMPLATE_2026_SECTIONS[8].text_en,
      reason: '业务约定书以磋商条款覆盖标准业务条款第 9.1 条的默认上限。2026 v4.0 模板将该磋商口径由「服务费的两倍」收紧为「相当于服务费的数额」。按 2026 年费用 RMB 528,000 计算，上限由 RMB 1,056,000 降至 RMB 528,000。',
      agent_explanation: '这条不是措辞调整，是钱数变了：这份合同用磋商条款覆盖标准业务条款的默认上限，今年的覆盖口径从「服务费两倍」收紧为「相当于服务费的数额」。按今年 52.8 万的费用算，上限从 105.6 万降到 52.8 万 —— 我方敞口少了 52.8 万。责任限额属于重大商业条款，系统不做判断，必须由合伙人 / 风险审批人批准。',
      source: 'PwC TP 标准模板 2026 v4.0 · 第 9 条（对照 2025 v3.2 第 9 条）',
      source_rule: 'R-LIAB-001', confidence: 0.90,
      impact: '直接影响我方风险敞口与客户谈判立场；须风险审批人批准。',
      computed_note: '上限对比由程序按已确认费用实时计算：服务费 = RMB 528,000；旧口径两倍 = RMB 1,056,000；新口径一倍 = RMB 528,000 → 敞口收窄 RMB 528,000。'
    },
    'CH-SOCIAL': {
      change_id: 'CH-SOCIAL', category: 'clause', clause_id: 'C-SOCIAL-001',
      title: '沟通渠道含微信，需加入即时通讯保密信息传输条款',
      change_type: 'add_conditional', change_type_cn: '条件条款加入', diff_class: 'added',
      risk_level: 'medium', approver: 'consultant',
      old_text: '（上年度合同无此条款）',
      old_text_en: '(No corresponding clause in the prior year agreement)',
      proposed_text: '我们尊重贵司信息的保密性。鉴于通过即时通讯工具（如微信、WhatsApp、LINE 等）传输信息存在风险，我们通常不建议通过此类工具分享保密信息；若我方人员被要求以此方式沟通或分享保密信息，我们将视以该途径与我们联系的人员已获贵司授权传输或接收相关信息。',
      proposed_text_en: 'We respect the confidentiality of your information. Given the risks of transmitting information via instant messaging tools (such as WeChat, WhatsApp and LINE), we generally do not recommend sharing confidential information through such tools; where our personnel are asked to communicate or share confidential information in this way, we will treat any person contacting us through that channel as authorised by you to transmit or receive such information.',
      reason: '客户信息表「沟通渠道」列明包含微信，触发 R-COND-SOCIAL-001。官方模板对该情形注明须加入专门约定。',
      agent_explanation: '客户要求用微信沟通，模板对这种情况有专门条款。加它不是形式主义 —— 它明确了「通过微信找我们的人视为你方授权」，否则出事时责任边界不清。',
      source: '客户信息表「沟通渠道」；PwC TP 标准模板 2026 v4.0 条件条款',
      source_rule: 'R-COND-SOCIAL-001', confidence: 0.93,
      impact: '不加则通过即时通讯传输保密信息的授权与责任边界不明确。'
    },
    'CH-GC-996': {
      change_id: 'CH-GC-996', category: 'clause', clause_id: 'C-GC-996',
      title: '按集团公司签约，需增补业务条款第 9.6 条并附实体清单',
      change_type: 'add_conditional', change_type_cn: '条件条款加入', diff_class: 'added',
      risk_level: 'medium', approver: 'consultant',
      old_text: '（上年度合同已按集团签约，本年度需确认实体清单是否变化）',
      old_text_en: '(Prior year was also contracted on a group basis; the entity list requires re-confirmation)',
      proposed_text: '新增以下条款至业务条款第 9 条：9.6 集团公司 —— 甲方将向乙方提供集团公司的名称；乙方仅向相关服务成果的收件人承担责任；若违反以上条款，甲方同意向乙方偿付乙方因此而承担的责任（包括法律费用）。集团公司实体清单见附件一。',
      proposed_text_en: 'The following is added to clause 9 of the Terms of Business: 9.6 Group Companies — you will provide us with the names of the Group Companies; we accept responsibility only to the recipient of the relevant deliverable; and if the above is breached, you agree to indemnify us for any liability we incur as a result (including legal costs). The list of Group Company entities is set out in Annex I.',
      reason: '客户按可识别集团公司签约（client_is_group = 是），触发 R-COND-GC-996。单一主体签约时不加本条。',
      agent_explanation: '这份合同不是只跟一家公司签，而是覆盖一组关联主体。模板要求这种情况必须增补 9.6 条并附实体清单 —— 否则「向谁负责」在法律上是模糊的。实体清单要和附件一对得上。',
      source: '客户信息表「关联方（境内外）」；PwC TP 标准模板 2026 v4.0 业务条款增补',
      source_rule: 'R-COND-GC-996', confidence: 0.92,
      impact: '不加则集团内各主体的责任归属不明确；实体清单与附件一必须一致。'
    },
    'CH-ENTITY': {
      change_id: 'CH-ENTITY', category: 'fact', clause_id: 'C-HEAD-000',
      title: '确认我方签约主体（模板首部为四选一占位符）',
      change_type: 'replace_field', change_type_cn: '确定性字段替换', diff_class: 'wording_only',
      risk_level: 'low', approver: 'consultant',
      old_text: '本协议由……与普华永道咨询（深圳）有限公司（以下称"我们"）签署。',
      old_text_en: 'This Agreement is entered into between ... and PricewaterhouseCoopers Consultants (Shenzhen) Limited ("we").',
      proposed_text: '本协议由……与普华永道咨询（深圳）有限公司（以下称"我们"）签署。（模板首部列出深圳／北京分公司／上海分公司／广州分公司四选一，已按上年度沿用确认为深圳）',
      proposed_text_en: 'This Agreement is entered into between ... and PricewaterhouseCoopers Consultants (Shenzhen) Limited ("we"). (The template offers Shenzhen / Beijing / Shanghai / Guangzhou branch; confirmed as Shenzhen, consistent with the prior year.)',
      reason: '模板首部签约主体是「请选择使用」的占位符，必须确认而不能默认沿用，触发 R-ENTITY-001。',
      agent_explanation: '模板首部给了四个主体让你选。看着像小事，但签约主体错了整份合同的当事人就错了 —— 所以它不是自动填，是要你确认一次。',
      source: 'PwC TP 标准模板 2026 v4.0 首部占位符；上年度合同首部',
      source_rule: 'R-ENTITY-001', confidence: 0.95,
      impact: '签约主体错误将导致合同当事人错误。'
    },
    'CH-DATA': {
      change_id: 'CH-DATA', category: 'template', clause_id: 'C-DATA-005',
      title: '数据保护条款升级：引用《个人信息保护法》并新增数据出境前置要求',
      change_type: 'modify', change_type_cn: '实质性权利义务变化', diff_class: 'substantive',
      risk_level: 'high', approver: 'manager',
      old_text: PRIOR_CONTRACT_SECTIONS[8].text_cn,
      old_text_en: PRIOR_CONTRACT_SECTIONS[8].text_en,
      proposed_text: TEMPLATE_2026_SECTIONS[7].text_cn,
      proposed_text_en: TEMPLATE_2026_SECTIONS[7].text_en,
      reason: '2026 模板明确引用《个人信息保护法》，并要求数据出境前完成标准合同条款签署与必要备案/评估。客户信息表确认存在香港、新加坡云端存放财务数据的情形，该段落被触发。',
      agent_explanation: '去年这条只写了"依照适用的中国法律"，比较笼统。今年模板写实了：要签标准合同条款、要完成备案或评估，没做完不能传。客户今年明确说了数据放在香港和新加坡，所以这一段对本项目是真实生效的，不是模板里的闲话。',
      source: 'PwC TP 标准模板 2026 v4.0 · 第 8 条；客户信息表「是否跨境传输数据 = 是」',
      source_rule: 'R-DATA-002', confidence: 0.89,
      impact: '若沿用旧条款：数据出境合规义务未在合同中落实，存在合规风险。'
    },
    'CH-GROUP': {
      change_id: 'CH-GROUP', category: 'clause', clause_id: 'C-GROUP-002',
      title: '集团成员所条款：新增责任分担与索赔限制安排',
      change_type: 'modify', change_type_cn: '实质性权利义务变化', diff_class: 'substantive',
      risk_level: 'high', approver: 'manager',
      old_text: PRIOR_CONTRACT_SECTIONS[10].text_cn,
      old_text_en: PRIOR_CONTRACT_SECTIONS[10].text_en,
      proposed_text: TEMPLATE_2026_SECTIONS[10].text_cn,
      proposed_text_en: TEMPLATE_2026_SECTIONS[10].text_en,
      reason: '客户信息表确认由普华永道香港成员所协作（member_firm_involved = true），触发 R-GROUP-001；2026 模板将该条款由单纯协作声明扩展为责任分担与索赔限制安排。',
      agent_explanation: '去年只写了"各成员所对自己的工作负责"。今年模板加了两层：成员所之间不承担连带责任，客户索赔只能找签约的那一家，并且受该家的责任上限约束。这属于关联方责任安排，必须人工确认。',
      source: 'PwC TP 标准模板 2026 v4.0 · 第 11 条；客户信息表「由普华永道香港成员所协作」',
      source_rule: 'R-GROUP-001', confidence: 0.87,
      impact: '涉及成员所之间与对客户的责任边界，属高风险条款。'
    },
    'CH-US-CONFLICT': {
      change_id: 'CH-US-CONFLICT', category: 'fact', clause_id: 'C-US-001',
      title: '客户事实冲突：去年涉及美国关联方，今年资料未提及美国业务',
      change_type: 'hold', change_type_cn: '暂停处理并升级', diff_class: 'undetermined',
      risk_level: 'high', approver: 'manager', is_conflict: true, fact_id: 'F-017',
      old_text: PRIOR_CONTRACT_SECTIONS[10].text_cn,
      old_text_en: PRIOR_CONTRACT_SECTIONS[10].text_en,
      proposed_text: '（系统不给出建议文本）需先确认今年是否仍涉及美国业务：\nA. 仍涉及 → 保留第 10 条美国关联方条款，并将美国补回服务地区与关联方清单；\nB. 不再涉及 → 删除第 10 条，并从关联方清单移除 Starwave Intelligence US Inc.；\nC. 尚不确定 → 条款暂停处理，升级给经理裁定。',
      proposed_text_en: '(No proposed text — decision required) A. Still involved → retain Clause 10; B. No longer involved → delete Clause 10 and remove the US affiliate from Annex I; C. Undetermined → hold and escalate.',
      reason: '2025 合同第 10 条与附件一均含美国关联方 Starwave Intelligence US Inc.；2026 客户信息表「是否涉及美国业务」为空值，关联方清单未列该主体，且备注称境外主体信息待确认。资料缺失不等于业务终止。',
      agent_explanation: '普通自动化在这里会二选一：要么照抄去年、要么直接删掉。两种都可能出事——照抄可能给不存在的美国业务加责任，删掉可能漏掉真实存在的美国申报风险。今年这份客户信息表在这一格是空的，而且备注说境外主体还在调整，所以这不是"否"，是"不知道"。系统的选择是停下来问你。',
      source: '2025 合同第 10 条 + 附件一；2026 客户信息表「是否涉及美国业务（空值）」「备注」',
      source_rule: 'R-US-002', confidence: 0.42,
      impact: '误删可能漏掉美国税务责任限制约定；误留可能引入不适用的美国条款。系统不选边。',
      highlight: 2
    },
    'CH-US-KEEP': {
      change_id: 'CH-US-KEEP', category: 'clause', clause_id: 'C-US-001',
      title: '保留美国关联方服务特别约定（已确认今年仍涉及美国业务）',
      change_type: 'keep', change_type_cn: '建议保留', diff_class: 'substantive',
      risk_level: 'high', approver: 'manager',
      old_text: PRIOR_CONTRACT_SECTIONS[10].text_cn,
      old_text_en: PRIOR_CONTRACT_SECTIONS[10].text_en,
      proposed_text: PRIOR_CONTRACT_SECTIONS[10].text_cn,
      proposed_text_en: PRIOR_CONTRACT_SECTIONS[10].text_en,
      reason: '人工确认今年仍涉及美国业务，R-US-001 触发，保留 C-US-001 条件条款。',
      agent_explanation: '你已确认今年仍涉及美国业务，因此美国关联方条款保留，同时服务地区与关联方清单需补回美国主体。',
      source: 'PwC TP 标准模板 2026 v4.0 · 第 10 条（条件条款）',
      source_rule: 'R-US-001', confidence: 0.95
    },
    'CH-WECHAT': {
      change_id: 'CH-WECHAT', category: 'clause', clause_id: 'C-COMM-003',
      title: '沟通渠道新增微信，需加入非标准即时通讯约定',
      change_type: 'modify', change_type_cn: '建议修改', diff_class: 'substantive',
      risk_level: 'medium', approver: 'consultant',
      old_text: PRIOR_CONTRACT_SECTIONS[12].text_cn,
      old_text_en: PRIOR_CONTRACT_SECTIONS[12].text_en,
      proposed_text: '双方通过电子邮件及 Microsoft Teams 进行项目沟通。经客户书面要求，双方可使用微信进行非正式沟通，但正式交付、通知与含敏感信息的资料交换仍应通过电子邮件或普华永道指定的安全平台进行；微信沟通内容不构成交付成果，双方各自负责其记录留存。',
      proposed_text_en: 'The parties will communicate by email and Microsoft Teams. At the Client\'s written request, WeChat may be used for informal communication; however, formal deliverables, notices and exchanges of sensitive information shall continue to be made by email or via a PwC-designated secure platform. WeChat communications do not constitute deliverables and each party is responsible for retaining its own records.',
      reason: '客户信息表「沟通渠道」新增微信（客户财务团队要求），触发 R-WECHAT-001。',
      agent_explanation: '客户财务团队今年想用微信。微信本身不是禁止项，但要在合同里划清界限：正式交付和敏感资料还得走邮件或安全平台，微信只做非正式沟通。这一条建议你复核后接受。',
      source: '客户信息表「沟通渠道：电子邮件、Microsoft Teams、微信（客户财务团队要求）」',
      source_rule: 'R-WECHAT-001', confidence: 0.91
    },
    'CH-NOTICE': {
      change_id: 'CH-NOTICE', category: 'template', clause_id: 'C-NOTICE-007',
      title: '2026 模板删除「送达（含传真）」条款，建议同步删除',
      change_type: 'delete', change_type_cn: '删除条款', diff_class: 'removed',
      risk_level: 'medium', approver: 'consultant',
      old_text: PRIOR_CONTRACT_SECTIONS[13].text_cn,
      old_text_en: PRIOR_CONTRACT_SECTIONS[13].text_en,
      proposed_text: '（建议删除该条）送达方式并入合同首部联络信息与第 8 条数据保护条款；后续条款编号顺延。',
      proposed_text_en: '(Recommend deletion) Notice arrangements are consolidated into the Parties section and Clause 8; subsequent clause numbering shifts accordingly.',
      reason: '2026 v4.0 模板已删除第 13 条送达（含传真）条款，条款状态为「已废止（2026 起）」。系统不自动删除，提请人工判断。',
      agent_explanation: '新模板把传真送达删了。但删条款不是系统能自己决定的事——万一这个客户确实还在用传真送正式通知，删了就少了一个约定。所以这条给你确认。另外，删了它之后原第 14 条会变成第 13 条，正文里对条款编号的交叉引用需要一起改，一致性检查会盯这一点。',
      source: 'PwC TP 标准模板 2025 v3.2 第 13 条（2026 v4.0 中已不存在）',
      source_rule: 'R-NOTICE-001', confidence: 0.86
    },
    'CH-LAW': {
      change_id: 'CH-LAW', category: 'template', clause_id: 'C-LAW-001',
      title: '适用法律与争议解决条款措辞优化（语义未变）',
      change_type: 'modify', change_type_cn: '文字优化，不改变含义', diff_class: 'wording_only',
      risk_level: 'low', approver: 'consultant',
      old_text: PRIOR_CONTRACT_SECTIONS[14].text_cn,
      old_text_en: PRIOR_CONTRACT_SECTIONS[14].text_en,
      proposed_text: TEMPLATE_2026_SECTIONS[13].text_cn,
      proposed_text_en: TEMPLATE_2026_SECTIONS[13].text_en,
      reason: '2026 模板补充「现行有效的」与「按其届时有效的仲裁规则」表述，适用法律与仲裁机构均未改变。',
      agent_explanation: '措辞更严谨了，但适用法律还是中国法、仲裁还是深圳国际仲裁院，没有实质变化，可以批量接受。原文对照仍然保留，方便你抽查。',
      source: 'PwC TP 标准模板 2026 v4.0 · 第 14 条',
      source_rule: 'R-LAW-001', confidence: 0.93
    },
    'CH-YEAR': {
      change_id: 'CH-YEAR', category: 'fact', clause_id: 'C-SCOPE-001',
      title: '全篇年度引用由 2025 更新为 2026（8 处）', short: '年度替换',
      change_type: 'modify', change_type_cn: '低风险自动变化', diff_class: 'deterministic',
      risk_level: 'low', approver: 'consultant',
      old_text: '……为客户 2025 财政年度提供转让定价文档准备服务……服务期间自 2025 年 3 月 1 日起至 2025 年 11 月 30 日止……',
      old_text_en: '…for the Client\'s FY2025… from 1 March 2025 to 30 November 2025…',
      proposed_text: '……为客户 2026 财政年度提供转让定价文档准备服务……服务期间自 2026 年 3 月 1 日起至 2026 年 11 月 30 日止……',
      proposed_text_en: '…for the Client\'s FY2026… from 1 March 2026 to 30 November 2026…',
      reason: '客户信息表「服务年度 = 2026」；由确定性程序替换全篇年度引用，共 8 处（第 1、2 条正文、首部、页眉、附件标题）。',
      agent_explanation: '年份这种事不需要模型判断，程序直接替换并统计处数。8 处全部列出，你可以抽查。服务期间的具体起止日期按顺延处理，仍建议你核对。',
      source: '客户信息表「服务年度」；确定性规则 R-YEAR-001',
      source_rule: 'R-YEAR-001', confidence: 1.0
    },
    'CH-ADDR': {
      change_id: 'CH-ADDR', category: 'fact', clause_id: 'C-HEAD-000', fact_id: 'F-003',
      title: '客户注册地址变化，需复核是否同一法律主体',
      change_type: 'modify', change_type_cn: '客户事实变化', diff_class: 'substantive',
      risk_level: 'medium', approver: 'consultant',
      old_text: '注册地址：深圳市南山区科技园高新南七道 12 号星海大厦 20 层',
      old_text_en: 'Registered address: 20/F Starwave Tower, No.12 Gaoxin South 7th Road, Science Park, Nanshan District, Shenzhen',
      proposed_text: '注册地址：深圳市南山区粤海街道深湾一路 8 号星海科技大厦 A 座 33 层',
      proposed_text_en: 'Registered address: 33/F, Tower A, Starwave Technology Building, No.8 Shenwan 1st Road, Yuehai Sub-district, Nanshan District, Shenzhen',
      reason: '客户信息表注册地址与上年度合同不一致，触发 R-ADDR-001。客户名称与英文名称未变，初步判断为同一主体迁址。',
      agent_explanation: '地址变了，但中英文名称都没变，看起来是同一家公司搬了办公地。不过"改地址"和"换主体"在合同里后果完全不同，所以标为需要复核：请确认工商登记地址已变更，而不是换了签约主体。',
      source: '客户信息表「注册地址」；2025 合同首部',
      source_rule: 'R-ADDR-001', confidence: 0.93
    },
    'CH-TEAM': {
      change_id: 'CH-TEAM', category: 'fact', clause_id: 'C-TEAM-001', fact_id: 'F-013',
      title: '项目经理由 Laura Finch 更换为 Daniel Reed',
      change_type: 'modify', change_type_cn: '客户事实变化', diff_class: 'substantive',
      risk_level: 'medium', approver: 'consultant',
      old_text: '本项目由合伙人 Victoria Hale 负责，项目经理为 Laura Finch，高级顾问为 Emma Clarke。',
      old_text_en: 'The engagement is led by Partner Victoria Hale, with Laura Finch as Engagement Manager and Emma Clarke as Senior Consultant.',
      proposed_text: '本项目由合伙人 Victoria Hale 负责，项目经理为 Daniel Reed，高级顾问为 Emma Clarke。',
      proposed_text_en: 'The engagement is led by Partner Victoria Hale, with Daniel Reed as Engagement Manager and Emma Clarke as Senior Consultant.',
      reason: '客户信息表「服务团队要求」指定项目经理为 Daniel Reed，与上年度合同不一致，触发 R-TEAM-001。',
      agent_explanation: '关键人员换了。合伙人没变，项目经理从 Laura Finch 换成 Daniel Reed。这条本身不复杂，但它是客户对接人，建议复核后接受，避免合同里还写着已经不管这个项目的人。',
      source: '客户信息表「服务团队要求」；2025 合同第 3 条',
      source_rule: 'R-TEAM-001', confidence: 0.94
    },
    'CH-FEE': {
      change_id: 'CH-FEE', category: 'fact', clause_id: 'C-FEE-001', fact_id: 'F-014',
      title: '专业服务费由 RMB 480,000 上调至 RMB 528,000（+10%）',
      change_type: 'modify', change_type_cn: '客户事实变化', diff_class: 'substantive',
      risk_level: 'medium', approver: 'consultant',
      old_text: '本项目专业服务费为人民币肆拾捌万元整（RMB 480,000），不含增值税及代垫费用。',
      old_text_en: 'The professional fees for this engagement are RMB 480,000 (Renminbi four hundred and eighty thousand only), exclusive of VAT and out-of-pocket expenses.',
      proposed_text: '本项目专业服务费为人民币伍拾贰万捌仟元整（RMB 528,000），不含增值税及代垫费用。',
      proposed_text_en: 'The professional fees for this engagement are RMB 528,000 (Renminbi five hundred and twenty-eight thousand only), exclusive of VAT and out-of-pocket expenses.',
      reason: '费用来自内部批准信息（Starwave_Fee_Approval_2026.pdf）与客户信息表，二者一致；变动 +10% 超过 5% 阈值，触发 R-FEE-001。',
      agent_explanation: '费用不是系统算出来的，是从批准文件里读出来的，两份资料对得上。涨幅 10% 超过复核阈值，所以列给你确认。中文大写「伍拾贰万捌仟元整」由程序按数字生成并已校验一致。',
      source: '内部费用批准 PDF 第 1 页；客户信息表「预算费用」',
      source_rule: 'R-FEE-001', confidence: 0.96,
      computed_note: '程序校验：数字 528,000 ↔ 大写「伍拾贰万捌仟元整」一致；较上年度 480,000 变动 +10.00%。'
    },
    'CH-SCOPE': {
      change_id: 'CH-SCOPE', category: 'fact', clause_id: 'C-SCOPE-001', fact_id: 'F-009',
      title: '服务范围新增「集团主体文档更新协助」',
      change_type: 'modify', change_type_cn: '客户事实变化', diff_class: 'substantive',
      risk_level: 'medium', approver: 'consultant',
      old_text: PRIOR_CONTRACT_SECTIONS[1].text_cn,
      old_text_en: PRIOR_CONTRACT_SECTIONS[1].text_en,
      proposed_text: '我们将为客户 2026 财政年度提供转让定价文档准备服务，包括中国转让定价本地文档编制、关联交易可比性分析、集团主体文档（Master File）更新协助，以及就客户中国大陆及香港关联方之间的服务与特许权使用交易提供文档支持。本协议项下关联方范围见附件一。',
      proposed_text_en: 'We will provide transfer pricing documentation services for the Client\'s FY2026, including preparation of the PRC Local File, comparability analysis of related party transactions, support for updating the group Master File, and documentation support for services and royalty transactions among the Client\'s related parties in Mainland China and Hong Kong. The related parties covered by this Agreement are listed in Annex I.',
      reason: '客户信息表服务类型新增「集团主体文档更新协助」，服务地区列示为中国大陆、香港，触发 R-SCOPE-001。',
      agent_explanation: '服务范围多了一项主体文档更新协助，这也是费用上涨的原因。要注意：这段里的服务地区目前写的是"中国大陆及香港"，是否补回美国，取决于美国业务那条冲突项的结论——两条会联动。',
      source: '客户信息表「服务类型」「服务地区」；2025 合同第 1 条',
      source_rule: 'R-SCOPE-001', confidence: 0.90,
      linked: ['CH-US-CONFLICT']
    },
    'CH-DELIVERABLE': {
      change_id: 'CH-DELIVERABLE', category: 'fact', clause_id: 'C-TERM-001', fact_id: 'F-011',
      title: '交付物新增「集团主体文档更新建议稿」',
      change_type: 'modify', change_type_cn: '客户事实变化', diff_class: 'substantive',
      risk_level: 'medium', approver: 'consultant',
      old_text: '交付物包括：中文本地文档定稿、英文摘要、可比性分析附件。',
      old_text_en: 'Deliverables include: final Local File in Chinese, an English summary, and the comparability analysis annex.',
      proposed_text: '交付物包括：中文本地文档定稿、英文摘要、可比性分析附件、集团主体文档更新建议稿。',
      proposed_text_en: 'Deliverables include: final Local File in Chinese, an English summary, the comparability analysis annex, and a proposed update to the group Master File.',
      reason: '服务范围新增主体文档更新协助，交付物需同步补充，触发 R-SCOPE-001。',
      agent_explanation: '服务范围加了主体文档协助，交付物清单要对上，否则服务范围和交付物、费用表之间会不一致——一致性检查也会查这一项。',
      source: '客户信息表「服务类型」；2025 合同第 2 条',
      source_rule: 'R-SCOPE-001', confidence: 0.87
    },
    'CH-ANNEX': {
      change_id: 'CH-ANNEX', category: 'fact', clause_id: 'C-ANNEX-001', fact_id: 'F-006',
      title: '附件一关联方清单变化（美国主体是否保留待定）',
      change_type: 'modify', change_type_cn: '客户事实变化', diff_class: 'undetermined',
      risk_level: 'medium', approver: 'consultant',
      old_text: '1. 星海智能（香港）有限公司；2. Starwave Intelligence US Inc.（美国特拉华州）；3. 星海软件（成都）有限公司。',
      old_text_en: '1. Starwave Intelligence (Hong Kong) Limited; 2. Starwave Intelligence US Inc. (Delaware, USA); 3. Starwave Software (Chengdu) Co., Ltd.',
      proposed_text: '1. 星海智能（香港）有限公司；2. 星海软件（成都）有限公司。\n（Starwave Intelligence US Inc. 的保留与否，取决于「是否涉及美国业务」冲突项的确认结果）',
      proposed_text_en: '1. Starwave Intelligence (Hong Kong) Limited; 2. Starwave Software (Chengdu) Co., Ltd.\n(Whether Starwave Intelligence US Inc. is retained depends on the resolution of the US involvement conflict.)',
      reason: '2026 客户信息表关联方清单未列 Starwave Intelligence US Inc.，触发 R-ANNEX-001；与 CH-US-CONFLICT 联动。',
      agent_explanation: '关联方清单少了美国那家。系统没有直接删——因为清单少列和主体注销是两件事。这条会跟着美国业务冲突项的结论一起定。',
      source: '客户信息表「关联方（境内外）」；2025 合同附件一',
      source_rule: 'R-ANNEX-001', confidence: 0.88,
      linked: ['CH-US-CONFLICT']
    },
    'CH-FMT': {
      change_id: 'CH-FMT', category: 'template', clause_id: 'C-FMT-000',
      title: '模板版式调整：字号、行距与条款标题样式', short: '版式调整',
      change_type: 'modify', change_type_cn: '纯格式变化', diff_class: 'format_only',
      risk_level: 'low', approver: 'consultant',
      old_text: '正文小四号、行距 1.5、条款标题加粗不编号缩进。',
      old_text_en: 'Body 12pt, line spacing 1.5, clause headings bold without indent.',
      proposed_text: '正文小四号、行距 1.5、条款标题加粗并统一左缩进 0 字符、段前 6 磅。',
      proposed_text_en: 'Body 12pt, line spacing 1.5, clause headings bold, left indent 0, 6pt space before.',
      reason: '2026 v4.0 模板版式规范调整，不涉及文字内容与权利义务。',
      agent_explanation: '纯排版，不改一个字的意思，属于可以批量接受的一类。',
      source: 'PwC TP 标准模板 2026 v4.0 · 版式规范',
      source_rule: 'R-FMT-001', confidence: 0.98
    },
    'CH-HEADER': {
      change_id: 'CH-HEADER', category: 'template', clause_id: 'C-FMT-000',
      title: '页眉页脚更新为 2026 版标识与文件编号位', short: '页眉页脚',
      change_type: 'modify', change_type_cn: '纯格式变化', diff_class: 'format_only',
      risk_level: 'low', approver: 'consultant',
      old_text: '页脚：PwC | TP Engagement Letter 2025 | 第 X 页 / 共 Y 页',
      old_text_en: 'Footer: PwC | TP Engagement Letter 2025 | Page X of Y',
      proposed_text: '页脚：PwC | TP Engagement Letter 2026 | EL-2026-TP-0392 | 第 X 页 / 共 Y 页',
      proposed_text_en: 'Footer: PwC | TP Engagement Letter 2026 | EL-2026-TP-0392 | Page X of Y',
      reason: '2026 模板要求页脚含合同编号位，属格式变化。',
      agent_explanation: '页脚加了合同编号位，年份同步更新，格式项。',
      source: 'PwC TP 标准模板 2026 v4.0 · 版式规范',
      source_rule: 'R-FMT-001', confidence: 0.98
    },
    'CH-NUMBER': {
      change_id: 'CH-NUMBER', category: 'template', clause_id: 'C-FMT-000',
      title: '条款编号重排：送达条款删除、AI 条款进入第 13 条', short: '条款编号',
      change_type: 'modify', change_type_cn: '纯格式变化', diff_class: 'format_only',
      risk_level: 'low', approver: 'consultant',
      old_text: '……第 12 条 沟通方式；第 13 条 送达；第 14 条 适用法律与争议解决……',
      old_text_en: '…Clause 12 Communications; Clause 13 Notices; Clause 14 Governing Law…',
      proposed_text: '……第 12 条 沟通方式；第 13 条 AI 辅助服务及数据处理；第 14 条 适用法律与争议解决（交叉引用同步更新）……',
      proposed_text_en: '…Clause 13 AI-assisted Services and Data Processing; Clause 14 Governing Law (numbering and cross-references updated) …',
      reason: '条款集变化后编号需重排；交叉引用由一致性检查校验。',
      agent_explanation: '编号重排本身是格式项，但它会牵出交叉引用问题——第 8 条正文里写了"适用第 12 条"，重排后要跟着改。一致性检查会把这个揪出来。',
      source: 'PwC TP 标准模板 2026 v4.0 · 版式规范',
      source_rule: 'R-FMT-001', confidence: 0.97
    },
    'CH-CONTRACT-NO': {
      change_id: 'CH-CONTRACT-NO', category: 'fact', clause_id: 'C-HEAD-000',
      title: '合同编号由 EL-2025-TP-0417 更新为 EL-2026-TP-0392', short: '合同编号',
      change_type: 'modify', change_type_cn: '低风险自动变化', diff_class: 'deterministic',
      risk_level: 'low', approver: 'consultant',
      old_text: '合同编号：EL-2025-TP-0417',
      old_text_en: 'Engagement Letter No.: EL-2025-TP-0417',
      proposed_text: '合同编号：EL-2026-TP-0392',
      proposed_text_en: 'Engagement Letter No.: EL-2026-TP-0392',
      reason: '按任务编号规则由系统生成本年度合同编号。',
      agent_explanation: '编号按规则生成，与任务编号绑定，属确定性字段。',
      source: '任务编号 T-2026-0392；编号规则 EL-{年度}-TP-{序号}',
      source_rule: 'R-YEAR-001', confidence: 1.0
    },
    'CH-CONTACT': {
      change_id: 'CH-CONTACT', category: 'fact', clause_id: 'C-HEAD-000', fact_id: 'F-004',
      title: '新增客户授权联系人：财务总监 Grace Zhou', short: '联系人',
      change_type: 'modify', change_type_cn: '低风险自动变化', diff_class: 'deterministic',
      risk_level: 'low', approver: 'consultant',
      old_text: '客户授权代表：Richard Chen',
      old_text_en: 'Client authorised representative: Richard Chen',
      proposed_text: '客户授权代表：Richard Chen（法定代表人）；日常授权联系人：财务总监 Grace Zhou（gracezhou@starwave-demo.cn）',
      proposed_text_en: 'Client authorised representative: Richard Chen (Legal Representative); day-to-day contact: Grace Zhou, CFO (gracezhou@starwave-demo.cn)',
      reason: '客户信息表提供了日常授权联系人，法定代表人未变，属普通联系人信息补充。',
      agent_explanation: '法定代表人没换，只是补了个日常联系人，低风险。',
      source: '客户信息表「法定代表人 / 授权联系人」',
      source_rule: 'R-ADDR-001', confidence: 0.90
    },
    'CH-WORDING-1': {
      change_id: 'CH-WORDING-1', category: 'template', clause_id: 'C-CLIENT-001',
      title: '客户责任条款措辞微调（「及时」→「按双方约定时间」）', short: '措辞微调',
      change_type: 'modify', change_type_cn: '文字优化，不改变含义', diff_class: 'wording_only',
      risk_level: 'low', approver: 'consultant',
      old_text: '客户应及时提供完整、准确的财务与业务资料。',
      old_text_en: 'The Client shall provide complete and accurate financial and business information on a timely basis.',
      proposed_text: '客户应按双方约定的时间提供完整、准确的财务与业务资料。',
      proposed_text_en: 'The Client shall provide complete and accurate financial and business information within the timeframes agreed by the parties.',
      reason: '2026 模板将「及时」改为「按双方约定的时间」，表述更明确，义务范围未变。',
      agent_explanation: '"及时"改成"按约定时间"，说得更清楚，但客户该给什么、该多准确，没有变化。仍建议扫一眼确认措辞可接受。',
      source: 'PwC TP 标准模板 2026 v4.0 · 第 6 条',
      source_rule: 'R-LAW-001', confidence: 0.91
    },
    'CH-WORDING-2': {
      change_id: 'CH-WORDING-2', category: 'template', clause_id: 'C-CONF-001',
      title: '保密条款措辞微调（补充「监管机构要求」示例）', short: '保密措辞',
      change_type: 'modify', change_type_cn: '文字优化，不改变含义', diff_class: 'wording_only',
      risk_level: 'low', approver: 'consultant',
      old_text: '双方应对本项目涉及的保密信息予以保密，但依法定或监管要求披露的除外。',
      old_text_en: 'Each party shall keep confidential information relating to this engagement confidential, save for disclosures required by law or regulators.',
      proposed_text: '双方应对本项目涉及的保密信息予以保密，但依法律、法规或监管机构（包括税务机关）要求披露的除外。',
      proposed_text_en: 'Each party shall keep confidential information relating to this engagement confidential, save for disclosures required by laws, regulations or regulators (including the tax authorities).',
      reason: '2026 模板补充监管机构示例，例外范围未实质扩大。',
      agent_explanation: '把"监管要求"举了个例子（税务机关），例外的范围本来就包含它，语义没变。',
      source: 'PwC TP 标准模板 2026 v4.0 · 第 7 条',
      source_rule: 'R-LAW-001', confidence: 0.90
    },
    'CH-ANNEX-TITLE': {
      change_id: 'CH-ANNEX-TITLE', category: 'template', clause_id: 'C-FMT-000',
      title: '附件命名统一为「附件一：关联方清单（2026）」', short: '附件命名',
      change_type: 'modify', change_type_cn: '纯格式变化', diff_class: 'format_only',
      risk_level: 'low', approver: 'consultant',
      old_text: '附件一 关联方清单',
      old_text_en: 'Annex I List of Related Parties',
      proposed_text: '附件一：关联方清单（2026）',
      proposed_text_en: 'Annex I: List of Related Parties (2026)',
      reason: '2026 模板统一附件命名格式并加注年度。',
      agent_explanation: '附件标题格式统一，加了年度，格式项。',
      source: 'PwC TP 标准模板 2026 v4.0 · 版式规范',
      source_rule: 'R-FMT-001', confidence: 0.96
    }
  };

  /* ==========================================================================
     6. 任务（EngagementTask §12.1）
     ========================================================================*/
  var PRESET_TASKS = [
    {
      task_id: 'T-2026-0392',
      contract_no: 'EL-2026-TP-0392',
      project_name: '2026 年度星海智能科技转让定价合同更新',
      client_name: '星海智能科技（深圳）有限公司',
      client_short: '星海智能',
      engagement_year: '2026',
      service_type: '转让定价文档准备服务',
      language: '中英双语（中文为准）',
      owner: 'Emma Clarke（TP 顾问）',
      reviewer: 'Daniel Reed（TP 项目经理）',
      partner: 'Victoria Hale（合伙人）',
      task_kind: 'renewal',
      status: 'files_pending',
      created_at: '2026-01-12 09:38',
      updated_at: '2026-01-12 09:42',
      is_demo_main: true,
      documents: ['D-001', 'D-002', 'D-003', 'D-004', 'D-005']
    },
    {
      task_id: 'T-2026-0388',
      contract_no: 'EL-2026-TP-0388',
      project_name: '2026 年度瑞元制造转让定价合同更新',
      client_name: '瑞元精密制造（苏州）有限公司',
      client_short: '瑞元制造',
      engagement_year: '2026', service_type: '转让定价文档准备服务', language: '中文',
      owner: 'Emma Clarke（TP 顾问）', reviewer: 'Daniel Reed（TP 项目经理）', partner: 'Victoria Hale（合伙人）',
      task_kind: 'renewal', status: 'manager_review',
      created_at: '2026-01-08 14:20', updated_at: '2026-01-11 17:05',
      static_risk: { high: 1, medium: 2, low: 5 }, static_progress: 78, documents: []
    },
    {
      task_id: 'T-2026-0381',
      contract_no: 'EL-2026-TP-0381',
      project_name: '2026 年度恒晖新材料转让定价合同更新',
      client_name: '恒晖新材料科技（无锡）有限公司',
      client_short: '恒晖新材',
      engagement_year: '2026', service_type: '转让定价文档准备服务', language: '中英双语',
      owner: 'Nathan Boyd（TP 顾问）', reviewer: 'Daniel Reed（TP 项目经理）', partner: 'Victoria Hale（合伙人）',
      task_kind: 'renewal', status: 'exported',
      created_at: '2026-01-05 10:02', updated_at: '2026-01-09 16:48',
      static_risk: { high: 0, medium: 3, low: 6 }, static_progress: 100, documents: []
    },
    {
      task_id: 'T-2026-0375',
      contract_no: 'EL-2026-TP-0375',
      project_name: '澜图智慧物流新签转让定价合同',
      client_name: '澜图智慧物流（杭州）有限公司',
      client_short: '澜图物流',
      engagement_year: '2026', service_type: '转让定价咨询', language: '中文',
      owner: 'Emma Clarke（TP 顾问）', reviewer: 'Daniel Reed（TP 项目经理）', partner: 'Victoria Hale（合伙人）',
      task_kind: 'new', status: 'info_pending',
      created_at: '2026-01-04 11:15', updated_at: '2026-01-06 09:30',
      static_risk: { high: 1, medium: 1, low: 2 }, static_progress: 35, documents: []
    }
  ];

  var TASK_STATUS = {
    files_pending: { label: '文件待上传', tone: 'neutral' },
    analyzing: { label: 'Agent 分析中', tone: 'info' },
    info_pending: { label: '等待补充资料', tone: 'warn' },
    consultant_review: { label: '等待顾问确认', tone: 'warn' },
    manager_review: { label: '等待经理复核', tone: 'warn' },
    draft_ready: { label: '初稿已生成', tone: 'ok' },
    exported: { label: '已导出', tone: 'done' }
  };

  /* ==========================================================================
     7. 新建合同动态问卷（F16 简化版 §7.2）
     ========================================================================*/
  var QUESTIONNAIRE = [
    {
      id: 'q_service', question: '本次服务类型是？', why: '服务类型决定基础模板与必选条款集。',
      type: 'single', options: ['转让定价文档准备', '转让定价咨询', '预约定价安排（APA）协助'],
      affects: '基础模板选择'
    },
    {
      id: 'q_lang', question: '合同语言？', why: '决定是否需要生成英文版本与双语一致性检查。',
      type: 'single', options: ['中文', '中英双语（中文为准）', '英文'],
      affects: '双语生成与一致性检查'
    },
    {
      id: 'q_countries', question: '服务涉及哪些国家或地区？', why: '涉及美国等特定地区将触发条件条款（R-US-001）。',
      type: 'multi', options: ['中国大陆', '香港', '美国', '新加坡', '其他'],
      affects: 'C-US-001 等条件条款'
    },
    {
      id: 'q_member_firm', question: '是否有其他普华永道成员所参与？', why: '触发集团成员所协作与责任分担条款（R-GROUP-001）。',
      type: 'single', options: ['是', '否'], affects: 'C-GROUP-002'
    },
    {
      id: 'q_channels', question: '客户要求使用哪些沟通渠道？', why: '微信等非标准渠道需加入使用与留存约定（R-WECHAT-001）。',
      type: 'multi', options: ['电子邮件', 'Microsoft Teams', '微信', '电话会议'],
      affects: 'C-COMM-003'
    },
    {
      id: 'q_data', question: '是否涉及个人信息或重要数据出境？', why: '触发跨境数据传输前置要求段落（R-DATA-002）。',
      type: 'single', options: ['是', '否', '尚不确定'], affects: 'C-DATA-005'
    },
    {
      id: 'q_ai', question: '客户是否同意我们使用经批准的 AI 辅助工具处理其资料？', why: '决定适用 C-AI-DATA-004 标准条款还是其替代条款。',
      type: 'single', options: ['同意', '不同意', '尚未沟通'], affects: 'C-AI-DATA-004'
    },
    {
      id: 'q_liab', question: '客户是否要求特殊责任限额安排？', why: '责任限额须合伙人 / 风险审批人批准，系统不得自动决定。',
      type: 'single', options: ['采用标准限额', '客户要求提高限额', '尚在谈判'], affects: 'C-LIAB-002'
    }
  ];

  // 问卷条件路由：仅在满足条件时提问
  var QUESTION_CONDITIONS = {
    q_member_firm: function (a) { return true; },
    q_channels: function (a) { return true; },
    q_data: function (a) { return true; },
    q_ai: function (a) { return true; },
    q_liab: function (a) { return true; },
    // 仅当涉及美国时才需要进一步确认美国申报用途
    q_us_filing: function (a) { return (a.q_countries || []).indexOf('美国') >= 0; }
  };

  QUESTIONNAIRE.push({
    id: 'q_us_filing', question: '美国关联方工作成果是否会用于美国税务申报？',
    why: '仅在上一题选择「美国」后出现。影响 C-US-001 中申报者责任的表述。',
    type: 'single', options: ['否，仅内部参考', '是，将用于美国申报', '尚不确定'],
    affects: 'C-US-001', conditional: true
  });

  /* ==========================================================================
     8. 预期正确结果（§12.2 之 7）—— 用于验收自查
     ========================================================================*/
  var EXPECTED = {
    core_fields_min: 12,
    core_fields_actual: FACTS.length,
    changes_min: 8,
    high_risk_change_ids: ['CH-AI-DATA', 'CH-LIAB', 'CH-DATA', 'CH-GROUP', 'CH-US-CONFLICT'],
    conflict_change_ids: ['CH-US-CONFLICT'],
    must_detect: [
      '2026 模板新增 AI 辅助服务及数据处理条款（CH-AI-DATA）',
      '去年涉及美国、今年资料缺失的冲突（CH-US-CONFLICT）',
      '责任限制条款实质变化（CH-LIAB）',
      '中英文责任限制倍数不一致（一致性检查 CK-BILINGUAL）'
    ],
    bilingual_inconsistency: '中文「服务费的数额」（一倍）vs 英文「two times the fees」（两倍）— 2026 模板英文版沿用了 2025 的倍数'
  };

  global.TPData = {
    META: META, ROLES: ROLES,
    DOCUMENTS: DOCUMENTS, FACTS: FACTS, CLAUSES: CLAUSES, RULES: RULES,
    CHANGE_TEMPLATES: CHANGE_TEMPLATES, PRESET_TASKS: PRESET_TASKS, TASK_STATUS: TASK_STATUS,
    QUESTIONNAIRE: QUESTIONNAIRE, QUESTION_CONDITIONS: QUESTION_CONDITIONS,
    EXPECTED: EXPECTED,
    SERVICE_LIBRARY: SERVICE_LIBRARY, TP_REGULATION_LIBRARY: TP_REGULATION_LIBRARY,
    TEMPLATE_JA: TEMPLATE_JA,
    TEMPLATE_2025_SECTIONS: TEMPLATE_2025_SECTIONS,
    TEMPLATE_2026_SECTIONS: TEMPLATE_2026_SECTIONS,
    TEMPLATE_2025_FORMAT: TEMPLATE_2025_FORMAT,
    TEMPLATE_2026_FORMAT: TEMPLATE_2026_FORMAT,
    FORMAT_FIELD_MAP: FORMAT_FIELD_MAP,
    SEMANTIC_DIFF_CLASS: SEMANTIC_DIFF_CLASS,
    PRIOR_CONTRACT_SECTIONS: PRIOR_CONTRACT_SECTIONS,
    CLIENT_INFO_ROWS: CLIENT_INFO_ROWS
  };
})(window);

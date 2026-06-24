# 加拿大流动性看板 — 设计文档

**日期:** 2026-06-24
**状态:** 已批准设计,待 spec 复核 → 实施计划
**模板:** 镜像 `macro-liquidity-dashboard`(美国版)架构,独立部署。

---

## 1. 目标

一个面向加拿大的宏观流动性看板:用 **加拿大央行(Bank of Canada)结算余额/资产负债表** 衡量加拿大银行体系流动性,叠加 **TSX 股指**、**CAD/USD 与 CAD/CNY 汇率**,以及 CORRA 资金面、GoC 收益率/曲线、美加利差、WTI 油价等信号,输出 0-100 顺风指数 + 偏多/偏空/中性判定 + 操作建议,并附诚实回测/稳健性。

完整克隆美国版功能(评分引擎 + 回测 + 稳健性),独立 repo / Worker / D1 / 域名。

## 2. 数据诚实原则(最高优先,贯穿全项目)

> 用户硬要求:**所有数据必须真实,不要有幻觉。**

- **每一个展示的数字都可溯源到一个真实序列**:BoC Valet 序列号 / Yahoo 符号 / FRED 序列号。文档第 4 节给出完整映射。
- **缺组件即跳过,绝不兜底估算**:某序列缺失/摄取失败 → 对应因子或卡片显示 `null`/「数据不足」并跳过,**不允许** carry-forward 估算(标准的 as-of「取 ≤ 日期最近一笔」除外)、不允许 `??` 兜底假值。
- **覆盖度指示**:同美国版,显示「覆盖 N/总 因子(有真实数据)」。
- **代理必须显式标注**:信用因子用美国 HY OAS 代理(加拿大无干净日频信用利差),UI 上明确写「美国 HY OAS · 全球风险代理,非加拿大本土」。
- **回测如实**:在真实 TSX 数据上跑,**如实报告结果**(预计信号偏弱/多集中 post-COVID,与美国版一致),看板定位为「弱宏观风控仪表盘」,**不编造 alpha**、不做 curve-fitting 宣称。
- **来源时效卡**:同美国版,逐层标注真实来源 + 真实时间戳(`last_ingest_at`、`asof`、数据 as-of 日期)。

## 3. 架构与技术栈(照搬美国版)

- **新 repo** `ca-liquidity-dashboard` + Cloudflare **Worker** + 新 **D1** 数据库 `ca_liquidity` + **Static Assets**(`public/`)。
- **摄取层**:
  - **BoC Valet API**(`https://www.bankofcanada.ca/valet/`,免 key,camelCase)—— 主源:资产负债表、CORRA、政策利率、GoC 收益率、汇率。
  - **Yahoo Finance** —— TSX(`^GSPTSE`)、WTI(`CL=F`)实时与历史;可选实时汇率兜底。
  - **FRED 免 key CSV**(`fredgraph.csv?id=...`)—— 仅取 ① 美国政策利率 `DFEDTARU`(算美加利差)② 美国 HY OAS `BAMLH0A0HYM2`(信用代理)。
- **模块布局**(对应美国版):
  - `src/config.ts` — 序列定义、权重、阈值
  - `src/boc.ts` — BoC Valet 摄取(替代 `fred.ts`);`src/extsrc.ts` — Yahoo/FRED 摄取
  - `src/db.ts` — D1 读写(observations / daily_snapshot / meta)
  - `src/metrics.ts` — computeSnapshot、因子打分、verdict、guidance
  - `src/explain.ts` `src/robustness.ts` `src/walkforward.ts` — 归因/稳健性/回测
  - `src/health.ts` `src/worker.ts` — 健康端点 / 路由 / cron
  - `public/index.html | app.js | styles.css` — 前端(复用美国版打磨好的样式)
- **Cron**:每 3 小时摄取一次(`0 */3 * * *`)。
- **D1 schema**(镜像美国版):
  - `observation(series_id, date, value)` 主键 `(series_id,date)`
  - `daily_snapshot(date, ...factor cols, settlement_balance, total_assets, goc_deposits, netliq, score, verdict, factors_json, tsx, ...)` 
  - `meta(key, value)` — `last_ingest_at` / `last_attempt_at` / `last_status` 等

## 4. 数据源与序列映射(全部已验证有真值,2026-06-24)

| 用途 | 序列 ID | 标签 | 频率 / 源 |
|---|---|---|---|
| BoC 总资产 | `V36610` | Total assets | 周 · BoC B2_WEEKLY |
| 政府存款(类比 TGA) | `V36628` | Government of Canada deposits | 周 · BoC |
| **结算余额(净流动性核心)** | `V36636` | Members of Payments Canada | 周 · BoC |
| 逆回购(类比 RRP) | `V1203435186` | Securities sold under repo | 周 · BoC |
| 流通券 | `V36625` | Notes in circulation | 周 · BoC |
| 资金面 | `AVG.INTWO` | CORRA(隔夜回购均率) | 日 · BoC |
| 政策利率 | `V122514` | Overnight rate(目标) | 日 · BoC |
| 利率/曲线 | `BD.CDN.10YR.DQ.YLD` / `BD.CDN.2YR.DQ.YLD` | GoC 10Y / 2Y | 日 · BoC |
| 汇率(美元兑加元) | `FXUSDCAD` | USD/CAD | 日 · BoC |
| 汇率(加元兑人民币) | `FXCADCNY` | CAD/CNY | 日 · BoC |
| 股指 | `^GSPTSE` | S&P/TSX Composite | 实时 · Yahoo |
| 油价 | `CL=F` | WTI | 实时 · Yahoo |
| 美国政策利率(利差用) | `DFEDTARU` | Fed funds upper target | 日 · FRED CSV |
| 信用代理 | `BAMLH0A0HYM2` | 美国 HY OAS(全球风险代理) | 日 · FRED CSV |

## 5. 加拿大流动性模型

### 5.1 净流动性
- **头条净流动性 = 结算余额 `V36636`** —— 加拿大银行体系在 BoC 的准备金,QT 抽的就是它。比美国 WALCL−TGA−RRP 更直接。
- **拆解瀑布(展示卡)**:`总资产 V36610 − 流通券 V36625 − 政府存款 V36628 − 逆回购 V1203435186 ≈ 结算余额`。

### 5.2 因子(加拿大序列重映射)
| 因子 | 口径 | 数据 | 初始权重* |
|---|---|---|---|
| netliqTrend | 结算余额 13 周趋势 | V36636 | 0.30 |
| reserveAdequacy | 结算余额水平/充裕度 | V36636 | 0.10 |
| impulse | 总资产扩/缩(QE/QT) | V36610 | 0.08 |
| curve | GoC 10Y − 2Y 斜率 | BD.CDN.10/2YR | 0.12 |
| dollar | USD/CAD 趋势(加元走弱=逆风) | FXUSDCAD | 0.12 |
| oil | WTI 趋势(加元/能源股顺风) | CL=F | 0.08 |
| funding | CORRA − 隔夜目标 | AVG.INTWO − V122514 | 0.08 |
| rates | GoC 10Y 冲量 | BD.CDN.10YR | 0.06 |
| credit | 美国 HY OAS(全球风险代理) | BAMLH0A0HYM2 | 0.06 |

\* 初始权重为占位,**由回测在真实 TSX 数据上校准**;和=1.00。方向先验(加元=商品/风险货币:CAD 走弱、油价跌=逆风)由回测验证,不强加。

### 5.3 判定与建议
- 0-100 分 → `verdictFromScore`:>55 偏多、<45 偏空、中间滞回保留前值(同美国版 `VERDICT_BANDS`)。
- 实时风险覆盖(stress):TSX 5 日回撤、VIX、USD/CAD 5 日急升、WTI 5 日急跌 → 触发则判定降一级。
- 操作建议卡(仓位旋钮):同美国版 `buildGuidance` 结构,tone = bull/neutral/bear/brake。

## 6. 汇率 & 额外信号面板

- **汇率卡**:USD/CAD(`FXUSDCAD`,如 1.42)+ 倒数 CAD/USD;CAD/CNY(`FXCADCNY`)。各带最新值 + 趋势方向。
- **资金面**:CORRA vs 隔夜目标(bps 偏离)。
- **美加利差**:`DFEDTARU − V122514`(USD/CAD 主驱动背景)。
- **油价**:WTI(`CL=F`)背景趋势。

## 7. 前端布局(镜像美国版,复用已打磨样式)

中文 UI,卡片顺序:
1. 判定卡(深色实底+白字,按状态联动)
2. 操作建议卡(仓位旋钮)
3. 顺风指数 + 因子条(横条已修的 `display:block`)
4. **结算余额 vs TSX** 双轴图
5. 汇率面板(CAD/USD、CAD/CNY)+ CORRA/曲线/利差/油价
6. 分数归因卡 / 因子明细
7. 回测稳健性卡(诚实)
8. 数据来源与时效卡(逐层真实时间戳)

## 8. 回测 / 稳健性(诚实)

- 在真实 TSX(`^GSPTSE`)历史上跑:IC(bootstrap CI + 非重叠样本)、score>55 多/空策略年化 vs 买入持有、Sharpe、最大回撤、换手、分 regime IC。
- 结论如实呈现(预计弱);UI 明写「弱信号宏观风控仪表盘,非择时工具」。
- 校准只用于设定因子权重,**不**用于宣称择时 alpha。

## 9. 部署与运维

- CF Worker + D1 + Pages/Assets;`wrangler deploy`;新域名(如 `ca-liquidity-dashboard.<account>.workers.dev`,或自定义)。
- 历史回填:BoC 资产负债表 2017+(结算余额体系成形)、FX/利率 2017+;首次 `?all=1` 全量重建。
- 健康端点 `/api/health`:摄取心跳 + 覆盖 + stale 判定(BoC 周频,类似 WALCL 节奏)。

## 10. 已决判断点(决策日志)

1. **净流动性 = 结算余额 V36636** —— 已批准。
2. **信用因子** —— 加拿大无干净日频信用利差,用 **美国 HY OAS 代理 + 明确标注**(用户批准:优先真加拿大,无则用美国代理)。
3. **回测诚实定位** —— 已批准;全程真实数据、无幻觉、不编造 alpha。

## 11. 构建阶段(高层,详细计划见 writing-plans)

- **P0 骨架**:repo + wrangler + D1 schema + BoC/Yahoo/FRED 摄取 + cron + 健康端点。
- **P1 模型**:computeSnapshot + 因子 + 净流动性(结算余额)+ verdict + guidance + `/api/snapshot`。
- **P2 前端**:复用样式,渲染判定/建议/顺风/图表/汇率/来源时效。
- **P3 归因 + 回测/稳健性**:explain + robustness + walkforward + 权重校准(真实 TSX)。
- **P4 额外面板**:CORRA/曲线/利差/油价 + 汇率面板打磨。
- **P5 上线**:回填 + 部署 + 端到端验证。

---

**非目标(YAGNI):** 不做用户登录/订阅;不做多语言;不做下单/交易;不抄美国版的研究结论,加拿大单独跑单独报。

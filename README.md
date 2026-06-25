# 加拿大宏观流动性看板 · Canada Macro-Liquidity Dashboard

用加拿大央行(Bank of Canada)的**结算余额**衡量加拿大银行体系流动性,叠加 **S&P/TSX 股指**、**CAD/USD 与 CAD/CNY 汇率**、CORRA 资金面、GoC 收益率曲线、美加利差、WTI 油价,输出一个 **0–100 顺风指数**和 **偏多 / 偏空 / 中性** 红绿灯,并附**诚实的回测**。

🌐 **Live:** https://ca-liquidity-dashboard.pp-account.workers.dev
📄 **算法说明页:** https://ca-liquidity-dashboard.pp-account.workers.dev/algorithm

> ⚠️ **诚实定位(请先读这条)**:在 2017–2026 的真实数据上,本模型对未来 13 周 TSX 的预测力**不显著**(综合 Spearman IC ≈ **−0.02**,95%CI 跨 0,p ≈ **0.56**,独立样本仅 **37**)。它是一个**弱信号的宏观 regime / 风控仪表盘**,**不是择时工具、不保证跑赢大盘、不构成投资建议**。本项目刻意不粉饰回测、不编造 alpha。

---

## ✨ 特性

- **净流动性 = BoC 结算余额**(`V36636`,加版"银行准备金"),不是凑出来的公式
- **9 因子加权 0–100 顺风指数** + 偏多/偏空/中性判定(带滞回)
- **实时风控覆盖层**:VIX / TSX / USD-CAD / WTI 急变时把显示判定下调一级
- **操作建议卡**(仓位旋钮):顺风加码 / 中性维持 / 逆风减仓 / RISK-OFF 刹车
- **汇率面板**:USD/CAD、CAD/USD、CAD/CNY;**额外信号**:CORRA vs 政策目标、美加利差、WTI
- **分数归因**(因子贡献 + 净流动性资产负债表桥接)、**回测稳健性**(IC bootstrap CI / 非重叠样本 / regime)
- **数据来源与时效卡**:逐层标注真实来源 + 真实时间戳
- **无幻觉**:每个数字溯源真实序列;缺数据即「数据不足」,绝不 carry-forward 估算或 `?? 0` 兜底
- **韧性摄取**:瞬时 5xx 自动重试;外围源失败跳过(用上次真实值)、核心 BoC 失败才报错

---

## 🏗️ 架构

```
BoC Valet API ┐
Yahoo Finance ┤→ Cloudflare Worker (3h cron) → D1 (observation / daily_snapshot / meta)
FRED CSV      ┘        │                                    │
                       └────────── /api/* ──────────────────┴──→ 静态前端 (vanilla JS + lightweight-charts)
```

- **Cloudflare Worker**(TypeScript)—— 摄取 + 评分 + `/api/*` + 静态资源托管
- **D1**(SQLite)—— `observation`(原始序列)、`daily_snapshot`(打分快照)、`meta`(运维元数据)
- **Cron** `0 */3 * * *` —— 每 3 小时增量摄取并重建近 14 天快照
- 前端纯原生 JS,无框架;图表用 vendored `lightweight-charts`

---

## 📊 数据源(全部真实、除管理端外无 key)

| 用途 | 序列 | 源 | 频率 |
|---|---|---|---|
| **结算余额(净流动性核心)** | `V36636` | BoC Valet | 周 |
| 总资产 / 政府存款 / 逆回购 / 流通券 | `V36610` / `V36628` / `V1203435186` / `V36625` | BoC Valet | 周 |
| 资金面 | CORRA `AVG.INTWO` − 政策目标 `V122514` | BoC Valet | 日 |
| 利率 / 曲线 | GoC `BD.CDN.10YR.DQ.YLD` / `BD.CDN.2YR.DQ.YLD` | BoC Valet | 日 |
| 汇率 | `FXUSDCAD`、`FXCADCNY` | BoC Valet | 日 |
| 股指 / 油价 / 风险 | `^GSPTSE`、`CL=F`、`^VIX`、`USDCAD=X` | Yahoo Finance | 实时 |
| 美加利差 / 信用代理 | 美国政策利率 `DFEDTARU`、HY OAS `BAMLH0A0HYM2` | FRED CSV | 日 |

> **信用因子是美国代理**:加拿大没有干净的日频信用利差,故用美国 HY OAS 作"全球风险偏好"代理,UI 三处明确标注"非加拿大本土"。

---

## 🧮 模型

每个因子把对应序列做 **z-score → 0–100**(中性 50;序列缺失记 50 并在覆盖度扣分)。**总分 = Σ 因子 × 权重**,权重和 = 1.00。判定带:>55 偏多、<45 偏空、45–55 死区保留前值。

| 因子 | 方向先验 | 权重 | 13 周 IC |
|---|---|---|---|
| netliqTrend(结算余额 13 周趋势) | 升=顺风 | **0.25** | +0.044 |
| curve(GoC 10Y−2Y) | 陡=顺风 | **0.18** | +0.156 |
| reserveAdequacy(结算余额水平) | 高=顺风 | 0.12 | +0.084 |
| rates(GoC 10Y 冲量) | 升=逆风 | 0.11 | +0.116 |
| credit(美国 HY OAS 代理) | 高=逆风 | 0.10 | +0.095 |
| impulse(总资产扩/缩) | 扩=顺风 | 0.06 | −0.064 |
| dollar(USD/CAD 趋势) | 加元弱=逆风 | 0.06 | −0.214 |
| oil(WTI 趋势) | 油涨=顺风 | 0.06 | −0.446 |
| funding(CORRA−目标) | 利差>0=逆风 | 0.06 | −0.207 |

**权重如何来的(诚实)**:用真实代码在真实数据上跑回测得到每因子 IC,**按 IC 符号定的粗略先验**——正 IC 给较高权重、负 IC 压到最低 0.06。**没有为了好看的回测翻转因子方向**(经济学先验在样本内没成立,但翻符号去拟合 37 个噪声样本就是过拟合)。权重不是被优化出来的 alpha。详见 [`scripts/calibrate.md`](scripts/calibrate.md) 与回测产物 [`scripts/calibration-output.json`](scripts/calibration-output.json)。

---

## 🔌 API

| 端点 | 说明 |
|---|---|
| `GET /api/snapshot` | 最新快照 + 实时行情 + 风控 + 操作建议 + 信号 + 摄取时戳 |
| `GET /api/health` | 健康检查(覆盖度、stale、摄取状态、`partial`)|
| `GET /api/history?from=&to=` | 历史快照(供图表)|
| `GET /api/explain?window=1w\|1m\|3m` | 分数归因 + 净流动性桥接 |
| `GET /api/robustness` / `GET /api/backtest` | 回测稳健性 / IC |
| `POST /api/admin/refresh[?all=1]` | 管理端摄取(`Bearer $ADMIN_TOKEN`;`?all=1` 全量回填)|

---

## 🛠️ 本地开发

```bash
npm install
npm test                       # 78 项单元测试 (Vitest)
npm run migrate:local          # 本地 D1 建表
npm run dev                    # wrangler dev (本地)
npx tsc --noEmit               # 类型检查
```

## 🚀 部署

```bash
npx wrangler d1 create ca_liquidity        # 首次:建 D1,把 database_id 填进 wrangler.toml
npm run migrate:remote                      # 远程建表
npx wrangler secret put ADMIN_TOKEN         # 设管理端 token
npx wrangler deploy                         # 发布 Worker

# 首次全量回填(BoC 2017+ / TSX / FRED → ~500 快照):
curl -X POST "https://<your-worker>/api/admin/refresh?all=1" \
     -H "authorization: Bearer <ADMIN_TOKEN>"
```

之后 cron 每 3 小时自动增量。权重重校准(用**真实 src 代码**,非复制):

```bash
npx tsx scripts/calibrate.ts   # → scripts/calibration-output.json
```

---

## 📁 项目结构

```
src/
  config.ts         序列定义、权重、阈值
  boc.ts            BoC Valet 取数 + 解析
  extsrc.ts         Yahoo + FRED CSV 取数
  http.ts           fetchRetry(瞬时 5xx/网络重试)
  db.ts             D1 读写(observation / snapshot / meta)
  metrics.ts        因子打分、computeSnapshot、verdict、guidance
  prices.ts         实时行情 + 风控(stress)
  explain.ts        分数归因 + 净流动性桥接
  robustness.ts     IC / bootstrap / 非重叠 / regime 回测
  walkforward.ts    walk-forward 回测
  backtest.ts       IC / 前瞻收益 / 策略
  health.ts         健康评估
  service.ts        runIngest 编排(非对称韧性)
  worker.ts         路由 / cron / 静态兜底
public/             index.html / app.js / styles.css / algorithm.{html,md} / vendor
migrations/         D1 schema
docs/superpowers/   spec + 实施计划
scripts/            calibrate.ts + 回测产物
test/               Vitest 单测
```

---

## 🔭 技术栈

TypeScript · Cloudflare Workers + Wrangler · D1 (SQLite) · Vitest · 原生 JS 前端 + lightweight-charts。本项目通过 **subagent-driven 流程**逐任务实现 + 评审(spec + 详细计划见 `docs/superpowers/`)。

## ⚖️ 免责声明

本项目仅供研究与教育用途。模型**无统计显著的预测力**,历史(尤其样本内)表现不代表未来,**不构成投资建议**。自负盈亏。

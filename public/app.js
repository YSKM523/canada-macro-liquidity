const FACTOR_LABELS = {
  netliqTrend:     '净流动性(结算余额)',
  reserveAdequacy: '准备金充裕',
  impulse:         '资产负债表',
  curve:           '收益率曲线',
  dollar:          '美元 USD/CAD',
  oil:             '油价 WTI',
  funding:         '资金面 CORRA',
  rates:           '利率 GoC10',
  credit:          '信用(美国 HY 代理)',
};
const VERDICT_CN = { BULLISH: '偏多', BEARISH: '偏空', NEUTRAL: '中性' };
const VERDICT_CLASS = { BULLISH: 'bull', BEARISH: 'bear', NEUTRAL: 'neutral' };
const REGIME_CN = { EXPANDING: '扩表', CONTRACTING: '缩表', FLAT: '横住' };
const POLICY_CN = { QE: 'QE(宽松)', QT: 'QT(紧缩)', RESERVE_MGMT: '准备金管理(QT已结束)', NEUTRAL: '中性' };
const fmt = (x, d = 2) => (x == null ? '—' : Number(x).toFixed(d));
const EX_WINDOW_LABEL = { '1w': '上周', '1m': '上月', '3m': '3 个月前' };
const FACTOR_MEANING = {
  netliqTrend:     '结算余额 13 周趋势，升=放水偏多',
  reserveAdequacy: 'BoC 结算余额充裕度（z-score）',
  impulse:         'BoC 总资产脉冲（扩/缩）',
  curve:           '收益率曲线斜率（GoC10Y−2Y）',
  dollar:          'USD/CAD 汇率，走强（加元贬值）=逆风',
  oil:             'WTI 油价 z-score，升=加元顺风',
  funding:         'CORRA−目标利差，升=资金面压力',
  rates:           'GoC10 年期利率冲量',
  credit:          '美国高收益债 OAS（全球风险代理，低=风险偏好高）',
};
let explainData = null;
const REGIME_AXIS_LABEL = { balance_sheet: '资产负债表', covid: 'COVID 前后', qt: 'QT 前后', vix: 'VIX 风险档' };
const REGIME_BUCKET_LABEL = { EXPANDING: '扩表', CONTRACTING: '缩表', FLAT: '横住', pre: '前', post: '后', low: '低波', high: '高波' };

// 移动端折叠次要卡片（规整：顶部只留决策区，分析类点击标题展开）
function setupAccordions() {
  if (!window.matchMedia || !window.matchMedia('(max-width:760px)').matches) return;
  document.querySelectorAll('.collapsible').forEach((card) => {
    const h2 = card.querySelector('h2');
    if (!h2 || h2.dataset.acc) return;
    h2.dataset.acc = '1';
    card.classList.add('collapsed');
    const chev = document.createElement('span');
    chev.className = 'chev';
    chev.textContent = '▸';
    h2.appendChild(chev);
    h2.addEventListener('click', () => {
      const collapsed = card.classList.toggle('collapsed');
      chev.textContent = collapsed ? '▸' : '▾';
    });
  });
}

async function main() {
  setupExplain();
  fetchExplain('1w');
  fetchRobust();
  let snapRes, histRes;
  try {
    [snapRes, histRes] = await Promise.all([
      fetch('/api/snapshot').then(r => r.json()),
      fetch('/api/history?from=' + threeYearsAgo()).then(r => r.json()),
    ]);
  } catch (e) {
    showBanner('⚠️ 加载失败，稍后重试（' + (e && e.message ? e.message : '网络错误') + '）');
    return;
  }
  if (!snapRes || !snapRes.snapshot || snapRes.error === 'no_data') {
    showBanner('暂无数据（数据库为空或正在初始化）');
    renderIngest(snapRes && snapRes.ingest);
    return;
  }
  renderVerdict(snapRes);
  renderGuidance(snapRes.snapshot);
  renderScore(snapRes.snapshot);
  renderFactorTable(snapRes);
  renderChart((histRes && histRes.rows) || []);
  renderFx(snapRes);
  renderSignals(snapRes);
  renderIngest(snapRes.ingest);
  renderProvenance(snapRes);
  setupAccordions();
}

function showBanner(text) {
  const banner = document.getElementById('stress-banner');
  if (banner) { banner.textContent = text; banner.style.display = ''; }
}

// 摄取异常（cron 停了/BoC 失败）才报红；正常周线数据滞后不报。
function renderIngest(ingest) {
  const el = document.getElementById('data-staleness');
  if (!el || !ingest) return;
  const age = ingest.ingest_age_hours;
  if (ingest.ingest_status === 'error' || (age != null && age > 6)) {
    const hrs = age != null ? Math.round(age) : '?';
    el.textContent += `　⚠️ 数据更新异常（上次成功 ${hrs} 小时前）`;
    el.style.color = '#C53030';
  }
}

function threeYearsAgo() {
  const d = new Date(); d.setFullYear(d.getFullYear() - 3);
  return d.toISOString().slice(0, 10);
}

function renderVerdict(res) {
  const s = res.snapshot || {};
  const card = document.getElementById('verdict-card');
  const macroV = s.verdict || 'NEUTRAL';
  const displayV = s.display_verdict || macroV;
  card.classList.add(VERDICT_CLASS[displayV]);
  document.getElementById('verdict-label').textContent = VERDICT_CN[displayV] || '—';
  document.getElementById('verdict-reason').textContent = s.reason || '';

  // Live stress overlay
  const stress = s.live_stress;
  const banner = document.getElementById('stress-banner');
  const note = document.getElementById('stress-note');
  if (stress && stress.stressed) {
    banner.textContent = '⚠️ 实时风险覆盖:' + stress.reasons.join('、');
    banner.style.display = '';
    if (displayV !== macroV) {
      note.textContent = `(宏观判断 ${VERDICT_CN[macroV]}，因实时风险下调一级)`;
      note.style.display = '';
    } else {
      note.style.display = 'none';
    }
  } else {
    banner.style.display = 'none';
    note.style.display = 'none';
  }
  const policy = s.policy_regime ? (POLICY_CN[s.policy_regime] || s.policy_regime) : '—';
  document.getElementById('regime-sub').innerHTML =
    `资产负债表:&nbsp;<b>${REGIME_CN[s.qe_qt_regime] || s.qe_qt_regime || '—'}</b><br>结算余额:&nbsp;<b>${dirCn(s.netliq_dir)}</b><br>政策阶段:&nbsp;<b>${policy}</b>`;
  const live = res.live || {};
  document.getElementById('asof').textContent =
    `TSX ${fmt(live.tsx, 0)} · VIX ${fmt(live.vix)} · USDCAD ${fmt(live.usdcad, 4)} · WTI ${fmt(live.wti)}`;

  // Staleness: days since snapshot.date
  const snapshotDate = s.date || '';
  if (snapshotDate) {
    const today = new Date();
    const snap = new Date(snapshotDate + 'T00:00:00Z');
    const diffDays = Math.round((today.getTime() - snap.getTime()) / 86400000);
    const staleEl = document.getElementById('data-staleness');
    if (staleEl) {
      if (diffDays > 8) {
        staleEl.textContent = `BoC 宏观 · 截至 ${snapshotDate} · 已 ${diffDays} 天未更新`;
        staleEl.style.color = '#B7791F';
      } else {
        staleEl.textContent = `BoC 宏观 · 截至 ${snapshotDate} · 周更(约周四)`;
        staleEl.style.color = '';
      }
    }
  }

  // Coverage: N/total scoring factors with real data
  const coverage = s.coverage;
  const total = s.coverage_total ?? 9;
  const coverageEl = document.getElementById('data-coverage');
  if (coverageEl && coverage != null) {
    const n = Math.round(coverage * total);
    coverageEl.textContent = `覆盖 ${n}/${total} 因子`;
    coverageEl.style.color = n < total ? '#B7791F' : '';
  }
}

function renderGuidance(s) {
  const card = document.getElementById('guidance-card');
  if (!s || !s.guidance) { card.style.display = 'none'; return; }
  card.style.display = '';
  const g = s.guidance;

  // Whole-card recolor by tone (bull/neutral/bear/brake), keep base classes
  card.className = 'card guidance ' + (g.tone || 'neutral');

  // Tier badge + tone color class
  const tierEl = document.getElementById('g-tier');
  tierEl.textContent = g.tierLabel;
  tierEl.className = 'g-badge ' + g.tone;

  document.getElementById('g-exposure').textContent = g.exposure;
  document.getElementById('g-lean').textContent = '偏向:' + g.lean;

  const divergeEl = document.getElementById('g-diverge');
  if (g.divergence) {
    divergeEl.textContent = g.divergence;
    divergeEl.style.display = '';
  } else {
    divergeEl.style.display = 'none';
  }

  const triggersList = document.getElementById('g-triggers');
  triggersList.innerHTML = (g.triggers || []).map(t => {
    const cls = t.armed ? 'armed' : '';
    return `<li class="${cls}"><b>${t.label}</b> · ${t.detail}</li>`;
  }).join('');
}

function dirCn(d) { return { UP: '在升', DOWN: '在收', FLAT: '走平' }[d] || '—'; }

// ── 数据来源与时效：逐层标注真实来源时间（全部取 API 真值，不估算）──────────
function fmtTs(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZoneName: 'short' });
}

function provLayer(tag, title, src, asof) {
  const cn = tag === 'live' ? '实时' : '周更';
  return `<div class="prov-layer"><div class="prov-head"><span class="prov-tag ${tag}">${cn}</span><b>${title}</b></div>`
    + `<div class="prov-src">${src}</div><div class="prov-asof">${asof}</div></div>`;
}

function renderProvenance(res) {
  const card = document.getElementById('provenance-card');
  const body = document.getElementById('provenance-body');
  if (!card || !body) return;
  const s = res.snapshot || {}, live = res.live || {}, ingest = res.ingest || {};
  const macroDate = s.date || '—';
  const ingestAt = fmtTs(ingest.ingest_at);
  const liveAt = fmtTs(live.asof);
  body.innerHTML =
    provLayer('weekly', '宏观模型 · 打分 / 判定 / 净流动性',
      '来源：BoC · 资产负债表(B2_WEEKLY，V36610/V36636 等，周频) · CORRA/目标利率/汇率/GoC 利率(日频) · FRED：美国 HY OAS(BAMLH0A0HYM2)、政策利率(DFEDTARU)',
      `数据截至 <b>${macroDate}</b>　·　最近摄取 <b>${ingestAt}</b>　·　每 3 小时；BoC 结算余额周频(约周四发布)`)
    + provLayer('live', '实时行情 · 顶部 TSX / VIX / USDCAD / WTI',
      '来源：Yahoo Finance(^GSPTSE · ^VIX · USDCAD=X · CL=F)',
      `抓取于 <b>${liveAt}</b>　·　每次打开页面实时抓取`)
    + provLayer('live', '实时风险覆盖 · stress / 判定降级',
      '来源：Yahoo Finance 日线 · 近 5 日动量(TSX / VIX / USDCAD / WTI)',
      `计算于 <b>${liveAt}</b>　·　与行情同次抓取`);
  card.style.display = '';
}

function renderScore(s) {
  if (!s) return;
  const score = Math.round(s.score ?? 0);
  document.getElementById('score-gauge').style.width = score + '%';
  document.getElementById('score-num').textContent = score;
  // sub-factor bars read the persisted factors_json column (set by upsertSnapshot)
  const factors = s.factors_json ? JSON.parse(s.factors_json) : null;
  const host = document.getElementById('factor-bars');
  host.innerHTML = '';
  if (!factors) return;
  for (const [k, label] of Object.entries(FACTOR_LABELS)) {
    const val = Math.round(factors[k] ?? 0);
    const st = val >= 55 ? 'up' : val <= 45 ? 'down' : 'flat';
    const row = document.createElement('div'); row.className = 'fb';
    row.innerHTML = `<span>${label}</span><span class="track"><span class="bar ${st}" style="width:${val}%"></span></span><span class="fbv ${st}">${val}</span>`;
    host.appendChild(row);
  }
}

function renderFactorTable(res) {
  const s = res.snapshot || {}; const live = res.live || {};
  const tbody = document.querySelector('#factor-table tbody');
  const tag = ok => `<span class="tag ${ok ? 'ok' : 'bad'}">${ok ? '顺风' : '逆风'}</span>`;
  const rows = [
    ['净流动性 结算余额(十亿CAD)', fmt(s.netliq != null ? s.netliq / 1000 : null, 1), s.netliq_dir === 'UP'],
    ['GoC 10年 收益率', fmt(s.goc10) + '%', null],
    ['CORRA−目标利差', fmt(s.corra_target, 3), (s.corra_target ?? 1) <= 0.05],
    ['HY OAS(美国代理)', fmt(s.hy_oas, 2), null],
    ['USD/CAD(BoC 汇率,实时仅展示)', fmt(live.usdcad, 4), null],
    ['VIX', fmt(live.vix), (live.vix ?? 99) < 25],
  ];
  tbody.innerHTML = rows.map(([k, v, ok]) =>
    `<tr><td>${k}</td><td>${v}</td><td>${ok == null ? '—' : tag(ok)}</td></tr>`).join('');
}

function renderChart(rows) {
  const el = document.getElementById('chart');
  const chart = LightweightCharts.createChart(el, {
    height: 320, layout: { background: { color: '#FFFFFF' }, textColor: '#697386' },
    grid: { vertLines: { color: '#E3E8EE' }, horzLines: { color: '#E3E8EE' } },
    rightPriceScale: { borderColor: '#E3E8EE' }, leftPriceScale: { visible: true, borderColor: '#E3E8EE' },
    timeScale: { borderColor: '#E3E8EE' },
  });
  const tsx = chart.addLineSeries({ color: '#1A1F36', priceScaleId: 'right', lineWidth: 2 });
  const nl = chart.addLineSeries({ color: '#635BFF', priceScaleId: 'left', lineWidth: 2 });
  // history rows: date, netliq (in M CAD from DB), tsx
  const tsxData = rows.filter(r => r.tsx != null).map(r => ({ time: r.date, value: r.tsx }));
  // convert netliq from M CAD to B CAD for the left axis label
  const nlData = rows.filter(r => r.netliq != null).map(r => ({ time: r.date, value: r.netliq / 1000 }));
  tsx.setData(tsxData);
  nl.setData(nlData);
  chart.timeScale().fitContent();
  new ResizeObserver(() => chart.applyOptions({ width: el.clientWidth })).observe(el);

  // Legend values: latest by default, hovered value on crosshair move
  const legNl = document.getElementById('leg-nl');
  const legSpx = document.getElementById('leg-spx');
  const lastNl = nlData.length ? nlData[nlData.length - 1].value : null;
  const lastTsx = tsxData.length ? tsxData[tsxData.length - 1].value : null;
  const setLeg = (nlv, tsxv) => {
    if (legNl) legNl.textContent = nlv == null ? '' : ' $' + nlv.toFixed(1) + 'B';
    if (legSpx) legSpx.textContent = tsxv == null ? '' : ' ' + Math.round(tsxv).toLocaleString();
  };
  setLeg(lastNl, lastTsx);
  chart.subscribeCrosshairMove((param) => {
    if (!param || !param.time) { setLeg(lastNl, lastTsx); return; }
    const nlv = param.seriesData.get(nl);
    const tsxv = param.seriesData.get(tsx);
    setLeg(nlv ? nlv.value : null, tsxv ? tsxv.value : null);
  });
}

// ── 分数归因卡 ────────────────────────────────────────────────────────────
async function fetchExplain(win) {
  const card = document.getElementById('explain-card');
  const body = document.getElementById('explain-body');
  if (!card || !body) return;
  try {
    const res = await fetch('/api/explain?window=' + win).then(r => r.json());
    explainData = res;
    renderExplain(res);
    card.style.display = '';
  } catch (e) {
    explainData = null;
    body.innerHTML = '<p class="ex-note">归因加载失败，稍后重试</p>';
    card.style.display = '';
  }
}

function setupExplain() {
  const seg = document.getElementById('explain-window');
  if (seg && !seg.dataset.wired) {
    seg.dataset.wired = '1';
    seg.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-window]');
      if (!btn) return;
      seg.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn));
      fetchExplain(btn.dataset.window);
    });
  }
  const body = document.getElementById('explain-body');
  if (body && !body.dataset.wired) {
    body.dataset.wired = '1';
    body.addEventListener('click', (e) => {
      const row = e.target.closest('.ex-row[data-key]');
      if (!row || !explainData) return;
      const sib = row.nextElementSibling;
      if (sib && sib.classList.contains('ex-detail')) { sib.remove(); return; }
      const key = row.dataset.key;
      const c = (explainData.contributions || []).find(x => x.key === key);
      const a = (explainData.attribution || []).find(x => x.key === key);
      const bits = [];
      if (c) bits.push(`当前因子 ${c.factor.toFixed(0)}/100 · 权重 ${Math.round(c.weight * 100)}% · 贡献 ${c.contribution >= 0 ? '+' : ''}${c.contribution.toFixed(2)}`);
      if (a) bits.push(`较基准 Δ ${a.deltaFactor >= 0 ? '+' : ''}${a.deltaFactor.toFixed(0)} → 拉动 ${a.deltaContribution >= 0 ? '+' : ''}${a.deltaContribution.toFixed(2)}`);
      if (FACTOR_MEANING[key]) bits.push(FACTOR_MEANING[key]);
      const det = document.createElement('div');
      det.className = 'ex-detail';
      det.textContent = bits.join('　·　');
      row.after(det);
    });
  }
}

function renderExplain(res) {
  const body = document.getElementById('explain-body');
  if (!body) return;
  if (!res || res.error === 'no_data' || !res.current) {
    body.innerHTML = '<p class="ex-note">暂无数据</p>';
    return;
  }
  body.innerHTML = renderAttribution(res) + renderContribution(res.contributions) + renderSettlementBal(res.netliq, res.window);
}

// 信号变化归因 = Δ分瀑布图（从基准分逐因子累加落到当前分）
function renderAttribution(res) {
  const label = EX_WINDOW_LABEL[res.window] || '基准';
  if (!res.attribution || res.reference == null || res.deltaScore == null) {
    return `<div class="ex-sub">这次为什么变（较${label}）</div>`
      + `<p class="ex-note">基准数据不足（历史不够），换更短的时间档试试。</p>`;
  }
  const R = res.reference.score, C = res.current.score, d = res.deltaScore;
  const dCls = d >= 0 ? 'ex-up' : 'ex-down';
  const dSign = d >= 0 ? '+' : '';

  const steps = res.attribution
    .filter(a => Math.abs(a.deltaContribution) >= 0.2)
    .map(a => ({ label: FACTOR_LABELS[a.key] || a.key, v: a.deltaContribution, key: a.key }));
  const otherSum = res.attribution
    .filter(a => Math.abs(a.deltaContribution) < 0.2)
    .reduce((s, a) => s + a.deltaContribution, 0);
  if (Math.abs(otherSum) >= 0.005) steps.push({ label: '其它', v: otherSum, key: null });

  // 轴范围：覆盖 R、C 及所有累加中间点
  let run = R; const pts = [R];
  for (const s of steps) { run += s.v; pts.push(run); }
  const lo = Math.min.apply(null, pts.concat([R, C]));
  const hi = Math.max.apply(null, pts.concat([R, C]));
  const span = Math.max(0.5, hi - lo);
  const x = (v) => (v - lo) / span * 100;

  let cum = R;
  const bars = steps.map(s => {
    const a = cum, b = cum + s.v; cum = b;
    const left = Math.min(x(a), x(b));
    const width = Math.max(0.8, Math.abs(x(b) - x(a)));
    const dataKey = s.key ? ` data-key="${s.key}"` : '';
    const cls = s.v >= 0 ? 'ex-up' : 'ex-down';
    const sign = s.v >= 0 ? '+' : '';
    return `<div class="ex-row"${dataKey}><span class="lbl">${s.label}</span>`
      + `<span class="ex-track"><span class="wf ${s.v >= 0 ? 'up' : 'down'}" style="left:${left}%;width:${width}%"></span></span>`
      + `<span class="ex-val ${cls}">${sign}${s.v.toFixed(2)}</span></div>`;
  }).join('');

  const attrSum = res.attribution.reduce((s, a) => s + a.deltaContribution, 0);
  const clampNote = Math.abs(attrSum - d) > 0.5 ? '<p class="ex-note">（含分数封顶调整）</p>' : '';

  return `<div class="ex-sub">这次为什么变（较${label}）</div>`
    + `<div class="ex-head-line">基准 ${R.toFixed(1)} → 当前 ${C.toFixed(1)} <span class="${dCls}">(${dSign}${d.toFixed(1)})</span></div>`
    + bars
    + clampNote;
}

// 因子贡献 = 离中性发散条
function renderContribution(contribs) {
  if (!contribs || !contribs.length) return '';
  const max = Math.max.apply(null, contribs.map(c => Math.abs(c.contribution)).concat([0.01]));
  const rows = contribs.map(c => divergingRow(FACTOR_LABELS[c.key] || c.key, c.contribution, max, c.key)).join('');
  return `<div class="ex-sub">谁在拉扯（离中性 50 的贡献分，合计 = 分数 − 50）</div>${rows}`;
}

function divergingRow(label, value, max, key) {
  const pct = Math.min(50, Math.abs(value) / max * 50);
  const bar = value >= 0
    ? `<span class="pos" style="width:${pct}%"></span>`
    : `<span class="neg" style="width:${pct}%"></span>`;
  const cls = value >= 0 ? 'ex-up' : 'ex-down';
  const sign = value >= 0 ? '+' : '';
  return `<div class="ex-row" data-key="${key}"><span class="lbl">${label}</span>`
    + `<span class="ex-track"><span class="mid"></span>${bar}</span>`
    + `<span class="ex-val ${cls}">${sign}${value.toFixed(2)}</span></div>`;
}

// 结算余额拆解（CA 净流动性 = BoC V36636 结算余额，直接报告值非推算）
function renderSettlementBal(nl, win) {
  if (!nl || !nl.current) return '';
  const c = nl.current;
  // Headline: REAL V36636 stored value (settlement_bal); never coerce null to 0
  const settlBal = c.settlement_bal;
  const settlBalStr = settlBal != null ? Math.round(settlBal).toLocaleString() : '数据不足';
  const maxv = settlBal != null ? Math.max(Math.abs(settlBal), 1) : 1;
  const w = (x) => x != null ? Math.max(1, Math.min(100, Math.abs(x) / maxv * 100)) : 0;

  // Headline row: real V36636
  const headlineRow = `<div class="ex-bridge">`
    + `<div class="br"><span class="lbl">结算余额 (V36636)</span>`
    + (settlBal != null
      ? `<span class="barwrap"><span class="bar tot" style="width:${w(settlBal)}%"></span></span><span class="amt">${settlBalStr}</span>`
      : `<span class="barwrap"></span><span class="amt" style="color:var(--muted)">数据不足</span>`)
    + `</div></div>`;

  // Component bridge (approximate, for context)
  const ta = c.total_assets, nc = c.notes_circ, gd = c.goc_deposits, rr = c.reverse_repo;
  const ba = c.bridge_approx;
  const r = (x) => x != null ? Math.round(x).toLocaleString() : '数据不足';
  const bar = (x, cls) => x != null
    ? `<span class="barwrap"><span class="bar ${cls}" style="width:${w(x)}%"></span></span>`
    : `<span class="barwrap"></span>`;
  const bridgeRows = `<div class="ex-bridge">`
    + `<div class="br"><span class="lbl">总资产</span>${bar(ta, 'tot')}<span class="amt">${r(ta)}</span></div>`
    + `<div class="br"><span class="lbl">− 流通钞券</span>${bar(nc, 'sub')}<span class="amt">${nc != null ? '−' + Math.round(nc).toLocaleString() : '数据不足'}</span></div>`
    + `<div class="br"><span class="lbl">− GoC 存款</span>${bar(gd, 'sub')}<span class="amt">${gd != null ? '−' + Math.round(gd).toLocaleString() : '数据不足'}</span></div>`
    + `<div class="br"><span class="lbl">− 逆回购</span>${bar(rr, 'sub')}<span class="amt">${rr != null ? '−' + Math.round(rr).toLocaleString() : '数据不足'}</span></div>`
    + `<div class="br"><span class="lbl">≈ 桥接近似值</span>${bar(ba, 'tot')}<span class="amt">${r(ba)}</span></div>`
    + `</div>`;

  let note = '';
  if (nl.delta) {
    const d = nl.delta;
    const tag = (v) => {
      if (v == null) return '<span class="ex-down">数据不足</span>';
      const up = v >= 0;
      return `<span class="${up ? 'ex-up' : 'ex-down'}">${up ? '+' : ''}${Math.round(v)}</span>`;
    };
    note = `<p class="ex-note">较${EX_WINDOW_LABEL[win] || '基准'} 结算余额 ${tag(d.settlement_bal)}M CAD</p>`;
  }

  return `<div class="ex-sub">结算余额（百万 CAD，BoC V36636 B2_WEEKLY）</div>`
    + headlineRow
    + note
    + `<div class="ex-sub" style="margin-top:12px">资产负债表构成（近似桥接）</div>`
    + `<p class="ex-note" style="margin-bottom:6px">以下为四项资产负债表分项推算，与上方 V36636 实报值存在其他负债/权益偏差</p>`
    + bridgeRows;
}

// ── 汇率面板 ──────────────────────────────────────────────────────────────
function renderFx(res) {
  const card = document.getElementById('fx-card');
  const body = document.getElementById('fx-body');
  if (!card || !body) return;
  const s = res.snapshot || {};
  const signals = res.signals || {};
  const live = res.live || {};

  // USD/CAD: prefer live (real-time), fall back to snapshot stored value
  const usdcad = live.usdcad != null ? live.usdcad : (s.usdcad != null ? s.usdcad : null);
  const cadusd = usdcad != null ? 1 / usdcad : null;
  const cadcny = signals.cadcny != null ? signals.cadcny : null;

  const row = (label, value, dp) =>
    `<div class="fx-row"><span class="fx-label">${label}</span><span class="fx-val">${value != null ? Number(value).toFixed(dp) : '—'}</span></div>`;

  body.innerHTML =
    row('USD/CAD', usdcad, 4) +
    row('CAD/USD', cadusd, 4) +
    row('CAD/CNY', cadcny, 4);
  card.style.display = '';
}

// ── 额外信号面板 ──────────────────────────────────────────────────────────
function renderSignals(res) {
  const card = document.getElementById('signals-card');
  const body = document.getElementById('signals-body');
  if (!card || !body) return;
  const s = res.snapshot || {};
  const signals = res.signals || {};
  const live = res.live || {};

  // CORRA vs 政策目标利差 (bps)：snapshot already stores corra_target spread (in pct units)
  const corraDiffBps = s.corra_target != null ? (s.corra_target * 100).toFixed(1) + ' bps' : '—';

  // 美加利差：US fed funds rate − CA target rate (bps)
  const us_rate = signals.us_rate;
  const target = signals.target;
  const usca_diff = (us_rate != null && target != null)
    ? ((us_rate - target) * 100).toFixed(1) + ' bps'
    : '—';

  // WTI：prefer live (real-time fetch), fall back to snapshot stored value
  const wti = live.wti != null ? live.wti : (s.wti != null ? s.wti : null);
  const wtiStr = wti != null ? '$' + Number(wti).toFixed(2) : '—';

  const row = (label, value) =>
    `<div class="sig-row"><span class="sig-label">${label}</span><span class="sig-val">${value}</span></div>`;

  body.innerHTML =
    row('CORRA − 政策目标利差', corraDiffBps) +
    row('美加利差 (US − CA 政策利率)', usca_diff) +
    row('WTI 原油', wtiStr);
  card.style.display = '';
}

// ── 回测稳健性面板 ────────────────────────────────────────────────────────
async function fetchRobust() {
  const card = document.getElementById('robust-card');
  const body = document.getElementById('robust-body');
  if (!card || !body) return;
  try {
    const r = await fetch('/api/robustness').then(x => x.json());
    if (!r || !r.ic) { body.innerHTML = '<p class="rb-note">数据不足</p>'; card.style.display = ''; return; }
    body.innerHTML = renderRobust(r);
    card.style.display = '';
  } catch (e) {
    body.innerHTML = '<p class="rb-note">稳健性加载失败，稍后重试</p>';
    card.style.display = '';
  }
}

function rbPct(x, d = 1) { return (x * 100).toFixed(d) + '%'; }
function rbIcCls(x) { return x >= 0 ? 'rb-pos' : 'rb-neg'; }
function rbEsc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function renderRobust(r) {
  const ic = r.ic, st = r.strategy, b = ic.bootstrap, sh = st.sharpe;
  const icBlock = `<div class="rb-sub">IC 稳健性（${r.horizon_weeks} 周）</div>`
    + `<div class="rb-stat"><span class="k">IC 点估</span><span class="v ${rbIcCls(b.point)}">${b.point.toFixed(3)} <span class="rb-ci">95%CI [${b.ci_lo.toFixed(3)}, ${b.ci_hi.toFixed(3)}] · p(IC≤0)=${b.p_value.toFixed(2)}</span></span></div>`
    + `<div class="rb-stat"><span class="k">重叠样本</span><span class="v">n=${ic.overlapping.n} · IC=${ic.overlapping.ic_spearman.toFixed(3)}</span></div>`
    + `<div class="rb-stat"><span class="k">非重叠样本（独立）</span><span class="v">n=${ic.non_overlapping.n} · IC=${ic.non_overlapping.ic_spearman.toFixed(3)}</span></div>`;

  const stratBlock = `<div class="rb-sub">策略稳健性（score&gt;55 多/空）</div>`
    + `<div class="rb-stat"><span class="k">年化 vs 买入持有</span><span class="v">${rbPct(st.ann_return)} vs ${rbPct(st.buyhold_ann)}</span></div>`
    + `<div class="rb-stat"><span class="k">Sharpe</span><span class="v ${rbIcCls(sh.point)}">${sh.point.toFixed(2)} <span class="rb-ci">95%CI [${sh.ci_lo.toFixed(2)}, ${sh.ci_hi.toFixed(2)}] · p(≤0)=${sh.p_value.toFixed(2)}</span></span></div>`
    + `<div class="rb-stat"><span class="k">最大回撤</span><span class="v rb-neg">−${rbPct(st.max_drawdown)}</span></div>`
    + `<div class="rb-stat"><span class="k">换手</span><span class="v">${rbPct(st.turnover_per_period)}/期 · ${st.turnover_annual.toFixed(1)}/年</span></div>`;

  const regimeBlock = `<div class="rb-sub">分 regime IC</div>`
    + Object.entries(r.regimes).map(([axis, buckets]) => {
      const rows = Object.entries(buckets).map(([k, v]) =>
        `<tr><td>${REGIME_BUCKET_LABEL[k] || rbEsc(k)}</td><td class="num">${v.n}</td><td class="num ${rbIcCls(v.ic_spearman)}">${v.ic_spearman.toFixed(3)}</td></tr>`).join('');
      return `<table class="rb-table"><thead><tr><th>${REGIME_AXIS_LABEL[axis] || rbEsc(axis)}</th><th class="num">n</th><th class="num">IC</th></tr></thead><tbody>${rows}</tbody></table>`;
    }).join('');

  const concl = `<div class="rb-concl">${robustConclusion(r)}</div>`;
  const notes = (r.caveats || []).map(c => `<p class="rb-note">· ${rbEsc(c)}</p>`).join('');
  return icBlock + stratBlock + regimeBlock + concl + notes;
}

function robustConclusion(r) {
  const b = r.ic.bootstrap, no = r.ic.non_overlapping;
  const edge = b.ci_lo > 0 ? 'IC 稳健为正' : (b.point > 0 ? 'IC 为正但 95%CI 跨 0（弱）' : 'IC 不显著');
  const bs = r.regimes.balance_sheet || {};
  const best = Object.entries(bs).sort((a, x) => x[1].ic_spearman - a[1].ic_spearman)[0];
  const bestTxt = best ? `资产负债表 ${REGIME_BUCKET_LABEL[best[0]] || best[0]} 期最强（IC=${best[1].ic_spearman.toFixed(2)}）` : '';
  return `${edge}；非重叠独立样本仅 n=${no.n}（IC=${no.ic_spearman.toFixed(3)}）——重叠版显著性被高估。${bestTxt}。定位：弱信号宏观风控仪表盘，非择时工具。`;
}

main().catch(e => { showBanner('⚠️ 加载失败，稍后重试（' + (e && e.message ? e.message : '网络错误') + '）'); });

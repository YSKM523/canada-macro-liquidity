#!/usr/bin/env python3
"""
backfill_local.py
Fetches missing FRED + Yahoo series, then computes all weekly snapshots,
writing directly into the local Miniflare D1 SQLite database.

Run: python3 scripts/backfill_local.py
"""
import sqlite3
import json
import math
import urllib.request
import urllib.parse
import csv
import io
import sys
from datetime import datetime

DB_PATH = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject/daf6b0c6bb38d170e0068ae73814ffa0a62c0851827e36f5286a322608e797fc.sqlite"
START_DATE = "2017-01-01"

# Series IDs
SERIES = {
    "TOTAL_ASSETS": "V36610",
    "GOC_DEPOSITS": "V36628",
    "SETTLEMENT":   "V36636",
    "REVERSE_REPO": "V1203435186",
    "NOTES_CIRC":   "V36625",
    "CORRA":        "AVG.INTWO",
    "TARGET":       "V122514",
    "GOC10":        "BD.CDN.10YR.DQ.YLD",
    "GOC2":         "BD.CDN.2YR.DQ.YLD",
    "USDCAD":       "FXUSDCAD",
    "CADCNY":       "FXCADCNY",
    "US_RATE":      "DFEDTARU",
    "HY_OAS":       "BAMLH0A0HYM2",
    "WTI":          "WTI",
    "TSX":          "^GSPTSE",
}

WEIGHTS = {
    "netliqTrend": 0.30, "reserveAdequacy": 0.10, "impulse": 0.08, "curve": 0.12,
    "dollar": 0.12, "oil": 0.08, "funding": 0.08, "rates": 0.06, "credit": 0.06,
}
FACTOR_KEYS = ["netliqTrend", "reserveAdequacy", "impulse", "curve", "dollar", "oil", "funding", "rates", "credit"]
NETLIQ_TREND_WEEKS = 13
ASSETS_EPSILON = 500
CA_QT_END_DATE = "2025-03-05"

# ── Fetch helpers ──────────────────────────────────────────────────────────────

def http_get(url, headers=None):
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode("utf-8")

def fetch_fred(series_id, from_date):
    url = f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={series_id}&cosd={from_date}"
    print(f"  FRED {series_id} from {from_date}...")
    text = http_get(url)
    reader = csv.reader(io.StringIO(text))
    rows = []
    for i, line in enumerate(reader):
        if i == 0 or len(line) < 2:
            continue
        date_str, val_str = line[0].strip(), line[1].strip()
        try:
            val = float(val_str)
            if math.isfinite(val):
                rows.append((date_str, val))
        except ValueError:
            pass
    print(f"    -> {len(rows)} rows")
    return rows

def fetch_yahoo(symbol, range_str="10y"):
    encoded = urllib.parse.quote(symbol)
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{encoded}?interval=1d&range={range_str}"
    print(f"  Yahoo {symbol}...")
    text = http_get(url, headers={"User-Agent": "Mozilla/5.0"})
    data = json.loads(text)
    res = (data.get("chart", {}).get("result") or [None])[0]
    if not res:
        raise ValueError(f"No data for {symbol}")
    ts = res.get("timestamp", [])
    close = (res.get("indicators", {}).get("quote") or [{}])[0].get("close", [])
    rows = []
    for i in range(min(len(ts), len(close))):
        if isinstance(close[i], (int, float)) and math.isfinite(close[i]):
            date_str = datetime.utcfromtimestamp(ts[i]).strftime("%Y-%m-%d")
            rows.append((date_str, close[i]))
    print(f"    -> {len(rows)} rows")
    return rows

# ── Metrics (port of src/metrics.ts) ──────────────────────────────────────────

def as_of(series, date):
    """Last value on or before date. series = sorted list of (date, value)."""
    v = None
    for d, val in series:
        if d <= date:
            v = val
        else:
            break
    return v

def stats(vals):
    n = len(vals)
    if n == 0:
        return (0.0, 1.0)
    m = sum(vals) / n
    variance = sum((x - m) ** 2 for x in vals) / max(1, n - 1)
    sd = math.sqrt(variance) if variance > 0 else 1.0
    return (m, sd)

def z_score(series, date, sign):
    vals = [val for d, val in series if d <= date]
    if not vals:
        return 50.0
    m, sd = stats(vals)
    z = (vals[-1] - m) / sd
    return max(0.0, min(100.0, 50.0 + sign * z * 20.0))

def score_netliq_trend(sb, date, weeks=NETLIQ_TREND_WEEKS):
    v = [val for d, val in sb if d <= date]
    if len(v) <= weeks:
        return 50.0
    chg = [v[i] - v[i - weeks] for i in range(weeks, len(v))]
    if not chg:
        return 50.0
    m, sd = stats(chg)
    z = (chg[-1] - m) / sd
    return max(0.0, min(100.0, 50.0 + z * 20.0))

def score_curve(goc10, goc2, date):
    a = as_of(goc10, date)
    b = as_of(goc2, date)
    if a is None or b is None:
        return 50.0
    slope = a - b
    return max(0.0, min(100.0, 50.0 + slope * 20.0))

def score_funding(corra, target, date):
    a = as_of(corra, date)
    b = as_of(target, date)
    if a is None or b is None:
        return 50.0
    spread = a - b
    return max(0.0, min(100.0, 50.0 - spread * 200.0))

def assets_direction(obs, date, epsilon_weeks=4):
    filtered = [(d, v) for d, v in obs if d <= date]
    if len(filtered) < epsilon_weeks + 1:
        return "FLAT"
    latest = filtered[-1][1]
    prev = filtered[-1 - epsilon_weeks][1]
    delta = latest - prev
    if delta > ASSETS_EPSILON:
        return "EXPANDING"
    if delta < -ASSETS_EPSILON:
        return "CONTRACTING"
    return "FLAT"

def settlement_direction(score):
    if score > 52:
        return "UP"
    if score < 48:
        return "DOWN"
    return "FLAT"

def verdict_from_score(score, prev=None):
    if score > 55:
        return "BULLISH"
    if score < 45:
        return "BEARISH"
    return prev or "NEUTRAL"

IMPULSE_CN = {"EXPANDING": "扩表", "CONTRACTING": "缩表", "FLAT": "横住"}
DIR_CN = {"UP": "在升", "DOWN": "在收", "FLAT": "走平"}
VERDICT_CN = {"BULLISH": "偏多", "BEARISH": "偏空", "NEUTRAL": "中性"}

def build_reason(impulse, netliq_dir, verdict):
    divergence = ""
    if impulse == "CONTRACTING" and netliq_dir == "UP":
        divergence = "(缩表却放水,留意背离)"
    elif impulse == "EXPANDING" and netliq_dir == "DOWN":
        divergence = "(扩表却收水,留意背离)"
    return f"BoC {IMPULSE_CN[impulse]}、结算余额{DIR_CN[netliq_dir]} → 环境{VERDICT_CN[verdict]}{divergence}"

def has_coverage(obs, date):
    return any(d <= date for d, _ in obs)

def compute_snapshot(m, date, prev=None):
    sb_series     = m.get(SERIES["SETTLEMENT"], [])
    assets_series = m.get(SERIES["TOTAL_ASSETS"], [])
    goc_dep       = m.get(SERIES["GOC_DEPOSITS"], [])
    rr_series     = m.get(SERIES["REVERSE_REPO"], [])
    notes         = m.get(SERIES["NOTES_CIRC"], [])
    corra         = m.get(SERIES["CORRA"], [])
    target        = m.get(SERIES["TARGET"], [])
    goc10         = m.get(SERIES["GOC10"], [])
    goc2          = m.get(SERIES["GOC2"], [])
    usdcad        = m.get(SERIES["USDCAD"], [])
    wti           = m.get(SERIES["WTI"], [])
    hy_oas        = m.get(SERIES["HY_OAS"], [])

    total_assets   = as_of(assets_series, date)
    goc_deposits   = as_of(goc_dep, date)
    reverse_repo   = as_of(rr_series, date)
    notes_circ     = as_of(notes, date)
    settlement_bal = as_of(sb_series, date)
    netliq         = settlement_bal

    corra_v = as_of(corra, date)
    target_v = as_of(target, date)
    corra_target = (corra_v - target_v) if (corra_v is not None and target_v is not None) else None

    goc10_v  = as_of(goc10, date)
    goc2_v   = as_of(goc2, date)
    usdcad_v = as_of(usdcad, date)
    wti_v    = as_of(wti, date)
    hy_oas_v = as_of(hy_oas, date)

    netliq_trend_score     = score_netliq_trend(sb_series, date)
    reserve_adequacy_score = z_score(sb_series, date, 1)
    impulse_score          = z_score(assets_series, date, 1)
    curve_score            = score_curve(goc10, goc2, date)
    dollar_score           = z_score(usdcad, date, -1)
    oil_score              = z_score(wti, date, 1)
    funding_score          = score_funding(corra, target, date)
    rates_score            = z_score(goc10, date, -1)
    credit_score           = z_score(hy_oas, date, -1)

    factors = {
        "netliqTrend":     netliq_trend_score,
        "reserveAdequacy": reserve_adequacy_score,
        "impulse":         impulse_score,
        "curve":           curve_score,
        "dollar":          dollar_score,
        "oil":             oil_score,
        "funding":         funding_score,
        "rates":           rates_score,
        "credit":          credit_score,
    }

    factor_series_map = {
        "netliqTrend":     [sb_series],
        "reserveAdequacy": [sb_series],
        "impulse":         [assets_series],
        "curve":           [goc10, goc2],
        "dollar":          [usdcad],
        "oil":             [wti],
        "funding":         [corra, target],
        "rates":           [goc10],
        "credit":          [hy_oas],
    }

    covered = sum(
        1 for k in FACTOR_KEYS if all(has_coverage(s, date) for s in factor_series_map[k])
    )
    coverage = covered / len(FACTOR_KEYS)

    score = sum(factors[k] * WEIGHTS[k] for k in FACTOR_KEYS)

    verdict        = verdict_from_score(score, prev)
    qe_qt_regime   = assets_direction(assets_series, date)
    netliq_trend   = netliq_trend_score
    netliq_dir     = settlement_direction(netliq_trend_score)
    reason         = build_reason(qe_qt_regime, netliq_dir, verdict)

    p0 = factors["rates"] >= 50 and factors["funding"] >= 50 and factors["credit"] >= 50
    p1 = factors["netliqTrend"] >= 50 or factors["impulse"] >= 50
    p2 = factors["dollar"] >= 50
    p3 = factors["oil"] >= 50

    return {
        "date": date,
        "total_assets": total_assets,
        "goc_deposits": goc_deposits,
        "reverse_repo": reverse_repo,
        "notes_circ": notes_circ,
        "settlement_bal": settlement_bal,
        "netliq": netliq,
        "netliq_trend": netliq_trend,
        "corra_target": corra_target,
        "goc10": goc10_v,
        "goc2": goc2_v,
        "usdcad": usdcad_v,
        "wti": wti_v,
        "hy_oas": hy_oas_v,
        "qe_qt_regime": qe_qt_regime,
        "netliq_dir": netliq_dir,
        "verdict": verdict,
        "score": score,
        "factors": factors,
        "coverage": coverage,
        "p0": p0,
        "p1": p1,
        "p2": p2,
        "p3": p3,
        "reason": reason,
    }

# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    db = sqlite3.connect(DB_PATH)
    db.execute("PRAGMA wal_checkpoint(FULL)")

    existing = set(r[0] for r in db.execute("SELECT DISTINCT series_id FROM observation"))
    print(f"Existing series ({len(existing)}): {', '.join(sorted(existing))}")

    # Fetch missing FRED series
    for series_id, from_date in [("BAMLH0A0HYM2", START_DATE), ("DFEDTARU", START_DATE)]:
        if series_id not in existing:
            rows = fetch_fred(series_id, from_date)
            db.executemany(
                "INSERT OR REPLACE INTO observation (series_id, date, value) VALUES (?, ?, ?)",
                [(series_id, d, v) for d, v in rows]
            )
            db.commit()
            print(f"  Stored {len(rows)} obs for {series_id}")
        else:
            n = db.execute("SELECT count(*) FROM observation WHERE series_id = ?", (series_id,)).fetchone()[0]
            print(f"  {series_id} already present ({n} rows)")

    # Fetch missing Yahoo series
    for symbol, series_id in [("^GSPTSE", "^GSPTSE"), ("CL=F", "WTI")]:
        if series_id not in existing:
            rows = fetch_yahoo(symbol)
            db.executemany(
                "INSERT OR REPLACE INTO observation (series_id, date, value) VALUES (?, ?, ?)",
                [(series_id, d, v) for d, v in rows]
            )
            db.commit()
            print(f"  Stored {len(rows)} obs for {series_id}")
        else:
            n = db.execute("SELECT count(*) FROM observation WHERE series_id = ?", (series_id,)).fetchone()[0]
            print(f"  {series_id} already present ({n} rows)")

    # Load all series into memory
    print("\nLoading all series into memory...")
    m = {}
    for key, sid in SERIES.items():
        rows = db.execute(
            "SELECT date, value FROM observation WHERE series_id = ? ORDER BY date", (sid,)
        ).fetchall()
        m[sid] = rows
        print(f"  {key} ({sid}): {len(rows)} obs")

    # Get total_assets dates (weekly cadence from BoC)
    total_assets_series = m[SERIES["TOTAL_ASSETS"]]
    tsx_series = m[SERIES["TSX"]]
    dates = [d for d, _ in total_assets_series]
    print(f"\nComputing {len(dates)} snapshots ({dates[0]} → {dates[-1]})...")

    # Clear existing snapshots
    db.execute("DELETE FROM daily_snapshot")
    db.commit()

    prev = None
    count = 0
    for date in dates:
        if as_of(total_assets_series, date) is None:
            continue
        snap = compute_snapshot(m, date, prev)
        tsx = as_of(tsx_series, date)
        db.execute("""
            INSERT OR REPLACE INTO daily_snapshot
              (date, total_assets, goc_deposits, reverse_repo, notes_circ,
               settlement_bal, netliq, netliq_trend, corra_target, goc10, goc2,
               usdcad, wti, hy_oas, vix_eod, qe_qt_regime, netliq_dir, verdict, score,
               p0, p1, p2, p3, tsx, reason, factors_json, coverage)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """, (
            snap["date"], snap["total_assets"], snap["goc_deposits"], snap["reverse_repo"],
            snap["notes_circ"], snap["settlement_bal"], snap["netliq"], snap["netliq_trend"],
            snap["corra_target"], snap["goc10"], snap["goc2"], snap["usdcad"], snap["wti"],
            snap["hy_oas"], None,  # vix_eod not available in CA
            snap["qe_qt_regime"], snap["netliq_dir"], snap["verdict"], snap["score"],
            1 if snap["p0"] else 0, 1 if snap["p1"] else 0,
            1 if snap["p2"] else 0, 1 if snap["p3"] else 0,
            tsx, snap["reason"], json.dumps(snap["factors"]), snap["coverage"]
        ))
        prev = snap["verdict"]
        count += 1

    db.commit()

    # Update meta
    now = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S.000Z")
    total_obs = db.execute("SELECT count(*) FROM observation").fetchone()[0]
    for key, val in [
        ("last_ingest_at", now),
        ("last_status", "ok"),
        ("last_error", ""),
        ("last_updated", str(total_obs)),
        ("last_snapshots", str(count)),
    ]:
        db.execute("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", (key, val))
    db.commit()

    db.execute("PRAGMA wal_checkpoint(FULL)")
    db.close()

    print(f"\nDone! {count} snapshots written.")
    print(f"Date range: {dates[0]} → {dates[-1]}")

    # Print sample last snapshot coverage
    return count

if __name__ == "__main__":
    n = main()
    sys.exit(0 if n > 0 else 1)

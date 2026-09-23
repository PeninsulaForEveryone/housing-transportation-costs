"""Non-geographic parameters: vehicle costs, fuel price, transit fares, parking
references, and tax tables. Every value is either parsed from a fetched document
or, where parsing a table is brittle (tax schedules), written here and then
verified to appear verbatim in the fetched document. A mismatch stops the build.
"""
from __future__ import annotations

import html as htmllib
import json
import re
from functools import lru_cache

import pandas as pd
import pdfplumber

from .common import RAW, DataError, assumptions
from .housing import pmms_latest


@lru_cache
def pdf_text(name: str) -> str:
    with pdfplumber.open(RAW / name) as pdf:
        return "\n".join(p.extract_text() or "" for p in pdf.pages)


@lru_cache
def html_text(name: str) -> str:
    t = (RAW / name).read_text(encoding="utf-8", errors="ignore")
    t = re.sub(r"<script.*?</script>|<style.*?</style>", " ", t, flags=re.S)
    t = htmllib.unescape(re.sub(r"<[^>]+>", " ", t))
    return re.sub(r"\s+", " ", t)


def _find(pattern: str, text: str, what: str, flags=0) -> re.Match:
    m = re.search(pattern, text, flags)
    if not m:
        raise DataError(f"Could not parse {what} (pattern {pattern!r})")
    return m


def _money(s: str) -> float:
    return float(s.replace(",", "").replace("$", ""))


def _require(text: str, needles: list[str], doc: str) -> None:
    flat = re.sub(r"\s+", " ", text)
    missing = [n for n in needles if n not in flat]
    if missing:
        raise DataError(f"{doc}: expected values not found in source text: {missing}")


# ---------------------------------------------------------------- vehicles

def aaa() -> dict:
    t = pdf_text("UPDATE-AAA-Fact-Sheet-Your-Driving-Cost-9.2025-1.pdf")
    d = {
        "depreciation": _money(_find(r"\$([\d,]+) loss in", t, "AAA depreciation").group(1)),
        "finance": _money(_find(r"Finance \$([\d,]+)/year", t, "AAA finance").group(1)),
        "insurance": _money(_find(r"Insurance \$([\d,]+)/year", t, "AAA insurance").group(1)),
        "license_registration_taxes": _money(_find(r"\$([\d,]+)/year\s*& Taxes", t, "AAA license").group(1)),
        "fuel_per_mile": float(_find(r"Fuel (\d+(?:\.\d+)?)¢/mile", t, "AAA fuel").group(1)) / 100,
        "maintenance_per_mile": float(_find(r"Maintenance, Repair\s*([\d.]+)¢/mile", t, "AAA maintenance").group(1)) / 100,
        "gas_price_basis": float(_find(r"averaged \$([\d.]+)/gallon", t, "AAA gas price").group(1)),
        "total_at_15k": _money(_find(r"cost to own and operate a new car in 2025\s*is \$([\d,]+)", t, "AAA total").group(1)),
    }
    fixed = d["depreciation"] + d["finance"] + d["insurance"] + d["license_registration_taxes"]
    implied = fixed + 15_000 * (d["fuel_per_mile"] + d["maintenance_per_mile"])
    if abs(implied - d["total_at_15k"]) > 10:
        raise DataError(f"AAA components sum to {implied:.0f}, sheet total is {d['total_at_15k']:.0f}")
    return d


def ca_gas() -> dict:
    x = pd.read_excel(RAW / "EMM_EPMR_PTE_SCA_DPGw.xls", sheet_name="Data 1", header=2)
    x = x.dropna()
    x.columns = ["date", "price"]
    last52 = x.tail(52)
    return {
        "avg_52wk": round(float(last52.price.mean()), 3),
        "latest": float(x.price.iloc[-1]),
        "from": pd.Timestamp(last52.date.iloc[0]).date().isoformat(),
        "to": pd.Timestamp(last52.date.iloc[-1]).date().isoformat(),
    }


# ---------------------------------------------------------------- transit

def caltrain() -> dict:
    t = html_text("caltrain_fares.html")
    m = _find(r"Monthly Pass.{0,400}?Adult Clipper Card((?:\s*\$[\d.]+){6})", t, "Caltrain monthly pass", re.S)
    prices = [_money(p) for p in re.findall(r"\$[\d.]+", m.group(1))]
    note = _find(r"(Customers with a two-zone or greater Caltrain Monthly Pass[^.]*\.)", t, "Caltrain pass transfer note").group(1)
    return {"monthly_by_zones": {str(i + 1): p for i, p in enumerate(prices)}, "samtrans_note": note}


def samtrans() -> dict:
    t = html_text("samtrans_fares.html")
    _find(r"Day Pass \(Cash or Mobile\)\s*Monthly Pass \(Clipper\)", t, "SamTrans fare table header")
    m = _find(r"Adult \(Age 19 through 64\)\s*\$([\d.]+)\s*\$([\d.]+)\s*\$([\d.]+)\s*\$([\d.]+)", t, "SamTrans adult fares")
    return {"monthly_adult": _money(m.group(4)), "single_clipper": _money(m.group(2))}


# ---------------------------------------------------------------- parking references

def parking_refs() -> dict:
    oa = json.load(open(RAW / "gabbe_pierce_openalex.json"))
    inv = oa.get("abstract_inverted_index") or {}
    abstract = " ".join(w for _, w in sorted((p, w) for w, ps in inv.items() for p in ps))
    _require(abstract, ["$1,700 per year", "17%"], "Gabbe & Pierce abstract")
    _require(html_text("wgi_2026.html"), ["$43,000 per space"], "WGI 2026 press release")
    civ = html_text("ca_civ_1947_1.html")
    _require(civ, ["16 or more residential units", "Alameda", "Santa Clara"], "Civil Code 1947.1")
    if "San Mateo" in civ:
        raise DataError("Civil Code 1947.1 now mentions San Mateo; update the methodology text")
    a = assumptions()["parking"]
    if a["bundled_garage_annual"]["value"] != 1700 or a["construction_cost_per_space"]["value"] != 43000:
        print("  note: parking reference values in assumptions.json differ from the cited sources (user override)")
    return {"gabbe_pierce_abstract": abstract}


# ---------------------------------------------------------------- taxes

FEDERAL_2026 = {
    "standard_deduction": {"mfj": 32200, "hoh": 24150, "single": 16100},
    "brackets": {
        "mfj": [[0, 0.10], [24800, 0.12], [100800, 0.22], [211400, 0.24], [403550, 0.32], [512450, 0.35], [768700, 0.37]],
        "hoh": [[0, 0.10], [17700, 0.12], [67450, 0.22], [105700, 0.24], [201750, 0.32], [256200, 0.35], [640600, 0.37]],
        "single": [[0, 0.10], [12400, 0.12], [50400, 0.22], [105700, 0.24], [201775, 0.32], [256225, 0.35], [640600, 0.37]],
    },
    "ctc_per_child": 2200,
    "ctc_refundable_max": 1700,
    # Statutory, not indexed. Excess over threshold is rounded up to a multiple of $1,000, times 5%.
    "ctc_phaseout_start": {"mfj": 400000, "hoh": 200000, "single": 200000},
    "ctc_phaseout_rate": 0.05,
    "actc_earned_income_floor": 2500,
    "actc_rate": 0.15,
}

FICA_2026 = {
    "ss_rate": 0.062, "ss_wage_base": 184500, "medicare_rate": 0.0145,
    "addl_medicare_rate": 0.009,
    "addl_medicare_threshold": {"mfj": 250000, "hoh": 200000, "single": 200000},
}

# 2025 is the latest published CA schedule; EDD's 2026 withholding tables use identical thresholds.
CA = {
    "tax_year": 2025,
    "standard_deduction": {"mfj": 11412, "hoh": 11412, "single": 5706},
    "brackets": {
        "single": [[0, .01], [11079, .02], [26264, .04], [41452, .06], [57542, .08], [72724, .093], [371479, .103], [445771, .113], [742953, .123]],
        "mfj": [[0, .01], [22158, .02], [52528, .04], [82904, .06], [115084, .08], [145448, .093], [742958, .103], [891542, .113], [1485906, .123]],
        "hoh": [[0, .01], [22173, .02], [52530, .04], [67716, .06], [83805, .08], [98990, .093], [505208, .103], [606251, .113], [1010417, .123]],
    },
    "personal_credit": 153, "dependent_credit": 475,
    "personal_credit_count": {"mfj": 2, "hoh": 1, "single": 1},
    "credit_phaseout_start": {"single": 252203, "mfj": 504411, "hoh": 378310},
    "credit_phaseout_per_2500": 6,
    "bhst_threshold": 1000000, "bhst_rate": 0.01,
    "sdi_rate": 0.013, "sdi_year": 2026,
}


def _fmt(n) -> str:
    return f"${n:,}"


def taxes() -> dict:
    rp = pdf_text("rp-25-32.pdf")
    need = [_fmt(v) for v in FEDERAL_2026["standard_deduction"].values()]
    for rows in FEDERAL_2026["brackets"].values():
        need += [_fmt(t) for t, _ in rows[1:]]
    need += [f"{round(r * 100)}%" for r in {r for rows in FEDERAL_2026["brackets"].values() for _, r in rows}]
    need += ["maximum amount of the credit allowed under § 24(a) is $2,200", "refundable is $1,700"]
    _require(rp, need, "IRS Rev. Proc. 2025-32")

    _require(pdf_text("f1040s8.pdf"), ["Married filing jointly—$400,000", "All other filing statuses—$200,000",
                                       "next multiple of $1,000", "Multiply line 10 by 5% (0.05)"], "IRS Schedule 8812")
    _require(pdf_text("i1040s8.pdf"), ["Subtract $2,500 from the amount on line 3", "by 15% (0.15)"],
             "IRS Schedule 8812 instructions")

    p15 = pdf_text("p15.pdf")
    _require(p15, ["base limit is $184,500", "6.2% each", "1.45% each", "Publication 15 (2026)"], "IRS Pub 15")
    amt = html_text("irs_amt_qa.html")
    _require(amt, ["Married filing jointly $250,000", "Single $200,000", "Head of household (with qualifying person) $200,000", "0.9 percent"],
             "IRS Additional Medicare Tax Q&A")

    ftb = pdf_text("2025-540-tax-rate-schedules.pdf")
    need = []
    for rows in CA["brackets"].values():
        need += [f"{t:,}" for t, _ in rows[1:]]
    need += [f"{r * 100:.2f}%" for r in {r for rows in CA["brackets"].values() for _, r in rows}]
    _require(ftb, need + ["2025 California Tax Rate Schedules"], "FTB 2025 tax rate schedules")
    edd = pdf_text("26methb.pdf")
    _require(edd, ["$5,706", "$11,412", "$11,079", "$22,158", "$22,173", "$1,485,906", "Withholding Schedules for 2026"],
             "EDD 2026 Method B")
    bk = pdf_text("2025-540-booklet.pdf")
    _require(bk, ["X $153 =", "X $475 =", "$252,203", "$504,411", "$378,310", "Multiply line d by $6",
                  "Behavioral Health Services Tax", "$(1,000,000)"], "FTB 2025 Form 540 booklet")
    _require(html_text("edd_rates.html"), ["SDI withholding rate for 2026 is 1.3 percent", "all wages are subject to SDI"],
             "EDD rates page")
    return {"federal": FEDERAL_2026, "fica": FICA_2026, "ca": CA}


def build_params() -> dict:
    parking_refs()
    return {
        "aaa": aaa(),
        "ca_gas": ca_gas(),
        "pmms": pmms_latest(),
        "transit": {"caltrain": caltrain(), "samtrans": samtrans()},
        "taxes": taxes(),
    }

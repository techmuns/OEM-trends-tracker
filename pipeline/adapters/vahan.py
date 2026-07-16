"""VAHAN adapter — live scrape of the public vehicle-registrations dashboard.

VAHAN reports REGISTRATIONS, a different measurement basis from SIAM's wholesale
dispatches (see dictionaries/metrics.yaml). Rows carry source='VAHAN'; the
one-source-per-table rule keeps them from ever being mixed with SIAM figures in a single
table or share calculation.

Mechanics: the live dashboard (``vahan.parivahan.gov.in/vahan4dashboard/...``) is a
JSF/PrimeFaces app with no login step. It exposes a 2-axis pivot (Y x X) behind dropdowns;
this module replays the same AJAX calls the browser makes when you click through them —
GET the page for a ViewState token, then POST state/axis/year selections and a Refresh,
parsing the returned HTML table out of the AJAX response's CDATA. No browser required.
Unlike some reference implementations of this technique, TLS verification is never
disabled here.

V1 scope (deliberately minimal): Y-axis="Vehicle Category", X-axis="Month Wise",
all-India, no maker/fuel breakdown yet. This is the first slice because it needs no
company-name dictionary, so the only unresolved-mapping risk is the (small) category
axis. Maker-level and Fuel/EV-ICE breakdowns are a follow-up once this slice is confirmed
reachable from GitHub Actions and the real category labels are known — VAHAN's own live
labels are NOT guessed (`vahan_categories.yaml` starts empty), matching companies.yaml's
"no guessed names" rule: an unresolved category hard-fails the ingest rather than silently
passing through or being invented.
"""

from __future__ import annotations

import argparse
import re
import sys
import time
from dataclasses import dataclass, field
from datetime import UTC, date, datetime

import httpx
from bs4 import BeautifulSoup

from pipeline.adapters.base import RawPayload, SourceAdapter, ValidationResult
from pipeline.aggregate.periods import fiscal_quarter_of, fiscal_year_of
from pipeline.contract.constants import INDUSTRY_TOTAL_CANONICAL
from pipeline.contract.models import ContractRow
from pipeline.dictionaries.loader import UnknownVahanCategoryError, load_vahan_category_resolver

VAHAN_URL = "https://vahan.parivahan.gov.in/vahan4dashboard/vahan/view/reportview.xhtml"
FORM_ID = "masterLayout_formlogin"
ROWS_PER_PAGE = 25

_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

_AJAX_HEADERS = {
    "User-Agent": _UA,
    "Accept": "application/xml, text/xml, */*; q=0.01",
    "Accept-Language": "en-US,en;q=0.9",
    "Origin": "https://vahan.parivahan.gov.in",
    "Referer": VAHAN_URL,
    "Faces-Request": "partial/ajax",
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    "X-Requested-With": "XMLHttpRequest",
}

_KNOWN_INPUT_NAMES = {
    "selectedRto_input",
    "yaxisVar_input",
    "xaxisVar_input",
    "selectedYearType_input",
    "selectedYear_input",
}

_REFRESH_IDS_FALLBACK = ["j_idt66", "j_idt71", "j_idt78", "j_idt65", "j_idt70", "j_idt77"]

_MONTH_NAMES = {
    "jan": 1,
    "january": 1,
    "feb": 2,
    "february": 2,
    "mar": 3,
    "march": 3,
    "apr": 4,
    "april": 4,
    "may": 5,
    "jun": 6,
    "june": 6,
    "jul": 7,
    "july": 7,
    "aug": 8,
    "august": 8,
    "sep": 9,
    "sept": 9,
    "september": 9,
    "oct": 10,
    "october": 10,
    "nov": 11,
    "november": 11,
    "dec": 12,
    "december": 12,
}
_NON_MONTH_COLUMNS = {"s no", "total", "vehicle category"}


class VahanScrapeError(RuntimeError):
    """The VAHAN dashboard could not be reached or parsed as expected."""


# ── ViewState helpers ────────────────────────────────────────────────────────────────


def extract_viewstate(html: str) -> str:
    for pat in [
        r'name="javax\.faces\.ViewState"[^>]*value="([^"]+)"',
        r'value="([^"]+)"[^>]*name="javax\.faces\.ViewState"',
    ]:
        m = re.search(pat, html)
        if m:
            return m.group(1)
    raise VahanScrapeError("javax.faces.ViewState not found in page HTML")


def extract_viewstate_xml(xml: str) -> str:
    m = re.search(r'<update\s+id="javax\.faces\.ViewState"><!\[CDATA\[(.*?)\]\]></update>', xml)
    return m.group(1) if m else ""


# ── Option discovery ─────────────────────────────────────────────────────────────────


def parse_options(soup: BeautifulSoup, select_name: str) -> dict[str, str]:
    """Return {value: display_label} for all options in <select name=select_name>."""
    sel = soup.find("select", {"name": select_name})
    if not sel:
        return {}
    return {
        o.get("value", ""): o.get_text(strip=True)
        for o in sel.find_all("option")
        if o.get("value", "")
    }


def parse_options_from_xml(xml: str, select_name: str) -> dict[str, str]:
    """Extract select options from CDATA sections in a PrimeFaces AJAX response."""
    for cd in re.findall(r"<!\[CDATA\[(.*?)\]\]>", xml, re.DOTALL):
        opts = parse_options(BeautifulSoup(cd, "html.parser"), select_name)
        if opts:
            return opts
    return {}


def find_state_input_name(soup: BeautifulSoup) -> str | None:
    """Locate the hidden <select> name for the state dropdown.

    Discriminator: the state select always has value="-1" (All States) followed by 2-char
    alpha-only uppercase state codes. The display-type select (T/L/C/A) has no "-1" option.
    """
    for sel in soup.find_all("select"):
        name = sel.get("name", "")
        if not name or name in _KNOWN_INPUT_NAMES:
            continue
        all_vals = [o.get("value", "") for o in sel.find_all("option") if o.get("value", "")]
        if "-1" not in all_vals:
            continue
        state_codes = [v for v in all_vals if v != "-1"]
        if state_codes and all(v.isalpha() and v.isupper() for v in state_codes[:10]):
            return name
    for fallback in ["j_idt36_input", "j_idt34_input", "j_idt41_input", "j_idt45_input"]:
        if soup.find("select", {"name": fallback}):
            return fallback
    return None


def find_display_input_name(soup: BeautifulSoup, state_name: str | None) -> str | None:
    """Locate the <select> name for the display-type dropdown (T/L/C/A)."""
    for sel in soup.find_all("select"):
        name = sel.get("name", "")
        if not name or name in _KNOWN_INPUT_NAMES or name == state_name:
            continue
        vals = {o.get("value", "") for o in sel.find_all("option") if o.get("value", "")}
        if vals and vals <= {"T", "L", "C", "A"}:
            return name
    for fallback in ["j_idt25_input", "j_idt22_input", "j_idt28_input"]:
        if soup.find("select", {"name": fallback}):
            return fallback
    return None


def find_refresh_ids(soup: BeautifulSoup) -> list[str]:
    """Discover Refresh button IDs. Dynamic across page versions; falls back to known IDs."""
    ids = [
        btn.get("id", "")
        for btn in soup.find_all("button")
        if btn.get_text(strip=True).lower() == "refresh" and btn.get("id", "")
    ]
    return ids or _REFRESH_IDS_FALLBACK


def match_option(options: dict[str, str], query: str) -> tuple[str, str] | None:
    """Case-insensitive match against display labels: exact first, then partial."""
    q = query.lower().strip()
    for val, label in options.items():
        if label.lower() == q:
            return val, label
    for val, label in options.items():
        if q in label.lower():
            return val, label
    return None


# ── Table parsing ────────────────────────────────────────────────────────────────────


def parse_table(resp_text: str) -> tuple[list[str], list[list[str]]]:
    """Extract headers + data rows from CDATA sections in a PrimeFaces AJAX response.

    Handles a known Vahan quirk: the <th> row sometimes includes a phantom axis-label
    column that the <td> rows omit. When detected, the phantom column is dropped and
    TOTAL is moved to the end to match the data layout.
    """
    raw_headers: list[str] = []
    all_rows: list[list[str]] = []

    for cd in re.findall(r"<!\[CDATA\[(.*?)\]\]>", resp_text, re.DOTALL):
        if "<th" not in cd.lower() and "<td" not in cd.lower():
            continue
        soup = BeautifulSoup(cd, "html.parser")
        ths = soup.find_all("th")
        if ths and len(ths) > 5:
            raw_headers = [th.get_text(strip=True) for th in ths]
        for tr in soup.find_all("tr"):
            tds = tr.find_all("td")
            if tds and len(tds) > 2:
                all_rows.append([td.get_text(strip=True) for td in tds])

    headers = raw_headers
    if (
        all_rows
        and raw_headers
        and len(raw_headers) == len(all_rows[0]) + 1
        and len(raw_headers) > 4
        and raw_headers[3] == "TOTAL"
    ):
        headers = raw_headers[:2] + raw_headers[4:] + ["TOTAL"]
    return headers, all_rows


def paginate_table(
    client: httpx.Client, form: dict[str, str], initial_resp: str
) -> tuple[list[str], list[list[str]]]:
    """Collect all paginated rows from groupingTable. Returns (headers, all_rows)."""
    headers, all_rows = parse_table(initial_resp)
    if "ui-paginator" not in initial_resp:
        return headers, all_rows

    page = 1
    while page < 100:  # safety cap
        first = page * ROWS_PER_PAGE
        page += 1
        page_data = {
            "javax.faces.partial.ajax": "true",
            "javax.faces.source": "groupingTable",
            "javax.faces.partial.execute": "groupingTable",
            "javax.faces.partial.render": "groupingTable",
            "javax.faces.behavior.event": "page",
            "javax.faces.partial.event": "page",
            "groupingTable_pagination": "true",
            "groupingTable_first": str(first),
            "groupingTable_rows": str(ROWS_PER_PAGE),
            "groupingTable_encodeFeature": "true",
            **form,
        }
        try:
            resp = client.post(VAHAN_URL, headers=_AJAX_HEADERS, data=page_data)
            resp.raise_for_status()
            new_vs = extract_viewstate_xml(resp.text)
            if new_vs:
                form["javax.faces.ViewState"] = new_vs
            _, new_rows = parse_table(resp.text)
            if not new_rows:
                break
            all_rows.extend(new_rows)
            if len(new_rows) < ROWS_PER_PAGE:
                break
            time.sleep(0.3)
        except httpx.HTTPError:
            break
    return headers, all_rows


# ── AJAX POST ─────────────────────────────────────────────────────────────────────────


def ajax_post(
    client: httpx.Client,
    form: dict[str, str],
    source: str,
    event: str | None = None,
    execute: str | None = None,
    render: str = "@all",
) -> tuple[str, str]:
    """Send a PrimeFaces AJAX partial POST. Returns (response_text, updated_viewstate)."""
    data = {
        "javax.faces.partial.ajax": "true",
        "javax.faces.source": source,
        "javax.faces.partial.execute": execute or source,
        "javax.faces.partial.render": render,
        **form,
    }
    if event:
        data["javax.faces.behavior.event"] = event
        data["javax.faces.partial.event"] = event
    else:
        data[source] = source
    resp = client.post(VAHAN_URL, headers=_AJAX_HEADERS, data=data)
    resp.raise_for_status()
    new_vs = extract_viewstate_xml(resp.text)
    return resp.text, new_vs if new_vs else form["javax.faces.ViewState"]


def new_client() -> httpx.Client:
    """A fresh client. TLS verification is always ON — never disabled, even for speed."""
    return httpx.Client(
        timeout=60.0, follow_redirects=True, headers={"User-Agent": _UA, "Accept": "text/html"}
    )


# ── Discovery (the --list-options equivalent) ───────────────────────────────────────


@dataclass
class Discovered:
    viewstate: str
    state_input_name: str | None
    display_input_name: str | None
    refresh_ids: list[str]
    states: dict[str, str] = field(default_factory=dict)
    yaxis: dict[str, str] = field(default_factory=dict)
    xaxis: dict[str, str] = field(default_factory=dict)
    years: dict[str, str] = field(default_factory=dict)


def discover(client: httpx.Client) -> Discovered:
    """GET the dashboard once and enumerate every dropdown's real options."""
    resp = client.get(VAHAN_URL)
    resp.raise_for_status()
    vs = extract_viewstate(resp.text)
    soup = BeautifulSoup(resp.text, "html.parser")

    state_name = find_state_input_name(soup)
    display_name = find_display_input_name(soup, state_name)
    refresh_ids = find_refresh_ids(soup)
    states = (
        {k: v for k, v in parse_options(soup, state_name).items() if k != "-1"}
        if state_name
        else {}
    )
    years = {
        k: v for k, v in parse_options(soup, "selectedYear_input").items() if k not in ("", "A")
    }

    return Discovered(
        viewstate=vs,
        state_input_name=state_name,
        display_input_name=display_name,
        refresh_ids=refresh_ids,
        states=states,
        yaxis=parse_options(soup, "yaxisVar_input"),
        xaxis=parse_options(soup, "xaxisVar_input"),
        years=years,
    )


def list_options() -> Discovered:
    """Live reachability probe + option dump. This is the run that proves the dashboard
    is reachable from wherever it executes, and harvests the REAL dropdown label strings
    needed to populate vahan_categories.yaml (never guessed)."""
    with new_client() as client:
        return discover(client)


# ── Scrape: Vehicle Category x Month Wise, all-India ────────────────────────────────


def scrape_category_by_month(
    client: httpx.Client, discovered: Discovered, years: list[int]
) -> dict[int, tuple[list[str], list[list[str]]]]:
    """Run the Y=Vehicle Category, X=Month Wise, all-India pivot for each year.

    Returns {year: (headers, rows)}. A year with no table in the response is omitted
    (not an error — some years may legitimately have nothing, e.g. before VAHAN coverage
    began), but a year that errors mid-request propagates the exception; a fully-empty
    result set across every requested year is treated as failure by the caller.
    """
    yaxis_match = match_option(discovered.yaxis, "Vehicle Category")
    xaxis_match = match_option(discovered.xaxis, "Month Wise")
    if not yaxis_match or not xaxis_match:
        raise VahanScrapeError(
            f"axis options not found on live page (yaxis={list(discovered.yaxis.values())!r}, "
            f"xaxis={list(discovered.xaxis.values())!r})"
        )
    yaxis_val, _ = yaxis_match
    xaxis_val, _ = xaxis_match

    form: dict[str, str] = {
        FORM_ID: FORM_ID,
        "yaxisVar_input": yaxis_val,
        "xaxisVar_input": xaxis_val,
        "selectedRto_input": "-1",
        "selectedYearType_input": "C",  # Calendar Year — per-row dates are computed from the
        "selectedYear_input": str(years[0]),  # actual month header, not from this choice
        "javax.faces.ViewState": discovered.viewstate,
    }
    if discovered.display_input_name:
        form[discovered.display_input_name] = "A"  # Actual values, not thousands/lakhs
    if discovered.state_input_name:
        form[discovered.state_input_name] = "-1"  # All-India

    _, vs = ajax_post(client, form, source="yaxisVar", event="change")
    form["javax.faces.ViewState"] = vs
    time.sleep(0.3)
    _, vs = ajax_post(client, form, source="xaxisVar", event="change")
    form["javax.faces.ViewState"] = vs
    time.sleep(0.3)

    results: dict[int, tuple[list[str], list[list[str]]]] = {}
    for year in years:
        form["selectedYear_input"] = str(year)
        _, vs = ajax_post(client, form, source="selectedYear", event="change")
        form["javax.faces.ViewState"] = vs
        time.sleep(0.3)

        resp_text = None
        for refresh_id in discovered.refresh_ids:
            try:
                rt, vs = ajax_post(client, form, source=refresh_id, execute="@all")
                form["javax.faces.ViewState"] = vs
                if "<th" in rt or "<td" in rt:
                    resp_text = rt
                    break
            except httpx.HTTPError:
                continue
        if not resp_text:
            continue

        headers, rows = parse_table(resp_text)
        if "ui-paginator" in resp_text:
            headers, rows = paginate_table(client, form, resp_text)
        if headers and rows:
            results[year] = (headers, rows)
        time.sleep(0.5)

    return results


# ── SourceAdapter ─────────────────────────────────────────────────────────────────────


def _month_from_header(header: str) -> int | None:
    key = re.sub(r"[^a-zA-Z]", "", header).lower()
    return _MONTH_NAMES.get(key)


class VahanAdapter(SourceAdapter):
    source_id = "VAHAN"
    native_frequency = "month"

    def __init__(self, years: list[int] | None = None, ingest_date: datetime | None = None) -> None:
        current_year = (ingest_date or datetime.now(UTC)).year
        self.years = years or [current_year - 2, current_year - 1, current_year]
        self.ingest_date = ingest_date or datetime.now(UTC)
        self.warnings: list[str] = []

    def fetch(self, period: str) -> RawPayload:
        with new_client() as client:
            discovered = discover(client)
            by_year = scrape_category_by_month(client, discovered, self.years)
        if not by_year:
            raise VahanScrapeError(
                f"no data returned for any requested year {self.years} — dashboard reachable "
                "but the scrape produced nothing; check axis labels via --list-options"
            )
        return RawPayload(
            source_id=self.source_id,
            source_period=period,
            source_file=f"vahan-live-scrape-{self.ingest_date.date().isoformat()}",
            content=by_year,
            meta={"years": self.years},
        )

    def parse(self, raw: RawPayload) -> list[ContractRow]:
        resolver = load_vahan_category_resolver()
        rows: list[ContractRow] = []
        by_year: dict[int, tuple[list[str], list[list[str]]]] = raw.content
        for year, (headers, table_rows) in by_year.items():
            month_cols = [(i, _month_from_header(h)) for i, h in enumerate(headers)]
            month_cols = [
                (i, m)
                for i, m in month_cols
                if m is not None and headers[i].strip().lower() not in _NON_MONTH_COLUMNS
            ]
            if not month_cols:
                self.warnings.append(f"{year}: no month columns recognized in headers {headers!r}")
                continue
            label_col = 1 if len(headers) > 1 else 0

            for row in table_rows:
                if len(row) <= max(i for i, _ in month_cols):
                    continue
                raw_label = row[label_col].strip()
                if raw_label.lower() in _NON_MONTH_COLUMNS:
                    continue
                try:
                    canonical = resolver.resolve(raw_label)
                except UnknownVahanCategoryError:
                    raise UnknownVahanCategoryError(
                        f"unresolved VAHAN category {raw_label!r} (year {year}) — add it to "
                        "pipeline/dictionaries/vahan_categories.yaml using the label exactly "
                        "as printed here, then re-run."
                    ) from None
                for i, month_num in month_cols:
                    cell = row[i].replace(",", "").strip()
                    if cell == "":
                        continue
                    try:
                        value = float(cell)
                    except ValueError:
                        self.warnings.append(
                            f"non-numeric cell {raw_label}/{year}/{headers[i]}: {cell!r}"
                        )
                        continue
                    d = date(year, month_num, 1)
                    rows.append(self._row(d, canonical, raw_label, value))
        return rows

    def validate(self, rows: list[ContractRow]) -> ValidationResult:
        errors: list[str] = []
        warnings = list(self.warnings)
        if not rows:
            errors.append("no rows parsed")
        warnings += [
            f"negative value {r.value} for {r.company_canonical} {r.period_date}"
            for r in rows
            if r.value is not None and r.value < 0
        ]
        return ValidationResult(ok=not errors, errors=errors, warnings=warnings)

    def _row(self, d: date, category: str, raw_label: str, value: float) -> ContractRow:
        return ContractRow(
            period_date=d,
            period_type="month",
            fiscal_year=fiscal_year_of(d),
            fiscal_quarter=fiscal_quarter_of(d),
            category=category,
            segment=None,
            sub_segment=None,
            company_canonical=INDUSTRY_TOTAL_CANONICAL,
            company_raw=raw_label,
            flow="domestic",
            powertrain="all",
            geography="IN",
            metric="units",
            value=value,
            unit="units",
            source=self.source_id,
            source_file=f"vahan-live-scrape-{self.ingest_date.date().isoformat()}",
            source_period=self.ingest_date.date().isoformat(),
            native_frequency="month",
            calc_status="reported",
            revision=0,
            ingest_date=self.ingest_date,
            confidence="high",
            is_superseded=False,
            is_partial=False,
            periods_present=None,
            periods_expected=None,
        )


# ── CLI (discovery mode for the GitHub Action) ──────────────────────────────────────


def _print_discovery(d: Discovered) -> None:
    print("Reachability: OK — dashboard loaded and ViewState extracted.")
    print(f"\nStates ({len(d.states)}):")
    for code, label in d.states.items():
        print(f"  [{code}]  {label}")
    print("\nY-Axis options:")
    for val, label in d.yaxis.items():
        print(f"  [{val}]  {label}")
    print("\nX-Axis options:")
    for val, label in d.xaxis.items():
        print(f"  [{val}]  {label}")
    print("\nYear options:")
    for val, label in d.years.items():
        print(f"  [{val}]  {label}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="VAHAN adapter CLI")
    parser.add_argument("--list-options", action="store_true", help="Discovery/reachability probe")
    args = parser.parse_args(argv)

    if args.list_options:
        try:
            _print_discovery(list_options())
        except (httpx.HTTPError, VahanScrapeError) as e:
            print(f"[vahan] UNREACHABLE: {e!r}", file=sys.stderr)
            return 1
        return 0

    adapter = VahanAdapter()
    try:
        rows = adapter.parse(adapter.fetch("live"))
    except (httpx.HTTPError, VahanScrapeError, UnknownVahanCategoryError) as e:
        print(f"[vahan] FAILED: {e}", file=sys.stderr)
        return 1
    result = adapter.validate(rows)
    print(f"[vahan] parsed {len(rows)} rows. ok={result.ok}")
    for w in result.warnings[:20]:
        print(f"  warning: {w}")
    for e in result.errors:
        print(f"  error: {e}", file=sys.stderr)
    return 0 if result.ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

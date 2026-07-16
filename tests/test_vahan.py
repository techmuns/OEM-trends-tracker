"""VAHAN adapter tests — pure parsing/discovery mechanics, no live network calls.

httpx.MockTransport stands in for the live site so discover()/scrape_category_by_month()
exercise real httpx request/response handling against synthetic (but realistic) PrimeFaces
HTML/XML fixtures, mirroring the shapes the live dashboard actually returns.
"""

from __future__ import annotations

from datetime import UTC, date, datetime

import httpx
import pytest
from bs4 import BeautifulSoup

from pipeline.adapters import vahan
from pipeline.adapters.base import RawPayload
from pipeline.dictionaries.loader import UnknownVahanCategoryError, VahanCategoryResolver

# ── Fixtures ─────────────────────────────────────────────────────────────────────────

PAGE_HTML = """
<html><body>
<form id="masterLayout_formlogin">
<input type="hidden" name="javax.faces.ViewState" value="vs_initial" />

<select name="j_idt28_input">
  <option value="T">In Thousand</option>
  <option value="L">In Lakh</option>
  <option value="C">In Crore</option>
  <option value="A">Actual Value</option>
</select>

<select name="j_idt36_input">
  <option value="-1">All Vahan4 Running States (36/36)</option>
  <option value="AN">A &amp; N Islands</option>
  <option value="KL">Kerala</option>
</select>

<select name="yaxisVar_input">
  <option value="VC">Vehicle Category</option>
  <option value="MAKER">Maker</option>
  <option value="FUEL">Fuel</option>
</select>
<select name="xaxisVar_input">
  <option value="MONTH">Month Wise</option>
  <option value="FUEL">Fuel</option>
  <option value="CY">Calendar Year</option>
</select>
<select name="selectedYear_input">
  <option value="">Select Year</option>
  <option value="A">All</option>
  <option value="2024">2024</option>
  <option value="2025">2025</option>
</select>
<select name="selectedRto_input">
  <option value="-1">All Vahan4 Running RTOs</option>
</select>

<button id="j_idt66" type="submit">Refresh</button>
<button id="j_idt71" type="submit">Refresh</button>
<button id="j_idt78" type="submit">Refresh</button>
</form>
</body></html>
"""

TABLE_XML = """<?xml version='1.0' encoding='UTF-8'?>
<partial-response>
<changes>
<update id="groupingTable"><![CDATA[
<table>
  <thead><tr>
    <th>S No</th><th>Vehicle Category</th><th>JAN</th><th>FEB</th><th>MAR</th><th>TOTAL</th>
  </tr></thead>
  <tbody>
    <tr><td>1</td><td>TWO WHEELER(NT)</td><td>1,000</td><td>1,100</td><td>1,200</td><td>3,300</td></tr>
    <tr><td>2</td><td>MOTOR CAR</td><td>500</td><td>550</td><td>600</td><td>1,650</td></tr>
  </tbody>
</table>
]]></update>
<update id="javax.faces.ViewState"><![CDATA[vs_updated]]></update>
</changes>
</partial-response>
"""

PHANTOM_TABLE_XML = """<?xml version='1.0' encoding='UTF-8'?>
<partial-response>
<changes>
<update id="groupingTable"><![CDATA[
<table>
  <thead><tr>
    <th>S No</th><th>Vehicle Category</th><th>Month</th><th>TOTAL</th><th>JAN</th><th>FEB</th>
  </tr></thead>
  <tbody>
    <tr><td>1</td><td>TWO WHEELER(NT)</td><td>1000</td><td>1100</td><td>2100</td></tr>
  </tbody>
</table>
]]></update>
<update id="javax.faces.ViewState"><![CDATA[vs_phantom]]></update>
</changes>
</partial-response>
"""

EMPTY_XML = """<?xml version='1.0' encoding='UTF-8'?>
<partial-response><changes>
<update id="javax.faces.ViewState"><![CDATA[vs_noop]]></update>
</changes></partial-response>
"""


def _mock_client(get_text: str, post_responses: list[str]) -> httpx.Client:
    """A real httpx.Client wired to a MockTransport — GET returns get_text once, each
    POST returns the next entry in post_responses in order."""
    responses = iter(post_responses)

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET":
            return httpx.Response(200, text=get_text)
        return httpx.Response(200, text=next(responses))

    return httpx.Client(transport=httpx.MockTransport(handler))


# ── ViewState ────────────────────────────────────────────────────────────────────────


def test_extract_viewstate_from_page_html() -> None:
    assert vahan.extract_viewstate(PAGE_HTML) == "vs_initial"


def test_extract_viewstate_value_before_name() -> None:
    html = '<input value="vs_reversed" name="javax.faces.ViewState" />'
    assert vahan.extract_viewstate(html) == "vs_reversed"


def test_extract_viewstate_raises_when_missing() -> None:
    with pytest.raises(vahan.VahanScrapeError):
        vahan.extract_viewstate("<html>no viewstate here</html>")


def test_extract_viewstate_xml() -> None:
    assert vahan.extract_viewstate_xml(TABLE_XML) == "vs_updated"
    assert vahan.extract_viewstate_xml("<partial-response></partial-response>") == ""


# ── Option discovery ─────────────────────────────────────────────────────────────────


def test_parse_options_yaxis() -> None:
    soup = BeautifulSoup(PAGE_HTML, "html.parser")
    opts = vahan.parse_options(soup, "yaxisVar_input")
    assert opts == {"VC": "Vehicle Category", "MAKER": "Maker", "FUEL": "Fuel"}


def test_find_state_input_name_not_display() -> None:
    soup = BeautifulSoup(PAGE_HTML, "html.parser")
    name = vahan.find_state_input_name(soup)
    assert name == "j_idt36_input"
    assert name != vahan.find_display_input_name(soup, name)


def test_find_display_input_name() -> None:
    soup = BeautifulSoup(PAGE_HTML, "html.parser")
    state_name = vahan.find_state_input_name(soup)
    assert vahan.find_display_input_name(soup, state_name) == "j_idt28_input"


def test_find_refresh_ids() -> None:
    soup = BeautifulSoup(PAGE_HTML, "html.parser")
    assert set(vahan.find_refresh_ids(soup)) == {"j_idt66", "j_idt71", "j_idt78"}


def test_find_refresh_ids_falls_back() -> None:
    soup = BeautifulSoup("<html><body></body></html>", "html.parser")
    assert vahan.find_refresh_ids(soup) == vahan._REFRESH_IDS_FALLBACK


def test_match_option_exact_then_partial() -> None:
    opts = {"VC": "Vehicle Category", "MONTH": "Month Wise"}
    assert vahan.match_option(opts, "month wise") == ("MONTH", "Month Wise")
    assert vahan.match_option(opts, "vehicle") == ("VC", "Vehicle Category")
    assert vahan.match_option(opts, "nonexistent") is None


# ── Table parsing ────────────────────────────────────────────────────────────────────


def test_parse_table_normal() -> None:
    headers, rows = vahan.parse_table(TABLE_XML)
    assert headers == ["S No", "Vehicle Category", "JAN", "FEB", "MAR", "TOTAL"]
    assert len(rows) == 2
    assert rows[0] == ["1", "TWO WHEELER(NT)", "1,000", "1,100", "1,200", "3,300"]


def test_parse_table_phantom_column_fix() -> None:
    headers, rows = vahan.parse_table(PHANTOM_TABLE_XML)
    assert headers == ["S No", "Vehicle Category", "JAN", "FEB", "TOTAL"]
    assert len(headers) == len(rows[0])


def test_parse_table_empty() -> None:
    headers, rows = vahan.parse_table(EMPTY_XML)
    assert headers == [] and rows == []


# ── discover() / scrape_category_by_month() against a mocked transport ─────────────


def test_discover_reads_real_dropdowns() -> None:
    client = _mock_client(PAGE_HTML, [])
    d = vahan.discover(client)
    assert d.viewstate == "vs_initial"
    assert d.state_input_name == "j_idt36_input"
    assert d.years == {"2024": "2024", "2025": "2025"}
    assert "Vehicle Category" in d.yaxis.values()
    assert "Month Wise" in d.xaxis.values()


def test_scrape_category_by_month_happy_path() -> None:
    client = _mock_client(PAGE_HTML, [EMPTY_XML, EMPTY_XML, EMPTY_XML, TABLE_XML])
    d = vahan.discover(client)
    result = vahan.scrape_category_by_month(client, d, years=[2024])
    assert 2024 in result
    headers, rows = result[2024]
    assert headers[0] == "S No"
    assert len(rows) == 2


def test_scrape_category_by_month_missing_axis_raises() -> None:
    d = vahan.Discovered(
        viewstate="vs",
        state_input_name=None,
        display_input_name=None,
        refresh_ids=["x"],
        yaxis={"OTHER": "Something Else"},
        xaxis={"OTHER2": "Other"},
    )
    client = _mock_client(PAGE_HTML, [])
    with pytest.raises(vahan.VahanScrapeError):
        vahan.scrape_category_by_month(client, d, years=[2024])


# ── _month_from_header ───────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "header,expected",
    [("JAN", 1), ("January", 1), ("Feb-24", 2), ("dec", 12), ("TOTAL", None), ("S No", None)],
)
def test_month_from_header(header, expected) -> None:
    assert vahan._month_from_header(header) == expected


# ── VahanAdapter.parse() — category resolution incl. the hard-fail path ────────────


def _raw_payload() -> RawPayload:
    headers = ["S No", "Vehicle Category", "JAN", "FEB", "TOTAL"]
    rows = [
        ["1", "TWO WHEELER(NT)", "1,000", "1,100", "2,100"],
        ["2", "MOTOR CAR", "500", "", "500"],  # blank cell must be skipped, not zeroed
    ]
    return RawPayload(
        source_id="VAHAN",
        source_period="live",
        source_file="vahan-live-scrape-test",
        content={2024: (headers, rows)},
    )


def test_parse_hard_fails_on_unrecognized_category(monkeypatch) -> None:
    monkeypatch.setattr(vahan, "load_vahan_category_resolver", lambda: VahanCategoryResolver({}))
    adapter = vahan.VahanAdapter(ingest_date=datetime(2026, 7, 16, tzinfo=UTC))
    with pytest.raises(UnknownVahanCategoryError, match="TWO WHEELER"):
        adapter.parse(_raw_payload())


def test_parse_maps_recognized_categories(monkeypatch) -> None:
    resolver = VahanCategoryResolver({"TWO WHEELER(NT)": "2W", "MOTOR CAR": "PV"})
    monkeypatch.setattr(vahan, "load_vahan_category_resolver", lambda: resolver)
    adapter = vahan.VahanAdapter(ingest_date=datetime(2026, 7, 16, tzinfo=UTC))
    rows = adapter.parse(_raw_payload())

    two_w = [r for r in rows if r.category.value == "2W"]
    assert {r.period_date for r in two_w} == {date(2024, 1, 1), date(2024, 2, 1)}
    jan = next(r for r in two_w if r.period_date == date(2024, 1, 1))
    assert jan.value == 1000.0
    assert jan.source == "VAHAN"
    assert jan.flow.value == "domestic"
    assert jan.powertrain.value == "all"
    assert jan.calc_status.value == "reported"

    pv = [r for r in rows if r.category.value == "PV"]
    # Feb cell was blank for Motor Car -> must be absent, never coerced to 0
    assert {r.period_date for r in pv} == {date(2024, 1, 1)}


def test_parse_strips_commas_and_skips_blank_cells(monkeypatch) -> None:
    resolver = VahanCategoryResolver({"TWO WHEELER(NT)": "2W", "MOTOR CAR": "PV"})
    monkeypatch.setattr(vahan, "load_vahan_category_resolver", lambda: resolver)
    adapter = vahan.VahanAdapter(ingest_date=datetime(2026, 7, 16, tzinfo=UTC))
    rows = adapter.parse(_raw_payload())
    two_w_feb = next(
        r for r in rows if r.category.value == "2W" and r.period_date == date(2024, 2, 1)
    )
    assert two_w_feb.value == 1100.0


def test_validate_flags_no_rows() -> None:
    adapter = vahan.VahanAdapter()
    result = adapter.validate([])
    assert result.ok is False
    assert "no rows parsed" in result.errors[0]

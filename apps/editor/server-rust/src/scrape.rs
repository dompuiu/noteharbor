//! Scrape routes: grading-company page parsers plus the CDP browser-attach
//! flow behind `POST /api/scrape/preview`.
//!
//! Crate choices follow the survey on `research/scrape`: `scraper`
//! (Servo `html5ever` + `selectors`) as the cheerio replacement for all
//! three parsers, `chromiumoxide` (`Browser::connect`) for the attach-only
//! CDP flow, `reqwest` for the `/json/version` readiness probe. The PCGS
//! embedded-JS-literal pass stays plain string/regex work, unchanged in
//! structure.
//!
//! `NOTE_HARBOR_BROWSER_CDP_URL` keeps its name and default verbatim; the
//! Win/macOS-only Chrome-launch gate lives in the desktop shell (ticket 07) —
//! the server attaches to whatever CDP endpoint it is given on every platform.

use std::sync::OnceLock;
use std::time::Duration;

use axum::{Json, Router, response::{IntoResponse, Response}, routing::post};
use regex::Regex;
use scraper::{Html, Selector};
use serde::Deserialize;
use serde_json::{json, Map, Value};

use chromiumoxide::cdp::browser_protocol::target::TargetId;

use crate::routes::bad_request;

pub const DEFAULT_BROWSER_CDP_URL: &str = "http://localhost:9222";
pub const DEFAULT_WAIT_SECONDS: f64 = 2.0;
pub const DEFAULT_NAVIGATION_TIMEOUT_MS: u64 = 30_000;
pub const MIN_NAVIGATION_TIMEOUT_MS: u64 = 5_000;
pub const MAX_NAVIGATION_TIMEOUT_MS: u64 = 120_000;
pub const NO_SCRAPER_MESSAGE: &str = "No scraper is implemented for this grading company yet.";

/// Resolves the browser CDP URL: trimmed env override or
/// the `http://localhost:9222` default.
pub fn browser_cdp_url() -> String {
    let trimmed = std::env::var("NOTE_HARBOR_BROWSER_CDP_URL")
        .map(|raw| raw.trim().to_owned())
        .unwrap_or_default();
    if trimmed.is_empty() {
        DEFAULT_BROWSER_CDP_URL.to_owned()
    } else {
        trimmed
    }
}

/// Normalizes the navigation timeout: `Number(value)`
/// semantics, falling back to 30 s for missing/non-positive/non-finite input
/// and clamping to 5–120 s.
pub fn normalize_navigation_timeout_ms(value: Option<&Value>) -> u64 {
    let parsed = match value {
        None => f64::NAN,
        Some(Value::Null) => 0.0,
        Some(Value::Bool(true)) => 1.0,
        Some(Value::Bool(false)) => 0.0,
        Some(Value::Number(number)) => number.as_f64().unwrap_or(f64::NAN),
        Some(Value::String(raw)) => {
            let trimmed = raw.trim();
            if trimmed.is_empty() {
                0.0
            } else {
                trimmed.parse::<f64>().unwrap_or(f64::NAN)
            }
        }
        Some(_) => f64::NAN,
    };
    if !parsed.is_finite() || parsed <= 0.0 {
        return DEFAULT_NAVIGATION_TIMEOUT_MS;
    }
    parsed.round().clamp(
        MIN_NAVIGATION_TIMEOUT_MS as f64,
        MAX_NAVIGATION_TIMEOUT_MS as f64,
    ) as u64
}

/// Normalizes a URL: trim, strip `#fragment`, strip
/// one trailing `/`.
pub fn normalize_url(url: &str) -> String {
    let trimmed = url.trim();
    let without_fragment = trimmed.split('#').next().unwrap_or("");
    without_fragment
        .strip_suffix('/')
        .unwrap_or(without_fragment)
        .to_owned()
}

/// Builds the CDP-unreachable hint (joined with single spaces).
pub fn build_cdp_hint(cdp_url: &str) -> String {
    [
        "Unable to reach the configured CDP browser endpoint.",
        &format!(
            "Verify {}/json/version is reachable from the server environment.",
            cdp_url.trim_end_matches('/')
        ),
        "If the server runs in WSL and Chrome runs on Windows, launch Chrome with",
        "--remote-debugging-port=9222 --remote-debugging-address=0.0.0.0 and point",
        "NOTE_HARBOR_BROWSER_CDP_URL at the Windows host IP instead of localhost if needed.",
    ]
    .join(" ")
}

/// Whether the URL uses the `http`/`https` scheme.
pub fn is_http_url(url: &str) -> bool {
    url::Url::parse(url)
        .map(|parsed| parsed.scheme() == "http" || parsed.scheme() == "https")
        .unwrap_or(false)
}

/// Tab URLs as currently open, in order, with `chrome-devtools://` tabs
/// removed — the `realPages` list in `resolveOpenPage`.
pub fn real_page_urls(page_urls: &[String]) -> Vec<String> {
    page_urls
        .iter()
        .filter(|url| !url.starts_with("chrome-devtools://"))
        .cloned()
        .collect()
}

/// Describes the open tabs: `(no open browser tabs)` when empty, else one
/// `- <url>` line per tab (`about:blank` for blank entries).
pub fn describe_open_pages(page_urls: &[String]) -> String {
    if page_urls.is_empty() {
        return "(no open browser tabs)".to_owned();
    }
    page_urls
        .iter()
        .map(|url| format!("- {}", if url.is_empty() { "about:blank" } else { url }))
        .collect::<Vec<_>>()
        .join("\n")
}

/// Finds the matching open tab: last tab whose normalized URL matches,
/// skipping blank, `about:blank`, and `chrome-devtools://` entries.
/// Returns the index into the caller's slice so the caller can reuse the
/// exact tab even when devtools tabs are present.
pub fn find_matching_open_page(page_urls: &[String], normalized_requested: &str) -> Option<usize> {
    page_urls
        .iter()
        .enumerate()
        .filter(|(_, url)| !url.is_empty() && *url != "about:blank")
        .filter(|(_, url)| !url.starts_with("chrome-devtools://"))
        .filter(|(_, url)| normalize_url(url) == normalized_requested)
        .map(|(index, _)| index)
        .next_back()
}

/// Site-specific identity of a grading-company URL: the note the page shows,
/// independent of URL embellishments the site adds or drops (PMG certlookup
/// URLs gain a `/<grade>` segment, e.g. `.../2258889-039` vs
/// `.../2258889-039/25/`). Used as a tab-reuse fallback so autopopulate stops
/// opening a duplicate tab when the stored URL and the open tab differ only
/// by such embellishments. Query strings and fragments never participate.
pub fn canonical_scrape_key(url: &str) -> Option<(ScraperKind, String)> {
    let parsed = url::Url::parse(url.trim()).ok()?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return None;
    }
    let host = parsed.host_str()?.to_lowercase();
    let segments: Vec<String> = parsed
        .path_segments()?
        .filter(|segment| !segment.is_empty())
        .map(|segment| segment.to_lowercase())
        .collect();
    // First non-empty path segment after `marker`.
    let after = |marker: &str| {
        segments
            .iter()
            .position(|segment| segment == marker)
            .and_then(|at| segments.get(at + 1))
            .filter(|segment| !segment.is_empty())
            .cloned()
    };
    if host.contains("pmgnotes.com") {
        return after("certlookup").map(|key| (ScraperKind::Pmg, key));
    }
    if host.contains("pcgs.com") {
        return after("cert").map(|key| (ScraperKind::Pcgs, key));
    }
    if host.contains("tqggrading.com") {
        return after("query").map(|key| (ScraperKind::Tqg, key));
    }
    None
}

/// Fallback tab match: last tab showing the same graded note (per
/// `canonical_scrape_key`), skipping blank, `about:blank`, and
/// `chrome-devtools://` entries. Only consulted when no tab matches the full
/// URL exactly, so a different note never matches.
pub fn find_key_matching_open_page(
    page_urls: &[String],
    key: &(ScraperKind, String),
) -> Option<usize> {
    page_urls
        .iter()
        .enumerate()
        .filter(|(_, url)| !url.is_empty() && *url != "about:blank")
        .filter(|(_, url)| !url.starts_with("chrome-devtools://"))
        .filter(|(_, url)| canonical_scrape_key(url).as_ref() == Some(key))
        .map(|(index, _)| index)
        .next_back()
}

/// Pure half of `resolveOpenPage` (tab reuse vs. open-new vs. refuse),
/// testable without a live browser against a faked tab-URL list.
#[derive(Debug, PartialEq, Eq)]
pub enum PagePlan {
    /// Index into the caller's tab-URL slice (the tab to reuse).
    Reuse(usize),
    OpenNew,
}

pub fn resolve_page_plan(
    page_urls: &[String],
    requested_url: &str,
    open_if_missing: bool,
) -> Result<PagePlan, String> {
    let normalized = normalize_url(requested_url);
    if normalized.is_empty() {
        return Err("No requested URL was provided for open-tab selection.".to_owned());
    }
    if let Some(index) = find_matching_open_page(page_urls, &normalized) {
        return Ok(PagePlan::Reuse(index));
    }
    // Same note, embellished URL (e.g. PMG's appended `/<grade>` segment):
    // reuse the tab instead of piling up a duplicate.
    if let Some(key) = canonical_scrape_key(requested_url) {
        if let Some(index) = find_key_matching_open_page(page_urls, &key) {
            return Ok(PagePlan::Reuse(index));
        }
    }
    if open_if_missing {
        if !is_http_url(requested_url) {
            return Err(format!("Refusing to open a non-web URL: {requested_url}"));
        }
        return Ok(PagePlan::OpenNew);
    }
    let real = real_page_urls(page_urls);
    Err(format!(
        "No open browser tab matches the requested URL.\nRequested: {requested_url}\nOpen tabs:\n{}",
        describe_open_pages(&real)
    ))
}

/// Readiness probe mirroring the shell's `requestJson` check:
/// `GET <cdpUrl>/json/version` with a 1 s
/// timeout; HTTP ≥ 400 counts as unavailable.
pub async fn probe_cdp_version(cdp_url: &str) -> Result<String, String> {
    let endpoint = format!("{}/json/version", cdp_url.trim_end_matches('/'));
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(1))
        .build()
        .map_err(|error| error.to_string())?;
    let response = client
        .get(&endpoint)
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if response.status().as_u16() >= 400 {
        return Err(format!("CDP browser at {cdp_url} is unavailable."));
    }
    response.text().await.map_err(|error| error.to_string())
}

// ---------------------------------------------------------------------------
// Scraper selection + parsers
// ---------------------------------------------------------------------------

/// Selects the scraper for a note by URL/company (case-insensitive).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScraperKind {
    Pmg,
    Pcgs,
    Tqg,
}

pub fn scraper_for_note(url: &str, company: &str) -> Option<ScraperKind> {
    let url = url.to_lowercase();
    let company = company.to_lowercase();
    if url.contains("pmgnotes.com") || company.contains("pmg") {
        return Some(ScraperKind::Pmg);
    }
    if url.contains("pcgs.com/banknotes/cert/") {
        return Some(ScraperKind::Pcgs);
    }
    if url.contains("tqggrading.com") || company.contains("tqg") {
        return Some(ScraperKind::Tqg);
    }
    None
}

/// Note fields the parsers fall back to for the cert number, mirroring
/// `this.note.catalog_number` / `.serial` / `.id` in the JS scrapers.
#[derive(Debug, Default, Clone)]
pub struct NoteRef {
    pub id: Option<String>,
    pub catalog_number: Option<String>,
    pub serial: Option<String>,
}

impl NoteRef {
    /// `scrapeUrl(url)` builds `{ url, grading_company: '' }`: no id,
    /// catalog, or serial, so cert fallbacks resolve to `""`.
    pub fn for_preview() -> Self {
        Self::default()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScrapedImage {
    pub side: String,
    pub variant: String,
    pub url: String,
}

#[derive(Debug, Clone)]
pub struct ParsedScrape {
    pub cert_number: String,
    pub details: Map<String, Value>,
    pub images: Vec<ScrapedImage>,
}

/// Normalizes a detail label: lowercase,
/// non-alnum runs become `_`, one leading/trailing `_` stripped.
pub fn normalize_label(label: &str) -> String {
    let mut out = String::with_capacity(label.len());
    let mut in_run = false;
    for ch in label.to_lowercase().chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch);
            in_run = false;
        } else if !in_run {
            out.push('_');
            in_run = true;
        }
    }
    if out.starts_with('_') {
        out.remove(0);
    }
    if out.ends_with('_') {
        out.pop();
    }
    out
}

fn element_text(text: scraper::ElementRef<'_>) -> String {
    text.text().collect::<Vec<_>>().join("")
}

fn strip_trailing_colon(value: &str) -> String {
    value.strip_suffix(':').unwrap_or(value).to_owned()
}

fn resolve_url(base: &str, href: &str) -> Option<String> {
    url::Url::parse(base)
        .ok()?
        .join(href)
        .ok()
        .map(|url| url.to_string())
}

fn detail_str(details: &Map<String, Value>, key: &str) -> Option<String> {
    details.get(key)?.as_str().map(str::to_owned)
}

fn pmg_side(title: &str) -> &'static str {
    // The grading-site labels come out swapped relative to the note faces
    // (reported: the scraped "front" picture belongs on the back slot and
    // vice versa), so the sides are stored swapped on purpose.
    let title = title.to_lowercase();
    if title.contains("rev") || title.contains("back") || title.contains("reverse") {
        "front"
    } else {
        "back"
    }
}

pub fn parse_pmg(html: &str, page_url: &str, note: &NoteRef) -> ParsedScrape {
    let document = Html::parse_document(html);
    let dl_sel = Selector::parse(".certlookup-wrapper dl").expect("static selector");
    let dt_sel = Selector::parse("dt").expect("static selector");
    let dd_sel = Selector::parse("dd").expect("static selector");
    let item_sel = Selector::parse(".certlookup-images-item").expect("static selector");
    let anchor_sel = Selector::parse("a").expect("static selector");
    let img_sel = Selector::parse("img").expect("static selector");
    let disclaimer_sel = Selector::parse(".certlookup-disclaimer").expect("static selector");

    let mut details = Map::new();
    for dl in document.select(&dl_sel) {
        let label = dl
            .select(&dt_sel)
            .next()
            .map(|dt| strip_trailing_colon(element_text(dt).trim()))
            .unwrap_or_default();
        let value = dl
            .select(&dd_sel)
            .next()
            .map(|dd| element_text(dd).trim().to_owned())
            .unwrap_or_default();
        if !label.is_empty() && !value.is_empty() {
            details.insert(normalize_label(&label), Value::String(value));
        }
    }

    let mut images = Vec::new();
    for item in document.select(&item_sel) {
        let anchor = item.select(&anchor_sel).next();
        let img = item.select(&img_sel).next();
        let side = pmg_side(img.and_then(|el| el.value().attr("title")).unwrap_or(""));
        if let Some(href) = anchor.and_then(|el| el.value().attr("href")) {
            if let Some(full) = resolve_url(page_url, href) {
                images.push(ScrapedImage {
                    side: side.to_owned(),
                    variant: "full".to_owned(),
                    url: full,
                });
            }
        }
        if let Some(src) = img.and_then(|el| el.value().attr("src")) {
            if let Some(thumbnail) = resolve_url(page_url, src) {
                images.push(ScrapedImage {
                    side: side.to_owned(),
                    variant: "thumbnail".to_owned(),
                    url: thumbnail,
                });
            }
        }
    }

    let comments = comments_text(&document, &disclaimer_sel);

    let cert_number = detail_str(&details, "pmg_cert")
        .or_else(|| detail_str(&details, "cert"))
        .or_else(|| note.catalog_number.clone())
        .or_else(|| note.id.clone())
        .unwrap_or_default();

    details.insert("source_url".to_owned(), Value::String(page_url.to_owned()));
    details.insert(
        "page_comments".to_owned(),
        comments.map(Value::String).unwrap_or(Value::Null),
    );

    ParsedScrape {
        cert_number,
        details,
        images,
    }
}

fn comments_text(document: &Html, sel: &Selector) -> Option<String> {
    let combined: String = document.select(sel).map(element_text).collect();
    let trimmed = combined.trim().to_owned();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

// --- PCGS embedded-literal helpers ---

fn unescape_html_string(value: &str) -> String {
    value
        .replace("\\/", "/")
        .replace("\\\"", "\"")
        .replace("\\n", "\n")
        .replace("\\r", "\r")
        .replace("\\t", "\t")
        .replace("\\\\", "\\")
}

fn embedded_data_source(html: &str) -> &str {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| {
        Regex::new(r"const data = \[(?s:(.*?))\];\s*Promise\.all\(").expect("static regex")
    });
    re.captures(html)
        .and_then(|captures| captures.get(1))
        .map(|group| group.as_str())
        .unwrap_or("")
}

fn read_string_literal(source: &str, key: &str) -> Option<String> {
    let pattern = format!(r#"{}:"([^"]*)""#, regex::escape(key));
    Regex::new(&pattern)
        .ok()?
        .captures(source)
        .and_then(|captures| captures.get(1))
        .map(|group| unescape_html_string(group.as_str()))
}

fn read_number_literal(source: &str, key: &str) -> Option<i64> {
    let pattern = format!(r#"{}:([0-9]+)"#, regex::escape(key));
    Regex::new(&pattern)
        .ok()?
        .captures(source)
        .and_then(|captures| captures.get(1))
        .and_then(|group| group.as_str().parse::<i64>().ok())
}

fn read_boolean_literal(source: &str, key: &str) -> Option<bool> {
    let pattern = format!(r"{}:(true|false)", regex::escape(key));
    Regex::new(&pattern)
        .ok()?
        .captures(source)
        .and_then(|captures| captures.get(1))
        .map(|group| group.as_str() == "true")
}

fn extract_embedded_images(source: &str) -> Vec<ScrapedImage> {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| {
        Regex::new(
            r#"\{showThumbnail:(?:true|false),label:"([^"]+)",downloadUrl:"([^"]+)",thumbnailUrl:"([^"]+)",popupUrl:"([^"]+)"[^{}]*\}"#,
        )
        .expect("static regex")
    });
    let mut images = Vec::new();
    for captures in re.captures_iter(source) {
        let label = captures.get(1).map(|group| group.as_str()).unwrap_or("");
        // Sides are stored swapped on purpose: the site's "reverse" picture
        // belongs on the front slot and vice versa (see `pmg_side`).
        let side = if label.to_lowercase().contains("reverse") {
            "front"
        } else {
            "back"
        };
        let full = captures
            .get(4)
            .map(|group| unescape_html_string(group.as_str()))
            .filter(|url| !url.is_empty())
            .or_else(|| {
                captures
                    .get(2)
                    .map(|group| unescape_html_string(group.as_str()))
                    .filter(|url| !url.is_empty())
            });
        if let Some(url) = full {
            images.push(ScrapedImage {
                side: side.to_owned(),
                variant: "full".to_owned(),
                url,
            });
        }
        if let Some(thumbnail) = captures
            .get(3)
            .map(|group| unescape_html_string(group.as_str()))
            .filter(|url| !url.is_empty())
        {
            images.push(ScrapedImage {
                side: side.to_owned(),
                variant: "thumbnail".to_owned(),
                url: thumbnail,
            });
        }
    }
    images
}

fn extract_table_details(document: &Html) -> Map<String, Value> {
    let row_sel = Selector::parse("table tr").expect("static selector");
    let cell_sel = Selector::parse("td").expect("static selector");
    let mut details = Map::new();
    for row in document.select(&row_sel) {
        let cells: Vec<_> = row.select(&cell_sel).collect();
        if cells.len() < 2 {
            continue;
        }
        let label = strip_trailing_colon(element_text(cells[0]).trim());
        let value = element_text(cells[1]).trim().to_owned();
        if !label.is_empty() && !value.is_empty() {
            details.insert(normalize_label(&label), Value::String(value));
        }
    }
    details
}

/// Normalizes the PCGS grade display value.
pub fn normalize_grade(
    display_grade: Option<&str>,
    grade_desc: Option<&str>,
    opq: Option<bool>,
) -> Option<String> {
    let display = display_grade.unwrap_or("").trim();
    if display.is_empty() {
        let desc = grade_desc.unwrap_or("").trim();
        if desc.is_empty() {
            return None;
        }
        static NUM: OnceLock<Regex> = OnceLock::new();
        let numeric = NUM
            .get_or_init(|| Regex::new(r"\b(\d{1,3})\b").expect("static regex"))
            .captures(desc)
            .and_then(|captures| captures.get(1))
            .map(|group| group.as_str().to_owned());
        let Some(numeric) = numeric else {
            return Some(desc.to_owned());
        };
        return Some(with_ppq(&numeric, opq));
    }
    Some(with_ppq(display, opq))
}

/// `[grade, opq ? 'PPQ' : null].filter(Boolean).join(' ')`.
fn with_ppq(base: &str, opq: Option<bool>) -> String {
    [
        Some(base.to_owned()),
        opq.filter(|flag| *flag).map(|_| "PPQ".to_owned()),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>()
    .join(" ")
}

/// `Number(tableValue || '') || null` for population columns.
fn table_number_or_null(details: &Map<String, Value>, key: &str) -> Value {
    let raw = details
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_owned();
    if raw.is_empty() {
        return Value::Null;
    }
    match raw.parse::<f64>() {
        Ok(number) if number.is_finite() && number != 0.0 => {
            if number.fract() == 0.0 && number >= i64::MIN as f64 && number <= i64::MAX as f64 {
                json!(number as i64)
            } else {
                json!(number)
            }
        }
        _ => Value::Null,
    }
}

pub fn parse_pcgs(html: &str, page_url: &str, note: &NoteRef) -> ParsedScrape {
    let document = Html::parse_document(html);
    let embedded = embedded_data_source(html).to_owned();
    let table = extract_table_details(&document);
    let opq = read_boolean_literal(&embedded, "opq");
    let display_grade = read_string_literal(&embedded, "displayGrade");
    let grade_desc =
        read_string_literal(&embedded, "gradeDesc").or_else(|| detail_str(&table, "grade"));
    let banknote_details =
        read_string_literal(&embedded, "banknoteDetails").or_else(|| detail_str(&table, "details"));
    let cert_number = read_string_literal(&embedded, "certNo")
        .or_else(|| detail_str(&table, "cert"))
        .or_else(|| note.catalog_number.clone())
        .or_else(|| note.id.clone())
        .unwrap_or_default();

    let mut details = Map::new();
    let cert_no = read_string_literal(&embedded, "certNo").unwrap_or_else(|| cert_number.clone());
    details.insert("cert_no".to_owned(), Value::String(cert_no));
    details.insert(
        "spec_no".to_owned(),
        read_string_literal(&embedded, "specNo")
            .map(Value::String)
            .unwrap_or(Value::Null),
    );
    details.insert(
        "display_note_no".to_owned(),
        read_string_literal(&embedded, "displayNoteNo")
            .or_else(|| read_string_literal(&embedded, "pcgsDisplayNo"))
            .map(Value::String)
            .unwrap_or(Value::Null),
    );
    details.insert(
        "serial_number".to_owned(),
        read_string_literal(&embedded, "currencySerialNumber")
            .or_else(|| detail_str(&table, "serial_number"))
            .map(Value::String)
            .unwrap_or(Value::Null),
    );
    details.insert(
        "date".to_owned(),
        read_string_literal(&embedded, "currencyDate")
            .or_else(|| read_string_literal(&embedded, "dateMintmark"))
            .or_else(|| detail_str(&table, "date"))
            .map(Value::String)
            .unwrap_or(Value::Null),
    );
    details.insert(
        "denomination".to_owned(),
        read_string_literal(&embedded, "denomination")
            .or_else(|| detail_str(&table, "denomination"))
            .map(Value::String)
            .unwrap_or(Value::Null),
    );
    details.insert(
        "catalog_label".to_owned(),
        Value::String(
            read_string_literal(&embedded, "catalog1LongDesc")
                .unwrap_or_else(|| "Catalog".to_owned()),
        ),
    );
    details.insert(
        "catalog_number".to_owned(),
        read_string_literal(&embedded, "catalogNo1")
            .or_else(|| detail_str(&table, "catalog"))
            .map(Value::String)
            .unwrap_or(Value::Null),
    );
    details.insert(
        "country".to_owned(),
        read_string_literal(&embedded, "country")
            .or_else(|| detail_str(&table, "region"))
            .map(Value::String)
            .unwrap_or(Value::Null),
    );
    details.insert(
        "region".to_owned(),
        detail_str(&table, "region")
            .or_else(|| read_string_literal(&embedded, "countryCode"))
            .map(Value::String)
            .unwrap_or(Value::Null),
    );
    details.insert(
        "display_grade".to_owned(),
        display_grade
            .clone()
            .map(Value::String)
            .unwrap_or(Value::Null),
    );
    details.insert(
        "grade_desc".to_owned(),
        grade_desc.clone().map(Value::String).unwrap_or(Value::Null),
    );
    details.insert(
        "grade".to_owned(),
        normalize_grade(display_grade.as_deref(), grade_desc.as_deref(), opq)
            .map(Value::String)
            .unwrap_or(Value::Null),
    );
    details.insert(
        "details".to_owned(),
        banknote_details
            .clone()
            .map(Value::String)
            .unwrap_or(Value::Null),
    );
    details.insert(
        "banknote_details".to_owned(),
        banknote_details.map(Value::String).unwrap_or(Value::Null),
    );
    details.insert(
        "security".to_owned(),
        detail_str(&table, "security")
            .map(Value::String)
            .unwrap_or(Value::Null),
    );
    details.insert(
        "population".to_owned(),
        read_number_literal(&embedded, "population")
            .map(|number| json!(number))
            .unwrap_or_else(|| table_number_or_null(&table, "population")),
    );
    details.insert(
        "pop_higher".to_owned(),
        read_number_literal(&embedded, "popHigher")
            .map(|number| json!(number))
            .unwrap_or_else(|| table_number_or_null(&table, "pop_higher")),
    );
    details.insert(
        "opq".to_owned(),
        opq.map(Value::Bool).unwrap_or(Value::Null),
    );
    details.insert(
        "nfc_secure".to_owned(),
        read_boolean_literal(&embedded, "isNFCSecure")
            .map(Value::Bool)
            .unwrap_or(Value::Null),
    );
    details.insert("source_url".to_owned(), Value::String(page_url.to_owned()));

    ParsedScrape {
        cert_number,
        details,
        images: extract_embedded_images(&embedded),
    }
}

// --- TQG ---

/// Extracts the TQG query folder: last `/query/<folder>` path
/// segment, case-insensitive, else `None`.
pub fn tqg_query_folder(page_url: &str) -> Option<String> {
    let pathname = url::Url::parse(page_url).ok()?.path().to_owned();
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?i)/query/([^/]+)$").expect("static regex"))
        .captures(&pathname)
        .and_then(|captures| captures.get(1))
        .map(|group| group.as_str().to_owned())
}

/// Reads a label cell's text with `span` descendants
/// removed, trimmed, one trailing colon stripped.
fn tqg_cell_text(cell: scraper::ElementRef<'_>) -> String {
    let inner = cell.inner_html();
    static SPAN: OnceLock<Regex> = OnceLock::new();
    let without_spans = SPAN
        .get_or_init(|| Regex::new(r"(?is)<span[^>]*>.*?</span>").expect("static regex"))
        .replace_all(&inner, "");
    let fragment = Html::parse_fragment(&without_spans);
    let text: String = fragment.root_element().text().collect();
    strip_trailing_colon(text.trim())
}

pub fn parse_tqg(html: &str, page_url: &str, note: &NoteRef) -> ParsedScrape {
    let document = Html::parse_document(html);
    let row_sel = Selector::parse(".query_wrap table tr").expect("static selector");
    let cell_sel = Selector::parse("td").expect("static selector");
    let img_sel = Selector::parse(".query_wrap .thumbs img").expect("static selector");

    let mut details = Map::new();
    for row in document.select(&row_sel) {
        let cells: Vec<_> = row.select(&cell_sel).collect();
        if cells.len() < 2 {
            continue;
        }
        let label = tqg_cell_text(cells[0]);
        let value = element_text(cells[1]).trim().to_owned();
        if !label.is_empty() && !value.is_empty() {
            details.insert(normalize_label(&label), Value::String(value));
        }
    }

    let mut images = Vec::new();
    for (index, img) in document.select(&img_sel).enumerate() {
        let Some(src) = img.value().attr("src") else {
            continue;
        };
        let Some(url) = resolve_url(page_url, src) else {
            continue;
        };
        let side = match index {
            // Stored swapped on purpose: the first site image belongs on the
            // back slot and the second on the front slot (see `pmg_side`).
            0 => "back".to_owned(),
            1 => "front".to_owned(),
            _ => format!("image_{}", index + 1),
        };
        images.push(ScrapedImage {
            side,
            variant: "full".to_owned(),
            url,
        });
    }

    let cert_number = tqg_query_folder(page_url)
        .or_else(|| note.serial.clone())
        .or_else(|| note.catalog_number.clone())
        .or_else(|| note.id.clone())
        .unwrap_or_default();

    details.insert("source_url".to_owned(), Value::String(page_url.to_owned()));
    ParsedScrape {
        cert_number,
        details,
        images,
    }
}

// ---------------------------------------------------------------------------
// Browser-attach fetch (via `chromiumoxide`)
// ---------------------------------------------------------------------------

/// Best-effort OS command that raises the scrape browser window above the
/// Editor so autopopulate bot checks are visible. Returns `(program, args)`
/// per platform vocabulary (`win32`/`darwin`, else `None`). Only the Chrome
/// running the `noteharbor-cdp` profile is targeted — the user's normal
/// Chrome windows are left alone. Failures are ignored by the caller:
/// scraping still succeeds, the window just stays behind.
pub fn scrape_browser_focus_command(platform: &str) -> Option<(String, Vec<String>)> {
    match platform {
        "win32" => Some((
            "powershell".to_owned(),
            vec![
                "-NoProfile".to_owned(),
                "-NonInteractive".to_owned(),
                "-Command".to_owned(),
                "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class NHF { [DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(IntPtr hWnd); [DllImport(\"user32.dll\")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow); }'; Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { $_.CommandLine -like '*noteharbor-cdp*' } | ForEach-Object { $p = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue; if ($p -and $p.MainWindowHandle -ne 0) { [NHF]::ShowWindow($p.MainWindowHandle, 9) | Out-Null; [NHF]::SetForegroundWindow($p.MainWindowHandle) | Out-Null } }".to_owned(),
            ],
        )),
        "darwin" => Some((
            "sh".to_owned(),
            vec![
                "-c".to_owned(),
                r#"for pid in $(pgrep -f noteharbor-cdp 2>/dev/null); do osascript -e "tell application \"System Events\" to set frontmost of (first process whose unix id is $pid) to true" >/dev/null 2>&1; done"#
                    .to_owned(),
            ],
        )),
        _ => None,
    }
}

/// Best-effort OS-level Chrome focus so the autopopulate browser window
/// comes forward for bot checks. CDP `Page.bringToFront` only activates the
/// tab inside Chrome; it does not raise the OS window above the Editor.
/// Failures are ignored: scraping still succeeds, the window just stays
/// behind. Win/macOS-only (the shell only launches Chrome there).
async fn focus_scrape_browser_window() {
    let platform = if cfg!(target_os = "windows") {
        "win32"
    } else if cfg!(target_os = "macos") {
        "darwin"
    } else {
        return;
    };
    let Some((program, args)) = scrape_browser_focus_command(platform) else {
        return;
    };
    let run = tokio::process::Command::new(program).args(args).output();
    let _ = tokio::time::timeout(Duration::from_secs(3), run).await;
}

/// Attach-only fetch: connect over CDP (never launch),
/// reuse the last matching tab or open-navigate when `open_if_missing`,
/// settle `wait_seconds`, then return `page.content()`.
/// Dropping `Browser` disconnects without killing the user's browser —
/// so unlike the launch flow, nothing is closed here.
pub async fn fetch_html(
    url: &str,
    cdp_url: &str,
    wait_seconds: f64,
    open_if_missing: bool,
    navigation_timeout_ms: Option<&Value>,
) -> Result<String, String> {
    if !wait_seconds.is_finite() || wait_seconds < 0.0 {
        return Err("waitSeconds must be a non-negative number".to_owned());
    }
    if cdp_url.is_empty() {
        return Err("A CDP URL is required".to_owned());
    }
    let navigation_timeout = normalize_navigation_timeout_ms(navigation_timeout_ms);

    let (mut browser, mut handler) = chromiumoxide::Browser::connect(cdp_url.to_owned())
        .await
        .map_err(|error| format!("{}\n{error}", build_cdp_hint(cdp_url)))?;
    tokio::spawn(async move {
        use futures::StreamExt;
        while handler.next().await.is_some() {}
    });

    // Pick up tabs that were already open before we attached.
    // `browser.pages()` only reports targets the handler has finished
    // attaching, which lags `fetch_targets` (empty when read immediately),
    // so match against the returned `TargetInfo` list instead: top-level
    // `page` targets only — OOPIF `iframe` targets share `type == "page"`
    // but carry `parent_frame_id`.
    let targets = browser
        .fetch_targets()
        .await
        .map_err(|error| error.to_string())?;
    let top_pages: Vec<(TargetId, String)> = targets
        .iter()
        .filter(|target| target.r#type == "page" && target.parent_frame_id.is_none())
        .map(|target| (target.target_id.clone(), target.url.clone()))
        .collect();
    let urls: Vec<String> = top_pages
        .iter()
        .map(|(_, page_url)| page_url.clone())
        .collect();
    match resolve_page_plan(&urls, url, open_if_missing) {
        Ok(PagePlan::Reuse(index)) => {
            let target_id = top_pages
                .get(index)
                .map(|(id, _)| id.clone())
                .ok_or_else(|| "Browser tab vanished.".to_owned())?;
            // Attaching to a pre-existing target can lag `fetch_targets`;
            // poll briefly before giving up on the tab.
            let mut page = None;
            for _ in 0..30 {
                match browser.get_page(target_id.clone()).await {
                    Ok(attached) => {
                        page = Some(attached);
                        break;
                    }
                    Err(_) => tokio::time::sleep(Duration::from_millis(100)).await,
                }
            }
            let page = match page {
                Some(attached) => attached,
                // The tab vanished mid-scrape: open fresh when allowed.
                None if open_if_missing && is_http_url(url) => {
                    return open_fresh_page(&browser, url, wait_seconds, navigation_timeout)
                        .await;
                }
                None => return Err("Browser tab vanished.".to_owned()),
            };
            // Activate the already-open tab (previously missing, so the tab
            // stayed in the background) and raise the Chrome OS window so the
            // user sees the page used for the scrape.
            let _ = page.bring_to_front().await;
            focus_scrape_browser_window().await;
            if wait_seconds > 0.0 {
                tokio::time::sleep(Duration::from_secs_f64(wait_seconds)).await;
            }
            page.content().await.map_err(|error| error.to_string())
        }
        Ok(PagePlan::OpenNew) => {
            open_fresh_page(&browser, url, wait_seconds, navigation_timeout).await
        }
        Err(error) => Err(error),
    }
}

/// Opens a new tab, navigates it to `url`, settles `wait_seconds`, and
/// returns `page.content()`. A failed navigation leaves the tab open for the
/// user, and the error propagates — mirroring `openMissingPage`.
async fn open_fresh_page(
    browser: &chromiumoxide::Browser,
    url: &str,
    wait_seconds: f64,
    navigation_timeout: u64,
) -> Result<String, String> {
    let page = browser
        .new_page("about:blank")
        .await
        .map_err(|error| error.to_string())?;
    page.bring_to_front()
        .await
        .map_err(|error| error.to_string())?;
    // A new tab in an existing window does not raise the OS window
    // above the Editor on its own; focus it for bot checks.
    focus_scrape_browser_window().await;
    let navigated = tokio::time::timeout(
        Duration::from_millis(navigation_timeout),
        page.goto(url.to_owned()),
    )
    .await
    .map_err(|_| {
        format!("Navigation timeout of {navigation_timeout}ms exceeded for {url}")
    });
    match navigated {
        Ok(Ok(_)) => {}
        Ok(Err(error)) => return Err(error.to_string()),
        Err(error) => return Err(error),
    }
    if wait_seconds > 0.0 {
        tokio::time::sleep(Duration::from_secs_f64(wait_seconds)).await;
    }
    page.content().await.map_err(|error| error.to_string())
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct PreviewPayload {
    url: Option<Value>,
    #[serde(rename = "timeoutMs")]
    timeout_ms: Option<Value>,
}

/// `POST /api/scrape/preview`: validates before touching a browser (400s),
/// then answers `{ scraped_data, images }`; fetch/parse failures are 500s.
/// Nothing is written to disk or the DB.
async fn preview(body: Option<Json<PreviewPayload>>) -> Response {
    let url = body
        .as_ref()
        .and_then(|Json(payload)| payload.url.as_ref())
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_owned();
    if url.is_empty() {
        return bad_request("A URL is required.");
    }
    let kind = match scraper_for_note(&url, "") {
        Some(kind) => kind,
        None => return bad_request(NO_SCRAPER_MESSAGE),
    };
    let timeout_ms = body
        .as_ref()
        .and_then(|Json(payload)| payload.timeout_ms.as_ref());
    // `timeoutMs` is cloned out of the request guard (which is not `Clone`)
    // so the fetch future owns its input.
    let timeout_value: Option<Value> = timeout_ms.cloned();
    let html = match fetch_html(
        &url,
        &browser_cdp_url(),
        DEFAULT_WAIT_SECONDS,
        true,
        timeout_value.as_ref(),
    )
    .await
    {
        Ok(html) => html,
        Err(message) => {
            // Keeps the `isNoScraper` status mapping: the
            // early return above already covers it, but the mapping stays so
            // a future fetch path that throws selection errors keeps the 400.
            let status = if message.contains(NO_SCRAPER_MESSAGE) {
                axum::http::StatusCode::BAD_REQUEST
            } else {
                axum::http::StatusCode::INTERNAL_SERVER_ERROR
            };
            return (status, Json(json!({ "error": message }))).into_response();
        }
    };
    let note = NoteRef::for_preview();
    let parsed = match kind {
        ScraperKind::Pmg => parse_pmg(&html, &url, &note),
        ScraperKind::Pcgs => parse_pcgs(&html, &url, &note),
        ScraperKind::Tqg => parse_tqg(&html, &url, &note),
    };
    (
        axum::http::StatusCode::OK,
        Json(json!({
            "scraped_data": Value::Object(parsed.details),
            "images": parsed.images.iter().map(|image| json!({
                "type": image.side,
                "variant": image.variant,
                "sourceUrl": image.url,
            })).collect::<Vec<_>>(),
        })),
    )
        .into_response()
}

pub fn scrape_router() -> Router<crate::AppState> {
    Router::new().route("/api/scrape/preview", post(preview))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn note(note_id: i64, catalog: Option<&str>, serial: Option<&str>) -> NoteRef {
        NoteRef {
            id: Some(note_id.to_string()),
            catalog_number: catalog.map(str::to_owned),
            serial: serial.map(str::to_owned),
        }
    }

    // --- PMG (port of `scrapers.test.js`) ---

    #[test]
    fn pmg_parses_details_cert_comments_and_both_image_sides() {
        let html = r#"
    <div class="certlookup-wrapper">
      <dl><dt>PMG Cert:</dt><dd>12345</dd></dl>
      <dl><dt>Grade:</dt><dd>65</dd></dl>
    </div>
    <div class="certlookup-images-item">
      <a href="https://images.example.com/full-front.jpg"><img title="Obverse" src="https://images.example.com/thumb-front.jpg" /></a>
    </div>
    <div class="certlookup-images-item">
      <a href="https://images.example.com/full-back.jpg"><img title="Reverse" src="https://images.example.com/thumb-back.jpg" /></a>
    </div>
    <p class="certlookup-disclaimer">Guaranteed genuine.</p>
  "#;
        let page_url = "https://www.pmgnotes.com/cert/12345";
        let parsed = parse_pmg(html, page_url, &note(7, None, None));

        assert_eq!(parsed.cert_number, "12345");
        assert_eq!(parsed.details.get("pmg_cert"), Some(&json!("12345")));
        assert_eq!(parsed.details.get("grade"), Some(&json!("65")));
        assert_eq!(parsed.details.get("source_url"), Some(&json!(page_url)));
        assert_eq!(
            parsed.details.get("page_comments"),
            Some(&json!("Guaranteed genuine."))
        );

        let by_url: std::collections::HashMap<&str, &ScrapedImage> = parsed
            .images
            .iter()
            .map(|image| (image.url.as_str(), image))
            .collect();
        // Sides are stored swapped on purpose (site labels come out
        // reversed): Obverse lands on the back slot, Reverse on the front.
        assert_eq!(
            by_url
                .get("https://images.example.com/full-front.jpg")
                .map(|image| (image.side.as_str(), image.variant.as_str())),
            Some(("back", "full"))
        );
        assert_eq!(
            by_url
                .get("https://images.example.com/full-back.jpg")
                .map(|image| (image.side.as_str(), image.variant.as_str())),
            Some(("front", "full"))
        );
        assert_eq!(
            by_url
                .get("https://images.example.com/thumb-front.jpg")
                .map(|image| (image.side.as_str(), image.variant.as_str())),
            Some(("back", "thumbnail"))
        );
        assert_eq!(
            by_url
                .get("https://images.example.com/thumb-back.jpg")
                .map(|image| (image.side.as_str(), image.variant.as_str())),
            Some(("front", "thumbnail"))
        );
    }

    #[test]
    fn pmg_falls_back_to_catalog_number_when_page_has_no_cert() {
        let parsed = parse_pmg(
            "<div></div>",
            "https://x.example/",
            &note(7, Some("P-22"), None),
        );
        assert_eq!(parsed.cert_number, "P-22");
    }

    // --- PCGS ---

    #[test]
    fn pcgs_parses_embedded_grade_cert_and_images() {
        let html = r#"
    <html><body>
    <table><tr><td>Region:</td><td>Romania</td></tr></table>
    <script>const data = [{certNo:"999",displayGrade:"65",gradeDesc:"Gem Unc 65",opq:true,population:12,popHigher:3,country:"Romania",denomination:"5 Lei",currencySerialNumber:"A1",currencyDate:"1920",specNo:"S1",displayNoteNo:"N1",catalogNo1:"P-1",catalog1LongDesc:"Pick",banknoteDetails:"crisp",isNFCSecure:false,images:[{showThumbnail:true,label:"Obverse",downloadUrl:"https:\/\/i.example\/f.jpg",thumbnailUrl:"https:\/\/i.example\/t.jpg",popupUrl:"https:\/\/i.example\/p.jpg"}]}]; Promise.all([])</script>
    </body></html>
  "#;
        let page_url = "https://www.pcgs.com/banknotes/cert/999";
        let parsed = parse_pcgs(html, page_url, &note(9, None, None));

        assert_eq!(parsed.cert_number, "999");
        assert_eq!(parsed.details.get("grade"), Some(&json!("65 PPQ")));
        assert_eq!(parsed.details.get("serial_number"), Some(&json!("A1")));
        assert_eq!(parsed.details.get("country"), Some(&json!("Romania")));
        assert_eq!(parsed.details.get("source_url"), Some(&json!(page_url)));

        let by_url: std::collections::HashMap<&str, &ScrapedImage> = parsed
            .images
            .iter()
            .map(|image| (image.url.as_str(), image))
            .collect();
        let full = by_url.get("https://i.example/p.jpg").expect("full image");
        // Obverse is stored swapped onto the back slot (see `pmg_side`).
        assert_eq!(full.side, "back");
        assert_eq!(full.variant, "full");
        let thumbnail = by_url.get("https://i.example/t.jpg").expect("thumbnail");
        assert_eq!(thumbnail.side, "back");
        assert_eq!(thumbnail.variant, "thumbnail");
    }

    // --- TQG ---

    #[test]
    fn tqg_parses_query_table_and_resolves_images_against_page() {
        let html = r#"
    <div class="query_wrap">
      <table>
        <tr><td>Grade:</td><td>66</td></tr>
        <tr><td>Serial:</td><td>X9</td></tr>
      </table>
      <div class="thumbs"><img src="/img/front.jpg" /><img src="/img/back.jpg" /></div>
    </div>
  "#;
        let page_url = "https://tqggrading.com/query/ABC123";
        let parsed = parse_tqg(html, page_url, &note(3, None, None));

        assert_eq!(parsed.cert_number, "ABC123");
        assert_eq!(parsed.details.get("grade"), Some(&json!("66")));
        assert_eq!(parsed.details.get("serial"), Some(&json!("X9")));
        assert_eq!(parsed.details.get("source_url"), Some(&json!(page_url)));
        assert_eq!(
            parsed.images,
            vec![
                ScrapedImage {
                    side: "back".to_owned(),
                    variant: "full".to_owned(),
                    url: "https://tqggrading.com/img/front.jpg".to_owned(),
                },
                ScrapedImage {
                    side: "front".to_owned(),
                    variant: "full".to_owned(),
                    url: "https://tqggrading.com/img/back.jpg".to_owned(),
                },
            ]
        );
    }

    #[test]
    fn tqg_falls_back_to_serial_when_url_has_no_query_folder() {
        let parsed = parse_tqg(
            r#"<div class="query_wrap"></div>"#,
            "https://x.example/",
            &note(3, None, Some("S-1")),
        );
        assert_eq!(parsed.cert_number, "S-1");
    }

    // --- Selection (port of `scrape.test.js`) ---

    #[test]
    fn pmg_url_selects_pmg() {
        assert_eq!(
            scraper_for_note("https://www.pmgnotes.com/cert/123", ""),
            Some(ScraperKind::Pmg)
        );
    }

    #[test]
    fn pmg_company_selects_pmg_without_url_match() {
        assert_eq!(
            scraper_for_note("https://example.com/x", "PMG"),
            Some(ScraperKind::Pmg)
        );
    }

    #[test]
    fn pcgs_cert_url_selects_pcgs() {
        assert_eq!(
            scraper_for_note("https://www.pcgs.com/banknotes/cert/123", ""),
            Some(ScraperKind::Pcgs)
        );
    }

    #[test]
    fn tqg_url_or_company_selects_tqg() {
        assert_eq!(
            scraper_for_note("https://tqggrading.com/query/abc", ""),
            Some(ScraperKind::Tqg)
        );
        assert_eq!(
            scraper_for_note("https://example.com/x", "tqg"),
            Some(ScraperKind::Tqg)
        );
    }

    #[test]
    fn unknown_site_selects_no_scraper() {
        assert_eq!(scraper_for_note("https://example.com/cert/1", ""), None);
        assert_eq!(scraper_for_note("", ""), None);
    }

    // --- Timeout + URL helpers ---

    #[test]
    fn navigation_timeout_falls_back_for_missing_or_invalid_values() {
        assert_eq!(normalize_navigation_timeout_ms(None), 30_000);
        assert_eq!(normalize_navigation_timeout_ms(Some(&Value::Null)), 30_000);
        assert_eq!(
            normalize_navigation_timeout_ms(Some(&json!("nope"))),
            30_000
        );
        assert_eq!(normalize_navigation_timeout_ms(Some(&json!(0))), 30_000);
        assert_eq!(normalize_navigation_timeout_ms(Some(&json!(-10))), 30_000);
    }

    #[test]
    fn navigation_timeout_clamps_to_allowed_range() {
        assert_eq!(normalize_navigation_timeout_ms(Some(&json!(1000))), 5_000);
        assert_eq!(
            normalize_navigation_timeout_ms(Some(&json!(60_000))),
            60_000
        );
        assert_eq!(
            normalize_navigation_timeout_ms(Some(&json!(999_999))),
            120_000
        );
        assert_eq!(
            normalize_navigation_timeout_ms(Some(&json!("45000"))),
            45_000
        );
    }

    fn pages(urls: &[&str]) -> Vec<String> {
        urls.iter().map(|url| url.to_string()).collect()
    }

    #[test]
    fn reuses_matching_tab_ignoring_hash_and_trailing_slash() {
        let tabs = pages(&["about:blank", "https://www.pmgnotes.com/certlookup/12345/"]);
        let plan = resolve_page_plan(
            &tabs,
            "https://www.pmgnotes.com/certlookup/12345#details",
            false,
        )
        .expect("matches");
        assert_eq!(plan, PagePlan::Reuse(1));
    }

    #[test]
    fn ignores_chrome_devtools_tabs() {
        let tabs = pages(&[
            "chrome-devtools://devtools/bundled/inspector.html",
            "https://www.pcgs.com/banknotes/cert/456",
        ]);
        let error = resolve_page_plan(
            &tabs,
            "chrome-devtools://devtools/bundled/inspector.html",
            false,
        )
        .expect_err("no match");
        assert!(
            error.contains("No open browser tab matches the requested URL"),
            "{error}"
        );
    }

    #[test]
    fn throws_when_no_tab_matches_and_open_if_missing_is_false() {
        let tabs = pages(&["https://www.pmgnotes.com/certlookup/1"]);
        let error = resolve_page_plan(&tabs, "https://www.pmgnotes.com/certlookup/999", false)
            .expect_err("no match");
        assert!(
            error.contains("No open browser tab matches the requested URL"),
            "{error}"
        );
    }

    #[test]
    fn opens_new_tab_when_open_if_missing_is_true() {
        let tabs = pages(&["https://www.pmgnotes.com/certlookup/1"]);
        assert_eq!(
            resolve_page_plan(&tabs, "https://www.pmgnotes.com/certlookup/999", true),
            Ok(PagePlan::OpenNew)
        );
    }

    #[test]
    fn still_reuses_matching_tab_when_open_if_missing_is_true() {
        let tabs = pages(&["https://www.pmgnotes.com/certlookup/999"]);
        assert_eq!(
            resolve_page_plan(&tabs, "https://www.pmgnotes.com/certlookup/999", true),
            Ok(PagePlan::Reuse(0))
        );
    }

    #[test]
    fn reuses_original_tab_index_when_devtools_tabs_precede_match() {
        // Regression: the reuse index must address the caller's tab list, not
        // the devtools-filtered list, or the scrape reads the wrong tab.
        let tabs = pages(&[
            "chrome-devtools://devtools/bundled/inspector.html",
            "https://www.pmgnotes.com/certlookup/1",
            "https://www.pmgnotes.com/certlookup/999",
        ]);
        assert_eq!(
            resolve_page_plan(&tabs, "https://www.pmgnotes.com/certlookup/999", true),
            Ok(PagePlan::Reuse(2))
        );
    }

    #[test]
    fn canonical_key_ignores_pmg_grade_suffix_query_and_case() {
        assert_eq!(
            canonical_scrape_key("https://www.pmgnotes.com/certlookup/2258889-039/25/"),
            Some((ScraperKind::Pmg, "2258889-039".to_owned()))
        );
        assert_eq!(
            canonical_scrape_key("https://www.pmgnotes.com/certlookup/2258889-039/?x=1#y"),
            Some((ScraperKind::Pmg, "2258889-039".to_owned()))
        );
        assert_eq!(
            canonical_scrape_key("https://www.pcgs.com/banknotes/cert/999?foo=bar"),
            Some((ScraperKind::Pcgs, "999".to_owned()))
        );
        assert_eq!(
            canonical_scrape_key("https://tqggrading.com/query/ABC123/"),
            Some((ScraperKind::Tqg, "abc123".to_owned()))
        );
        assert_eq!(canonical_scrape_key("https://example.com/cert/1"), None);
        assert_eq!(
            canonical_scrape_key("https://www.pmgnotes.com/certlookup/"),
            None
        );
        assert_eq!(canonical_scrape_key("file:///etc/passwd"), None);
    }

    #[test]
    fn reuses_same_note_tab_when_grade_suffix_differs() {
        let tabs = pages(&["https://www.pmgnotes.com/certlookup/2258889-039/25/"]);
        assert_eq!(
            resolve_page_plan(&tabs, "https://www.pmgnotes.com/certlookup/2258889-039/", true),
            Ok(PagePlan::Reuse(0))
        );
        // And the reverse direction: stored URL has the suffix, tab does not.
        let tabs = pages(&["https://www.pmgnotes.com/certlookup/2258889-039/"]);
        assert_eq!(
            resolve_page_plan(
                &tabs,
                "https://www.pmgnotes.com/certlookup/2258889-039/25/",
                true
            ),
            Ok(PagePlan::Reuse(0))
        );
    }

    #[test]
    fn different_notes_never_key_match() {
        let tabs = pages(&["https://www.pmgnotes.com/certlookup/111/25/"]);
        assert_eq!(
            resolve_page_plan(&tabs, "https://www.pmgnotes.com/certlookup/222", true),
            Ok(PagePlan::OpenNew)
        );
        // Different sites sharing an id segment are different notes.
        let tabs = pages(&["https://tqggrading.com/query/999"]);
        assert_eq!(
            resolve_page_plan(&tabs, "https://www.pcgs.com/banknotes/cert/999", true),
            Ok(PagePlan::OpenNew)
        );
    }

    #[test]
    fn refuses_to_open_non_web_url() {
        let error =
            resolve_page_plan(&pages(&[]), "file:///etc/passwd", true).expect_err("refused");
        assert!(error.contains("Refusing to open a non-web URL"), "{error}");
    }

    #[test]
    fn rejects_missing_requested_url() {
        let error = resolve_page_plan(&pages(&[]), "  ", false).expect_err("rejected");
        assert!(error.contains("No requested URL was provided"), "{error}");
    }

    #[test]
    fn focus_command_targets_only_the_scrape_browser_profile() {
        let (program, args) = scrape_browser_focus_command("win32").expect("windows focus");
        assert_eq!(program, "powershell");
        let script = args.last().expect("script arg");
        assert!(
            script.contains("noteharbor-cdp"),
            "must scope to the scrape profile: {script}"
        );
        assert!(
            !script.contains("Get-Process chrome -ErrorAction"),
            "must not raise every Chrome window: {script}"
        );
        let (program, args) = scrape_browser_focus_command("darwin").expect("mac focus");
        assert_eq!(program, "sh");
        assert!(
            args.iter().any(|arg| arg.contains("noteharbor-cdp")),
            "must scope to the scrape profile: {args:?}"
        );
        assert_eq!(scrape_browser_focus_command("linux"), None);
    }

    #[test]
    fn cdp_hint_points_at_json_version() {
        let hint = build_cdp_hint("http://localhost:9222/");
        assert!(
            hint.contains("http://localhost:9222/json/version"),
            "{hint}"
        );
        assert!(hint.contains("NOTE_HARBOR_BROWSER_CDP_URL"), "{hint}");
    }
}

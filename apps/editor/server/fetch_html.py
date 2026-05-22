#!/usr/bin/env python3
"""Fetch raw HTML from a matching open tab on a CDP-connected browser."""

import argparse
import asyncio
import sys
from urllib.parse import urldefrag
from typing import Optional

from playwright.async_api import async_playwright


def build_cdp_hint(cdp_url: str) -> str:
    return (
        "Unable to reach the configured CDP browser endpoint. "
        f"Verify {cdp_url.rstrip('/')}/json/version is reachable from the server environment. "
        "If the server runs in WSL and Chrome runs on Windows, launch Chrome with "
        "--remote-debugging-port=9222 --remote-debugging-address=0.0.0.0 and point "
        "NOTE_HARBOR_BROWSER_CDP_URL at the Windows host IP instead of localhost if needed."
    )


def normalize_url(url: str) -> str:
    return urldefrag((url or "").strip()).url.rstrip("/")


def describe_open_pages(real_pages) -> str:
    if not real_pages:
        return "(no open browser tabs)"
    return "\n".join(f"- {page.url or 'about:blank'}" for page in real_pages)


def select_open_page(browser, requested_url: str):
    pages = [page for context in browser.contexts for page in context.pages]
    real_pages = [page for page in pages if not page.url.startswith("chrome-devtools://")]
    non_blank_pages = [page for page in real_pages if page.url and page.url != "about:blank"]
    normalized_requested_url = normalize_url(requested_url)

    if normalized_requested_url:
        matching_pages = [
            page for page in non_blank_pages if normalize_url(page.url) == normalized_requested_url
        ]
        if matching_pages:
            return matching_pages[-1]

        raise RuntimeError(
            "No open browser tab matches the requested URL. "
            f"Requested: {requested_url}\n"
            f"Open tabs:\n{describe_open_pages(real_pages)}"
        )

    raise RuntimeError("No requested URL was provided for open-tab selection.")


async def fetch_open_tab_html(cdp_url: str, requested_url: str, wait_seconds: float) -> str:
    try:
        async with async_playwright() as playwright:
            browser = await playwright.chromium.connect_over_cdp(cdp_url)
            page = select_open_page(browser, requested_url)

            if wait_seconds > 0:
                await asyncio.sleep(wait_seconds)

            return await page.content()
    except Exception as exc:
        if "CDP endpoint" in str(exc) or "connect_over_cdp" in str(exc):
            print(build_cdp_hint(cdp_url), file=sys.stderr)
        raise


async def fetch(
    url: str,
    wait_seconds: float,
    cdp_url: Optional[str] = None,
) -> None:
    if wait_seconds < 0:
        raise ValueError("wait_seconds must be non-negative")

    if not cdp_url:
        raise ValueError("A CDP URL is required")

    html = await fetch_open_tab_html(cdp_url, url, wait_seconds)
    sys.stdout.buffer.write(html.encode("utf-8"))


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Fetch a page with crawl4ai and print HTML to stdout."
    )
    parser.add_argument("url", help="URL to fetch")
    parser.add_argument(
        "--wait",
        type=float,
        default=10.0,
        help="Seconds to wait before capturing HTML from the matching open tab (default: 10)",
    )
    parser.add_argument(
        "--cdp-url",
        default=None,
        required=True,
        help="Chrome DevTools Protocol endpoint for the browser that already has the page open",
    )
    args = parser.parse_args()
    asyncio.run(fetch(args.url, args.wait, args.cdp_url))


if __name__ == "__main__":
    main()

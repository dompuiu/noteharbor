#!/usr/bin/env python3
"""Fetch a page with crawl4ai and print the raw HTML to stdout.

Usage:
  # Fetch a page (prints HTML to stdout):
  python fetch_html.py <url> [--wait 10] [--profile-dir storage/browser_profiles/pmg]

  # Open a persistent browser so you can solve bot challenges and save the session:
  python fetch_html.py --prepare <url> [--profile-dir storage/browser_profiles/pmg]
"""

import argparse
import asyncio
import json
import sys
from pathlib import Path

from crawl4ai import AsyncWebCrawler
from crawl4ai.async_configs import BrowserConfig, CrawlerRunConfig


async def fetch(url: str, wait_seconds: float, profile_dir: str = None) -> None:
    browser_config = BrowserConfig(headless=False, user_data_dir=profile_dir or None)
    run_config = CrawlerRunConfig(wait_for=".certlookup-details")

    async with AsyncWebCrawler(config=browser_config) as crawler:
        result = await crawler.arun(url=url, config=run_config)

    if not result.success:
        print(f"Crawl failed: {result.error_message}", file=sys.stderr)
        sys.exit(1)

    sys.stdout.buffer.write((result.html or "").encode("utf-8"))


async def prepare(url: str, profile_dir: str) -> None:
    """Open a persistent browser for bot bypass. Keeps running until the browser is closed."""
    from playwright.async_api import async_playwright

    Path(profile_dir).mkdir(parents=True, exist_ok=True)

    async with async_playwright() as p:
        context = await p.chromium.launch_persistent_context(
            user_data_dir=profile_dir,
            headless=False,
            args=["--start-maximized"],
        )
        pages = context.pages
        page = pages[0] if pages else await context.new_page()
        await page.goto(url, wait_until="domcontentloaded")
        await page.bring_to_front()
        print(json.dumps({"status": "open", "url": url}), flush=True)
        await context.wait_for_event("close")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Fetch a page with crawl4ai and print HTML to stdout."
    )
    parser.add_argument("url", help="URL to fetch")
    parser.add_argument(
        "--prepare",
        action="store_true",
        help="Open a persistent browser for bot bypass instead of fetching",
    )
    parser.add_argument(
        "--wait",
        type=float,
        default=10.0,
        help="Seconds to wait after page load before capturing HTML (default: 10)",
    )
    parser.add_argument(
        "--profile-dir",
        default=None,
        help="Persistent browser profile directory for session reuse",
    )
    args = parser.parse_args()

    if args.prepare:
        if not args.profile_dir:
            print("Error: --profile-dir is required with --prepare", file=sys.stderr)
            sys.exit(1)
        asyncio.run(prepare(args.url, args.profile_dir))
    else:
        asyncio.run(fetch(args.url, args.wait, args.profile_dir))


if __name__ == "__main__":
    main()

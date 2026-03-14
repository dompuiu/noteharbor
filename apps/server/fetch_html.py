#!/usr/bin/env python3
"""Fetch a page with crawl4ai and print the raw HTML to stdout."""

import argparse
import asyncio
import sys

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


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Fetch a page with crawl4ai and print HTML to stdout."
    )
    parser.add_argument("url", help="URL to fetch")
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
    asyncio.run(fetch(args.url, args.wait, args.profile_dir))


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Build the static Portfolio AI market-news snapshot.

Uses only the Python standard library so GitHub Actions needs no pip install.
The NewsData API key is embedded for this demo build and is never written to news.json.
"""

from __future__ import annotations

import json
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

BASE_URL = "https://newsdata.io/api/1/market"
NEWSDATA_API_KEY = "pub_0eb8966ea9f248b49dff1a609b7a8782"
ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "news.json"

QUERIES = {
    "portfolio": 'gold OR oil OR bitcoin OR ethereum OR "S&P 500" OR Nasdaq',
    "markets": '"financial markets" OR economy OR "central bank" OR earnings',
    "stocks": 'Nvidia OR Apple OR Microsoft OR Tesla OR "S&P 500" OR Nasdaq',
    "crypto": 'bitcoin OR ethereum OR solana OR XRP',
    "forex": 'forex OR "US dollar" OR euro OR sterling OR yen OR rand',
    "commodities": 'gold OR silver OR "crude oil" OR Brent OR WTI',
    "south-africa": '"South Africa" OR JSE OR rand OR Johannesburg',
}

LABELS = {
    "portfolio": "Major Assets",
    "markets": "Markets",
    "stocks": "Stocks",
    "crypto": "Crypto",
    "forex": "Forex",
    "commodities": "Commodities",
    "south-africa": "South Africa",
}


def load_existing():
    if not OUTPUT.exists():
        return {"schema_version": 1, "updated_at": None, "provider": "NewsData.io", "markets": {}}
    try:
        return json.loads(OUTPUT.read_text(encoding="utf-8"))
    except Exception:
        return {"schema_version": 1, "updated_at": None, "provider": "NewsData.io", "markets": {}}


def clean_article(item):
    item = item or {}
    return {
        "title": item.get("title") or "Financial market update",
        "url": item.get("link") or "",
        "socialimage": item.get("image_url") or "",
        "seendate": item.get("pubDate") or item.get("pubDateTZ") or "",
        "language": item.get("language") or "English",
        "domain": item.get("source_id") or item.get("source_name") or "",
        "sourceName": item.get("source_name") or item.get("source_id") or "Market news",
        "description": item.get("description") or "",
        "sentiment": item.get("sentiment") or "",
    }


def dedupe(items):
    seen = set()
    output = []
    for item in items:
        key = ((item.get("url") or "").strip().lower() or (item.get("title") or "").strip().lower())
        if not key or key in seen:
            continue
        seen.add(key)
        output.append(item)
    return output


def fetch_category(api_key, category, query):
    params = urllib.parse.urlencode({
        "apikey": api_key,
        "language": "en",
        "q": query,
    })
    url = BASE_URL + "?" + params
    req = urllib.request.Request(url, headers={"User-Agent": "PortfolioAI-NewsSnapshot/1.0"})

    with urllib.request.urlopen(req, timeout=30) as response:
        payload = json.loads(response.read().decode("utf-8"))

    if payload.get("status") == "error":
        raise RuntimeError(str(payload.get("results") or payload.get("message") or "NewsData error"))

    results = payload.get("results") or []
    articles = [clean_article(item) for item in results]
    articles = [item for item in articles if str(item.get("language", "")).lower() in ("", "en", "english")]
    return dedupe(articles)[:10]


def main():
    api_key = NEWSDATA_API_KEY

    existing = load_existing()
    markets = dict(existing.get("markets") or {})
    successful = 0

    for category, query in QUERIES.items():
        try:
            articles = fetch_category(api_key, category, query)
            if articles:
                markets[category] = {
                    "label": LABELS[category],
                    "articles": articles,
                }
                successful += 1
                print(f"{category}: {len(articles)} articles")
            else:
                print(f"{category}: no articles returned; keeping previous snapshot")
        except Exception as exc:
            print(f"{category}: fetch failed ({exc}); keeping previous snapshot", file=sys.stderr)
        time.sleep(0.25)

    if successful == 0:
        print("No category refreshed successfully. Existing news.json left unchanged.", file=sys.stderr)
        return 1

    snapshot = {
        "schema_version": 1,
        "updated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "provider": "NewsData.io",
        "markets": markets,
    }

    temp = OUTPUT.with_suffix(".json.tmp")
    temp.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temp.replace(OUTPUT)
    print(f"Wrote {OUTPUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

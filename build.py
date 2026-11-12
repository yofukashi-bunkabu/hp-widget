"""HP の「自動で動く窓」のデータを作る。

data/events.json（告知のときに足す）と note の RSS から、_site/data.json を書き出す。
GitHub Actions が毎朝これを動かし、_site を GitHub Pages に出す。

    python3 build.py            # _site/ に書き出す
    python3 build.py --today 2026-11-21   # 日付を指定して試す
"""
import argparse
import json
import re
import shutil
import ssl
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "_site"
JST = timezone(timedelta(hours=9))
UA = "yofukashi-bunkabu-hp-widget/1.0 (+https://github.com/yofukashi-bunkabu/hp-widget)"


def fetch(url, timeout=20):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout, context=ssl.create_default_context()) as r:
        return r.read()


def is_https(url, host):
    return isinstance(url, str) and re.match(rf"^https://([a-z0-9-]+\.)*{re.escape(host)}/", url) is not None


def load_events(today):
    events = json.loads((ROOT / "data/events.json").read_text(encoding="utf-8"))
    upcoming, held = [], set()
    for e in events:
        if not e.get("published") or e.get("canceled"):
            continue
        if e["date"] >= today:
            upcoming.append({
                "no": e["no"],
                "date": e["date"],
                "start": e.get("start", ""),
                "title": e["title"],
                "place": e.get("place", ""),
                "genre": e.get("genre", ""),
                "price": e.get("price"),
                "peatix": e["peatix"] if is_https(e.get("peatix"), "peatix.com") else "",
                "tunagate": e["tunagate"] if is_https(e.get("tunagate"), "tunagate.com") else "",
            })
        else:
            # 06-1・06-2・06-3 のような同じ日の連続企画は1回と数える
            held.add(str(e["no"]).split("-")[0])
    upcoming.sort(key=lambda e: (e["date"], e["start"]))
    return upcoming, len(held)


def load_journal(cfg):
    """note のマガジンの RSS から記事を取る。取れなければ None。"""
    if not cfg.get("note_rss"):
        return []
    root = ET.fromstring(fetch(cfg["note_rss"]))
    items = []
    for it in root.iter("item"):
        link = (it.findtext("link") or "").strip()
        if not is_https(link, "note.com"):
            continue
        date = ""
        if it.findtext("pubDate"):
            date = parsedate_to_datetime(it.findtext("pubDate")).astimezone(JST).strftime("%Y-%m-%d")
        items.append({"title": (it.findtext("title") or "").strip(), "link": link, "date": date})
    return items


def previous_journal(cfg):
    """RSS が読めなかったとき、いま公開中の data.json から記事一覧を引き継ぐ。"""
    try:
        return json.loads(fetch(cfg["site_url"] + "data.json")).get("journal", {}).get("all", [])
    except Exception:
        return []


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--today", help="YYYY-MM-DD（試すとき用）")
    args = ap.parse_args()
    cfg = json.loads((ROOT / "config.json").read_text(encoding="utf-8"))
    now = datetime.now(JST)
    today = args.today or now.strftime("%Y-%m-%d")

    upcoming, held = load_events(today)

    try:
        articles = load_journal(cfg)
        journal_ok = True
    except Exception as err:
        print(f"note の RSS が読めませんでした（前回の内容を使います）: {err}")
        articles, journal_ok = previous_journal(cfg), False

    series = [a for a in articles if cfg["journal_series"] in a["title"]]
    data = {
        "updated": now.isoformat(timespec="minutes"),
        "today": today,
        "links": {k: cfg[k] for k in ("peatix_group", "tunagate_circle", "note_url")},
        # 全件を渡し、始まった会を除いてからページ側で max_events 件に絞る
        "next": upcoming,
        "max_events": cfg["max_events"],
        "journal": {"all": articles, "latest": articles[: cfg["max_articles"]], "fresh": journal_ok},
        "stats": {"held": held, "venues": len(series), "show": held >= cfg["stats_min"]},
    }

    if OUT.exists():
        shutil.rmtree(OUT)
    shutil.copytree(ROOT / "site", OUT)
    (OUT / "data.json").write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{today}: 次の会 {len(upcoming)}件／開催 {held}回／記事 {len(articles)}本 → {OUT}")


if __name__ == "__main__":
    main()

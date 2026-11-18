"""夜更文化部の HP（GitHub Pages）を作る。

data/events.json（告知のときに足す）と note の RSS から、HP のページと _site/data.json を書き出す。
GitHub Actions が毎朝6時（日本時間）と push のたびにこれを動かし、_site を GitHub Pages に出す。

    python3 build.py            # _site/ に書き出す
    python3 build.py --today 2026-11-21   # 日付を指定して試す

ページの中の <!--@名前--> は、ここで中身に置き換える（共通のヘッダー・フッター、次の会、会の一覧、記事）。
site/_parts/ は部品なので _site には出さない。
"""
import argparse
import html
import json
import re
import shutil
import ssl
import urllib.request
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "_site"
JST = timezone(timedelta(hours=9))
UA = "yofukashi-bunkabu-site/1.0 (+https://github.com/yofukashi-bunkabu)"
WD = "月火水木金土日"
WD_EN = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]
esc = lambda s: html.escape(str(s or ""), quote=True)


def fetch(url, timeout=20):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout, context=ssl.create_default_context()) as r:
        return r.read()


def is_https(url, host):
    return isinstance(url, str) and re.match(rf"^https://([a-z0-9-]+\.)*{re.escape(host)}/", url) is not None


def tunagate_price(e, fee):
    """つなげーとで申し込んだときに払う額。つなげーとは利用料（fee）が足されるので Peatix と金額が違う。
    events.json に price_tunagate があればそれを使う。"""
    if "price_tunagate" in e:
        return e["price_tunagate"]
    price = e.get("price")
    if isinstance(price, int) and isinstance(fee, int) and is_https(e.get("tunagate"), "tunagate.com"):
        return price + fee
    return None


def load_events(today, fee=None):
    """公開中の会を、これからの会（upcoming）と終わった会（past）に分ける。中止は除く。"""
    events = json.loads((ROOT / "data/events.json").read_text(encoding="utf-8"))
    upcoming, past, held = [], [], set()
    for e in events:
        if not e.get("published") or e.get("canceled"):
            continue
        row = {
            "no": e["no"],
            "date": e["date"],
            "start": e.get("start", ""),
            "title": e["title"],
            "place": e.get("place", ""),
            "genre": e.get("genre", ""),
            "price": e.get("price"),
            "price_tunagate": tunagate_price(e, fee),
            "peatix": e["peatix"] if is_https(e.get("peatix"), "peatix.com") else "",
            "tunagate": e["tunagate"] if is_https(e.get("tunagate"), "tunagate.com") else "",
        }
        if e["date"] >= today:
            upcoming.append(row)
        else:
            past.append(row)
            # 06-1・06-2・06-3 のような同じ日の連続企画は1回と数える
            held.add(str(e["no"]).split("-")[0])
    upcoming.sort(key=lambda e: (e["date"], e["start"]))
    past.sort(key=lambda e: (e["date"], e["start"]), reverse=True)
    return upcoming, past, len(held)


def load_journal(cfg):
    """note のマガジンの RSS から記事を取る。"""
    if not cfg.get("note_rss"):
        return []
    root = ET.fromstring(fetch(cfg["note_rss"]))
    items = []
    for it in root.iter("item"):
        link = (it.findtext("link") or "").strip()
        if not is_https(link, "note.com"):
            continue
        d = ""
        if it.findtext("pubDate"):
            d = parsedate_to_datetime(it.findtext("pubDate")).astimezone(JST).strftime("%Y-%m-%d")
        items.append({"title": (it.findtext("title") or "").strip(), "link": link, "date": d})
    return items


def previous_journal(cfg):
    """RSS が読めなかったとき、いま公開中の data.json から記事一覧を引き継ぐ。"""
    try:
        return json.loads(fetch(cfg["site_url"] + "data.json")).get("journal", {}).get("all", [])
    except Exception:
        return []


# ---------- ページの部品 ----------

def jdate(s):
    d = date.fromisoformat(s)
    return d, f"{d.month}月{d.day}日（{WD[d.weekday()]}）"


def title1(t):
    return esc(t).replace("／", "")


def title_br(t):
    return esc(t).replace("／", "<br>")


def price_text(e):
    p, t = e.get("price"), e.get("price_tunagate")
    if not isinstance(p, int):
        return ""
    s = f"参加費 {p:,}円"
    if isinstance(t, int) and t != p:
        s += f"（つなげーとは {t:,}円）"
    return s


def ev_buttons(e, cfg):
    b = []
    if e["peatix"]:
        b.append(f'<a class="btn fill" href="{esc(e["peatix"])}">Peatix で予約</a>')
    if e["tunagate"]:
        b.append(f'<a class="btn" href="{esc(e["tunagate"])}">つなげーと で予約</a>')
    if not b:
        b.append(f'<a class="btn fill" href="{esc(cfg["peatix_group"])}">予約ページを見る</a>')
    return "".join(b)


def next1_html(up, cfg):
    if not up:
        return ('<div class="next1 empty"><p>次の会は準備中です。Peatix のグループをフォローすると、お知らせが届きます。</p>'
                f'<a class="btn fill" href="{esc(cfg["peatix_group"])}">Peatix のグループを見る</a></div>')
    e = up[0]
    d, _ = jdate(e["date"])
    return f'''<div class="next1">
  <div class="d">{d.month}.{d.day:02d}<small>{WD_EN[d.weekday()]} {esc(e["start"])}</small></div>
  <div><span class="lab">NEXT</span><div class="t">{title1(e["title"])}</div><div class="pl">{esc(e["place"])}</div></div>
  <a class="btn fill" href="{esc(e["peatix"] or cfg["peatix_group"])}">予約ページを見る</a>
</div>'''


def ev_card(e, cfg, past=False):
    d, jd = jdate(e["date"])
    no = f"No.{esc(e['no'])}"
    meta = " ・ ".join(x for x in [esc(e["genre"]), price_text(e) if not past else ""] if x)
    btns = "" if past else f'<div class="btns">{ev_buttons(e, cfg)}</div>'
    return f'''<article class="ev{' past' if past else ''}">
  <div class="ev-d"><b>{d.month}.{d.day:02d}</b><span>{WD[d.weekday()]}{(" " + esc(e["start"])) if e["start"] else ""}</span></div>
  <div class="ev-b"><span class="lab">{no}</span><h3>{title_br(e["title"])}</h3><p class="pl">{esc(e["place"])}</p>{f'<p class="meta">{meta}</p>' if meta else ""}{btns}</div>
</article>'''


def list_html(rows, cfg, past=False, limit=None, empty=""):
    rows = rows[:limit] if limit else rows
    if not rows:
        return f'<p class="empty">{empty}</p>'
    return '<div class="evs">' + "".join(ev_card(e, cfg, past) for e in rows) + "</div>"


def journal_html(articles, cfg, limit=None):
    rows = articles[:limit] if limit else articles
    if not rows:
        return ('<p class="empty">記事は準備中です。最初の記事を note に書いています。</p>')
    out = []
    for a in rows:
        out.append(f'<a class="art" href="{esc(a["link"])}"><i>{esc(a["date"].replace("-", "."))}</i><b>{esc(a["title"])}</b></a>')
    return '<div class="arts">' + "".join(out) + "</div>"


def stats_html(held, venues, cfg):
    if held < cfg["stats_min"]:
        return ""
    return (f'<div class="stats"><div class="stat"><b>{held}</b><span>これまでの開催</span></div>'
            f'<div class="stat"><b>{venues}</b><span>記録した館</span></div></div>')


def render_pages(ctx):
    parts = {p.stem: p.read_text(encoding="utf-8") for p in (ROOT / "site/_parts").glob("*.html")}
    for page in OUT.rglob("*.html"):
        s = page.read_text(encoding="utf-8")
        if "<!--@" not in s:
            continue
        depth = len(page.relative_to(OUT).parts) - 1
        base = "../" * depth or "./"

        def sub(m):
            key = m.group(1)
            if key in parts:
                return parts[key].replace("{{base}}", base)
            return ctx.get(key, "")

        s = re.sub(r"<!--@([a-z0-9_]+)-->", sub, s)
        page.write_text(s.replace("{{base}}", base), encoding="utf-8")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--today", help="YYYY-MM-DD（試すとき用）")
    args = ap.parse_args()
    cfg = json.loads((ROOT / "config.json").read_text(encoding="utf-8"))
    now = datetime.now(JST)
    today = args.today or now.strftime("%Y-%m-%d")

    upcoming, past, held = load_events(today, cfg.get("tunagate_fee"))

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
        # 全件を渡し、始まった会を除いてからページ側で max_events 件に絞る（窓 widget/ 用）
        "next": upcoming,
        "past": past,
        "max_events": cfg["max_events"],
        "journal": {"all": articles, "latest": articles[: cfg["max_articles"]], "fresh": journal_ok},
        "stats": {"held": held, "venues": len(series), "show": held >= cfg["stats_min"]},
    }

    ctx = {
        "next1": next1_html(upcoming, cfg),
        "next3": list_html(upcoming, cfg, limit=cfg["max_events"], empty="次の会は準備中です。Peatix のグループをフォローすると、お知らせが届きます。"),
        "upcoming": list_html(upcoming, cfg, empty="次の会は準備中です。"),
        "past": list_html(past, cfg, past=True, empty="まだありません。"),
        "journal3": journal_html(articles, cfg, cfg["max_articles"]),
        "journal": journal_html(articles, cfg),
        "stats": stats_html(held, len(series), cfg),
        "count_up": str(len(upcoming)),
        "count_past": str(len(past)),
        "updated": now.strftime("%Y年%-m月%-d日"),
        "note_url": esc(cfg["note_url"]),
        "peatix_group": esc(cfg["peatix_group"]),
        "tunagate_circle": esc(cfg["tunagate_circle"]),
    }

    if OUT.exists():
        shutil.rmtree(OUT)
    shutil.copytree(ROOT / "site", OUT, ignore=shutil.ignore_patterns("_parts", ".DS_Store"))
    render_pages(ctx)
    (OUT / "data.json").write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{today}: 次の会 {len(upcoming)}件／終わった会 {len(past)}件（開催 {held}回）／記事 {len(articles)}本 → {OUT}")


if __name__ == "__main__":
    main()

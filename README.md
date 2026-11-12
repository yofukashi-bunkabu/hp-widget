# 夜更文化部 HP の「自動で動く窓」

STUDIO で作る夜更文化部の HP に、Embed（埋め込み）ボックスで表示する小さなページです。
次の会・最新の記録（note）・これまでの数字を、毎朝自動で入れ替えます。STUDIO 側は一度貼れば触りません。

- 公開先：https://yofukashi-bunkabu.github.io/hp-widget/
- 更新：毎朝6時（日本時間）と、`main` に push したとき（GitHub Actions「窓を更新」）

## 表示の切り替え（URL の後ろに付ける）
| 付けるもの | 表示 |
|---|---|
| `?part=next` | 次の会（最大3件。始まった会は自動で消える） |
| `?part=journal` | note「美術館制覇記」の最新3本 |
| `?part=stats` | 開いた会の回数・記録した館の数（`stats_min` 回以上になったら表示） |
| `?part=all` | 全部（既定） |
| `&bg=kinari` / `&bg=none` | 生成りの地／透明の地（既定は濃藍） |

## 会を足すとき（event-launch スキルが行う）
`data/events.json` に1件足して push するだけです。

| 項目 | 例 |
|---|---|
| `id` | `2026-11-20_tobikan100`（バナーの `イベント.json` と同じ） |
| `no` | `01`（同じ日の連続企画は `06-1` のように枝番。回数は1回と数える） |
| `date` / `start` | `2026-11-20` / `19:00` |
| `title` | 改行位置は「／」（バナーと同じ） |
| `place` / `genre` / `price` | `東京都美術館（上野）` / `美術館` / `500` |
| `peatix` / `tunagate` | 公開ページの URL |
| `published` | 両サイトで公開したら `true`（下書きの間は `false` で表示しない） |
| `canceled` | 中止・見送りにしたら `true`（表示も回数の数えからも外れる） |

終わった会は消さずに残します（開催回数に数えるため）。

## 設定（config.json）
- `note_rss`：note のマガジンの RSS の URL（マガジンのトップの RSS アイコンから取る）。空なら記録の枠は出ない
- `note_url`：マガジンの URL（「記録をすべて note で読む」のリンク先）
- `max_events` / `max_articles` / `stats_min`：表示件数と、数字を出し始める回数

## 手元で見る
```bash
python3 build.py
python3 -m http.server 8765
```
http://localhost:8765/dev/test.html を開く（`python3 build.py --today 2026-12-20` で日付を変えて試せる）。

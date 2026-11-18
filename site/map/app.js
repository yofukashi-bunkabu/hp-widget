// 夜更けの地図（参加者用）。館のピン・自分の記録・みんなの口コミ。
// 保存先は store.js（Firebase か、試し表示ならこの端末の中）。
import { makeStore } from "./store.js";

const store = makeStore();
const S = {
  venues: [], byId: new Map(),
  user: null, profile: null, admin: false,
  mine: [], pub: [],
  tab: "place", sel: null, edit: null, q: "", msg: "", msgBad: false,
};
const $ = (s, el = document) => el.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const fmtDate = (s) => (s ? s.replace(/^(\d{4})-0?(\d+)-0?(\d+)$/, "$1年$2月$3日") : "日付なし");
const starTxt = (n) => (n ? "★".repeat(n) + "☆".repeat(5 - n) : "");
const placeOf = (r) => (r.venueId && S.byId.get(r.venueId)) || null;
const nameOf = (r) => placeOf(r)?.name || r.placeName || "名前のない場所";

/* ---------- 地図 ---------- */
const map = L.map("map", { zoomControl: true, attributionControl: true }).setView([35.69, 139.74], 11);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 18,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);
const layer = L.layerGroup().addTo(map);
let newPin = null;

function drawPins() {
  layer.clearLayers();
  const mineIds = new Set(S.mine.map((r) => r.venueId).filter(Boolean));
  const pubCount = new Map();
  for (const r of S.pub) if (r.venueId) pubCount.set(r.venueId, (pubCount.get(r.venueId) || 0) + 1);
  for (const v of S.venues) {
    const isMine = mineIds.has(v.id), n = pubCount.get(v.id) || 0;
    const cls = isMine ? "mine" : n ? "pub" : "none";
    const size = isMine ? 24 : n ? 22 : 12;
    const sel = S.sel?.venueId === v.id ? " sel" : "";
    const icon = L.divIcon({ className: "", html: `<div class="pin ${cls}${sel}">${!isMine && n ? n : ""}</div>`, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
    L.marker([v.lat, v.lng], { icon, title: v.name, keyboard: true, zIndexOffset: isMine ? 300 : n ? 200 : 0 })
      .bindTooltip(v.short || v.name, { className: "vname", direction: "top", offset: [0, -8] })
      .on("click", () => selectVenue(v.id))
      .addTo(layer);
  }
  // 一覧にない場所の自分の記録・公開の口コミ
  const seen = new Set();
  for (const r of [...S.mine, ...S.pub]) {
    if (r.venueId || typeof r.lat !== "number" || seen.has(r.id)) continue;
    seen.add(r.id);
    const isMine = r.uid === S.user?.uid;
    const icon = L.divIcon({ className: "", html: `<div class="pin ${isMine ? "mine" : "pub"}"></div>`, iconSize: [20, 20], iconAnchor: [10, 10] });
    L.marker([r.lat, r.lng], { icon, title: r.placeName }).bindTooltip(r.placeName || "", { className: "vname", direction: "top", offset: [0, -8] })
      .on("click", () => { S.sel = { custom: r.id, lat: r.lat, lng: r.lng, placeName: r.placeName }; S.tab = "place"; S.edit = null; render(); })
      .addTo(layer);
  }
}

map.on("click", (e) => {
  if (!S.user) { flash("一覧にない場所を足すには、ログインしてください。", true); return; }
  S.tab = "place"; S.edit = "new";
  S.sel = { newPlace: true, lat: e.latlng.lat, lng: e.latlng.lng };
  if (newPin) newPin.remove();
  newPin = L.marker(e.latlng, { icon: L.divIcon({ className: "", html: '<div class="pin new"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }) }).addTo(map);
  render();
});

function selectVenue(id) {
  S.sel = { venueId: id }; S.tab = "place"; S.edit = null;
  if (newPin) { newPin.remove(); newPin = null; }
  const v = S.byId.get(id);
  if (v) map.panTo([v.lat, v.lng]);
  render(); drawPins();
}

/* ---------- 画面 ---------- */
function flash(m, bad = false) { S.msg = m; S.msgBad = bad; render(); }

function reviewCard(r, { showPlace = false, canEdit = false, canModerate = false } = {}) {
  const who = r.uid === S.user?.uid ? "わたし" : esc(r.nickname || "だれか");
  return `<div class="card">
    <div class="h">${showPlace ? `<b><button class="linkbtn" data-goto="${esc(r.id)}">${esc(nameOf(r))}</button></b>` : ""}
      ${r.stars ? `<span class="stars" aria-label="星${r.stars}">${starTxt(r.stars)}</span>` : ""}
      ${r.uid === S.user?.uid ? `<span class="tag ${r.visibility === "public" ? "pub" : ""}">${r.visibility === "public" ? "みんなに公開" : "自分だけ"}</span>` : ""}
    </div>
    <div class="m">${fmtDate(r.date)}${r.exhibition ? "　" + esc(r.exhibition) : ""}　｜　${who}</div>
    ${r.text ? `<div class="t">${esc(r.text)}</div>` : ""}
    ${canEdit || canModerate ? `<div class="row">${canEdit ? `<button class="linkbtn" data-edit="${esc(r.id)}">直す</button><button class="linkbtn bad" data-del="${esc(r.id)}">消す</button>` : ""}${canModerate ? `<button class="linkbtn bad" data-del="${esc(r.id)}">管理者として非表示にする（消す）</button>` : ""}</div>` : ""}
  </div>`;
}

function loginBox(text) {
  return `<div class="card"><p class="lead" style="margin:0">${text}</p><div class="row"><button class="btn fill" data-act="signin">Googleでログイン</button></div>
  <p class="muted" style="margin:0">ログインに使うのは Google の本人確認だけです。名前・メールアドレス・写真は保存しません。<a href="privacy.html">くわしく</a></p></div>`;
}

function formHtml(r, place) {
  const x = r || { date: today(), stars: 0, visibility: "private", exhibition: "", text: "" };
  const canPub = !!S.profile?.nickname;
  const needName = place.newPlace || (place.custom && !place.venueId);
  return `<form id="revf" data-id="${esc(r?.id || "")}">
    <b>${r ? "記録を直す" : "記録を書く"}</b>
    ${needName ? `<label>場所の名前<input type="text" name="placeName" required maxlength="60" value="${esc(x.placeName || place.placeName || "")}" placeholder="例：〇〇ギャラリー"></label>` : ""}
    <label>行った日<input type="date" name="date" value="${esc(x.date)}" max="${today()}"></label>
    <label>観た展示<input type="text" name="exhibition" maxlength="80" value="${esc(x.exhibition)}" placeholder="例：常設展／特別展「〇〇」"></label>
    <div><span class="muted">星（つけなくてもよい）</span><div class="starpick" data-stars="${x.stars || 0}">${[1, 2, 3, 4, 5].map((i) => `<button type="button" data-star="${i}" class="${i <= (x.stars || 0) ? "on" : ""}" aria-label="星${i}">★</button>`).join("")}</div></div>
    <label>ひとこと<textarea name="text" maxlength="1000" placeholder="いちばん残った1点、だれに勧めたいか、寄り道したお店など">${esc(x.text)}</textarea></label>
    <div class="vis" role="radiogroup" aria-label="だれに見せるか">
      <label><input type="radio" name="visibility" value="private" ${x.visibility !== "public" ? "checked" : ""}><span>自分だけ<small>あなたにしか見えません</small></span></label>
      <label><input type="radio" name="visibility" value="public" ${x.visibility === "public" ? "checked" : ""} ${canPub ? "" : "disabled"}><span>みんなに公開<small>${canPub ? `インターネット上のだれでも（ログインしていない人も）、表示名「${esc(S.profile.nickname)}」と一緒に読めます` : "「わたしの記録」で表示名を決めると選べます"}</small></span></label>
    </div>
    <div class="row"><button class="btn moon">残す</button><button type="button" class="btn ghost" data-act="cancel">やめる</button></div>
  </form>`;
}

function placePane() {
  const sel = S.sel;
  if (!sel) {
    const q = S.q.trim();
    const hits = q ? S.venues.filter((v) => (v.name + (v.short || "") + (v.area || "")).includes(q)).slice(0, 8) : [];
    return `<p class="lead" style="margin:0">夜更文化部で行った館、ひとりで行った館。観たものとひとことを、地図に残していく場所です。</p>
      <div class="search"><label>館を探す<input type="text" id="q" value="${esc(S.q)}" placeholder="例：西洋美術館、上野"></label>
      ${hits.length ? `<div class="hits">${hits.map((v) => `<button data-venue="${esc(v.id)}">${esc(v.name)}<span class="muted">　${esc(v.area || "")}</span></button>`).join("")}</div>` : q ? `<p class="muted">見つかりません。一覧にない場所は、地図の上を押すと足せます。</p>` : ""}</div>
      <p class="muted" style="margin:0">● 月の色の丸：自分が行った館　◯ 数字：みんなの口コミの数　・ 小さな丸：まだの館<br>地図の何もない所を押すと、一覧にない場所を足せます（ログインが要ります）。</p>`;
  }
  let head, mine, pub, place = sel;
  if (sel.venueId) {
    const v = S.byId.get(sel.venueId);
    head = `<h2>${esc(v?.name)}</h2><div class="sub">${esc(v?.kind || "")}${v?.area ? "・" + esc(v.area) : ""}${v?.url ? `　<a href="${esc(v.url)}" target="_blank" rel="noopener">公式サイト</a>` : ""}</div>`;
    mine = S.mine.filter((r) => r.venueId === sel.venueId);
    pub = S.pub.filter((r) => r.venueId === sel.venueId && r.uid !== S.user?.uid);
  } else if (sel.custom) {
    head = `<h2>${esc(sel.placeName || "名前のない場所")}</h2><div class="sub">一覧にない場所</div>`;
    mine = S.mine.filter((r) => r.id === sel.custom);
    pub = S.pub.filter((r) => r.id === sel.custom && r.uid !== S.user?.uid);
  } else {
    head = `<h2>新しい場所</h2><div class="sub">地図で押した場所に記録を残します</div>`;
    mine = []; pub = [];
  }
  let body = "";
  if (S.edit === "new" || (S.edit && mine.some((r) => r.id === S.edit))) {
    body += formHtml(S.edit === "new" ? null : mine.find((r) => r.id === S.edit), place);
  } else if (S.user) {
    if (!sel.custom) body += `<div class="row"><button class="btn moon" data-act="write">記録を書く</button></div>`;
  } else {
    body += loginBox("ログインすると、この館の記録を残せます。");
  }
  if (mine.length && !(S.edit && S.edit !== "new" && mine.length === 1)) body += `<b>わたしの記録</b>` + mine.map((r) => reviewCard(r, { canEdit: true })).join("");
  body += `<b>みんなの口コミ</b>` + (pub.length ? pub.map((r) => reviewCard(r, { canModerate: S.admin })).join("") : `<p class="muted" style="margin:0">まだありません。</p>`);
  return `${head}<div class="row"><button class="linkbtn" data-act="back">← 一覧に戻る</button></div>${body}`;
}

function minePane() {
  if (!S.user) return loginBox("ログインすると、行った館の記録が自分だけの地図になります。");
  const venuesDone = new Set(S.mine.map((r) => r.venueId || "c:" + r.id)).size;
  const list = [...S.mine].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  return `<div class="count"><div><b>${venuesDone}</b><span>行った館</span></div><div><b>${S.mine.length}</b><span>記録</span></div><div><b>${S.mine.filter((r) => r.visibility === "public").length}</b><span>公開中</span></div></div>
    <form id="namef" class="card"><b>表示名</b>
      <p class="muted" style="margin:0">「みんなに公開」にした口コミに出る名前です。インターネット上のだれでも読めるので、本名ではない名前をおすすめします（20文字まで）。</p>
      <label>表示名<input type="text" name="nickname" maxlength="20" required value="${esc(S.profile?.nickname || "")}" placeholder="例：たいまつ"></label>
      <div class="row"><button class="btn">保存</button></div></form>
    <b>記録（${S.mine.length}）</b>
    ${list.length ? list.map((r) => reviewCard(r, { showPlace: true, canEdit: true })).join("") : `<p class="muted" style="margin:0">まだありません。地図の丸を押して「記録を書く」から始めましょう。</p>`}
    <div class="card"><b>自分のデータ</b>
      <div class="row"><button class="btn ghost" data-act="export">記録をファイルで保存</button><button class="btn danger" data-act="wipe">記録をすべて消す</button></div>
      <p class="muted" style="margin:0">すべて消すと、記録と表示名がなくなります。元に戻せません。</p></div>`;
}

function allPane() {
  const list = [...S.pub].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  return `<p class="muted" style="margin:0">書いた人が「みんなに公開」にした口コミです（${list.length}件）。館の名前を押すと地図が動きます。${S.user ? "" : "書くにはログインしてください。"}</p>
    ${list.length ? list.map((r) => reviewCard(r, { showPlace: true, canEdit: false, canModerate: S.admin && r.uid !== S.user?.uid })).join("") : `<p class="muted" style="margin:0">まだありません。最初のひとことを残してみませんか。</p>`}`;
}

function render() {
  for (const t of document.querySelectorAll(".tab")) t.setAttribute("aria-selected", String(t.dataset.tab === S.tab));
  $("#signin").hidden = !!S.user; $("#signout").hidden = !S.user;
  const demo = store.mode === "demo" ? `<div class="demo">いまは<b>試し表示</b>です。ログインはまねだけで、記録はこの端末の中にだけ残ります。</div>` : "";
  const msg = S.msg ? `<div class="msg ${S.msgBad ? "bad" : ""}" role="status">${esc(S.msg)}</div>` : "";
  const body = S.tab === "mine" ? minePane() : S.tab === "all" ? allPane() : placePane();
  $("#pane").innerHTML = demo + msg + body;
  S.msg = "";
  const q = $("#q");
  if (q && document.activeElement?.id !== "q" && S.q) { /* 入力中の位置は保つ */ }
}

/* ---------- 操作 ---------- */
async function reload() {
  try {
    if (S.user) {
      [S.profile, S.admin] = await Promise.all([store.getProfile(), store.isAdmin()]);
      S.mine = await store.myReviews();
    } else { S.profile = null; S.admin = false; S.mine = []; }
    S.pub = await store.publicReviews();
  } catch (e) { console.error(e); S.msg = "読み込みに失敗しました。少し待ってから開き直してください。"; S.msgBad = true; }
  drawPins(); render();
}

document.addEventListener("click", async (e) => {
  const t = e.target.closest("button, [data-goto]");
  if (!t) return;
  if (t.classList.contains("tab")) { S.tab = t.dataset.tab; S.edit = null; render(); return; }
  if (t.id === "signin" || t.dataset.act === "signin") { try { await store.signIn(); } catch (err) { console.error(err); flash("ログインできませんでした。もう一度お試しください。", true); } return; }
  if (t.id === "signout") { await store.signOut(); S.sel = null; S.tab = "place"; return; }
  if (t.dataset.venue) { selectVenue(t.dataset.venue); return; }
  if (t.dataset.goto) {
    const r = [...S.mine, ...S.pub].find((x) => x.id === t.dataset.goto);
    if (r?.venueId) selectVenue(r.venueId);
    else if (r) { S.sel = { custom: r.id, lat: r.lat, lng: r.lng, placeName: r.placeName }; S.tab = "place"; map.panTo([r.lat, r.lng]); render(); }
    return;
  }
  if (t.dataset.star) {
    const box = t.closest(".starpick"); const n = +t.dataset.star;
    const cur = +box.dataset.stars; const next = cur === n ? 0 : n;
    box.dataset.stars = next;
    box.querySelectorAll("button").forEach((b) => b.classList.toggle("on", +b.dataset.star <= next));
    return;
  }
  switch (t.dataset.act) {
    case "back": S.sel = null; S.edit = null; if (newPin) { newPin.remove(); newPin = null; } render(); drawPins(); return;
    case "write": S.edit = "new"; render(); return;
    case "cancel": S.edit = null; if (S.sel?.newPlace) { S.sel = null; if (newPin) { newPin.remove(); newPin = null; } } render(); return;
    case "export": {
      const rows = S.mine.map((r) => ({ 場所: nameOf(r), 日付: r.date, 展示: r.exhibition, 星: r.stars, ひとこと: r.text, 公開: r.visibility === "public" ? "みんなに公開" : "自分だけ" }));
      const blob = new Blob([JSON.stringify({ 表示名: S.profile?.nickname || "", 記録: rows }, null, 2)], { type: "application/json" });
      const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "夜更けの地図_わたしの記録.json" });
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); return;
    }
    case "wipe":
      if (!confirm("記録と表示名をすべて消します。元に戻せません。消しますか？")) return;
      try { await store.deleteAllMine(); S.msg = "すべて消しました。"; } catch (err) { console.error(err); S.msg = "消せませんでした。"; S.msgBad = true; }
      await reload(); return;
  }
  if (t.dataset.edit) { S.edit = t.dataset.edit; const r = S.mine.find((x) => x.id === t.dataset.edit); if (r?.venueId) S.sel = { venueId: r.venueId }; else if (r) S.sel = { custom: r.id, lat: r.lat, lng: r.lng, placeName: r.placeName }; S.tab = "place"; render(); return; }
  if (t.dataset.del) {
    if (!confirm("この記録を消します。元に戻せません。消しますか？")) return;
    try { await store.deleteReview(t.dataset.del); S.msg = "消しました。"; } catch (err) { console.error(err); S.msg = "消せませんでした。"; S.msgBad = true; }
    S.edit = null; await reload();
  }
});

document.addEventListener("input", (e) => { if (e.target.id === "q") { S.q = e.target.value; const pos = e.target.selectionStart; render(); const q = $("#q"); q.focus(); q.setSelectionRange(pos, pos); } });

document.addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target, fd = new FormData(f);
  try {
    if (f.id === "namef") {
      const n = String(fd.get("nickname") || "").trim();
      if (!n) return;
      await store.setProfile(n);
      // 公開中の口コミの表示名もそろえる
      for (const r of S.mine.filter((x) => x.visibility === "public")) await store.saveReview(r.id, r, n);
      S.msg = "表示名を保存しました。";
    } else if (f.id === "revf") {
      const sel = S.sel || {};
      const v = sel.venueId ? S.byId.get(sel.venueId) : null;
      const id = f.dataset.id || null;
      const old = id ? S.mine.find((x) => x.id === id) : null;
      const data = {
        venueId: v?.id || null,
        placeName: v ? v.name : String(fd.get("placeName") ?? old?.placeName ?? sel.placeName ?? "").trim(),
        lat: v ? v.lat : (old?.lat ?? sel.lat), lng: v ? v.lng : (old?.lng ?? sel.lng),
        date: fd.get("date"), exhibition: fd.get("exhibition"), text: fd.get("text"),
        stars: +f.querySelector(".starpick").dataset.stars,
        visibility: fd.get("visibility") === "public" && S.profile?.nickname ? "public" : "private",
      };
      if (!data.placeName) { flash("場所の名前を入れてください。", true); return; }
      await store.saveReview(id, data, S.profile?.nickname || "");
      S.msg = "残しました。"; S.edit = null;
      if (sel.newPlace) { S.sel = null; if (newPin) { newPin.remove(); newPin = null; } }
    }
  } catch (err) {
    console.error(err);
    S.msg = "保存できませんでした。通信を確かめて、もう一度お試しください。";
    S.msgBad = true;
  }
  await reload();
});

/* ---------- はじめ ---------- */
(async () => {
  try {
    S.venues = await (await fetch("venues.json")).json();
    S.byId = new Map(S.venues.map((v) => [v.id, v]));
  } catch (e) { console.error(e); }
  drawPins(); render();
  try { await store.init(async (u) => { S.user = u; await reload(); }); }
  catch (e) { console.error(e); flash("ログインの仕組みを読み込めませんでした。", true); }
})();

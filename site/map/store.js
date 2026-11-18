// 口コミの保存先。Firebase の設定があれば Firestore、なければこの端末の中（試し表示）。
// どちらも同じ形の関数を持つので、画面（app.js）は保存先を気にしない。
//
// データの形（Firestore）
//   reviews/{id}  : uid, venueId|null, placeName, lat, lng, date, exhibition, stars(0-5), text,
//                   visibility('private'|'members'), nickname(公開のときだけ), createdAt, updatedAt
//   profiles/{uid}: nickname（公開の口コミに出す名前。本名・メールは保存しない）
//   members/{uid} : 合言葉を入れた参加者（code, joinedAt）。公開の口コミを読む・出すのに要る
//   admins/{uid}  : 管理者（コンソールで秋輝が手で作る）
//   config/join   : 合言葉（code）。だれも読めない。ルールの中でだけ照らし合わせる
import { firebaseConfig } from "./firebase-config.js";

const FB = "https://www.gstatic.com/firebasejs/10.12.2/";
const LIMITS = { text: 1000, exhibition: 80, placeName: 60, nickname: 20 };

export function clean(r) {
  const s = (v, n) => String(v ?? "").trim().slice(0, n);
  const num = (v) => (typeof v === "number" && isFinite(v) ? Math.round(v * 1e5) / 1e5 : null);
  const out = {
    venueId: r.venueId ? s(r.venueId, 40) : null,
    placeName: s(r.placeName, LIMITS.placeName),
    lat: num(r.lat),
    lng: num(r.lng),
    date: /^\d{4}-\d{2}-\d{2}$/.test(r.date || "") ? r.date : "",
    exhibition: s(r.exhibition, LIMITS.exhibition),
    stars: Math.max(0, Math.min(5, parseInt(r.stars, 10) || 0)),
    text: s(r.text, LIMITS.text),
    visibility: r.visibility === "members" ? "members" : "private",
  };
  return out;
}

/* ---------- 試し表示（この端末の中だけ） ---------- */
class LocalStore {
  constructor() { this.mode = "demo"; this.key = "yofukashi-map-demo-v1"; this.user = null; }
  _load() { try { return JSON.parse(localStorage.getItem(this.key)) || {}; } catch { return {}; } }
  _save(d) { try { localStorage.setItem(this.key, JSON.stringify(d)); } catch {} }
  async init(onAuth) {
    this.onAuth = onAuth;
    const d = this._load();
    this.user = d.signedIn ? { uid: "demo-user", label: "試しの人" } : null;
    onAuth(this.user);
  }
  async signIn() { const d = this._load(); d.signedIn = true; this._save(d); this.user = { uid: "demo-user", label: "試しの人" }; this.onAuth(this.user); }
  async signOut() { const d = this._load(); d.signedIn = false; this._save(d); this.user = null; this.onAuth(null); }
  async getProfile() { return this._load().profile || null; }
  async setProfile(nickname) { const d = this._load(); d.profile = { nickname: String(nickname).trim().slice(0, LIMITS.nickname) }; this._save(d); }
  async isMember() { return !!this._load().member; }
  async join(code) { if (String(code).trim() !== "よふけ") throw new Error("bad_code"); const d = this._load(); d.member = true; this._save(d); }
  async isAdmin() { return false; }
  async myReviews() { return (this._load().reviews || []).filter((r) => r.uid === this.user?.uid); }
  async publicReviews() {
    const mine = (this._load().reviews || []).filter((r) => r.visibility === "members");
    return mine;
  }
  async saveReview(id, data, nickname) {
    const d = this._load(); d.reviews = d.reviews || [];
    const now = new Date().toISOString();
    const r = { ...clean(data), uid: this.user.uid, updatedAt: now };
    if (r.visibility === "members") r.nickname = nickname; else delete r.nickname;
    if (id) { const i = d.reviews.findIndex((x) => x.id === id); if (i >= 0) d.reviews[i] = { ...d.reviews[i], ...r }; }
    else d.reviews.push({ ...r, id: "d" + Date.now().toString(36), createdAt: now });
    this._save(d);
  }
  async deleteReview(id) { const d = this._load(); d.reviews = (d.reviews || []).filter((x) => x.id !== id); this._save(d); }
  async deleteAllMine() { const d = this._load(); d.reviews = []; delete d.profile; delete d.member; this._save(d); }
}

/* ---------- 本番（Firebase） ---------- */
class FirebaseStore {
  constructor(cfg) { this.mode = "live"; this.cfg = cfg; this.user = null; }
  async init(onAuth) {
    const [{ initializeApp }, A, F] = await Promise.all([
      import(FB + "firebase-app.js"), import(FB + "firebase-auth.js"), import(FB + "firebase-firestore.js"),
    ]);
    this.A = A; this.F = F;
    const app = initializeApp(this.cfg);
    this.auth = A.getAuth(app);
    this.db = F.getFirestore(app);
    A.onAuthStateChanged(this.auth, (u) => {
      // 画面に出すのは「ログイン中」だけ。Google の名前・メール・写真は保存しないし表示もしない
      this.user = u ? { uid: u.uid, label: "ログイン中" } : null;
      onAuth(this.user);
    });
  }
  async signIn() {
    const p = new this.A.GoogleAuthProvider();
    p.setCustomParameters({ prompt: "select_account" });
    try { await this.A.signInWithPopup(this.auth, p); }
    catch (e) { if (e?.code === "auth/popup-blocked") await this.A.signInWithRedirect(this.auth, p); else throw e; }
  }
  async signOut() { await this.A.signOut(this.auth); }
  _doc(...p) { return this.F.doc(this.db, ...p); }
  async getProfile() { const s = await this.F.getDoc(this._doc("profiles", this.user.uid)); return s.exists() ? s.data() : null; }
  async setProfile(nickname) {
    await this.F.setDoc(this._doc("profiles", this.user.uid), { nickname: String(nickname).trim().slice(0, LIMITS.nickname), updatedAt: this.F.serverTimestamp() });
  }
  async isMember() { try { return (await this.F.getDoc(this._doc("members", this.user.uid))).exists(); } catch { return false; } }
  async join(code) {
    try { await this.F.setDoc(this._doc("members", this.user.uid), { code: String(code).trim(), joinedAt: this.F.serverTimestamp() }); }
    catch { throw new Error("bad_code"); }
  }
  async isAdmin() { try { return (await this.F.getDoc(this._doc("admins", this.user.uid))).exists(); } catch { return false; } }
  _rows(snap) { return snap.docs.map((d) => ({ id: d.id, ...d.data() })); }
  async myReviews() {
    const F = this.F;
    return this._rows(await F.getDocs(F.query(F.collection(this.db, "reviews"), F.where("uid", "==", this.user.uid))));
  }
  async publicReviews() {
    const F = this.F;
    return this._rows(await F.getDocs(F.query(F.collection(this.db, "reviews"), F.where("visibility", "==", "members"), F.limit(500))));
  }
  async saveReview(id, data, nickname) {
    const F = this.F;
    const r = { ...clean(data), uid: this.user.uid, updatedAt: F.serverTimestamp() };
    if (r.visibility === "members") r.nickname = nickname; else r.nickname = F.deleteField();
    if (id) await F.updateDoc(this._doc("reviews", id), r);
    else { if (r.visibility !== "members") delete r.nickname; await F.addDoc(F.collection(this.db, "reviews"), { ...r, createdAt: F.serverTimestamp() }); }
  }
  async deleteReview(id) { await this.F.deleteDoc(this._doc("reviews", id)); }
  async deleteAllMine() {
    for (const r of await this.myReviews()) await this.deleteReview(r.id);
    await this.F.deleteDoc(this._doc("profiles", this.user.uid)).catch(() => {});
    await this.F.deleteDoc(this._doc("members", this.user.uid)).catch(() => {});
  }
}

export function makeStore() { return firebaseConfig ? new FirebaseStore(firebaseConfig) : new LocalStore(); }

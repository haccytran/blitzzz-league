// v37-state-routes.mjs
// Drop-in routes for persistent admin data (announcements, challenges, teams/buy-in, league settings, venmo/zelle, trading block, polls).
// Public GET; admin-only POST/PATCH guarded by x-admin header. No changes to transactions/waivers logic.

// --- Dependencies (use existing imports if available) ---
import fs from "fs/promises";
import path from "path";
import express from "express";

// --- Data dir & helpers ---
const DATA_DIR = path.join(process.cwd(), "data");
async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(path.join(DATA_DIR, file), "utf8")); }
  catch { return fallback; }
}
async function writeJson(file, obj) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(path.join(DATA_DIR, file), JSON.stringify(obj, null, 2), "utf8");
}
function isAdmin(req) {
  const want = process.env.ADMIN_PASSWORD || globalThis.ADMIN_PASSWORD;
  if (!want) return true; // if no admin password configured, allow (dev)
  const got = req.header("x-admin");
  return got === want;
}

export default function registerV37Routes(app, deps) {
  const router = express.Router();
  const espnFetch = deps?.espnFetch; // optional; only used by /league/teams/import

  // ---------- Announcements ----------
  router.get("/announcements", async (_req, res) => {
    const data = await readJson("announcements.json", { items: [] });
    res.json(data);
  });
  router.post("/announcements", async (req, res) => {
    if (!isAdmin(req)) return res.status(401).send("Unauthorized");
    const { items } = req.body || {};
    if (!Array.isArray(items)) return res.status(400).send("items[] required");
    await writeJson("announcements.json", { items });
    res.json({ ok: true });
  });

  // ---------- Weekly challenges ----------
  router.get("/challenges", async (_req, res) => {
    const data = await readJson("weekly_challenges.json", { items: [] });
    res.json(data);
  });
  router.post("/challenges", async (req, res) => {
    if (!isAdmin(req)) return res.status(401).send("Unauthorized");
    const { items } = req.body || {};
    if (!Array.isArray(items)) return res.status(400).send("items[] required");
    await writeJson("weekly_challenges.json", { items });
    res.json({ ok: true });
  });

  // ---------- League settings (teams, venmo/zelle, qr, etc.) ----------
  router.get("/league/settings", async (_req, res) => {
    const data = await readJson("league_settings.json", { leagueId: "", seasonId: "", teams: [], venmoLink: "", zelleEmail: "", venmoQR: "" });
    res.json(data);
  });
  router.post("/league/settings", async (req, res) => {
    if (!isAdmin(req)) return res.status(401).send("Unauthorized");
    const { leagueId="", seasonId="", teams=[], venmoLink="", zelleEmail="", venmoQR="" } = req.body || {};
    const data = { leagueId, seasonId, teams, venmoLink, zelleEmail, venmoQR };
    await writeJson("league_settings.json", data);
    res.json({ ok: true });
  });

  // ---------- Buy-in checklist ----------
  router.get("/league/buyin", async (_req, res) => {
    // shape: { paid: { [teamId]: true/false } }
    const data = await readJson("buyin.json", { paid: {} });
    res.json(data);
  });
  router.post("/league/buyin", async (req, res) => {
    if (!isAdmin(req)) return res.status(401).send("Unauthorized");
    const { paid } = req.body || {};
    if (!paid || typeof paid !== "object") return res.status(400).send("paid map required");
    await writeJson("buyin.json", { paid });
    res.json({ ok: true });
  });

  // When admin imports ESPN teams, also persist them and initialize buy-in map if missing.
  router.post("/league/teams/import", async (req, res) => {
    if (!isAdmin(req)) return res.status(401).send("Unauthorized");
    try {
      let { leagueId, seasonId } = req.body || {};
      if (!leagueId || !seasonId) return res.status(400).send("leagueId, seasonId required");
      if (!espnFetch) return res.status(500).send("espnFetch not wired");
      const j = await espnFetch({ leagueId, seasonId, view: "mTeam", req, requireCookie: false });
      const teams = (j?.teams || []).map(t => ({ id: String(t?.id ?? ""), name: String(t?.location || "") + " " + String(t?.nickname || "") })).filter(t => t.id);
      // Save to league_settings.json
      const prev = await readJson("league_settings.json", { leagueId, seasonId, teams: [], venmoLink:"", zelleEmail:"", venmoQR:"" });
      const next = { ...prev, leagueId, seasonId, teams };
      await writeJson("league_settings.json", next);
      // Ensure buy-in map has an entry for each team
      const buyPrev = await readJson("buyin.json", { paid: {} });
      const paid = { ...buyPrev.paid };
      for (const t of teams) if (!(t.id in paid)) paid[t.id] = false;
      await writeJson("buyin.json", { paid });
      res.json({ ok: true, teamsCount: teams.length, teams });
    } catch (e) {
      res.status(502).send(String(e?.message || e));
    }
  });

  // ---------- Trading block ----------
  router.get("/trading-block", async (_req, res) => {
    const data = await readJson("trading_block.json", { items: [] });
    res.json(data);
  });
  router.post("/trading-block", async (req, res) => {
    if (!isAdmin(req)) return res.status(401).send("Unauthorized");
    const { items } = req.body || {};
    if (!Array.isArray(items)) return res.status(400).send("items[] required");
    await writeJson("trading_block.json", { items });
    res.json({ ok: true });
  });

  // ---------- Polls (server-side password check) ----------
  // Shape: { polls: [ { id, question, options:[{id,text,votes}], passwords:[string] } ] }
  router.get("/polls", async (_req, res) => {
    const data = await readJson("polls.json", { polls: [] });
    res.json(data);
  });
  router.post("/polls", async (req, res) => {
    if (!isAdmin(req)) return res.status(401).send("Unauthorized");
    const { polls } = req.body || {};
    if (!Array.isArray(polls)) return res.status(400).send("polls[] required");
    await writeJson("polls.json", { polls });
    res.json({ ok: true });
  });
  router.post("/polls/:id/vote", async (req, res) => {
    const { id } = req.params;
    const { optionId, password } = req.body || {};
    if (!id || !optionId || !password) return res.status(400).send("id, optionId, password required");
    const data = await readJson("polls.json", { polls: [] });
    const poll = data.polls.find(p => String(p.id) == String(id));
    if (!poll) return res.status(404).send("poll not found");
    const ok = (poll.passwords || []).some(pw => String(pw) === String(password));
    if (!ok) return res.status(403).send("bad password");
    const opt = (poll.options || []).find(o => String(o.id) == String(optionId));
    if (!opt) return res.status(404).send("option not found");
    opt.votes = (opt.votes|0) + 1;
    await writeJson("polls.json", data);
    res.json({ ok: true, tally: poll.options });
  });

  // Mount under /api/v37
  app.use("/api/v37", router);
}

// v37-state-routes.mjs (SAFE MODE)
import fs from "fs/promises";
import path from "path";
import express from "express";

const DATA_DIR = path.join(process.cwd(), "data");

async function readJson(file, fallback) {
  try {
    const txt = await fs.readFile(path.join(DATA_DIR, file), "utf8");
    return JSON.parse(txt);
  } catch (e) {
    return fallback;
  }
}

async function writeJson(file, obj) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(path.join(DATA_DIR, file), JSON.stringify(obj, null, 2), "utf8");
}

function isAdmin(req) {
  const want = process.env.ADMIN_PASSWORD || globalThis.ADMIN_PASSWORD;
  if (!want) return true;
  const got = req.header("x-admin");
  return got === want;
}

export default function registerV37Routes(app, deps) {
  const router = express.Router();
  const espnFetch = deps && deps.espnFetch ? deps.espnFetch : null;

  // ---------- Announcements ----------
  router.get("/announcements", async function (_req, res) {
    const data = await readJson("announcements.json", { items: [] });
    res.json(data);
  });
  router.post("/announcements", async function (req, res) {
    if (!isAdmin(req)) return res.status(401).send("Unauthorized");
    const body = req.body || {};
    const items = body.items;
    if (!Array.isArray(items)) return res.status(400).send("items[] required");
    await writeJson("announcements.json", { items: items });
    res.json({ ok: true, items: items });
  });

  // ---------- Weekly challenges ----------
  router.get("/challenges", async function (_req, res) {
    const data = await readJson("weekly_challenges.json", { items: [] });
    res.json(data);
  });
  router.post("/challenges", async function (req, res) {
    if (!isAdmin(req)) return res.status(401).send("Unauthorized");
    const body = req.body || {};
    const items = body.items;
    if (!Array.isArray(items)) return res.status(400).send("items[] required");
    await writeJson("weekly_challenges.json", { items: items });
    res.json({ ok: true, items: items });
  });

  // ---------- League settings (teams, venmo/zelle, qr, etc.) ----------
  router.get("/league/settings", async function (_req, res) {
    const data = await readJson("league_settings.json", { leagueId: "", seasonId: "", teams: [], venmoLink: "", zelleEmail: "", venmoQR: "" });
    res.json(data);
  });
  router.post("/league/settings", async function (req, res) {
    if (!isAdmin(req)) return res.status(401).send("Unauthorized");
    const incoming = req.body || {};
    const prev = await readJson("league_settings.json", { leagueId: "", seasonId: "", teams: [], venmoLink: "", zelleEmail: "", venmoQR: "" });
    const next = {
      leagueId: prev.leagueId,
      seasonId: prev.seasonId,
      teams: Array.isArray(prev.teams) ? prev.teams : [],
      venmoLink: prev.venmoLink || "",
      zelleEmail: prev.zelleEmail || "",
      venmoQR: prev.venmoQR || ""
    };
    ["leagueId","seasonId","teams","venmoLink","zelleEmail","venmoQR"].forEach(function(k){
      if (Object.prototype.hasOwnProperty.call(incoming, k) && typeof incoming[k] !== "undefined") {
        next[k] = incoming[k];
      }
    });
    await writeJson("league_settings.json", next);
    res.json({ ok: true, saved: next });
  });

  // ---------- Buy-in checklist ----------
  router.get("/league/buyin", async function (_req, res) {
    const data = await readJson("buyin.json", { paid: {} });
    res.json(data);
  });
  router.post("/league/buyin", async function (req, res) {
    if (!isAdmin(req)) return res.status(401).send("Unauthorized");
    const body = req.body || {};
    const paid = body.paid;
    if (!paid || typeof paid !== "object") return res.status(400).send("paid map required");
    await writeJson("buyin.json", { paid: paid });
    res.json({ ok: true });
  });

  // Import teams + initialize buy-in entries
  router.post("/league/teams/import", async function (req, res) {
    if (!isAdmin(req)) return res.status(401).send("Unauthorized");
    try {
      const body = req.body || {};
      const leagueId = body.leagueId;
      const seasonId = body.seasonId;
      if (!leagueId || !seasonId) return res.status(400).send("leagueId, seasonId required");
      if (!espnFetch) return res.status(500).send("espnFetch not wired");

      let j;
      try {
        j = await espnFetch({ leagueId: leagueId, seasonId: seasonId, view: "mTeam", req: req, requireCookie: false });
      } catch (e) {
        j = await espnFetch({ leagueId: leagueId, seasonId: seasonId, view: "mTeam", req: req, requireCookie: true });
      }

      const teams = Array.isArray(j && j.teams) ? j.teams.map(function(t){
        const id = String((t && t.id) || "");
        const name = String((t && t.location) || "") + " " + String((t && t.nickname) || "");
        return { id: id, name: name };
      }).filter(function (t){ return t.id; }) : [];

      const prev = await readJson("league_settings.json", { leagueId: leagueId, seasonId: seasonId, teams: [], venmoLink:"", zelleEmail:"", venmoQR:"" });
      const next = { leagueId: leagueId, seasonId: seasonId, teams: teams, venmoLink: prev.venmoLink || "", zelleEmail: prev.zelleEmail || "", venmoQR: prev.venmoQR || "" };
      await writeJson("league_settings.json", next);

      const buyPrev = await readJson("buyin.json", { paid: {} });
      const paid = Object.assign({}, buyPrev.paid || {});
      teams.forEach(function(t){ if (!Object.prototype.hasOwnProperty.call(paid, t.id)) paid[t.id] = false; });
      await writeJson("buyin.json", { paid: paid });

      res.json({ ok: true, teamsCount: teams.length, teams: teams });
    } catch (e) {
      res.status(502).send(String((e && e.message) || e));
    }
  });

  // ---------- Trading block ----------
  router.get("/trading-block", async function (_req, res) {
    const data = await readJson("trading_block.json", { items: [] });
    res.json(data);
  });
  router.post("/trading-block", async function (req, res) {
    if (!isAdmin(req)) return res.status(401).send("Unauthorized");
    const body = req.body || {};
    const items = body.items;
    if (!Array.isArray(items)) return res.status(400).send("items[] required");
    await writeJson("trading_block.json", { items: items });
    res.json({ ok: true });
  });

  // ---------- Polls ----------
  router.get("/polls", async function (_req, res) {
    const data = await readJson("polls.json", { polls: [] });
    res.json(data);
  });
  router.post("/polls", async function (req, res) {
    if (!isAdmin(req)) return res.status(401).send("Unauthorized");
    const body = req.body || {};
    const polls = body.polls;
    if (!Array.isArray(polls)) return res.status(400).send("polls[] required");
    await writeJson("polls.json", { polls: polls });
    res.json({ ok: true });
  });
  router.post("/polls/:id/vote", async function (req, res) {
    const id = req.params.id;
    const body = req.body || {};
    const optionId = body.optionId;
    const password = body.password;
    if (!id || !optionId || !password) return res.status(400).send("id, optionId, password required");

    const data = await readJson("polls.json", { polls: [] });
    const poll = (data.polls || []).find(function(p){ return String(p.id) === String(id); });
    if (!poll) return res.status(404).send("poll not found");
    const ok = Array.isArray(poll.passwords) && poll.passwords.some(function(pw){ return String(pw) === String(password); });
    if (!ok) return res.status(403).send("bad password");
    const opt = (poll.options || []).find(function(o){ return String(o.id) === String(optionId); });
    if (!opt) return res.status(404).send("option not found");
    opt.votes = (opt.votes|0) + 1;
    await writeJson("polls.json", data);
    res.json({ ok: true, tally: poll.options });
  });

  app.use("/api/v37", router);
}

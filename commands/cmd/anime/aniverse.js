"use strict";

const axios = require("axios");

const API_BASE    = "https://aniverse-fojj.onrender.com";
const MAXMB       = 49;
const SEARCH_TTL  = 5  * 60 * 1000;
const EPISODE_TTL = 10 * 60 * 1000;
const DL_TIMEOUT  = 180_000;
const API_TIMEOUT = 30_000;

if (!global._AniVersePending) global._AniVersePending = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of global._AniVersePending.entries())
    if (now > v.expiresAt) global._AniVersePending.delete(k);
}, 60_000).unref?.();

async function apiGet(endpoint, params = {}) {
  const res = await axios.get(`${API_BASE}${endpoint}`, {
    params,
    timeout: API_TIMEOUT,
    headers: { "User-Agent": "CHISA-AniVerse/2.0", "Accept-Encoding": "gzip" },
  });
  return res.data;
}

async function apiDownload(episodeUrl) {
  const res = await axios.get(`${API_BASE}/api/v1/download`, {
    params: { url: episodeUrl, quality: "best", max_mb: MAXMB },
    responseType: "arraybuffer",
    timeout: DL_TIMEOUT,
    headers: { "User-Agent": "CHISA-AniVerse/2.0", "Accept-Encoding": "identity" },
    maxRedirects: 5,
  });
  const buf = Buffer.from(res.data);
  if (buf.length < 1024) throw new Error("Server returned an empty or invalid video file");
  return buf;
}

async function fetchPoster(imageUrl) {
  if (!imageUrl) return null;
  try {
    const res = await axios.get(`${API_BASE}/api/v1/imgproxy`, {
      params: { url: imageUrl },
      responseType: "arraybuffer",
      timeout: 10_000,
    });
    const buf = Buffer.from(res.data);
    return buf.length > 512 ? buf : null;
  } catch { return null; }
}

function langTag(languages = []) {
  return languages.map(l => {
    if (l === "hindi")   return "🇮🇳 Hindi";
    if (l === "bengali") return "🇧🇩 Bengali";
    return l.charAt(0).toUpperCase() + l.slice(1);
  }).join(" · ") || "🎌 Dubbed";
}

function pad(n, width = 2) { return String(n).padStart(width, "0"); }

function trim(str, max) {
  return str.length > max ? str.slice(0, max - 1) + "…" : str;
}

function noQueryCard() {
  return [
    "╭───────────────────────────╮",
    "│  🌸  *AniVerse*           │",
    "╰───────────────────────────╯",
    "",
    "Send an anime name to search.",
    "",
    "*Usage*",
    "  anime naruto",
    "  anime dragon ball",
    "  anime doraemon",
    "",
    "┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄",
    "✦  _Hindi & Bengali dubbed only_",
  ].join("\n");
}

function noResultsCard(query) {
  return [
    "╭───────────────────────────╮",
    "│  🔍  *No Results*         │",
    "╰───────────────────────────╯",
    "",
    `_"${trim(query, 28)}"_ didn't match`,
    "anything in the library.",
    "",
    "💡  Try a shorter or different",
    "    spelling and search again.",
  ].join("\n");
}

function searchCard(query, results) {
  const lines = [
    "╭───────────────────────────╮",
    "│  🔎  *AniVerse Search*    │",
    "╰───────────────────────────╯",
    `🔍  _"${trim(query, 24)}"_`,
    "",
  ];
  results.forEach((r, i) => {
    lines.push(`  *${pad(i + 1)}*  ${trim(r.title, 34)}`);
    lines.push(`       ${langTag(r.languages)}`);
    lines.push("");
  });
  lines.push("┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄");
  lines.push("✦  _Send a number to select_");
  return lines.join("\n");
}

function episodeCard(anime, episodes) {
  const lines = [
    "┌━━━━━━━━━━━━━━━━━━━━━━━━━━━┐",
    `  🎌  *${trim(anime.title, 24)}*`,
    `  ${langTag(anime.languages)}`,
    `  📺  ${episodes.length} Episodes`,
    "└━━━━━━━━━━━━━━━━━━━━━━━━━━━┘",
    "",
  ];
  const show = Math.min(episodes.length, 50);
  for (let i = 0; i < show; i++) {
    const ep  = episodes[i];
    const raw = ep.episode_title || ep.episode_number || `Episode ${i + 1}`;
    lines.push(`  *${pad(i + 1)} ·*  ${trim(String(raw), 32)}`);
  }
  if (episodes.length > 50) {
    lines.push(`  _···  +${episodes.length - 50} more_`);
    lines.push(`  _Send any number from 1–${episodes.length}_`);
  }
  lines.push("");
  lines.push("┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄");
  lines.push("✦  _Send episode number to download_");
  return lines.join("\n");
}

function downloadingCard(anime, epNum, epLabel) {
  return [
    "╭━━━━━━━━━━━━━━━━━━━━━━━━━━━╮",
    "",
    "  ⬇️  *Fetching episode…*",
    "",
    `  🎌  ${trim(anime.title, 26)}`,
    `  📺  Ep ${epNum}  ·  ${trim(epLabel, 22)}`,
    "  ⏳  _Up to ~2 minutes_",
    "",
    "╰━━━━━━━━━━━━━━━━━━━━━━━━━━━╯",
  ].join("\n");
}

function errorCard(title, body, link = null) {
  const lines = [
    "╭───────────────────────────╮",
    `│  ⚠️  *${title}*`,
    "╰───────────────────────────╯",
    "",
    `_${body}_`,
  ];
  if (link) {
    lines.push("");
    lines.push("🔗  _Watch online:_");
    lines.push(`  ${link}`);
  }
  return lines.join("\n");
}

function videoCaption(anime, epNum, epLabel, sizeMB) {
  return [
    `🎌  *${anime.title}*`,
    `▸  Ep ${pad(epNum)}  ·  ${trim(epLabel, 30)}`,
    `📦  _${sizeMB.toFixed(1)} MB  ·  AniVerse_`,
  ].join("\n");
}

async function pickAnime(ctx, anime) {
  await ctx.replyReact("⏳");
  try {
    const data     = await apiGet("/api/v1/series", { url: anime.url });
    const episodes = data.episodes || [];

    if (!episodes.length) {
      await ctx.replyReact("❌");
      return ctx.reply({
        text: errorCard("No Episodes Found", `Nothing available for "${trim(anime.title, 28)}" yet.`),
      });
    }

    const seriesInfo = {
      title:     data.title     || anime.title,
      image:     data.image     || anime.image,
      url:       anime.url,
      languages: data.languages || anime.languages || [],
    };

    global._AniVersePending.set(ctx.sender.jid, {
      step: "pick_episode", anime: seriesInfo, episodes,
      expiresAt: Date.now() + EPISODE_TTL,
    });

    const caption   = episodeCard(seriesInfo, episodes);
    const posterBuf = await fetchPoster(seriesInfo.image);

    await ctx.replyReact("✅");
    if (posterBuf) {
      await ctx.reply({ image: posterBuf, caption });
    } else {
      await ctx.reply({ text: caption });
    }
  } catch (err) {
    console.error("[AniVerse] pickAnime:", err.message);
    await ctx.replyReact("❌");
    await ctx.reply({ text: errorCard("Series Error", err.message) });
  }
}

module.exports = [
  {
    name:        "AniVerse",
    aliases:     ["anime", "hindianime", "banglaanime"],
    category:    "anime",
    description: "Search & download Hindi/Bengali dubbed anime episodes",
    usage:       "anime <name>",
    permissions: { coin: 10 },

    async code(ctx) {
      const query = (ctx.args || []).join(" ").trim();
      if (!query) return ctx.reply({ text: noQueryCard() });

      await ctx.replyReact("🔍");
      try {
        const data    = await apiGet("/api/v1/search", { q: query, lang: "all" });
        const results = (data.results || []).slice(0, 8);

        if (!results.length) {
          await ctx.replyReact("❌");
          return ctx.reply({ text: noResultsCard(query) });
        }

        if (results.length === 1) return pickAnime(ctx, results[0]);

        global._AniVersePending.set(ctx.sender.jid, {
          step: "pick_anime", results,
          expiresAt: Date.now() + SEARCH_TTL,
        });

        await ctx.replyReact("✅");
        await ctx.reply({ text: searchCard(query, results) });
      } catch (err) {
        console.error("[AniVerse] search:", err.message);
        await ctx.replyReact("❌");
        await ctx.reply({ text: errorCard("API Error", err.message) });
      }
    },
  },

  {
    type: "hears",
    name: "^\\d+$",

    async code(ctx) {
      try {
        const senderJid = ctx.sender?.jid;
        if (!senderJid) return;

        const pending = global._AniVersePending.get(senderJid);
        if (!pending) return;

        if (Date.now() > pending.expiresAt) {
          global._AniVersePending.delete(senderJid);
          return;
        }

        const num = parseInt((ctx.msg?.body || "").trim(), 10);
        if (isNaN(num) || num < 1) return;

        if (pending.step === "pick_anime") {
          const { results } = pending;
          if (num > results.length) {
            return ctx.reply({
              text: errorCard("Wrong Number", `Pick a number between *1* and *${results.length}*.`),
            });
          }
          global._AniVersePending.delete(senderJid);
          return pickAnime(ctx, results[num - 1]);
        }

        if (pending.step === "pick_episode") {
          const { anime, episodes } = pending;
          if (num > episodes.length) {
            return ctx.reply({
              text: errorCard("Wrong Number", `Pick a number between *1* and *${episodes.length}*.`),
            });
          }

          global._AniVersePending.delete(senderJid);

          const ep      = episodes[num - 1];
          const epLabel = String(ep.episode_title || ep.episode_number || `Episode ${num}`);

          await ctx.replyReact("⬇️");
          await ctx.reply({ text: downloadingCard(anime, num, epLabel) });

          let buf;
          try {
            buf = await apiDownload(ep.episode_url);
          } catch (err) {
            console.error("[AniVerse] download:", err.message);
            await ctx.replyReact("❌");
            return ctx.reply({
              text: errorCard("Download Failed", err.message, ep.episode_url),
            });
          }

          const sizeMB = buf.length / (1024 * 1024);
          if (sizeMB > MAXMB) {
            await ctx.replyReact("❌");
            return ctx.reply({
              text: errorCard(
                "File Too Large",
                `${sizeMB.toFixed(1)} MB exceeds the ${MAXMB} MB limit.`,
                ep.episode_url
              ),
            });
          }

          await ctx.replyReact("✅");
          await ctx.reply({
            video:    buf,
            mimetype: "video/mp4",
            caption:  videoCaption(anime, num, epLabel, sizeMB),
          });
        }
      } catch (err) {
        console.error("[AniVerse] hears:", err.message);
        try { await ctx.replyReact("❌"); } catch {}
      }
    },
  },
];

"use strict";

const axios = require("axios");
const fs = require("fs");
const path = require("path");

const API_BASE = process.env.SHIKO_API || "https://siko-anime.onrender.com";
const MAXMB = 49;
const SEARCH_TTL = 5 * 60 * 1000;  // 5 min
const EPISODE_TTL = 10 * 60 * 1000; // 10 min

const TMP_DIR = path.join(__dirname, "..", "..", "..", "data", "cache", "shiko");
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

if (!global._shikoPending) global._shikoPending = new Map();


async function apiGet(endpoint, params = {}) {
    const res = await axios.get(`${API_BASE}${endpoint}`, {
        params,
        timeout: 30000,
        headers: { "User-Agent": "CHISA-SHIKO/1.0", "Accept-Encoding": "gzip" },
    });
    return res.data;
}


async function downloadToBuffer(url) {
    const res = await axios.get(url, {
        responseType: "arraybuffer",
        timeout: 120000,
        maxRedirects: 5,
        maxContentLength: MAXMB * 1024 * 1024,
        headers: {
            Referer: "https://animesalt.link/",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
    });
    return Buffer.from(res.data);
}


function searchResultsText(results) {
    const lines = [
        "🔍 *SHIKO — Anime Search*",
        "━━━━━━━━━━━━━━━━━━━",
    ];
    results.forEach((r, i) => {
        const title = r.title.length > 42 ? r.title.slice(0, 39) + "..." : r.title;
        const langs = (r.languages || []).join("/") || "?";
        lines.push(`${i + 1}. ${title}  [${langs}]`);
    });
    lines.push("━━━━━━━━━━━━━━━━━━━");
    lines.push("📌 Reply with a number to select");
    return lines.join("\n");
}

function episodeListText(anime, episodes) {
    const langs = (anime.languages || [])
        .map(l => l.charAt(0).toUpperCase() + l.slice(1))
        .join(" & ") || "Dubbed";
    const lines = [
        `🎬 *${anime.title}*`,
        `🌐 ${langs}  |  📺 ${episodes.length} Episodes`,
        "━━━━━━━━━━━━━━━━━━━",
    ];
    const show = Math.min(episodes.length, 50);
    for (let i = 0; i < show; i++) {
        const ep = episodes[i];
        const raw = ep.episode_title || ep.episode_number || `Episode ${i + 1}`;
        const lbl = raw.length > 38 ? raw.slice(0, 35) + "..." : raw;
        lines.push(`${String(i + 1).padStart(2)}. ${lbl}`);
    }
    if (episodes.length > 50) {
        lines.push(`... and ${episodes.length - 50} more (type up to ${episodes.length})`);
    }
    lines.push("━━━━━━━━━━━━━━━━━━");
    lines.push("📌 Reply with an episode number to download");
    return lines.join("\n");
}

async function pickAnime(ctx, anime) {
    await ctx.replyReact("⏳");
    try {
        const data = await apiGet("/api/v1/series", { url: anime.url });
        const episodes = data.episodes || [];

        if (!episodes.length) {
            await ctx.replyReact("❌");
            return ctx.reply({ text: `❌ No episodes found for *${anime.title}*.` });
        }

        const seriesInfo = {
            title: data.title || anime.title,
            image: data.image || anime.image,
            url: anime.url,
            languages: data.languages || anime.languages || [],
        };

        const caption = episodeListText(seriesInfo, episodes);
        const senderJid = ctx.sender.jid;

        global._shikoPending.set(senderJid, {
            step: "pick_episode",
            anime: seriesInfo,
            episodes,
            expiresAt: Date.now() + EPISODE_TTL,
        });

        
        let posterBuf = null;
        if (seriesInfo.image) {
            try {
                const imgRes = await axios.get(
                    `${API_BASE}/api/v1/imgproxy?url=${encodeURIComponent(seriesInfo.image)}`,
                    { responseType: "arraybuffer", timeout: 10000 }
                );
                posterBuf = Buffer.from(imgRes.data);
            } catch { /* send text only */ }
        }

        await ctx.replyReact("✅");
        if (posterBuf && posterBuf.length > 512) {
            await ctx.reply({ image: posterBuf, caption });
        } else {
            await ctx.reply({ text: caption });
        }
    } catch (err) {
        await ctx.replyReact("❌");
        await ctx.reply({ text: `❌ Error fetching series: ${err.message}` });
    }
}


module.exports = {
    name: "shiko",
    aliases: ["sikoanime", "hindianime", "banglaanime"],
    category: "anime",
    description: "Search & download Hindi/Bengali dubbed anime episodes",
    usage: "shiko <anime name>",
    permissions: { coin: 10 },

    async code(ctx) {
        const args = ctx.args || [];
        const query = args.join(" ").trim();
        if (!query) {
            return ctx.reply({
                text: "❓ Please provide an anime name.\n\nExample: *shiko naruto*",
            });
        }

        await ctx.replyReact("🔍");
        try {
            const data = await apiGet("/api/v1/search", { q: query, lang: "all" });
            const results = (data.results || []).slice(0, 8);

            if (!results.length) {
                await ctx.replyReact("❌");
                return ctx.reply({ text: `❌ No results found for *${query}*.` });
            }

            if (results.length === 1) {
                return pickAnime(ctx, results[0]);
            }

            const senderJid = ctx.sender.jid;
            global._shikoPending.set(senderJid, {
                step: "pick_anime",
                results,
                expiresAt: Date.now() + SEARCH_TTL,
            });

            await ctx.replyReact("✅");
            await ctx.reply({ text: searchResultsText(results) });
        } catch (err) {
            await ctx.replyReact("❌");
            await ctx.reply({ text: `❌ API error: ${err.message}` });
        }
    },
};

// Export helpers for the pick handler
module.exports._pickAnime = pickAnime;
module.exports._apiGet = apiGet;
module.exports._downloadToBuffer = downloadToBuffer;
module.exports.MAXMB = MAXMB;
module.exports.TMP_DIR = TMP_DIR;

"use strict";

const { execFileSync, execSync } = require("child_process");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const os = require("os");

const API_BASE = process.env.SHIKO_API || "https://siko-anime.onrender.com";
const MAXMB = 49;
const SEARCH_TTL = 5 * 60 * 1000;
const EPISODE_TTL = 10 * 60 * 1000;
const FFMPEG_TIMEOUT = 150000;
const YTDLP_TIMEOUT = 180000;

if (!global._shikoPending) global._shikoPending = new Map();

async function apiGet(endpoint, params = {}) {
    const res = await axios.get(`${API_BASE}${endpoint}`, {
        params,
        timeout: 30000,
        headers: { "User-Agent": "CHISA-SHIKO/1.0", "Accept-Encoding": "gzip" },
    });
    return res.data;
}

function searchResultsText(results) {
    const lines = ["🔍 *SHIKO — Anime Search*", "━━━━━━━━━━━━━━━━━━━━━━━━━━"];
    results.forEach((r, i) => {
        const title = r.title.length > 42 ? r.title.slice(0, 39) + "..." : r.title;
        const langs = (r.languages || []).join("/") || "?";
        lines.push(`${i + 1}. ${title}  [${langs}]`);
    });
    lines.push("━━━━━━━━━━━━━━━━━━━━━━━━━━");
    lines.push("📌 Reply with a number to select");
    return lines.join("\n");
}

function episodeListText(anime, episodes) {
    const langs = (anime.languages || []).map(l => l.charAt(0).toUpperCase() + l.slice(1)).join(" & ") || "Dubbed";
    const lines = [
        `🎬 *${anime.title}*`,
        `🌐 ${langs}  |  📺 ${episodes.length} Episodes`,
        "━━━━━━━━━━━━━━━━━━━━━━━━━━",
    ];
    const show = Math.min(episodes.length, 50);
    for (let i = 0; i < show; i++) {
        const ep = episodes[i];
        const raw = ep.episode_title || ep.episode_number || `Episode ${i + 1}`;
        const lbl = raw.length > 38 ? raw.slice(0, 35) + "..." : raw;
        lines.push(`${String(i + 1).padStart(2)}. ${lbl}`);
    }
    if (episodes.length > 50) lines.push(`... and ${episodes.length - 50} more (type up to ${episodes.length})`);
    lines.push("━━━━━━━━━━━━━━━━━━━━━━━━━━");
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

        global._shikoPending.set(ctx.sender.jid, {
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
            } catch {}
        }

        const caption = episodeListText(seriesInfo, episodes);
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

async function resolveVideoUrl(iframeSrc) {
    const hashMatch = iframeSrc.match(/\/video\/([a-f0-9]{32,})/i);
    if (!hashMatch) return null;
    const hash = hashMatch[1];
    const cdnHost = new URL(iframeSrc).origin;

    const res = await axios.post(
        `${cdnHost}/player/index.php?data=${hash}&do=getVideo`,
        `hash=${hash}&r=https%3A%2F%2Fanimesalt.link%2F`,
        {
            timeout: 20000,
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "Referer": "https://animesalt.link/",
                "Origin": cdnHost,
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "X-Requested-With": "XMLHttpRequest",
            },
        }
    );
    return res.data?.videoSource || res.data?.securedLink || null;
}

async function downloadEpisode(iframeSrc) {
    const tmpFile = path.join(os.tmpdir(), `shiko_${Date.now()}.mp4`);

    
    try {
        execFileSync("yt-dlp", [
            "--no-playlist",
            "--no-warnings",
            "-f", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
            "--merge-output-format", "mp4",
            "--max-filesize", `${MAXMB}m`,
            "-o", tmpFile,
            iframeSrc,
        ], { timeout: YTDLP_TIMEOUT, stdio: "pipe" });

        if (fs.existsSync(tmpFile) && fs.statSync(tmpFile).size >= 1024) {
            const buf = fs.readFileSync(tmpFile);
            try { fs.unlinkSync(tmpFile); } catch {}
            return buf;
        }
    } catch (_ytErr) {
        
    } finally {
        if (fs.existsSync(tmpFile)) { try { fs.unlinkSync(tmpFile); } catch {} }
    }

  
    const videoUrl = await resolveVideoUrl(iframeSrc);
    if (!videoUrl) throw new Error("Could not resolve video source from player API");

    const tmpFile2 = path.join(os.tmpdir(), `shiko_${Date.now()}.mp4`);
    try {
        execFileSync("ffmpeg", [
            "-y", "-i", videoUrl,
            "-c", "copy",
            "-movflags", "+faststart",
            "-bsf:a", "aac_adtstoasc",
            "-fs", String(MAXMB * 1024 * 1024),
            tmpFile2,
        ], { timeout: FFMPEG_TIMEOUT, stdio: "pipe" });

        if (!fs.existsSync(tmpFile2) || fs.statSync(tmpFile2).size < 1024) {
            throw new Error("ffmpeg produced an empty file");
        }

        const buf = fs.readFileSync(tmpFile2);
        fs.unlinkSync(tmpFile2);
        return buf;
    } catch (err) {
        if (fs.existsSync(tmpFile2)) { try { fs.unlinkSync(tmpFile2); } catch {} }
        throw err;
    }
}

module.exports = [
    {
        name: "shiko",
        aliases: ["sikoanime", "hindianime", "banglaanime"],
        category: "anime",
        description: "Search & download Hindi/Bengali dubbed anime episodes",
        usage: "shiko <anime name>",
        permissions: { coin: 10 },

        async code(ctx) {
            const query = (ctx.args || []).join(" ").trim();
            if (!query) {
                return ctx.reply({ text: "❓ Please provide an anime name.\n\nExample: *shiko naruto*" });
            }

            await ctx.replyReact("🔍");
            try {
                const data = await apiGet("/api/v1/search", { q: query, lang: "all" });
                const results = (data.results || []).slice(0, 8);

                if (!results.length) {
                    await ctx.replyReact("❌");
                    return ctx.reply({ text: `❌ No results found for *${query}*.` });
                }

                if (results.length === 1) return pickAnime(ctx, results[0]);

                global._shikoPending.set(ctx.sender.jid, {
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
    },

    {
        type: "hears",
        name: "^\\d+$",

        async code(ctx) {
            try {
                const senderJid = ctx.sender?.jid;
                if (!senderJid || !global._shikoPending) return;

                const pending = global._shikoPending.get(senderJid);
                if (!pending || Date.now() > pending.expiresAt) {
                    global._shikoPending.delete(senderJid);
                    return;
                }

                const num = parseInt((ctx.msg?.body || "").trim(), 10);
                if (isNaN(num) || num < 1) return;

                if (pending.step === "pick_anime") {
                    const { results } = pending;
                    if (num > results.length) {
                        return ctx.reply({ text: `❌ Please reply with a number between *1* and *${results.length}*.` });
                    }
                    global._shikoPending.delete(senderJid);
                    return pickAnime(ctx, results[num - 1]);
                }

                if (pending.step === "pick_episode") {
                    const { anime, episodes } = pending;
                    if (num > episodes.length) {
                        return ctx.reply({ text: `❌ Please reply with a number between *1* and *${episodes.length}*.` });
                    }

                    global._shikoPending.delete(senderJid);

                    const ep = episodes[num - 1];
                    const epLabel = String(ep.episode_title || ep.episode_number || `Episode ${num}`);

                    await ctx.replyReact("⬇️");
                    await ctx.reply({
                        text: `⏳ Downloading *Episode ${num}*: ${epLabel}\n📺 *${anime.title}*\n\n_Please wait, converting HLS stream…_`,
                    });

                    let extracted;
                    try {
                        extracted = await apiGet("/api/v1/extract", { url: ep.episode_url });
                    } catch (err) {
                        await ctx.replyReact("❌");
                        return ctx.reply({ text: `❌ SHIKO API error: ${err.message}` });
                    }

                    if (!extracted?.iframe_src) {
                        await ctx.replyReact("❌");
                        return ctx.reply({
                            text: `❌ No video source found for Episode ${num}.\n` +
                                (extracted?.error ? `Reason: ${extracted.error}` : ""),
                        });
                    }

                    let buf = null;
                    try {
                        buf = await downloadEpisode(extracted.iframe_src);
                    } catch (err) {
                        consolefy?.error?.("[SHIKO]", err.message);
                        await ctx.replyReact("❌");
                        return ctx.reply({
                            text: `❌ Download failed: ${err.message}\n🔗 Watch directly:\n${extracted.iframe_src}`,
                        });
                    }

                    if (!buf || buf.length < 1024) {
                        await ctx.replyReact("❌");
                        return ctx.reply({
                            text: `❌ Download failed for Episode ${num}.\n🔗 Watch directly:\n${extracted.iframe_src}`,
                        });
                    }

                    const sizeMB = buf.length / (1024 * 1024);
                    if (sizeMB > MAXMB) {
                        await ctx.replyReact("❌");
                        return ctx.reply({
                            text: `❌ File too large (${sizeMB.toFixed(1)} MB).\n🔗 Watch directly:\n${extracted.iframe_src}`,
                        });
                    }

                    await ctx.replyReact("✅");
                    await ctx.reply({
                        video: buf,
                        mimetype: "video/mp4",
                        caption: `🎬 *${anime.title}*\n📺 Episode ${num}: ${epLabel}  |  ${sizeMB.toFixed(1)} MB`,
                    });
                }
            } catch (err) {
                consolefy?.error?.("[SHIKO]", err.message);
                try { await ctx.replyReact("❌"); } catch {}
            }
        },
    },
];

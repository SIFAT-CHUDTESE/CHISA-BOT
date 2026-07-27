"use strict";

const axios = require("axios");
const shiko = require("./shiko.js");
const { _pickAnime, _apiGet, _downloadToBuffer, MAXMB } = shiko;

const API_BASE = process.env.SHIKO_API || "https://siko-anime.onrender.com";

module.exports = {
    type: "hears",
    name: "^\\d+$",

    async code(ctx) {
        try {
            const senderJid = ctx.sender?.jid;
            if (!senderJid) return;

            if (!global._shikoPending) return;
            const pending = global._shikoPending.get(senderJid);
            if (!pending || Date.now() > pending.expiresAt) {
                global._shikoPending.delete(senderJid);
                return;
            }

            const body = (ctx.msg?.body || "").trim();
            const num = parseInt(body, 10);
            if (isNaN(num) || num < 1) return;

            
            if (pending.step === "pick_anime") {
                const { results } = pending;
                if (num > results.length) {
                    return ctx.reply({
                        text: `❌ Please reply with a number between *1* and *${results.length}*.`,
                    });
                }
                global._shikoPending.delete(senderJid);
                return _pickAnime(ctx, results[num - 1]);
            }

            
            if (pending.step === "pick_episode") {
                const { anime, episodes } = pending;
                if (num > episodes.length) {
                    return ctx.reply({
                        text: `❌ Please reply with a number between *1* and *${episodes.length}*.`,
                    });
                }

                global._shikoPending.delete(senderJid);

                const ep = episodes[num - 1];
                const epLabel =
                    ep.episode_title || ep.episode_number
                        ? String(ep.episode_title || ep.episode_number)
                        : `Episode ${num}`;

                await ctx.replyReact("⬇️");
                await ctx.reply({
                    text: `⏳ Fetching *Episode ${num}*: ${epLabel}\n📺 ${anime.title}`,
                });

                try {
                    
                    const extracted = await _apiGet("/api/v1/extract", {
                        url: ep.episode_url,
                    });

                    if (!extracted.iframe_src) {
                        await ctx.replyReact("❌");
                        return ctx.reply({
                            text:
                                `❌ Could not find video source for Episode ${num}.\n` +
                                (extracted.error ? `Reason: ${extracted.error}` : ""),
                        });
                    }

                
                    let buf = null;
                    try {
                        buf = await _downloadToBuffer(extracted.iframe_src);
                    } catch (dlErr) {
                    
                        try {
                            buf = await _downloadToBuffer(
                                `${API_BASE}/api/v1/proxy?url=${encodeURIComponent(extracted.iframe_src)}`
                            );
                        } catch { /* give up */ }
                    }

                    if (!buf || buf.length < 1024) {
                        await ctx.replyReact("❌");
                        return ctx.reply({
                            text:
                                `❌ Download failed for Episode ${num}.\n` +
                                `🔗 Watch directly: ${extracted.iframe_src}`,
                        });
                    }

                    const sizeMB = buf.length / (1024 * 1024);
                    if (sizeMB > MAXMB) {
                        await ctx.replyReact("❌");
                        return ctx.reply({
                            text:
                                `❌ File too large (${sizeMB.toFixed(1)} MB > ${MAXMB} MB limit).\n` +
                                `🔗 Watch directly: ${extracted.iframe_src}`,
                        });
                    }

                    await ctx.replyReact("✅");
                    await ctx.reply({
                        video: buf,
                        mimetype: "video/mp4",
                        caption: `🎬 *${anime.title}*\n📺 Episode ${num}: ${epLabel}  |  ${sizeMB.toFixed(1)} MB`,
                    });
                } catch (err) {
                    await ctx.replyReact("❌");
                    await ctx.reply({ text: `❌ Download error: ${err.message}` });
                }
            }
        } catch {
            
        }
    },
};
                  

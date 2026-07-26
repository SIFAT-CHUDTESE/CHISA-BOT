"use strict";

const axios = require("axios");

const SIFAT_CDTESE = "https://raw.githubusercontent.com/FX-SIFAT/SIFATChudtese/refs/heads/main/sifatapichudtese.json";
let _sifatBase = process.env.SIFU_API_BASE ? process.env.SIFU_API_BASE.replace(/\/+$/, "") : null;
const _sifatReady = (async () => {
    if (_sifatBase) return;
    try {
        const r = await axios.get(SIFAT_CDTESE, { timeout: 8000 });
        const u = r.data?.music;
        if (u && u.startsWith("http")) _sifatBase = u.replace(/\/+$/, "");
    } catch {}
})();
const getSIFAT = async () => { await _sifatReady; return _sifatBase; };

const TMO    = parseInt(process.env.SIFU_TIMEOUT_MS || "180000", 10);
const MAXMB  = parseFloat(process.env.SIFU_MAX_MB   || "50");
const PICK_TTL = 5 * 60 * 1000;

const RETRY_CODES = new Set(["ECONNRESET","ETIMEDOUT","ECONNABORTED","EAI_AGAIN","ENETUNREACH","EPIPE"]);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function sifatGet(endpoint, params) {
    const api = await getSIFAT();
    if (!api) throw new Error("SIFAT API unavailable");
    for (let i = 0; i < 3; i++) {
        try {
            return (await axios.get(api + endpoint, { params, timeout: TMO, validateStatus: s => s < 300 })).data;
        } catch (e) {
            if (!RETRY_CODES.has(e.code) && !(e.response?.status >= 502)) throw e;
            if (i === 2) throw e;
            await sleep(600 * 2 ** i);
        }
    }
}

async function sifatDownload(endpoint, params) {
    const api = await getSIFAT();
    if (!api) throw new Error("SIFAT API unavailable");
    for (let i = 0; i < 3; i++) {
        try {
            const res = await axios.get(api + endpoint, {
                params, timeout: TMO,
                responseType: "arraybuffer",
                validateStatus: s => s < 300,
                maxContentLength: MAXMB * 1024 * 1024
            });
            return Buffer.from(res.data);
        } catch (e) {
            if (!RETRY_CODES.has(e.code) && !(e.response?.status >= 502)) throw e;
            if (i === 2) throw e;
            await sleep(600 * 2 ** i);
        }
    }
}

const BENGALI_RX = /[\u0980-\u09FF]/g;
function hasBengali(text) {
    const str = String(text || "");
    const m = str.match(BENGALI_RX);
    if (!m) return false;
    return m.length / Math.max(str.replace(/\s/g, "").length, 1) > 0.3;
}
function filterResults(results) {
    const f = (results || []).filter(r => !hasBengali(r.title));
    return f.length > 0 ? f : (results || []);
}

const TT_RX = /^(https?:\/\/)?(www\.|vm\.|vt\.|m\.)?tiktok\.com\//i;
const isTT  = s => TT_RX.test(String(s).trim());

const QUALITIES = ["hd", "sd"];
const DEF_Q     = "hd";

if (!global._searchPick) global._searchPick = new Map();

module.exports = {
    name: "tiktok",
    aliases: ["tt", "tik", "ttdl", "tikdl"],
    category: "downloader",
    description: "TikTok video search & download (Bengali titles filtered)",
    usage: "tiktok <query | TikTok URL> [-q hd|sd] [list]",
    permissions: { coin: 10 },

    async code(ctx) {
        const senderJid = ctx.sender?.jid;
        try {
            const args = ctx.args || [];
            let quality = DEF_Q;
            let mode = "dl";
            const rest = [];

            for (let i = 0; i < args.length; i++) {
                const a = args[i].toLowerCase();
                if (a === "list" || a === "-list") { mode = "list"; continue; }
                if ((a === "-q" || a === "--quality") && QUALITIES.includes(args[i + 1]?.toLowerCase())) {
                    quality = args[++i].toLowerCase(); continue;
                }
                rest.push(args[i]);
            }

            const query = rest.join(" ").trim() || ctx.text?.trim() || "";
            if (!query) { await ctx.replyReact("❓"); return; }

            
            if (mode === "list") {
                await ctx.replyReact("🔍");
                const searchData = await sifatGet("/api/tiktok/search", { q: query, limit: 10 });
                const results = filterResults(searchData?.results || []).slice(0, 6);
                if (!results.length) { await ctx.replyReact("❌"); return; }

                const imgBuf = await sifatDownload("/api/tiktok/search-image", { q: query, limit: 6, cmd: "Reply 1-6" });
                if (!imgBuf || imgBuf.length < 512) { await ctx.replyReact("❌"); return; }

                global._searchPick.set(senderJid, {
                    type: "tiktok", results, quality,
                    expiresAt: Date.now() + PICK_TTL
                });

                await ctx.replyReact("✅");
                await ctx.reply({ image: imgBuf, caption: "" });
                return;
            }

            
            let url;
            if (isTT(query)) {
                url = query.trim();
                await ctx.replyReact("📥");
            } else {
                await ctx.replyReact("🔍");
                const d = await sifatGet("/api/tiktok/search", { q: query, limit: 10 });
                const top = filterResults(d?.results || [])[0];
                if (!top?.url) { await ctx.replyReact("❌"); return; }
                url = top.url;
                await ctx.replyReact("📥");
            }

            const ladder = quality === "hd" ? ["hd", "sd"] : ["sd", "hd"];
            let buf = null;
            for (const q of ladder) {
                try { buf = await sifatDownload("/api/tiktok/download", { url, quality: q }); } catch { buf = null; }
                if (buf && buf.length >= 1024 && buf.length / 1048576 <= MAXMB) break;
                buf = null;
            }

            if (!buf || buf.length < 1024 || buf.length / 1048576 > MAXMB) {
                await ctx.replyReact("❌"); return;
            }
            await ctx.replyReact("✅");
            await ctx.reply({ video: buf, mimetype: "video/mp4", caption: "" });

        } catch {
            await ctx.replyReact("❌");
        }
    }
};

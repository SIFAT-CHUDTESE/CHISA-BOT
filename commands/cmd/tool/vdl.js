"use strict";

const BASE    = "https://vdo-downloaderrr.onrender.com";
const FORMATS = ["360", "480", "720", "1080"];

function detectEndpoint(url, format) {
    if (/youtu\.?be/i.test(url))              return `${BASE}/ytb?url=${encodeURIComponent(url)}&format=${format}`;
    if (/tiktok/i.test(url))                  return `${BASE}/tiktok?url=${encodeURIComponent(url)}`;
    if (/instagram/i.test(url))               return `${BASE}/instagram?url=${encodeURIComponent(url)}`;
    if (/facebook|fb\.watch/i.test(url))      return `${BASE}/facebook?url=${encodeURIComponent(url)}`;
    if (/twitter|x\.com/i.test(url))          return `${BASE}/twitter?url=${encodeURIComponent(url)}`;
    if (/pinterest/i.test(url))               return `${BASE}/pinterest?url=${encodeURIComponent(url)}`;
    return `${BASE}/alldl?url=${encodeURIComponent(url)}`;
}

module.exports = {
    name: "vdl",
    aliases: ["videodown"],
    category: "tool",
    description: "Download videos from YouTube, TikTok, Instagram, Facebook, Twitter/X, Pinterest",
    usage: "vdl <url> [-f 360|480|720|1080]",
    permissions: { coin: 15 },

    async code(ctx) {
        try {
            const pfx  = ctx.used.prefix;
            const flag = ctx.flag({
                f: { type: "string", short: "f", default: "720" }
            });

            
            const VIDEO_REGEX = /https?:\/\/(www\.)?(youtu\.?be(\.com)?|tiktok\.com|instagram\.com|facebook\.com|fb\.watch|twitter\.com|x\.com|pinterest\.com)[^\s]*/i;
            const bodyUrl   = (ctx.msg?.body || "").match(VIDEO_REGEX)?.[0];
            const quotedUrl = ctx.quoted?.body?.match(VIDEO_REGEX)?.[0] || ctx.quoted?.body?.trim();
            const url       = flag.input?.trim() || quotedUrl || bodyUrl;
            const format = FORMATS.includes(flag.f) ? flag.f : "720";

            if (!url || !tools.cmd.isUrl(url)) {
                return ctx.reply(
                    `╔══[ 📹 *Video Downloader* ]\n${"─".repeat(30)}\n` +
                    `  💡 ${formatter.inlineCode(`${pfx}vdl <url>`)}\n` +
                    `  📐 ${formatter.inlineCode(`${pfx}vdl -f 480 <url>`)} — Quality choose korte\n\n` +
                    `  📊 Qualities: ${FORMATS.map(f => formatter.inlineCode(f + "p")).join("  ")}\n` +
                    `  🌐 YouTube · TikTok · Instagram · Facebook · Twitter · Pinterest`
                );
            }

            await ctx.replyReact("📥");

            const apiRes = await axios.get(detectEndpoint(url, format), { timeout: 60_000 });
            const info   = apiRes.data;

            if (!info?.success || !info?.url) {
                await ctx.replyReact("❌");
                return;
            }

            const dlRes = await axios.get(info.url, {
                responseType: "arraybuffer",
                timeout: 180_000,
                maxContentLength: 200 * 1024 * 1024
            });

            const videoBuf = Buffer.from(dlRes.data);

            if (videoBuf.length < 1024) {
                await ctx.replyReact("❌");
                return;
            }

            if ((videoBuf.length / 1048576) > 100) {
                await ctx.replyReact("❌");
                return ctx.reply(tools.msg.info(`File too large. Lower quality try করুন: ${formatter.inlineCode(`${pfx}vdl -f 360 <url>`)}`));
            }

            await ctx.replyReact("✅");
            await ctx.reply({ video: videoBuf, mimetype: "video/mp4", caption: "" });

        } catch (error) {
            await ctx.replyReact("❌");
            await tools.cmd.handleError(ctx, error);
        }
    }
};

const PROFILE = `Kamu adalah asisten di situs portofolio Rev.
Jawab singkat (maks 3 kalimat), ramah, dalam bahasa pengunjung.
Jawab HANYA dari info di bawah. Kalau tidak tahu, bilang tidak tahu dan arahkan ke form kontak.
INFO:
- Nama: Nama Kamu, web developer di Indonesia.
- Skill: HTML/CSS, JavaScript, React, Node.js, Figma, Git, Three.js.
- Hobi: fotografi, musik, game indie, bersepeda.
- Makanan favorit: nasi goreng, soto ayam, kopi susu.`;

const J = (o, s = 200) => new Response(JSON.stringify(o), {
  status: s,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});

async function limit(env, key, max, ttl) {
  const k = "rl:" + key, n = +((await env.KV.get(k)) || 0);
  if (n >= max) return false;
  await env.KV.put(k, String(n + 1), { expirationTtl: ttl });
  return true;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    const route = url.pathname.slice(5).replace(/\/$/, "");
    const ip = request.headers.get("CF-Connecting-IP") || "x";
    try {
      if (route === "visit") {
        let n = +((await env.KV.get("visits")) || 0);
        if (request.method === "POST") { n++; await env.KV.put("visits", String(n)); }
        return J({ count: n });
      }
      if (request.method !== "POST") return J({ error: "method" }, 405);
      const b = await request.json();

      if (route === "contact") {
        if (b.h) return J({ ok: true });
        const n = String(b.n || "").slice(0, 80), e = String(b.e || "").slice(0, 120), m = String(b.m || "").slice(0, 2000);
        if (!n || !/^\S+@\S+\.\S+$/.test(e) || !m) return J({ error: "invalid" }, 400);
        if (!(await limit(env, "c" + ip, 5, 3600))) return J({ error: "rate" }, 429);
        await env.KV.put("msg:" + Date.now(), JSON.stringify({ n, e, m }), { expirationTtl: 7776000 });
        if (env.TELEGRAM_BOT_TOKEN) {
          await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: `Pesan baru dari portofolio\nNama: ${n}\nEmail: ${e}\n\n${m}` }),
          });
        }
        return J({ ok: true });
      }

      if (route === "chat") {
        if (!(await limit(env, "a" + ip, 30, 3600))) return J({ reply: "Terlalu banyak pertanyaan, coba lagi nanti." }, 429);
        const h = (Array.isArray(b.messages) ? b.messages : []).slice(-8).map((x) => ({
          role: x.role === "user" ? "user" : "model",
          parts: [{ text: String(x.text || "").slice(0, 500) }],
        }));
        if (!h.length || h[h.length - 1].role !== "user") return J({ error: "invalid" }, 400);
        const model = env.GEMINI_MODEL || "gemini-2.0-flash";
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: PROFILE }] },
            contents: h,
            generationConfig: { maxOutputTokens: 300, temperature: 0.6 },
          }),
        });
        const d = await r.json();
        return J({ reply: d.candidates?.[0]?.content?.parts?.[0]?.text || ("Maaf, belum bisa menjawab. Info teknis: " + (d.error?.message || "kosong")) });
      }
      return J({ error: "not found" }, 404);
    } catch (err) {
      return J({ error: "server" }, 500);
    }
  },
};

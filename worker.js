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
      if (route === "testtg") {
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: "Tes dari Worker" }),
  });
  return J({ token: !!env.TELEGRAM_BOT_TOKEN, chat: env.TELEGRAM_CHAT_ID || null, status: r.status, body: (await r.text()).slice(0, 200) });
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
      return J({ error: "not found" }, 404);
    } catch (err) {
      return J({ error: "server" }, 500);
    }
  },
};

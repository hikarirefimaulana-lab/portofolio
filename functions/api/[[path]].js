// Cloudflare Pages Function: menangani /api/contact, /api/chat, /api/visit
// Butuh: KV binding bernama KV, dan env GEMINI_API_KEY (+ TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID opsional)

// ISI DENGAN DATA ASLIMU. Chatbot hanya menjawab dari teks ini.
const PROFILE = `Kamu adalah asisten di situs portofolio Rev.
Jawab singkat (maksimal 3 kalimat), ramah, dalam bahasa yang dipakai pengunjung.
Jawab HANYA berdasarkan info di bawah. Kalau tidak tahu, katakan tidak tahu dan arahkan ke form kontak.
Jangan mengarang pengalaman, angka, atau klien.

INFO:
- Nama: Rev, web developer di Indonesia, terbuka untuk proyek baru dan remote.
- Skill: HTML/CSS, JavaScript, React, Node.js, Figma, Git, Three.js.
- Proyek: Warung Pintar (aplikasi stok untuk UMKM), Kilat.co (web perusahaan cepat), Dunia Muter (eksperimen 3D).
- Hobi: fotografi jalanan, musik, game indie, bersepeda.
- Makanan favorit: nasi goreng, soto ayam, kopi susu.
- Kontak: lewat form di halaman ini.`;

const J = (o, s = 200) =>
  new Response(JSON.stringify(o), {
    status: s,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

// Batas request sederhana per IP (KV)
async function limit(env, key, max, ttl) {
  const k = "rl:" + key;
  const n = +((await env.KV.get(k)) || 0);
  if (n >= max) return false;
  await env.KV.put(k, String(n + 1), { expirationTtl: ttl });
  return true;
}

export async function onRequest({ request, env, params }) {
  const route = [].concat(params.path || []).join("/");
  const ip = request.headers.get("CF-Connecting-IP") || "x";
  try {
    if (route === "visit") {
      if (request.method === "POST") {
        const n = +((await env.KV.get("visits")) || 0) + 1;
        await env.KV.put("visits", String(n));
        return J({ count: n });
      }
      return J({ count: +((await env.KV.get("visits")) || 0) });
    }
    if (request.method !== "POST") return J({ error: "method" }, 405);
    const b = await request.json();

    if (route === "contact") {
      if (b.h) return J({ ok: true }); // honeypot: bot
      const n = String(b.n || "").slice(0, 80);
      const e = String(b.e || "").slice(0, 120);
      const m = String(b.m || "").slice(0, 2000);
      if (!n || !/^\S+@\S+\.\S+$/.test(e) || !m) return J({ error: "invalid" }, 400);
      if (!(await limit(env, "c" + ip, 5, 3600))) return J({ error: "rate" }, 429);
      await env.KV.put("msg:" + Date.now(), JSON.stringify({ n, e, m }), {
        expirationTtl: 60 * 60 * 24 * 90,
      });
      if (env.TELEGRAM_BOT_TOKEN) {
        await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: env.TELEGRAM_CHAT_ID,
            text: `Pesan baru dari portofolio\nNama: ${n}\nEmail: ${e}\n\n${m}`,
          }),
        });
      }
      return J({ ok: true });
    }

    if (route === "chat") {
      if (!(await limit(env, "a" + ip, 30, 3600)))
        return J({ reply: "Terlalu banyak pertanyaan, coba lagi nanti." }, 429);
      const h = (Array.isArray(b.messages) ? b.messages : []).slice(-8).map((x) => ({
        role: x.role === "user" ? "user" : "model",
        parts: [{ text: String(x.text || "").slice(0, 500) }],
      }));
      if (!h.length || h[h.length - 1].role !== "user") return J({ error: "invalid" }, 400);
      const model = env.GEMINI_MODEL || "gemini-2.0-flash"; // cek nama model terbaru di Google AI Studio
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: PROFILE }] },
            contents: h,
            generationConfig: { maxOutputTokens: 300, temperature: 0.6 },
          }),
        }
      );
      const d = await r.json();
      return J({
        reply: d.candidates?.[0]?.content?.parts?.[0]?.text || "Maaf, saya belum bisa menjawab itu.",
      });
    }
    return J({ error: "not found" }, 404);
  } catch (err) {
    return J({ error: "server" }, 500);
  }
}

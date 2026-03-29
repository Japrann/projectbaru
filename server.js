/**
 * Private chat server: in-memory messages, Discord webhook, optional auto-reply,
 * manual admin replies via POST /admin-reply.
 */

// Load .env before reading process.env (must be first).
require("dotenv").config();

// node-fetch v2 supports require(); v3 is ESM-only and breaks require().
const fetch = require("node-fetch");

const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("server jalan di port " + PORT);
});

/** Webhook URL from environment (set in .env as DISCORD_WEBHOOK_URL=...) */
const DISCORD_WEBHOOK_URL = (process.env.DISCORD_WEBHOOK_URL || "").trim();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// --- State ---
/** @type {{ text: string, sender: 'user' | 'bot' }[]} */
let messages = [];
let autoReplyEnabled = true;
let botTyping = false;
/** Pending auto-replies (typing stays true until all complete). */
let pendingAutoReplies = 0;

function logAutoReplyMode() {
  console.log(`[Auto-reply] Mode: ${autoReplyEnabled ? "ON" : "OFF"}`);
}

// --- Auto-reply: keyword lists & response pools (easy to edit) ---
const GREETING_KEYS = ["hai", "halo", "hallo", "hi", "hello", "hey"];
const GREETING_REPLIES = [
  "Hai juga~ lagi ngapain nih?",
  "Halo! kangen chat sama kamu loh, hehe.",
  "Heyy, akhirnya muncul juga. Miss you dikit 😊",
  "Hai sayang virtual~ ready buat ngobrol?",
];

const LAGI_APA_KEYS = ["lagi apa", "lagi ngapain", "sedang apa"];
const LAGI_APA_REPLIES = [
  "Lagi nungguin chat dari kamu sih, obviously.",
  "Ngerjain hal penting: mikirin kamu. Iya, itu penting.",
  "Lagi chill, sambil hoping kamu ngechat. And here you are~",
];

const BOSEN_KEYS = ["bosen", "bosan", "boring"];
const BOSEN_REPLIES = [
  "Yuk ngobrol seru bareng aku, biar gak bosen lagi.",
  "Bosen ya? Cerita random aja ke aku, I'll entertain you~",
  "Same sometimes. Tapi sekarang kan ada aku, jadi less boring kan?",
];

const KANGEN_KEYS = ["kangen", "miss", "miss you"];
const KANGEN_REPLIES = [
  "Aww, aku juga little bit kangen. Chat lebih sering ya~",
  "Kangen ya? Good, so you keep coming back to me 😏",
  "Same energy. Virtual hug dulu deh 🤗",
];

const FALLBACK_REPLIES = [
  "Hmm, noted. Tell me more?",
  "Interesting~ lanjut dong, I'm listening.",
  "Oke oke, got it. What's on your mind sekarang?",
  "Hehe, random but I like it. Next?",
  "Fair. Anyway, how's your day going?",
  "Mmm, okay. Mau curhat atau random chat aja?",
];

function normalizeText(s) {
  return String(s).toLowerCase().trim();
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomBetween(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

/**
 * Same playful hybrid ID + EN logic as requested.
 * @param {string} userText
 * @returns {string}
 */
function generateAutoReply(userText) {
  const t = normalizeText(userText);

  if (GREETING_KEYS.some((k) => t.includes(k))) {
    return pickRandom(GREETING_REPLIES);
  }
  if (LAGI_APA_KEYS.some((k) => t.includes(k))) {
    return pickRandom(LAGI_APA_REPLIES);
  }
  if (BOSEN_KEYS.some((k) => t.includes(k))) {
    return pickRandom(BOSEN_REPLIES);
  }
  if (KANGEN_KEYS.some((k) => t.includes(k))) {
    return pickRandom(KANGEN_REPLIES);
  }
  if (t.includes("?")) {
    return pickRandom([
      "Good question~ menurut kamu gimana?",
      "Hmm, tricky. Tapi aku curious sama jawaban kamu dulu.",
      "Let's figure it out bareng-bareng, ya?",
    ]);
  }

  return pickRandom(FALLBACK_REPLIES);
}

/**
 * POST user text to Discord Incoming Webhook.
 * Discord expects: POST with JSON { "content": "..." }.
 * @param {string} text
 */
async function sendToDiscord(text) {
  if (!DISCORD_WEBHOOK_URL) {
    console.warn("[Discord] sendToDiscord skipped: DISCORD_WEBHOOK_URL is empty. Set it in .env");
    return;
  }

  console.log("[Discord] Sending to webhook…", { preview: text.slice(0, 80) });

  try {
    const res = await fetch(DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: text }),
    });

    const bodyText = await res.text();
    console.log("[Discord] Response status:", res.status, res.statusText);

    if (!res.ok) {
      console.error("[Discord] Webhook error body:", bodyText);
      return;
    }

    console.log("[Discord] Message accepted by Discord API.");
  } catch (err) {
    console.error("[Discord] Request failed:", err && err.message ? err.message : err);
  }
}

function scheduleAutoReply(userText) {
  const delay = randomBetween(800, 1500);
  pendingAutoReplies += 1;
  botTyping = true;
  console.log(`[Auto-reply] Scheduled in ${delay}ms (pending: ${pendingAutoReplies})`);

  setTimeout(() => {
    if (!autoReplyEnabled) {
      console.log("[Auto-reply] Skipped — turned OFF before send");
      pendingAutoReplies -= 1;
      if (pendingAutoReplies <= 0) {
        pendingAutoReplies = 0;
        botTyping = false;
      }
      return;
    }
    const replyText = generateAutoReply(userText);
    messages.push({ text: replyText, sender: "bot" });
    console.log("[Auto-reply] Triggered — bot:", replyText.slice(0, 100));
    pendingAutoReplies -= 1;
    if (pendingAutoReplies <= 0) {
      pendingAutoReplies = 0;
      botTyping = false;
    }
  }, delay);
}

// --- Routes ---

/** Poll: messages + typing state for UI */
app.get("/messages", (req, res) => {
  res.json({ messages, botTyping, autoReplyEnabled });
});

/** User sends a message */
app.post("/message", async (req, res) => {
  const text = (req.body && req.body.text) != null ? String(req.body.text).trim() : "";
  if (!text) {
    return res.status(400).json({ error: "Missing or empty text" });
  }

  console.log("[User message]", text.slice(0, 200));

  const entry = { text, sender: "user" };
  messages.push(entry);

  const ts = new Date().toISOString();
  const discordPayload = `[NEW MESSAGE]\nUser: ${text}\nTime: ${ts}`;
  await sendToDiscord(discordPayload);

  if (autoReplyEnabled) {
    scheduleAutoReply(text);
  } else {
    console.log("[Auto-reply] Not sent — mode is OFF");
  }

  res.json({ ok: true, message: entry });
});

/**
 * Manual bot reply (e.g. from Discord workflow or Postman).
 * Body: { "message": "text here" } — also accepts legacy { "text": "..." }.
 */
app.post("/admin-reply", (req, res) => {
  const body = req.body || {};
  const raw =
    body.message != null ? body.message : body.text != null ? body.text : "";
  const text = String(raw).trim();
  if (!text) {
    return res.status(400).json({ error: 'Missing or empty "message"' });
  }

  console.log("[Manual reply]", text.slice(0, 200));

  const entry = { text, sender: "bot" };
  messages.push(entry);
  res.json({ ok: true, message: entry });
});

/** Toggle auto-reply mode */
app.post("/toggle-auto", (req, res) => {
  autoReplyEnabled = !autoReplyEnabled;
  logAutoReplyMode();
  res.json({ ok: true, autoReplyEnabled });
});

const server = app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  logAutoReplyMode();
  if (DISCORD_WEBHOOK_URL) {
    console.log("[Discord] Webhook configured (URL length:", DISCORD_WEBHOOK_URL.length, "chars)");
  } else {
    console.warn("[Discord] No DISCORD_WEBHOOK_URL — add it to .env to enable notifications.");
  }
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `[Server] Port ${PORT} is already in use. Close the other app (or run: netstat -ano | findstr :${PORT} then taskkill /PID <pid> /F), or set PORT=3001 in .env`
    );
  } else {
    console.error("[Server] Listen error:", err);
  }
  process.exit(1);
});


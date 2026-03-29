/**
 * Private chat client: polls server, renders bubbles, syncs auto-reply toggle.
 * API is same-origin (served by Express static + server.js).
 */

const API = {
  messages: "/messages",
  message: "/message",
  toggleAuto: "/toggle-auto",
};

const chatEl = document.getElementById("chat");
const typingEl = document.getElementById("typing");
const formEl = document.getElementById("form");
const inputEl = document.getElementById("input");
const autoReplyToggle = document.getElementById("autoReplyToggle");

/** Snapshot to skip redundant re-renders */
let lastMessagesJson = "";

/** Polling: random 1–2s as specified */
function nextPollDelayMs() {
  return 1000 + Math.floor(Math.random() * 1000);
}

function scrollChatToBottom() {
  requestAnimationFrame(() => {
    chatEl.scrollTop = chatEl.scrollHeight;
  });
}

/**
 * Render messages array into chat (full replace — keeps sync with server).
 * @param {{ text: string, sender: 'user' | 'bot' }[]} messages
 */
function renderMessages(messages) {
  const serialized = JSON.stringify(messages);
  if (serialized === lastMessagesJson) {
    return;
  }
  lastMessagesJson = serialized;

  chatEl.innerHTML = "";
  const frag = document.createDocumentFragment();

  for (const m of messages) {
    const row = document.createElement("div");
    row.className = `msg msg--${m.sender === "user" ? "user" : "bot"}`;

    const bubble = document.createElement("div");
    bubble.className = "msg__bubble";
    bubble.textContent = m.text;

    row.appendChild(bubble);
    frag.appendChild(row);
  }

  chatEl.appendChild(frag);
  scrollChatToBottom();
}

function setTypingVisible(show) {
  typingEl.classList.toggle("typing--hidden", !show);
  typingEl.setAttribute("aria-hidden", show ? "false" : "true");
}

async function fetchState() {
  const res = await fetch(API.messages);
  if (!res.ok) throw new Error("Failed to fetch messages");
  const data = await res.json();

  renderMessages(data.messages || []);
  setTypingVisible(!!data.botTyping);

  if (typeof data.autoReplyEnabled === "boolean") {
    autoReplyToggle.checked = data.autoReplyEnabled;
  }

  scrollChatToBottom();
}

async function sendUserMessage(text) {
  const res = await fetch(API.message, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Send failed");
  }
  await fetchState();
}

// --- Events ---

formEl.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = inputEl.value.trim();
  if (!text) return;

  inputEl.value = "";
  inputEl.focus();

  try {
    await sendUserMessage(text);
  } catch (err) {
    console.error(err);
    alert(err.message || "Could not send message.");
  }
});

/** Checkbox: POST /toggle-auto (one flip per click; state confirmed from response) */
autoReplyToggle.addEventListener("change", async () => {
  try {
    const res = await fetch(API.toggleAuto, { method: "POST" });
    if (!res.ok) throw new Error("Toggle failed");
    const data = await res.json();
    if (typeof data.autoReplyEnabled === "boolean") {
      autoReplyToggle.checked = data.autoReplyEnabled;
    }
  } catch (err) {
    console.error(err);
    autoReplyToggle.checked = !autoReplyToggle.checked;
    alert("Could not toggle auto-reply.");
  }
});

function pollLoop() {
  fetchState().catch((err) => console.warn("Poll error:", err));
  setTimeout(pollLoop, nextPollDelayMs());
}

// Initial load + polling
fetchState().catch((err) => console.error(err));
setTimeout(pollLoop, nextPollDelayMs());

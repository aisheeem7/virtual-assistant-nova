import { useState, useRef, useEffect } from "react";
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY });

// ── Colour tokens ──────────────────────────────────────────────
const C = {
  bg:         "#121212",
  surface:    "#1E1E1E",
  header:     "#242424",
  border:     "#3A3A3A",
  userBubble: "#5C5470",
  aiBubble:   "#DBD8E3",
  accent:     "#4A78E2",
  text:       "#E0E0E0",
  textMuted:  "#A0A0A0",
  textDark:   "#333333",
};

// ── Helpers ────────────────────────────────────────────────────
const uid  = () => Math.random().toString(36).slice(2, 9);
const now  = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const STORAGE_KEY = "nova_chats";

function loadChats() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
  catch { return []; }
}
function saveChats(chats) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(chats));
}
function newSession(title = "New Chat") {
  return {
    id: uid(),
    title,
    createdAt: Date.now(),
    messages: [
      { id: uid(), role: "model", content: "Hello! I am NOVA, your AI assistant. How can I help you today?", time: now() }
    ]
  };
}

// ── Sparkle SVG icon (NOVA avatar) ────────────────────────────
function SparkleIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" style={{ flexShrink: 0, marginTop: 2 }}>
      <circle cx="14" cy="14" r="14" fill="#2C2C3A" />
      <path d="M14 6 L15.2 12.8 L22 14 L15.2 15.2 L14 22 L12.8 15.2 L6 14 L12.8 12.8 Z"
        fill="#9B8EC4" />
    </svg>
  );
}

// ── Send icon ─────────────────────────────────────────────────
function SendIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M22 2L11 13" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── Main App ──────────────────────────────────────────────────
export default function App() {
  const [chats,      setChats]      = useState(() => { const s = loadChats(); return s.length ? s : [newSession("NOVA")]; });
  const [activeId,   setActiveId]   = useState(() => { const s = loadChats(); return s.length ? s[0].id : null; });
  const [input,      setInput]      = useState("");
  const [loading,    setLoading]    = useState(false);
  const [listening,  setListening]  = useState(false);
  const [sidebarOpen,setSidebarOpen]= useState(true);
  const bottomRef = useRef(null);
  const recRef    = useRef(null);
  const inputRef  = useRef(null);

  const activeChat = chats.find(c => c.id === activeId) || chats[0];

  // persist on every change
  useEffect(() => { saveChats(chats); }, [chats]);

  // scroll to bottom
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [activeChat?.messages]);

  // ── Chat mutations ────────────────────────────────────────
  function updateChat(id, fn) {
    setChats(prev => prev.map(c => c.id === id ? fn(c) : c));
  }
  function addMessage(chatId, msg) {
    updateChat(chatId, c => ({ ...c, messages: [...c.messages, msg] }));
  }
  function createNewChat() {
    const s = newSession("New Chat");
    setChats(prev => [s, ...prev]);
    setActiveId(s.id);
    setInput("");
  }
  function deleteChat(id, e) {
    e.stopPropagation();
    setChats(prev => {
      const next = prev.filter(c => c.id !== id);
      if (next.length === 0) { const s = newSession("NOVA"); return [s]; }
      return next;
    });
    if (activeId === id) {
      setChats(prev => {
        const next = prev.filter(c => c.id !== id);
        setActiveId(next.length ? next[0].id : null);
        return prev;
      });
    }
  }

  // ── Voice input ───────────────────────────────────────────
  function toggleMic() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return alert("Speech recognition not supported. Use Chrome.");
    if (listening) { recRef.current?.stop(); return; }
    const rec = new SR();
    rec.lang           = "en-US";
    rec.onstart        = () => setListening(true);
    rec.onend          = () => setListening(false);
    rec.onresult       = (e) => { setInput(e.results[0][0].transcript); inputRef.current?.focus(); };
    rec.onerror        = () => setListening(false);
    recRef.current     = rec;
    rec.start();
  }

  // ── TTS ───────────────────────────────────────────────────
  function speak(text) {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
  }

  // ── Send message ──────────────────────────────────────────
  async function sendMessage(text) {
    if (!text.trim() || loading) return;
    const chatId = activeChat.id;
    const userMsg = { id: uid(), role: "user", content: text, time: now() };

    // optimistically add user message
    addMessage(chatId, userMsg);
    setInput("");
    setLoading(true);

    // auto-title the chat from first user message
    if (activeChat.messages.length === 1) {
      updateChat(chatId, c => ({
        ...c,
        title: text.length > 28 ? text.slice(0, 28) + "…" : text
      }));
    }

    // build history for Gemini (exclude initial greeting, map roles)
    const history = [...activeChat.messages, userMsg]
      .filter((_, i) => i > 0)
      .slice(0, -1)
      .map(m => ({ role: m.role, parts: [{ text: m.content }] }));

    // ── retry helper: up to 3 attempts with backoff on 429 ──
    const callWithRetry = async (fn, retries = 3, delayMs = 5000) => {
      for (let i = 0; i < retries; i++) {
        try { return await fn(); }
        catch (err) {
          const is429 = err?.message?.includes("429") || err?.message?.includes("RESOURCE_EXHAUSTED");
          if (is429 && i < retries - 1) {
            const wait = delayMs * (i + 1);
            addMessage(chatId, { id: uid(), role: "model", content: `⏳ Rate limit reached — retrying in ${wait / 1000}s…`, time: now() });
            await new Promise(r => setTimeout(r, wait));
          } else { throw err; }
        }
      }
    };

    try {
      // Inject current date/time so NOVA always knows today's date
      const currentDateTime = new Date().toLocaleString("en-IN", {
        weekday: "long", year: "numeric", month: "long", day: "numeric",
        hour: "2-digit", minute: "2-digit", timeZoneName: "short"
      });

      const reply = await callWithRetry(async () => {
        const chat = ai.chats.create({
          model: "gemini-2.5-flash",  // more capable than lite — better accuracy
          history,
          config: {
            systemInstruction:
              `You are NOVA, a knowledgeable and accurate AI assistant. ` +
              `Today's exact date and time is: ${currentDateTime}. ` +
              `ACCURACY RULES you must always follow: ` +
              `1. Use Google Search for ANY question about current events, news, sports, weather, prices, people, places, or facts that may have changed — always prefer searched facts over your training data. ` +
              `2. For date or time questions, always use the exact date provided above — never guess or estimate. ` +
              `3. If you are not sure about something, clearly say "I'm not certain, but..." rather than stating it as fact. ` +
              `4. Never make up names, numbers, statistics, or URLs. ` +
              `5. Keep replies clear and conversational — 2–4 sentences for simple questions, a short paragraph for complex ones. ` +
              `6. Never use markdown symbols like ** or ## in your response.`,
            tools: [{ googleSearch: {} }]  // live web search for factual accuracy
          }
        });
        const response = await chat.sendMessage({ message: text });
        return response.text || "Sorry, I received an empty response.";
      });

      // remove any "retrying…" messages before adding real reply
      setChats(prev => prev.map(c => c.id === chatId
        ? { ...c, messages: c.messages.filter(m => !m.content.startsWith("⏳")) }
        : c
      ));
      addMessage(chatId, { id: uid(), role: "model", content: reply, time: now() });
      speak(reply);
    } catch (err) {
      console.error(err);
      const friendly = err?.message?.includes("429") || err?.message?.includes("RESOURCE_EXHAUSTED")
        ? "⚠️ Free API quota reached for today. Please wait a few minutes and try again, or come back tomorrow when the quota resets."
        : "Error: " + err.message;
      setChats(prev => prev.map(c => c.id === chatId
        ? { ...c, messages: c.messages.filter(m => !m.content.startsWith("⏳")) }
        : c
      ));
      addMessage(chatId, { id: uid(), role: "model", content: friendly, time: now() });
    }

    setLoading(false);
  }

  // ── Styles (inline for portability) ──────────────────────
  const s = {
    root: {
      display: "flex", flexDirection: "column", height: "100vh",
      background: C.bg, color: C.text,
      fontFamily: "'Inter', 'Helvetica Neue', sans-serif", overflow: "hidden"
    },
    // top header
    topBar: {
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "0 20px", height: 52, background: C.header,
      borderBottom: `1px solid ${C.border}`, flexShrink: 0, zIndex: 10
    },
    topLeft: { display: "flex", alignItems: "center", gap: 10 },
    hamburger: {
      background: "none", border: "none", color: C.textMuted,
      cursor: "pointer", fontSize: 18, padding: "4px 6px",
      borderRadius: 6, lineHeight: 1
    },
    logoText: { fontWeight: 700, fontSize: 17, color: C.text, letterSpacing: "0.02em" },

    // body row
    bodyRow: { display: "flex", flex: 1, overflow: "hidden" },
    // sidebar
    sidebar: {
      width: sidebarOpen ? 220 : 0, flexShrink: 0,
      background: C.surface, borderRight: `1px solid ${C.border}`,
      display: "flex", flexDirection: "column",
      transition: "width 0.2s ease", overflow: "hidden"
    },
    sidebarInner: { display: "flex", flexDirection: "column", height: "100%", minWidth: 220 },
    newChatBtn: {
      margin: "14px 12px 10px", padding: "8px 14px",
      border: `1px solid ${C.border}`, borderRadius: 8,
      background: "none", color: C.text, cursor: "pointer",
      fontSize: 13, fontWeight: 500, textAlign: "left",
      display: "flex", alignItems: "center", gap: 8,
      transition: "background 0.15s"
    },
    sectionLabel: {
      padding: "8px 14px 4px", fontSize: 11,
      color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.08em"
    },
    chatList: { flex: 1, overflowY: "auto", padding: "0 8px" },
    chatItem: (isActive) => ({
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "8px 10px", borderRadius: 7, cursor: "pointer", marginBottom: 2,
      background: isActive ? "#2E2A3A" : "none",
      color: isActive ? C.text : C.textMuted,
      fontSize: 13, transition: "background 0.15s"
    }),
    chatItemTitle: {
      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1
    },
    deleteBtn: {
      background: "none", border: "none", color: C.textMuted,
      cursor: "pointer", fontSize: 14, padding: "0 2px",
      opacity: 0, transition: "opacity 0.15s", lineHeight: 1
    },

    // chat area
    chatArea: {
      flex: 1, display: "flex", flexDirection: "column", overflow: "hidden",
      background: C.bg
    },
    messageList: {
      flex: 1, overflowY: "auto", padding: "24px 28px",
      display: "flex", flexDirection: "column", gap: 18
    },
    // bubbles
    msgRow: (isUser) => ({
      display: "flex", flexDirection: "column",
      alignItems: isUser ? "flex-end" : "flex-start"
    }),
    msgInner: (isUser) => ({
      display: "flex", alignItems: "flex-start", gap: 10,
      flexDirection: isUser ? "row-reverse" : "row",
      width: "100%"
    }),
    bubble: (isUser) => ({
      maxWidth: "62%", minWidth: 0, width: "fit-content",
      padding: "10px 15px", borderRadius: 16,
      borderBottomRightRadius: isUser ? 4 : 16,
      borderBottomLeftRadius: isUser ? 16 : 4,
      background: isUser ? C.userBubble : C.aiBubble,
      color: isUser ? "#F0EEF6" : C.textDark,
      fontSize: 14, lineHeight: 1.6,
      wordBreak: "break-word", whiteSpace: "pre-wrap",
      flexShrink: 0, boxSizing: "border-box"
    }),
    timestamp: (isUser) => ({
      fontSize: 11, color: C.textMuted, marginTop: 4,
      paddingLeft: isUser ? 0 : 38,
      paddingRight: isUser ? 4 : 0
    }),
    // typing indicator
    typingDot: {
      width: 7, height: 7, borderRadius: "50%",
      background: C.textMuted, display: "inline-block", margin: "0 2px"
    },
    // input bar
    inputBar: {
      display: "flex", alignItems: "center", gap: 10,
      padding: "12px 20px", borderTop: `1px solid ${C.border}`,
      background: C.surface, flexShrink: 0
    },
    micBtn: (active) => ({
      width: 40, height: 40, borderRadius: 10, flexShrink: 0,
      border: `1px solid ${active ? "#E05C5C" : C.border}`,
      background: active ? "#3A1A1A" : "none",
      color: active ? "#E05C5C" : C.textMuted,
      cursor: "pointer", fontSize: 18, display: "flex",
      alignItems: "center", justifyContent: "center"
    }),
    textInput: {
      flex: 1, padding: "10px 16px", borderRadius: 10,
      border: `1px solid ${C.border}`, background: C.bg,
      color: C.text, fontSize: 14, outline: "none",
      fontFamily: "inherit"
    },
    sendBtn: (disabled) => ({
      width: 44, height: 40, borderRadius: 10, flexShrink: 0,
      border: "none", cursor: disabled ? "default" : "pointer",
      background: disabled ? "#2A2A3A" : C.accent,
      display: "flex", alignItems: "center", justifyContent: "center",
      transition: "background 0.15s"
    })
  };

  return (
    <div style={s.root}>

      {/* ── Top Header ── */}
      <header style={s.topBar}>
        <div style={s.topLeft}>
          <button style={s.hamburger} onClick={() => setSidebarOpen(o => !o)}>☰</button>
          <span style={s.logoText}>✦ NOVA Chatbot</span>
        </div>
      </header>

      {/* ── Body ── */}
      <div style={s.bodyRow}>

        {/* ── Sidebar ── */}
        <aside style={s.sidebar}>
          <div style={s.sidebarInner}>
            <button
              style={s.newChatBtn}
              onClick={createNewChat}
              onMouseEnter={e => e.currentTarget.style.background = "#2A2A2A"}
              onMouseLeave={e => e.currentTarget.style.background = "none"}
            >
              <span style={{ fontSize: 16 }}>＋</span> New Chat
            </button>

            <div style={s.sectionLabel}>Recent Chats</div>

            <div style={s.chatList}>
              {chats.map(chat => (
                <div
                  key={chat.id}
                  style={s.chatItem(chat.id === activeId)}
                  onClick={() => setActiveId(chat.id)}
                  onMouseEnter={e => {
                    e.currentTarget.querySelector(".del-btn").style.opacity = "1";
                    if (chat.id !== activeId) e.currentTarget.style.background = "#252530";
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.querySelector(".del-btn").style.opacity = "0";
                    if (chat.id !== activeId) e.currentTarget.style.background = "none";
                  }}
                >
                  <span style={s.chatItemTitle}>
                    {chat.id === activeId ? "● " : ""}{chat.title}
                  </span>
                  <button
                    className="del-btn"
                    style={s.deleteBtn}
                    onClick={(e) => deleteChat(chat.id, e)}
                    title="Delete chat"
                  >✕</button>
                </div>
              ))}
            </div>


          </div>
        </aside>

        {/* ── Chat Area ── */}
        <main style={s.chatArea}>
          <div style={s.messageList}>
            {activeChat?.messages.map((msg) => {
              const isUser = msg.role === "user";
              return (
                <div key={msg.id} style={s.msgRow(isUser)}>
                  <div style={s.msgInner(isUser)}>
                    {!isUser && <SparkleIcon />}
                    <div style={s.bubble(isUser)}>{msg.content}</div>
                  </div>
                  <div style={s.timestamp(isUser)}>{msg.time}</div>
                </div>
              );
            })}

            {loading && (
              <div style={s.msgRow(false)}>
                <div style={s.msgInner(false)}>
                  <SparkleIcon />
                  <div style={{ ...s.bubble(false), display: "flex", alignItems: "center", gap: 4, padding: "12px 16px" }}>
                    {[0, 1, 2].map(i => (
                      <span key={i} style={{
                        ...s.typingDot,
                        animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite`
                      }} />
                    ))}
                  </div>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* ── Input Bar ── */}
          <div style={s.inputBar}>
            <button
              style={s.micBtn(listening)}
              onClick={toggleMic}
              title={listening ? "Stop listening" : "Click to speak"}
            >🎤</button>

            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendMessage(input)}
              placeholder={listening ? "Listening… speak now" : "Type your message..."}
              style={s.textInput}
            />

            <button
              style={s.sendBtn(!input.trim() || loading)}
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || loading}
              title="Send message"
            >
              <SendIcon />
            </button>
          </div>
        </main>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #121212; }
        ::-webkit-scrollbar { width: 5px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #3A3A3A; border-radius: 10px; }
        @keyframes bounce {
          0%, 60%, 100% { transform: translateY(0); }
          30% { transform: translateY(-5px); }
        }
      `}</style>
    </div>
  );
}
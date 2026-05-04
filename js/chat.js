/**
 * CS Digital Setup — Chat Client
 * Logique complète du chatbot : session, streaming SSE, UI
 */

// ============================================
// Configuration
// ============================================
const SUPABASE_FUNCTIONS_URL =
  "https://ptksijwyvecufcvcpntp.supabase.co/functions/v1";

// ============================================
// Compression de l'historique
// ============================================
function compressMessages(messages, keepLast = 5) {
  if (!messages || messages.length === 0) return [];
  if (messages.length <= keepLast + 10) return messages;

  const keepFull = messages.slice(-keepLast);
  const toCompress = messages.slice(0, messages.length - keepLast);
  const compressed = [];

  // Résumer par blocs de 10
  for (let i = 0; i < toCompress.length; i += 10) {
    const chunk = toCompress.slice(i, Math.min(i + 10, toCompress.length));
    const keyPoints = [];

    for (const msg of chunk) {
      if (msg.role === "user") {
        const firstLine = (msg.content || "").split("\n")[0].trim();
        if (firstLine.length > 0) {
          const truncated = firstLine.length > 60 ? firstLine.slice(0, 60) + "..." : firstLine;
          keyPoints.push(`Q: ${truncated}`);
        }
      }
    }

    if (keyPoints.length > 0) {
      compressed.push({
        role: "system",
        content: `[DIAGNOSTIC_HISTORY] Messages ${i + 1}-${Math.min(i + 10, toCompress.length)}: ${keyPoints.join(" | ")}`,
      });
    }
  }

  return [...compressed, ...keepFull];
}

// ============================================
// État
// ============================================
let jwtToken = null;
let userEmail = null;
let sessionId = null;
let sessionData = null;
let isStreaming = false;
let conversationHistory = [];
let diagnosticMode = "express";
let configGenerationStarted = false;
let recoveryEmail = null;
let promptLanguage = "fr";

// ============================================
// Generate unique session ID for this diagnostic
// ============================================
function generateSessionId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function(c) {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ============================================
// Éléments DOM
// ============================================
const loadingScreen = document.getElementById("loading-screen");
const errorScreen = document.getElementById("error-screen");
const chatScreen = document.getElementById("chat-screen");
const messagesContainer = document.getElementById("messages-container");
const typingIndicator = document.getElementById("typing-indicator");
const chatInput = document.getElementById("chat-input");
const sendBtn = document.getElementById("send-btn");
const generateNowBtn = document.getElementById("generate-now-btn");
const newSessionBtn = document.getElementById("new-session-btn");
const modeSelector = document.getElementById("mode-selector");
const modeExpressBtn = document.getElementById("mode-express-btn");
const modeDeepBtn = document.getElementById("mode-deep-btn");
const recoveryEmailInput = document.getElementById("recovery-email");
const promptLanguageSelect = document.getElementById("prompt-language");

// ============================================
// Initialisation
// ============================================
async function init() {
  // Check for beta test mode
  const urlParams = new URLSearchParams(window.location.search);
  const isTest = urlParams.get("test") === "true";
  const testEmail = urlParams.get("email");
  const betaToken = urlParams.get("token");

  if (betaToken) {
    // Beta invite mode: exchange session token for a real Supabase JWT.
    try {
      const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/exchange-beta-token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ token: betaToken }),
      });
      if (!res.ok) {
        throw new Error("Lien beta invalide ou expire.");
      }
      const data = await res.json();
      jwtToken = data.access_token || null;
      userEmail = data.user_email || null;
      if (jwtToken && userEmail) {
        localStorage.setItem("jwt_token", jwtToken);
        localStorage.setItem("user_email", userEmail);
        // Remove token from URL for cleaner UX and to avoid accidental sharing.
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    } catch (err) {
      console.error("Beta token exchange error:", err);
      showError();
      return;
    }
  } else if (isTest && testEmail) {
    // Beta test mode: create a temporary session
    jwtToken = "beta_test_token_" + Date.now();
    userEmail = testEmail;
    localStorage.setItem("jwt_token", jwtToken);
    localStorage.setItem("user_email", userEmail);
    localStorage.setItem("is_beta_test", "true");
  } else {
    // Extract JWT from localStorage (set by auth/callback.html)
    jwtToken = localStorage.getItem("jwt_token");
    userEmail = localStorage.getItem("user_email");
  }

  if (!jwtToken || !userEmail) {
    console.log("No JWT found, redirecting to home");
    showError();
    return;
  }

  // Generate a unique session ID for this diagnostic session
  sessionId = generateSessionId();
  window.CS_JWT_TOKEN = jwtToken;
  window.CS_SESSION_ID = sessionId;

  try {
    // Show chat screen
    showChat();

    // User selects desired diagnostic depth before first question.
    diagnosticMode = await chooseDiagnosticMode();
    await sendFirstMessage();
  } catch (err) {
    console.error("Init error:", err);
    showError();
  }
}

function chooseDiagnosticMode() {
  return new Promise((resolve) => {
    const done = (mode) => {
      diagnosticMode = mode;
      recoveryEmail = (recoveryEmailInput?.value || userEmail || "").trim().toLowerCase();
      promptLanguage = (promptLanguageSelect?.value || "fr").toLowerCase() === "en" ? "en" : "fr";
      if (recoveryEmail) {
        localStorage.setItem("recovery_email", recoveryEmail);
      }
      localStorage.setItem("prompt_language", promptLanguage);
      if (modeSelector) modeSelector.style.display = "none";
      resolve(mode);
    };

    if (recoveryEmailInput) {
      recoveryEmailInput.value =
        localStorage.getItem("recovery_email") || userEmail || "";
    }
    if (promptLanguageSelect) {
      promptLanguageSelect.value = localStorage.getItem("prompt_language") || "fr";
    }
    if (modeSelector) modeSelector.style.display = "block";
    modeExpressBtn?.addEventListener("click", () => done("express"), { once: true });
    modeDeepBtn?.addEventListener("click", () => done("deep"), { once: true });
  });
}

// ============================================
// Affichage des écrans
// ============================================
function showError() {
  loadingScreen.style.display = "none";
  errorScreen.style.display = "flex";
  chatScreen.style.display = "none";
}

function showDeviceError() {
  loadingScreen.style.display = "none";
  chatScreen.style.display = "none";
  errorScreen.style.display = "flex";
  const errorTitle = errorScreen.querySelector("h2");
  const errorText = errorScreen.querySelector("p");
  if (errorTitle) errorTitle.textContent = "Lien personnel";
  if (errorText) errorText.textContent = "Ce lien est associé à un autre appareil. Chaque configuration est personnelle et liée à l'appareil utilisé lors du premier accès. Contactez catherine@csbusiness.fr si vous avez besoin d'aide.";
}

function showChat() {
  loadingScreen.style.display = "none";
  errorScreen.style.display = "none";
  chatScreen.style.display = "flex";
  chatInput.focus();
}

function resetChatVisualState() {
  const messageNodes = messagesContainer.querySelectorAll(".message");
  messageNodes.forEach((node) => node.remove());
  document.querySelector(".chat-input-area").style.display = "";
  typingIndicator.classList.remove("visible");
  chatInput.disabled = false;
  sendBtn.disabled = false;
  if (generateNowBtn) generateNowBtn.disabled = false;
  chatInput.placeholder = "Tapez ou dictez votre réponse...";
}

async function startNewSession() {
  if (isStreaming) return;
  const ok = window.confirm(
    "Démarrer une nouvelle session ? Votre session actuelle restera en base mais l'écran repartira de zéro."
  );
  if (!ok) return;

  sessionId = generateSessionId();
  window.CS_SESSION_ID = sessionId;
  conversationHistory = [];
  configGenerationStarted = false;
  resetChatVisualState();
  diagnosticMode = await chooseDiagnosticMode();
  await sendFirstMessage();
}

// ============================================
// Messages
// ============================================
function appendMessage(role, content) {
  const div = document.createElement("div");
  div.className = `message message-${role}`;

  let cleanContent = sanitizeAssistantVisibleText(content);

  // Convertir le markdown basique en HTML
  div.innerHTML = markdownToHtml(cleanContent);

  // Insérer avant le typing indicator
  messagesContainer.insertBefore(div, typingIndicator);

  // Vérifier si le diagnostic est complet
  if (content.includes("[DIAGNOSTIC_COMPLETE]")) {
    showDiagnosticComplete();
  }

  return div;
}

function createStreamingBubble() {
  const div = document.createElement("div");
  div.className = "message message-assistant";
  div.id = "streaming-bubble";
  messagesContainer.insertBefore(div, typingIndicator);
  return div;
}

function showDiagnosticComplete() {
  if (configGenerationStarted) return;
  configGenerationStarted = true;
  // Désactiver la saisie
  chatInput.disabled = true;
  sendBtn.disabled = true;
  if (generateNowBtn) generateNowBtn.disabled = true;
  chatInput.placeholder = "Diagnostic terminé";

  // Lancer la génération de la config
  generateConfig(sessionId, jwtToken);
}

function appendStreamDeltaFromEvent(data, acc) {
  if (!data || typeof data !== "object") return acc;

  // Legacy format handled by previous frontend parser.
  if (typeof data.text === "string") {
    return acc + data.text;
  }

  // Anthropic stream format.
  if (
    data.type === "content_block_delta" &&
    data.delta &&
    typeof data.delta.text === "string"
  ) {
    return acc + data.delta.text;
  }

  return acc;
}

// ============================================
// Retirer fuites JSON (métadonnées diagnostic) du texte assistant
// ============================================
function stripLeakedDiagnosticFencedJson(text) {
  if (!text || typeof text !== "string") return text;
  return text
    .replace(/```(?:json)?\s*\n?([\s\S]*?)```/gi, (match, inner) => {
      const t = String(inner).trim();
      if (
        t.includes('"session_id"') &&
        (t.includes('"coverage_tracking"') || t.includes('"metadata_version"'))
      ) {
        return "";
      }
      return match;
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Texte assistant affichable / à stocker en historique (sans META ni JSON interne). */
function sanitizeAssistantVisibleText(text) {
  return stripLeakedDiagnosticFencedJson(String(text || ""))
    .replace(/\[META\][\s\S]*?\[\/META\]/g, "")
    .replace(/\[DIAGNOSTIC_COMPLETE\]/g, "")
    .trim();
}

// ============================================
// Markdown basique → HTML
// ============================================
function markdownToHtml(text) {
  return text
    // Titres
    .replace(/^### (.+)$/gm, "<strong>$1</strong>")
    .replace(/^## (.+)$/gm, "<strong>$1</strong>")
    // Gras
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    // Italique
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    // Listes à puces
    .replace(/^- (.+)$/gm, "• $1")
    // Sauts de ligne → paragraphes
    .split("\n\n")
    .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

// ============================================
// Premier message (bienvenue)
// ============================================
async function sendFirstMessage() {
  isStreaming = true;
  sendBtn.disabled = true;
  chatInput.disabled = true;

  // Afficher le typing indicator
  typingIndicator.classList.add("visible");
  scrollToBottom();

  try {
    const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${jwtToken}`,
      },
      body: JSON.stringify({
        session_id: sessionId,
        message:
          diagnosticMode === "deep"
            ? `[DIAGNOSTIC_MODE:DEEP][PROMPT_LANGUAGE:${promptLanguage.toUpperCase()}][RECOVERY_EMAIL:${recoveryEmail || userEmail}] Bonjour, je veux un diagnostic approfondi.`
            : `[DIAGNOSTIC_MODE:EXPRESS][PROMPT_LANGUAGE:${promptLanguage.toUpperCase()}][RECOVERY_EMAIL:${recoveryEmail || userEmail}] Bonjour, je veux un diagnostic rapide et utile.`,
        conversation_history: conversationHistory,
        client_name: userEmail,
      }),
    });

    if (res.status === 401) {
      throw new Error("Session expirée. Veuillez vous reconnecter.");
    }
    if (res.status === 403) {
      throw new Error("Accès refusé. Veuillez vérifier votre paiement.");
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    typingIndicator.classList.remove("visible");
    const bubble = createStreamingBubble();
    let fullText = "";

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const jsonStr = line.slice(6).trim();
        if (!jsonStr) continue;
        try {
          const data = JSON.parse(jsonStr);
          if (data.done || data.type === "message_stop") break;
          const nextText = appendStreamDeltaFromEvent(data, fullText);
          if (nextText !== fullText) {
            fullText = nextText;
            const cleanText = sanitizeAssistantVisibleText(fullText);
            bubble.innerHTML = markdownToHtml(cleanText);
            scrollToBottom();
          }
        } catch {}
      }
    }

    const cleanFinal = sanitizeAssistantVisibleText(fullText);
    bubble.innerHTML = markdownToHtml(cleanFinal);
    bubble.removeAttribute("id");

    // Store in conversation history
    conversationHistory.push({
      role: "user",
      content:
        diagnosticMode === "deep"
          ? `[DIAGNOSTIC_MODE:DEEP][PROMPT_LANGUAGE:${promptLanguage.toUpperCase()}][RECOVERY_EMAIL:${recoveryEmail || userEmail}] Bonjour, je veux un diagnostic approfondi.`
          : `[DIAGNOSTIC_MODE:EXPRESS][PROMPT_LANGUAGE:${promptLanguage.toUpperCase()}][RECOVERY_EMAIL:${recoveryEmail || userEmail}] Bonjour, je veux un diagnostic rapide et utile.`,
    });
    conversationHistory.push({ role: "assistant", content: cleanFinal });
  } catch (err) {
    console.error("First message error:", err);
    typingIndicator.classList.remove("visible");
    appendMessage("assistant", `Erreur: ${err.message}`);
  } finally {
    isStreaming = false;
    sendBtn.disabled = false;
    chatInput.disabled = false;
    chatInput.focus();
    scrollToBottom();
  }
}

// ============================================
// Envoi et streaming
// ============================================
async function sendMessage(text) {
  if (isStreaming) return;
  if (!text.trim()) return;

  isStreaming = true;
  sendBtn.disabled = true;
  chatInput.disabled = true;

  // Afficher le message utilisateur
  appendMessage("user", text);
  scrollToBottom();

  // Afficher le typing indicator
  typingIndicator.classList.add("visible");
  scrollToBottom();

  try {
    const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${jwtToken}`,
      },
      body: JSON.stringify({
        session_id: sessionId,
        message: text,
        conversation_history: conversationHistory,
        client_name: userEmail,
      }),
    });

    if (res.status === 401) {
      throw new Error("Session expirée. Veuillez vous reconnecter.");
    }
    if (res.status === 403) {
      throw new Error("Accès refusé. Veuillez vérifier votre paiement.");
    }
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    // Masquer le typing, créer la bulle de streaming
    typingIndicator.classList.remove("visible");
    const bubble = createStreamingBubble();
    let fullText = "";

    // Lire le stream SSE
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Parser les événements SSE
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;

        const jsonStr = line.slice(6).trim();
        if (!jsonStr) continue;

        try {
          const data = JSON.parse(jsonStr);

          if (data.done) {
            // Stream terminé
            break;
          }
          if (data.type === "message_stop") {
            break;
          }

          if (data.error) {
            fullText += "\n\n⚠️ Une erreur est survenue. Veuillez réessayer.";
            break;
          }

          const nextText = appendStreamDeltaFromEvent(data, fullText);
          if (nextText !== fullText) {
            fullText = nextText;
            const cleanText = sanitizeAssistantVisibleText(fullText);
            bubble.innerHTML = markdownToHtml(cleanText);
            scrollToBottom();
          } 
        } catch {
          // JSON invalide, ignorer
        }
      }
    }

    // Finaliser la bulle
    const cleanFinal = sanitizeAssistantVisibleText(fullText);
    bubble.innerHTML = markdownToHtml(cleanFinal);
    bubble.removeAttribute("id");

    // Store in conversation history
    conversationHistory.push({ role: "user", content: text });
    conversationHistory.push({ role: "assistant", content: cleanFinal });

    // Vérifier si diagnostic complet
    if (fullText.includes("[DIAGNOSTIC_COMPLETE]")) {
      showDiagnosticComplete();
    }
  } catch (err) {
    console.error("Stream error:", err);
    typingIndicator.classList.remove("visible");
    appendMessage("assistant", `Erreur: ${err.message}`);
  } finally {
    isStreaming = false;
    sendBtn.disabled = false;
    chatInput.disabled = false;
    chatInput.focus();
    scrollToBottom();
  }
}

// ============================================
// Scroll
// ============================================
function scrollToBottom() {
  requestAnimationFrame(() => {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  });
}

// ============================================
// Auto-resize du textarea
// ============================================
function autoResize() {
  chatInput.style.height = "auto";
  chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + "px";
}

// ============================================
// Dictée vocale (Web Speech API)
// ============================================
const micBtn = document.getElementById("mic-btn");
let recognition = null;
let isRecording = false;

function initSpeechRecognition() {
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    console.warn("Speech API not supported");
    micBtn.classList.add("unsupported");
    return;
  }

  console.log("Speech API available");
}

function startRecording() {
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) return;

  // Créer une nouvelle instance à chaque fois (plus fiable)
  recognition = new SpeechRecognition();
  recognition.lang = "fr-FR";
  recognition.continuous = true;
  recognition.interimResults = true;

  let finalTranscript = "";
  const startValue = chatInput.value;

  recognition.onstart = () => {
    console.log("Recording started");
    isRecording = true;
    micBtn.classList.add("recording");
    chatInput.placeholder = "Parlez, je vous écoute...";
  };

  recognition.onresult = (event) => {
    let interim = "";
    finalTranscript = "";
    for (let i = 0; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalTranscript += transcript;
      } else {
        interim += transcript;
      }
    }
    chatInput.value = startValue + (startValue ? " " : "") + finalTranscript + interim;
    autoResize();
  };

  recognition.onerror = (event) => {
    console.error("Speech error:", event.error);
    if (event.error === "not-allowed") {
      alert("Veuillez autoriser l'accès au micro dans votre navigateur.");
    }
    stopRecording();
  };

  recognition.onend = () => {
    console.log("Recording ended");
    // Si on est encore en mode recording, c'est un arrêt automatique — relancer
    if (isRecording) {
      // Chrome arrête parfois après un silence, on ne relance pas
      stopRecording();
    }
  };

  try {
    recognition.start();
  } catch (err) {
    console.error("Start recording error:", err);
  }
}

function stopRecording() {
  isRecording = false;
  micBtn.classList.remove("recording");
  chatInput.placeholder = "Tapez ou dictez votre réponse...";
  if (recognition) {
    try {
      recognition.stop();
    } catch {}
    recognition = null;
  }
  chatInput.focus();
}

function toggleRecording() {
  if (isRecording) {
    stopRecording();
  } else {
    startRecording();
  }
}

initSpeechRecognition();

// ============================================
// Event listeners
// ============================================
sendBtn.addEventListener("click", () => {
  if (isRecording) stopRecording();
  const text = chatInput.value.trim();
  if (text) {
    chatInput.value = "";
    chatInput.style.height = "auto";
    sendMessage(text);
  }
});

micBtn.addEventListener("click", toggleRecording);
newSessionBtn?.addEventListener("click", () => {
  startNewSession().catch((err) => {
    console.error("New session error:", err);
    appendMessage("assistant", "Erreur: impossible de démarrer une nouvelle session.");
  });
});
generateNowBtn?.addEventListener("click", () => {
  if (isStreaming || configGenerationStarted) return;
  showDiagnosticComplete();
});

chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendBtn.click();
  }
});

chatInput.addEventListener("input", autoResize);

// Gérer le clavier virtuel sur mobile
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", () => {
    document.documentElement.style.setProperty(
      "--vh",
      `${window.visualViewport.height * 0.01}px`
    );
    scrollToBottom();
  });
}

// ============================================
// Lancement
// ============================================
init();

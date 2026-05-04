/**
 * CS Digital Setup — Config Display
 * Affichage des livrables générés + boutons copier + checklist d'import
 */

const SUPABASE_FUNCTIONS_URL_CONFIG =
  "https://ptksijwyvecufcvcpntp.supabase.co/functions/v1";

function extractGuideSectionsFromConfig(config) {
  const sections = [];
  const structured = config?.structured || {};
  const living = structured?.living_proposal || {};

  const customInstructions =
    config?.custom_instructions || structured?.custom_instructions || "";
  if (customInstructions) {
    sections.push({
      title: "Instructions personnalisées",
      instruction:
        "Allez dans Claude.ai → Paramètres → Instructions personnalisées, puis collez ce bloc.",
      content: customInstructions,
    });
  }

  if (Array.isArray(living.agents)) {
    for (const a of living.agents) {
      sections.push({
        title: `Agent — ${a.role || "Agent"}`,
        instruction:
          a.trigger
            ? `Créez l'agent dans Claude puis vérifiez le déclencheur: ${a.trigger}.`
            : "Créez l'agent dans Claude et collez le prompt.",
        content: a.prompt || "",
      });
    }
  }

  if (Array.isArray(living.routines)) {
    for (const r of living.routines) {
      const details = [
        r.trigger_timing ? `Quand: ${r.trigger_timing}` : "",
        Array.isArray(r.linked_agents) && r.linked_agents.length
          ? `Agents liés: ${r.linked_agents.join(", ")}`
          : "",
      ]
        .filter(Boolean)
        .join(" | ");
      sections.push({
        title: `Routine — ${r.title || "Routine"}`,
        instruction: details || "Planifiez cette routine dans Claude.",
        content: r.prompt || "",
      });
    }
  }

  return sections.filter((s) => (s.content || "").trim().length > 0);
}

function extractGuideSectionsFromMarkdown(markdownBundle) {
  const md = String(markdownBundle || "");
  if (!md.trim()) return [];
  const sections = [];

  const customMatch = md.match(
    /## Custom Instructions \(proposition\)\n+([\s\S]*?)(?:\n## |\n---|\n### |\n$)/i
  );
  if (customMatch?.[1]?.trim()) {
    sections.push({
      title: "Instructions personnalisées",
      instruction:
        "Allez dans Claude.ai → Paramètres → Instructions personnalisées, puis collez ce bloc.",
      content: customMatch[1].trim(),
    });
  }

  const parts = md.split("\n### ").slice(1);
  for (const part of parts) {
    const firstNl = part.indexOf("\n");
    const title = (firstNl >= 0 ? part.slice(0, firstNl) : part).trim();
    const body = (firstNl >= 0 ? part.slice(firstNl + 1) : "").trim();
    if (!title || !body) continue;

    const fenced =
      body.match(/```text\n([\s\S]*?)```/i)?.[1]?.trim() ||
      body.match(/```\n([\s\S]*?)```/i)?.[1]?.trim() ||
      body;

    sections.push({
      title,
      instruction: "Copiez ce contenu dans l'étape correspondante de votre configuration.",
      content: fenced.trim(),
    });
  }

  return sections.filter((s) => (s.content || "").trim().length > 0);
}

// ============================================
// Génération de la config (STREAMING)
// ============================================
async function generateConfig(sessionId, jwtToken) {
  console.log("generateConfig called with session:", sessionId);
  const container = document.getElementById("messages-container");

  // Ajouter un indicateur de génération avec progression
  const genDiv = document.createElement("div");
  genDiv.className = "diagnostic-complete";
  genDiv.id = "generation-indicator";
  genDiv.innerHTML =
    '<div class="spinner" style="margin:0 auto var(--space-sm)"></div><strong>Génération en cours...</strong><br><div id="generation-progress" style="font-size:12px;margin-top:8px;color:#666"></div>Votre configuration personnalisée est en cours de création (section par section)...';
  container.appendChild(genDiv);
  container.scrollTop = container.scrollHeight;

  try {
    const res = await fetch(`${SUPABASE_FUNCTIONS_URL_CONFIG}/generate-config`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${jwtToken}`,
        "Accept": "application/json",
      },
      body: JSON.stringify({ session_id: sessionId }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error("Erreur de génération: " + err);
    }

    const fullConfig = await res.json();
    if (!fullConfig || typeof fullConfig !== "object") {
      throw new Error("Config non reçue");
    }

    // Retirer l'indicateur
    document.getElementById("generation-indicator")?.remove();

    // Afficher les résultats
    displayConfig(fullConfig);
  } catch (err) {
    console.error("Generation error:", err);
    const indicator = document.getElementById("generation-indicator");
    if (indicator) {
      indicator.innerHTML =
        "<strong>Erreur de génération</strong><br>" + err.message + "<br>Veuillez rafraîchir la page et réessayer.";
    }
  }
}

// ============================================
// Affichage de la config
// ============================================
function displayConfig(config) {
  const container = document.getElementById("messages-container");

  // Masquer la zone de saisie
  document.querySelector(".chat-input-area").style.display = "none";

  // Créer le conteneur de résultats
  const resultsDiv = document.createElement("div");
  resultsDiv.className = "config-results";
  resultsDiv.innerHTML = `
    <div class="config-header">
      <h2>Votre configuration Claude.ai est prête${config.client_name ? ", " + config.client_name : ""} !</h2>
      <p>Suivez les étapes ci-dessous pour tout importer dans Claude.ai</p>
      <p class="config-trust-note">Session reprise possible en cas d'interruption. Les données diagnostics sont conservées au maximum 90 jours, puis supprimées automatiquement.</p>
    </div>
  `;

  resultsDiv.appendChild(createDataControlSection(config));

  // Bannière Niveau 1
  const level1 = document.createElement("div");
  level1.className = "config-level-banner";
  level1.innerHTML = `<h3>Niveau 1 — Version gratuite</h3><p>Ces éléments fonctionnent avec toutes les versions de Claude.ai</p>`;
  resultsDiv.appendChild(level1);

  // 1. Custom Instructions
  if (config.custom_instructions) {
    resultsDiv.appendChild(
      createConfigSection(
        "1",
        "Instructions personnalisées",
        "Allez dans Claude.ai → Cliquez sur votre nom en bas à gauche → Paramètres → Instructions personnalisées → Collez le texte ci-dessous",
        config.custom_instructions,
        "C'est le socle de votre Claude : il saura qui vous êtes et comment vous aider."
      )
    );
  }

  // 2. Bouclier de sécurité
  if (config.security_shield) {
    resultsDiv.appendChild(
      createConfigSection(
        "2",
        "Vos règles de sécurité IA",
        "Ces règles sont intégrées dans vos instructions personnalisées. Voici le récapitulatif des protections configurées :",
        config.security_shield.summary_text || config.security_shield.certificate_text || config.security_shield.rules?.join("\n• ") || "",
        "Ce récapitulatif liste les protections actives dans votre configuration. Ce n'est pas un certificat officiel, mais vos règles de sécurité sont bien en place."
      )
    );
  }

  // 8. Style personnalisé (aussi dispo en gratuit)
  if (config.custom_style) {
    resultsDiv.appendChild(
      createConfigSection(
        "3",
        `Style : ${config.custom_style.name || "Mon Style"}`,
        "Allez dans Claude.ai → Paramètres → Styles → Créer un style personnalisé → Collez la description ci-dessous",
        config.custom_style.description,
        config.custom_style.why
      )
    );
  }

  // Bannière Niveau 2
  const level2 = document.createElement("div");
  level2.className = "config-level-banner level-pro";
  level2.innerHTML = `<h3>Niveau 2 — Version Pro</h3><p>Pour aller plus loin, passez à Claude Pro. Vous débloquez les projets, les agents, les tâches automatiques et le co-travail.</p>`;
  resultsDiv.appendChild(level2);

  // 3. Projets
  if (config.projects && config.projects.length > 0) {
    let stepNum = 3;
    for (const project of config.projects) {
      resultsDiv.appendChild(
        createConfigSection(
          String(stepNum),
          `Projet : ${project.name}`,
          `Allez dans Claude.ai → Projets → Nouveau projet → Nom : "${project.name}" → Collez les instructions ci-dessous`,
          project.system_prompt,
          project.why
        )
      );
      stepNum++;
    }
  }

  // 4. Agents
  if (config.agents && config.agents.length > 0) {
    for (const agent of config.agents) {
      resultsDiv.appendChild(
        createConfigSection(
          "★",
          `Agent : ${agent.name}`,
          agent.creation_guide || `Créez un agent "${agent.name}" dans Claude.ai avec les instructions ci-dessous`,
          agent.instructions,
          agent.why,
          agent.tools ? `Outils recommandés : ${agent.tools.join(", ")}` : null
        )
      );
    }
  }

  // 5. Agent Coach
  if (config.agent_coach) {
    resultsDiv.appendChild(
      createConfigSection(
        "★",
        `Projet : ${config.agent_coach.name || "Mon Coach Digital"}`,
        "Créez un nouveau projet avec ce nom et collez les instructions ci-dessous",
        config.agent_coach.instructions,
        config.agent_coach.why,
        config.agent_coach.weekly_prompt
          ? `💡 Prompt hebdomadaire suggéré : "${config.agent_coach.weekly_prompt}"`
          : null
      )
    );
  }

  // 6. Agent Miroir
  if (config.agent_miroir) {
    resultsDiv.appendChild(
      createConfigSection(
        "★",
        `Projet : ${config.agent_miroir.name || "Mon Miroir"}`,
        "Créez un nouveau projet avec ce nom et collez les instructions ci-dessous",
        config.agent_miroir.instructions,
        config.agent_miroir.why,
        config.agent_miroir.rituals
          ? `Rituels suggérés : ${config.agent_miroir.rituals.join(" | ")}`
          : null
      )
    );
  }

  // 7. Tâches programmées
  if (config.scheduled_tasks && config.scheduled_tasks.length > 0) {
    for (const task of config.scheduled_tasks) {
      const taskContent = `${task.description}\n\nFréquence : ${task.frequency}${task.best_time ? "\nMoment idéal : " + task.best_time : ""}${task.target_agent ? "\nAppelle automatiquement : " + task.target_agent : ""}\n\nCe que Claude enverra automatiquement :\n« ${task.prompt_suggestion || "..."} »${task.creation_guide ? "\n\n--- Comment configurer cette tâche ---\n" + task.creation_guide : ""}`;
      resultsDiv.appendChild(
        createConfigSection(
          "⏰",
          `Tâche auto : ${task.name}`,
          "Configurez-la une fois, ensuite elle tourne toute seule",
          taskContent,
          task.why
        )
      );
    }
  }

  // Niveau 3 — Expert (MCP)
  if (config.mcp_connections && config.mcp_connections.length > 0) {
    const level3 = document.createElement("div");
    level3.className = "config-level-banner level-expert";
    level3.innerHTML = `<h3>Niveau 3 — Expert</h3><p>Connectez Claude directement à vos outils pour qu'il puisse lire, écrire et agir dedans. Nécessite Claude Desktop ou Claude Pro avec MCP.</p>`;
    resultsDiv.appendChild(level3);

    for (const mcp of config.mcp_connections) {
      resultsDiv.appendChild(
        createConfigSection(
          "🔌",
          `Connexion : ${mcp.name}`,
          `Connecte Claude à ${mcp.tool_used_by_client || mcp.name}`,
          mcp.setup_guide || "",
          mcp.why,
          mcp.what_it_does ? `Ce que ça permet : ${mcp.what_it_does}` : null
        )
      );
    }
  }

  // Email + feedback restent des integrations legacy (contrat token historique).
  // On les masque temporairement pour garder un parcours de livraison fiable.

  // CTA upsell
  resultsDiv.appendChild(createUpsellSection());

  container.appendChild(resultsDiv);
  container.scrollTop = container.scrollHeight;
}

function createDataControlSection(config) {
  const section = document.createElement("div");
  section.className = "config-data-control";
  section.innerHTML = `
    <h3>Confidentialité & contrôle</h3>
    <p>Copiez d'abord votre configuration complète. Ensuite, vous pouvez effacer vos données de diagnostic de manière irréversible.</p>
    <div class="config-data-actions">
      <button id="copy-full-config-btn" class="config-data-btn" type="button">Copier la config complète</button>
      <button id="download-html-guide-btn" class="config-data-btn" type="button">Télécharger le guide HTML</button>
      <button id="erase-data-btn" class="config-data-btn danger" type="button">Effacer mes données</button>
    </div>
    <p id="erase-data-status" class="config-data-status"></p>
  `;

  const copyBtn = section.querySelector("#copy-full-config-btn");
  const htmlBtn = section.querySelector("#download-html-guide-btn");
  const eraseBtn = section.querySelector("#erase-data-btn");
  const status = section.querySelector("#erase-data-status");

  copyBtn?.addEventListener("click", async () => {
    const fullText =
      config.markdown_bundle ||
      config.structured?.custom_instructions ||
      JSON.stringify(config, null, 2);
    try {
      await navigator.clipboard.writeText(fullText);
      copyBtn.textContent = "Config copiée !";
      setTimeout(() => (copyBtn.textContent = "Copier la config complète"), 2000);
    } catch {
      copyBtn.textContent = "Copie impossible";
    }
  });

  htmlBtn?.addEventListener("click", () => {
    downloadGuideHtml(config);
    htmlBtn.textContent = "Guide téléchargé";
    setTimeout(() => (htmlBtn.textContent = "Télécharger le guide HTML"), 2000);
  });

  eraseBtn?.addEventListener("click", async () => {
    const ok = window.confirm(
      "Cette action est irréversible. Vérifiez d'abord que vous avez copié votre configuration. Continuer ?"
    );
    if (!ok) return;
    const typed = window.prompt('Confirmez en tapant SUPPRIMER');
    if (typed !== "SUPPRIMER") {
      status.textContent = "Suppression annulée.";
      return;
    }

    eraseBtn.disabled = true;
    eraseBtn.textContent = "Suppression...";
    try {
      const res = await fetch(`${SUPABASE_FUNCTIONS_URL_CONFIG}/erase-my-data`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${window.CS_JWT_TOKEN || ""}`,
        },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Erreur de suppression");
      }
      status.textContent = "Vos données de diagnostic ont été supprimées.";
      eraseBtn.textContent = "Données supprimées";
    } catch (err) {
      status.textContent = `Erreur: ${err.message || "suppression impossible"}`;
      eraseBtn.disabled = false;
      eraseBtn.textContent = "Effacer mes données";
    }
  });

  return section;
}

function downloadGuideHtml(config) {
  let sections = Array.from(document.querySelectorAll(".config-section")).map((el) => {
    const title = el.querySelector("h3")?.textContent || "";
    const instruction = el.querySelector(".config-instruction")?.textContent || "";
    const content = el.querySelector(".config-content")?.textContent || "";
    return { title, instruction, content };
  });
  if (!sections.length) {
    sections = extractGuideSectionsFromConfig(config);
  }
  if (!sections.length) {
    sections = extractGuideSectionsFromMarkdown(config?.markdown_bundle || "");
  }

  const tocHtml = sections
    .map(
      (s, idx) =>
        `<li><a href="#step-${idx + 1}">Étape ${idx + 1} — ${escapeHtml(
          s.title
        )}</a></li>`
    )
    .join("");

  const stepsHtml = sections
    .map(
      (s, idx) => `
      <section class="step-card" id="step-${idx + 1}">
        <div class="step-head">
          <span class="step-num">${idx + 1}</span>
          <div>
            <h3>Étape ${idx + 1} — ${escapeHtml(s.title)}</h3>
            <p>${escapeHtml(s.instruction)}</p>
          </div>
        </div>
        <div class="code-wrap">
          <button class="copy-btn" data-copy-target="code-${idx + 1}">Copier</button>
          <pre id="code-${idx + 1}">${escapeHtml(s.content)}</pre>
        </div>
        <label class="checkline">
          <input type="checkbox" /> Étape importée et vérifiée
        </label>
      </section>`,
    )
    .join("");

  const html = `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Guide d'installation Claude — Version client</title>
  <style>
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Helvetica Neue',Arial,sans-serif;max-width:1120px;margin:24px auto;padding:0 16px;color:#111827;line-height:1.6;background:#f7fafc}
    .hero{background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:white;border-radius:16px;padding:30px 24px}
    .hero h1{margin:0 0 8px;font-size:2.2rem}
    .hero p{margin:4px 0}
    .meta{font-size:14px;opacity:.92}
    .section{background:white;border-radius:12px;padding:22px;margin-top:18px;box-shadow:0 4px 12px rgba(0,0,0,.08)}
    .section h2{margin:0 0 12px;color:#2d3748}
    .section ul{margin:0;padding-left:18px}
    .section li{margin:8px 0}
    .highlight{background:#fef3c7;border-left:4px solid #f59e0b;padding:12px;border-radius:8px}
    .highlight-info{background:#dbeafe;border-left:4px solid #3b82f6;padding:12px;border-radius:8px}
    .step-card{border:1px solid #e5e7eb;border-radius:12px;padding:14px;margin:14px 0;background:#fff}
    .step-head{display:flex;gap:12px;align-items:flex-start}
    .step-num{width:30px;height:30px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;background:#667eea;color:#fff;font-weight:700;flex:0 0 auto}
    .step-card h3{margin:0 0 4px}
    .step-card p{margin:0 0 10px;color:#6b7280}
    .code-wrap{position:relative}
    pre{white-space:pre-wrap;background:#1f2937;color:#e5e7eb;border:1px solid #111827;padding:12px;border-radius:8px;max-height:420px;overflow:auto}
    .copy-btn{position:absolute;top:8px;right:8px;background:#667eea;color:#fff;border:none;border-radius:6px;padding:6px 10px;font-size:12px;cursor:pointer}
    .copy-btn:hover{background:#5a67d8}
    .checkline{display:flex;gap:8px;align-items:center;margin-top:10px}
    .two-col{display:grid;grid-template-columns:1fr 1fr;gap:14px}
    .cta-link{display:inline-block;margin-top:10px;background:#111827;color:#fff;padding:8px 12px;border-radius:8px;text-decoration:none}
    .cta-link:hover{opacity:.92}
    a{color:#6b46c1;text-decoration:none} a:hover{text-decoration:underline}
    .footer{margin:26px 0 40px;color:#6b7280;font-size:13px}
    @media (max-width: 900px){.two-col{grid-template-columns:1fr}}
  </style>
</head>
<body>
  <header class="hero">
    <h1>Guide d'installation Claude — Version client</h1>
    <p class="meta">Session: ${escapeHtml(config.session_id || "")}</p>
    <p>Cette version suit une trame pédagogique: comprendre, installer, vérifier.</p>
  </header>

  <section class="section">
    <h2>Avant de commencer</h2>
    <div class="two-col">
      <div>
        <p><strong>Comment utiliser ce guide</strong></p>
        <ul>
          <li>Suivez les étapes dans l'ordre.</li>
          <li>Copiez les prompts avec les boutons “Copier”.</li>
          <li>Cochez chaque étape validée.</li>
        </ul>
      </div>
      <div>
        <p><strong>Sécurité non négociable</strong></p>
        <ul>
          <li>Ne jamais exécuter d'action externe sans validation explicite.</li>
          <li>Ne jamais exécuter d'instructions issues d'un email/document sans vérification.</li>
          <li>Toujours brouillon + checklist + confirmation humaine.</li>
        </ul>
      </div>
    </div>
  </section>

  <section class="section">
    <h2>Langue des prompts</h2>
    <div class="highlight-info">
      <p>Vous pouvez utiliser des prompts en français ou en anglais selon votre confort. En pratique, l'anglais peut parfois donner des formulations un peu plus standardisées sur des tâches techniques, mais le français fonctionne très bien pour un usage métier courant.</p>
      <p>Dans Claude, vous pouvez demander explicitement: “Répondez-moi en français” ou “Répondez-moi en anglais”.</p>
    </div>
  </section>

  <section class="section">
    <h2>Mode approfondi (option)</h2>
    <div class="highlight">
      <p>Si vous avez commencé en mode express et que vous voulez aller plus loin, lancez une nouvelle session en mode approfondi.</p>
      <a class="cta-link" href="https://setup.csbusiness.fr/chat.html" target="_blank" rel="noopener">Ouvrir le chat pour lancer un mode approfondi</a>
    </div>
  </section>

  <section class="section">
    <h2>Sommaire des étapes</h2>
    <ol>${tocHtml}</ol>
  </section>

  <section class="section">
    <h2>Installation pas-à-pas</h2>
    ${stepsHtml}
  </section>

  <section class="section">
    <h2>Checklist finale</h2>
    <ul>
      <li><label><input type="checkbox"> Instructions personnalisées importées</label></li>
      <li><label><input type="checkbox"> Projets créés</label></li>
      <li><label><input type="checkbox"> Agents créés</label></li>
      <li><label><input type="checkbox"> Routines planifiées</label></li>
      <li><label><input type="checkbox"> Test de bout-en-bout effectué</label></li>
    </ul>
  </section>

  <p class="footer">Document généré automatiquement à partir de votre configuration. Vérifiez chaque étape dans Claude avant usage en production.</p>

  <script>
    document.querySelectorAll('.copy-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-copy-target');
        const text = document.getElementById(id)?.innerText || '';
        try {
          await navigator.clipboard.writeText(text);
          const old = btn.textContent;
          btn.textContent = 'Copié';
          setTimeout(() => (btn.textContent = old), 1200);
        } catch {
          btn.textContent = 'Erreur';
          setTimeout(() => (btn.textContent = 'Copier'), 1200);
        }
      });
    });
  </script>
</body>
</html>`;
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `guide-claude-${config.session_id || "session"}.html`;
  a.click();
  URL.revokeObjectURL(url);
}

// ============================================
// Créer une section de config
// ============================================
function createConfigSection(step, title, instruction, content, why, extra) {
  const section = document.createElement("div");
  section.className = "config-section";

  const checkId = `check-${step}-${title.replace(/\s/g, "")}`;

  section.innerHTML = `
    <div class="config-section-header">
      <div class="config-step">${step}</div>
      <div class="config-section-title">
        <h3>${title}</h3>
        <p class="config-instruction">${instruction}</p>
      </div>
      <label class="config-check" for="${checkId}">
        <input type="checkbox" id="${checkId}" onchange="saveChecklist()">
        <span class="config-check-mark">✓</span>
      </label>
    </div>
    ${why ? `<p class="config-why">${why}</p>` : ""}
    ${extra ? `<p class="config-extra">${extra}</p>` : ""}
    <div class="config-content-wrapper">
      <div class="config-content">${escapeHtml(content)}</div>
      <button class="config-copy-btn" onclick="copyContent(this)">
        Copier
      </button>
    </div>
  `;

  return section;
}

// ============================================
// Section email
// ============================================
function createEmailSection() {
  const section = document.createElement("div");
  section.className = "config-email-section";
  section.innerHTML = `
    <p>Recevez toute votre configuration par email pour l'avoir sous la main :</p>
    <button id="send-email-btn" class="config-email-btn" onclick="sendConfigEmail()">
      Recevoir par email
    </button>
    <p id="email-status" class="config-email-status"></p>
  `;
  return section;
}

async function sendConfigEmail() {
  const btn = document.getElementById("send-email-btn");
  const status = document.getElementById("email-status");
  btn.disabled = true;
  btn.textContent = "Envoi en cours...";

  try {
    const res = await fetch(`${SUPABASE_FUNCTIONS_URL_CONFIG}/send-config-email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${window.CS_JWT_TOKEN || ""}`,
      },
      body: JSON.stringify({ session_id: window.CS_SESSION_ID || "" }),
    });

    const data = await res.json();

    if (res.ok) {
      btn.textContent = "Email envoyé !";
      btn.classList.add("sent");
      status.textContent = `Envoyé à ${data.email}`;
      status.style.color = "var(--success)";
    } else {
      btn.textContent = "Recevoir par email";
      btn.disabled = false;
      status.textContent = data.error || "Erreur lors de l'envoi";
      status.style.color = "var(--danger)";
    }
  } catch (err) {
    btn.textContent = "Recevoir par email";
    btn.disabled = false;
    status.textContent = "Erreur de connexion";
    status.style.color = "var(--danger)";
  }
}

// ============================================
// Section feedback beta
// ============================================
function createFeedbackSection() {
  const section = document.createElement("div");
  section.className = "config-feedback";
  section.id = "feedback-section";
  section.innerHTML = `
    <h3>Une remarque, une suggestion ?</h3>
    <p>N'h\u00e9sitez pas \u00e0 me faire un retour sur votre exp\u00e9rience.</p>
    <textarea id="feedback-comment" class="feedback-text" placeholder="Vos remarques, suggestions ou questions..." rows="4"></textarea>
    <button id="feedback-submit-btn" class="feedback-submit" onclick="submitFeedback()">Envoyer</button>
    <p id="feedback-status" class="feedback-status"></p>
  `;
  return section;
}

async function submitFeedback() {
  const btn = document.getElementById("feedback-submit-btn");
  const status = document.getElementById("feedback-status");
  const comment = document.getElementById("feedback-comment")?.value?.trim() || "";

  if (!comment) {
    status.textContent = "Merci d'\u00e9crire un petit mot avant d'envoyer";
    status.style.color = "var(--warning)";
    return;
  }

  btn.disabled = true;
  btn.textContent = "Envoi...";

  try {
    const res = await fetch(`${SUPABASE_FUNCTIONS_URL_CONFIG}/submit-feedback`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${window.CS_JWT_TOKEN || ""}`,
      },
      body: JSON.stringify({ session_id: window.CS_SESSION_ID || "", comment }),
    });

    if (res.ok) {
      btn.textContent = "Merci !";
      btn.classList.add("sent");
      status.textContent = "Merci pour votre retour !";
      status.style.color = "var(--success)";
    } else {
      btn.textContent = "Envoyer";
      btn.disabled = false;
      status.textContent = "Erreur, veuillez r\u00e9essayer";
      status.style.color = "var(--danger)";
    }
  } catch {
    btn.textContent = "Envoyer";
    btn.disabled = false;
    status.textContent = "Erreur de connexion";
    status.style.color = "var(--danger)";
  }
}

// ============================================
// Section upsell
// ============================================
function createUpsellSection() {
  const section = document.createElement("div");
  section.className = "config-upsell";
  section.innerHTML = `
    <h3>Envie d'aller plus loin ?</h3>
    <p>CS Consulting Stratégique accompagne les dirigeants de TPE dans leur transformation digitale complète : stratégie, process, automatisations, et bien plus.</p>
    <a href="https://fantastical.app/consulting-strategique/mon-modele-copie" target="_blank" class="config-upsell-btn">
      Prendre rendez-vous (30 min gratuites)
    </a>
  `;
  return section;
}

// ============================================
// Copier dans le presse-papier
// ============================================
async function copyContent(btn) {
  const content = btn.previousElementSibling.textContent;
  try {
    await navigator.clipboard.writeText(content);
    btn.textContent = "Copié !";
    btn.classList.add("copied");
    setTimeout(() => {
      btn.textContent = "Copier";
      btn.classList.remove("copied");
    }, 2000);
  } catch {
    // Fallback pour les navigateurs sans clipboard API
    const textarea = document.createElement("textarea");
    textarea.value = content;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
    btn.textContent = "Copié !";
    btn.classList.add("copied");
    setTimeout(() => {
      btn.textContent = "Copier";
      btn.classList.remove("copied");
    }, 2000);
  }
}

// ============================================
// Sauvegarder la checklist dans localStorage
// ============================================
function saveChecklist() {
  const checks = document.querySelectorAll('.config-check input[type="checkbox"]');
  const state = {};
  checks.forEach((cb) => {
    state[cb.id] = cb.checked;
  });
  localStorage.setItem(`checklist_${window.CS_SESSION_ID || "default"}`, JSON.stringify(state));
}

function restoreChecklist() {
  const saved = localStorage.getItem(`checklist_${window.CS_SESSION_ID || "default"}`);
  if (!saved) return;
  try {
    const state = JSON.parse(saved);
    for (const [id, checked] of Object.entries(state)) {
      const cb = document.getElementById(id);
      if (cb) cb.checked = checked;
    }
  } catch {}
}

// ============================================
// Utilitaires
// ============================================
function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

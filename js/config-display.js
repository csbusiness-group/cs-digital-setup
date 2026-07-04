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

    document.getElementById("generation-indicator")?.remove();
    displayConfig(fullConfig, sessionId, jwtToken);

    // Config delivered — revoke refresh token to prevent re-use
    localStorage.removeItem("refresh_token");
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
// Affichage du livrable RICHE (document HTML autonome, en iframe isolée)
// ============================================
function displayRichConfig(config, sessionId, jwtToken) {
  const container = document.getElementById("messages-container");
  const inputArea = document.querySelector(".chat-input-area");
  if (inputArea) inputArea.style.display = "none";

  const wrap = document.createElement("div");
  wrap.className = "rich-config-wrap";
  // width:100% : #messages-container est une colonne flex — sans ça le wrap
  // rétrécit à sa largeur minimale et l'iframe s'affiche en colonne étroite.
  wrap.style.cssText = "width:100%;max-width:52rem;margin:0 auto;padding:8px 0 24px";

  // Barre d'actions : télécharger le guide.
  const bar = document.createElement("div");
  bar.style.cssText = "display:flex;justify-content:flex-end;gap:8px;margin:0 0 10px;padding:0 4px";
  const dl = document.createElement("button");
  dl.type = "button";
  dl.textContent = "⬇︎  Télécharger le guide (HTML)";
  dl.style.cssText =
    "border:1px solid var(--terra,#C2714A);background:var(--terra,#C2714A);color:#fff;font-weight:600;" +
    "font-size:13px;padding:8px 14px;border-radius:8px;cursor:pointer";
  dl.addEventListener("click", function () {
    try {
      const blob = new Blob([config.html_bundle], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "ma-configuration-claude.html";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    } catch (e) {
      console.error("download failed", e);
    }
  });
  bar.appendChild(dl);

  // Recevoir le guide par email (pièce jointe HTML, envoyée au compte connecté).
  if (sessionId && jwtToken) {
    const mail = document.createElement("button");
    mail.type = "button";
    mail.textContent = "✉︎  Recevoir par email";
    mail.style.cssText =
      "border:1px solid var(--terra,#C2714A);background:transparent;color:var(--terra,#C2714A);" +
      "font-weight:600;font-size:13px;padding:8px 14px;border-radius:8px;cursor:pointer";
    mail.addEventListener("click", async function () {
      mail.disabled = true;
      const original = mail.textContent;
      mail.textContent = "Envoi en cours…";
      try {
        const res = await fetch(SUPABASE_FUNCTIONS_URL_CONFIG + "/send-config-email", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + jwtToken,
          },
          body: JSON.stringify({ session_id: sessionId }),
        });
        if (!res.ok) throw new Error("send failed " + res.status);
        mail.textContent = "Envoyé ✓ (vérifiez vos spams)";
      } catch (e) {
        console.error("send email failed", e);
        mail.textContent = "Échec — réessayez";
        mail.disabled = false;
        setTimeout(function () { mail.textContent = original; }, 4000);
      }
    });
    bar.appendChild(mail);
  }
  wrap.appendChild(bar);

  // Le livrable, rendu dans une iframe : isolation CSS totale, présentation
  // identique à chaque fois (aucune collision avec les styles de la page).
  // Hauteur = écran, défilement INTERNE à l'iframe : une iframe à la taille du
  // document (30 000+ px) dépasse la surface de rendu de Chrome et le bas ne
  // s'affiche jamais — on ne dimensionne donc PAS l'iframe sur son contenu.
  const frame = document.createElement("iframe");
  frame.setAttribute("title", "Votre configuration Claude");
  frame.setAttribute("sandbox", "allow-scripts allow-popups allow-downloads");
  frame.setAttribute("allow", "clipboard-write");
  frame.style.cssText =
    "width:100%;border:1px solid var(--hair,#E7DCCB);border-radius:12px;" +
    "height:max(600px, calc(100vh - 190px));background:#FBF7F2";
  frame.srcdoc = config.html_bundle;
  wrap.appendChild(frame);

  // Questionnaire de satisfaction (étoiles + témoignage) sous le livrable.
  wrap.appendChild(createFeedbackSection());

  container.appendChild(wrap);
  container.scrollTop = container.scrollHeight;

  // Config delivered — revoke refresh token to prevent re-use.
  localStorage.removeItem("refresh_token");
}

// ============================================
// Affichage de la config
// ============================================
function displayConfig(config, sessionId, jwtToken) {
  // Livrable riche disponible → présentation stable en iframe, on court-circuite
  // l'ancien rendu déterministe (conservé en repli quand le riche est absent).
  if (config && typeof config.html_bundle === "string" && config.html_bundle.length > 500) {
    displayRichConfig(config, sessionId, jwtToken);
    return;
  }

  const container = document.getElementById("messages-container");
  document.querySelector(".chat-input-area").style.display = "none";

  const structured = config.structured || {};
  const lp = structured.living_proposal || config.living_proposal || {};
  const customInstructions =
    structured.custom_instructions ||
    config.custom_instructions ||
    lp.custom_instructions_draft ||
    "";
  const synthesis = structured.synthesis || config.synthesis || null;
  const agents = lp.agents || config.agents || [];
  const routines = lp.routines || config.scheduled_tasks || [];
  const memorySections = lp.memory_sections || [];

  const resultsDiv = document.createElement("div");
  resultsDiv.className = "config-results";
  resultsDiv.innerHTML =
    '<div class="config-header">' +
    '<h2>Votre configuration Claude.ai est pr\u00eate !</h2>' +
    '<p>Suivez les \u00e9tapes ci-dessous pour tout importer dans Claude.ai</p>' +
    '<p class="config-trust-note">Session reprise possible en cas d\'interruption. Les donn\u00e9es diagnostics sont conserv\u00e9es au maximum 90 jours, puis supprim\u00e9es automatiquement.</p>' +
    '</div>';

  resultsDiv.appendChild(createDataControlSection(config));

  if (synthesis) {
    const synDiv = document.createElement("div");
    synDiv.className = "config-synthesis-recap";
    let synHtml = "<h3>Synth\u00e8se de votre diagnostic</h3>";
    if (synthesis.understanding) {
      synHtml += "<p><strong>Ce que nous avons compris :</strong></p><p>" + escapeHtml(synthesis.understanding) + "</p>";
    }
    if (synthesis.transformation) {
      synHtml += "<p><strong>O\u00f9 Claude devient game-changer :</strong></p><p>" + escapeHtml(synthesis.transformation) + "</p>";
    }
    synDiv.innerHTML = synHtml;
    resultsDiv.appendChild(synDiv);
  }

  const level1 = document.createElement("div");
  level1.className = "config-level-banner";
  level1.innerHTML = "<h3>Niveau 1 \u2014 Version gratuite</h3><p>Ces \u00e9l\u00e9ments fonctionnent avec toutes les versions de Claude.ai</p>";
  resultsDiv.appendChild(level1);

  let stepNum = 1;

  if (customInstructions) {
    resultsDiv.appendChild(
      createConfigSection(
        String(stepNum++),
        "Instructions personnalis\u00e9es",
        "Allez dans Claude.ai \u2192 Cliquez sur votre nom en bas \u00e0 gauche \u2192 Param\u00e8tres \u2192 Instructions personnalis\u00e9es \u2192 Collez le texte ci-dessous",
        customInstructions,
        "C'est le socle de votre Claude : il saura qui vous \u00eates et comment vous aider."
      )
    );
  }

  if (memorySections.length > 0) {
    const memContent = memorySections
      .map((m) => (m.recommended ? "[Recommand\u00e9] " : "") + m.title + " \u2014 " + m.description)
      .join("\n\n");
    resultsDiv.appendChild(
      createConfigSection(
        String(stepNum++),
        "Structure \u00ab Ma M\u00e9moire \u00bb",
        "Ces sections structurent la m\u00e9moire de votre Claude. Activez-les dans Param\u00e8tres \u2192 Ma M\u00e9moire.",
        memContent,
        "La m\u00e9moire permet \u00e0 Claude de retenir votre contexte entre les conversations."
      )
    );
  }

  const level2 = document.createElement("div");
  level2.className = "config-level-banner level-pro";
  level2.innerHTML = "<h3>Niveau 2 \u2014 Version Pro</h3><p>Pour aller plus loin, passez \u00e0 Claude Pro. Vous d\u00e9bloquez les projets, les agents, les t\u00e2ches automatiques et le co-travail.</p>";
  resultsDiv.appendChild(level2);

  if (agents.length > 0) {
    for (const agent of agents) {
      const name = agent.role || agent.name || "Agent";
      const prompt = agent.prompt || agent.instructions || "";
      const why = agent.why_for_you || agent.why || "";
      const trigger = agent.trigger ? "D\u00e9clencheur : " + agent.trigger : null;
      resultsDiv.appendChild(
        createConfigSection(
          "\u2605",
          "Agent : " + name,
          "Cr\u00e9ez un agent \u00ab " + name + " \u00bb dans Claude.ai avec les instructions ci-dessous",
          prompt,
          why,
          trigger
        )
      );
    }
  }

  if (routines.length > 0) {
    for (const r of routines) {
      const title = r.title || r.name || "Routine";
      const cadence = r.cadence || r.frequency || "";
      const timing = r.trigger_timing || r.best_time || "";
      const linked = Array.isArray(r.linked_agents) && r.linked_agents.length
        ? "Agents li\u00e9s : " + r.linked_agents.join(", ")
        : null;
      const content = (r.prompt || "") +
        (r.expected_output ? "\n\nSortie attendue : " + r.expected_output : "");
      resultsDiv.appendChild(
        createConfigSection(
          "\u23f0",
          title + (cadence ? " (" + cadence + ")" : ""),
          timing ? "Quand : " + timing : "Planifiez cette routine dans Claude.",
          content,
          null,
          linked
        )
      );
    }
  }

  if (lp.expected_impacts && lp.expected_impacts.length > 0) {
    const impactContent = lp.expected_impacts
      .map((i) => i.area + " \u2014 " + i.metric + " : " + i.expected_change + " (" + i.timeframe + ")")
      .join("\n");
    resultsDiv.appendChild(
      createConfigSection(
        "\u2197",
        "Impacts attendus",
        "Ces estimations sont bas\u00e9es sur votre diagnostic. Elles servent de rep\u00e8re pour mesurer vos progr\u00e8s.",
        impactContent,
        null
      )
    );
  }

  if (config.validation && config.validation.warnings && config.validation.warnings.length > 0) {
    const warnDiv = document.createElement("div");
    warnDiv.className = "config-warnings";
    warnDiv.innerHTML = "<p><strong>Avertissements :</strong> " +
      config.validation.warnings.map(escapeHtml).join(" | ") + "</p>";
    resultsDiv.appendChild(warnDiv);
  }

  resultsDiv.appendChild(createFeedbackSection());
  resultsDiv.appendChild(createUpsellSection());

  container.appendChild(resultsDiv);
  container.scrollTop = container.scrollHeight;

  restoreChecklist();
}

function createDataControlSection(config) {
  const section = document.createElement("div");
  section.className = "config-data-control";
  section.innerHTML =
    '<h3>Confidentialit\u00e9 & contr\u00f4le</h3>' +
    '<p>Copiez d\'abord votre configuration compl\u00e8te. Ensuite, vous pouvez effacer vos donn\u00e9es de diagnostic de mani\u00e8re irr\u00e9versible.</p>' +
    '<div class="config-data-actions">' +
    '<button id="copy-full-config-btn" class="config-data-btn" type="button">Copier la config compl\u00e8te</button>' +
    '<button id="download-html-guide-btn" class="config-data-btn" type="button">T\u00e9l\u00e9charger le guide HTML</button>' +
    '<button id="erase-data-btn" class="config-data-btn danger" type="button">Effacer mes donn\u00e9es</button>' +
    '</div>' +
    '<p id="erase-data-status" class="config-data-status"></p>';

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
      copyBtn.textContent = "Config copi\u00e9e !";
      setTimeout(() => (copyBtn.textContent = "Copier la config compl\u00e8te"), 2000);
    } catch {
      copyBtn.textContent = "Copie impossible";
    }
  });

  htmlBtn?.addEventListener("click", () => {
    downloadGuideHtml(config);
    htmlBtn.textContent = "Guide t\u00e9l\u00e9charg\u00e9";
    setTimeout(() => (htmlBtn.textContent = "T\u00e9l\u00e9charger le guide HTML"), 2000);
  });

  eraseBtn?.addEventListener("click", async () => {
    const ok = window.confirm(
      "Cette action est irr\u00e9versible. V\u00e9rifiez d'abord que vous avez copi\u00e9 votre configuration. Continuer ?"
    );
    if (!ok) return;
    const typed = window.prompt("Confirmez en tapant SUPPRIMER");
    if (typed !== "SUPPRIMER") {
      status.textContent = "Suppression annul\u00e9e.";
      return;
    }

    eraseBtn.disabled = true;
    eraseBtn.textContent = "Suppression...";
    try {
      const res = await fetch(SUPABASE_FUNCTIONS_URL_CONFIG + "/erase-my-data", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + (window.CS_JWT_TOKEN || ""),
        },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Erreur de suppression");
      }
      status.textContent = "Vos donn\u00e9es de diagnostic ont \u00e9t\u00e9 supprim\u00e9es.";
      eraseBtn.textContent = "Donn\u00e9es supprim\u00e9es";
    } catch (err) {
      status.textContent = "Erreur: " + (err.message || "suppression impossible");
      eraseBtn.disabled = false;
      eraseBtn.textContent = "Effacer mes donn\u00e9es";
    }
  });

  return section;
}


function downloadGuideHtml(config) {
  var structured = config.structured || {};
  var lp = structured.living_proposal || config.living_proposal || {};
  var customInstructions = structured.custom_instructions || config.custom_instructions || lp.custom_instructions_draft || "";
  var synthesis = structured.synthesis || config.synthesis || null;
  var agents = lp.agents || config.agents || [];
  var routines = lp.routines || config.scheduled_tasks || [];
  var memorySections = lp.memory_sections || [];
  var impacts = lp.expected_impacts || [];
  var sessionId = config.session_id || "session";
  var now = new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });

  function esc(t) { return escapeHtml(String(t || "")); }

  var agentColors = ["#667eea", "#764ba2", "#e74c3c", "#27ae60", "#f39c12", "#3498db"];

  var agentsHtml = "";
  for (var ai = 0; ai < agents.length; ai++) {
    var ag = agents[ai];
    var borderColor = agentColors[ai % agentColors.length];
    agentsHtml += '<div class="agent-card" style="border-left-color:' + borderColor + '">' +
      '<h4>' + esc(ag.role || "Agent") + '</h4>' +
      "<p><strong>Quand l'utiliser :</strong> " + esc(ag.trigger) + '</p>' +
      (ag.why_for_you ? '<p><strong>Pourquoi pour vous :</strong> ' + esc(ag.why_for_you) + '</p>' : '') +
      (ag.expected_outcome ? '<div class="success-box"><h4>R\u00e9sultat attendu</h4><p>' + esc(ag.expected_outcome) + '</p></div>' : '') +
      '<div class="code-block"><button class="copy-btn" onclick="copyToClipboard(this)">Copier</button>' +
      '<pre>' + esc(ag.prompt) + '</pre></div>' +
      '<label style="display:flex;gap:8px;align-items:center;margin-top:12px;cursor:pointer">' +
      '<input type="checkbox"> Agent cr\u00e9\u00e9</label></div>';
  }

  var routinesHtml = "";
  for (var ri = 0; ri < routines.length; ri++) {
    var rt = routines[ri];
    var linkedList = "";
    if (Array.isArray(rt.linked_agents) && rt.linked_agents.length > 0) {
      linkedList = '<p><strong>Agents li\u00e9s :</strong> ' + esc(rt.linked_agents.join(", ")) + '</p>';
    }
    routinesHtml += '<div class="routine-card">' +
      '<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">' +
      '<h4 style="margin:0">' + esc(rt.title || "Routine") + '</h4>' +
      (rt.cadence ? '<span class="cadence-badge">' + esc(rt.cadence) + '</span>' : '') +
      '</div>' +
      (rt.trigger_timing ? '<p><strong>Quand :</strong> ' + esc(rt.trigger_timing) + '</p>' : '') +
      linkedList +
      '<div class="code-block"><button class="copy-btn" onclick="copyToClipboard(this)">Copier</button>' +
      '<pre>' + esc(rt.prompt) + '</pre></div>' +
      (rt.expected_output ? '<div class="success-box"><h4>R\u00e9sultat attendu</h4><p>' + esc(rt.expected_output) + '</p></div>' : '') +
      '</div>';
  }

  var memoryCardsHtml = "";
  for (var mi = 0; mi < memorySections.length; mi++) {
    var ms = memorySections[mi];
    memoryCardsHtml += '<div class="memory-card">' +
      '<h4>' + esc(ms.title) + '</h4>' +
      '<p>' + esc(ms.description) + '</p>' +
      (ms.recommended ? '<p class="memory-rec">' + esc(ms.recommended) + '</p>' : '') +
      '</div>';
  }

  var impactsRowsHtml = "";
  for (var ii = 0; ii < impacts.length; ii++) {
    var imp = impacts[ii];
    impactsRowsHtml += '<tr>' +
      '<td>' + esc(imp.area) + '</td>' +
      '<td>' + esc(imp.metric) + '</td>' +
      '<td>' + esc(imp.timeframe) + '</td>' +
      '<td>' + esc(imp.expected_change) + '</td>' +
      '<td>' + esc(imp.rationale) + '</td>' +
      '</tr>';
  }

  var checklistAgentsHtml = "";
  for (var ca = 0; ca < agents.length; ca++) {
    checklistAgentsHtml += '<li>Agent "' + esc(agents[ca].role || "Agent") + '" cr\u00e9\u00e9</li>';
  }
  var checklistRoutinesHtml = "";
  for (var cr = 0; cr < routines.length; cr++) {
    checklistRoutinesHtml += '<li>Routine "' + esc(routines[cr].title || "Routine") + '" planifi\u00e9e</li>';
  }

  var synthesisHtml = "";
  if (synthesis && (synthesis.understanding || synthesis.transformation || synthesis.config_preview)) {
    synthesisHtml = '<div class="step">' +
      '<h2><span class="step-number">0</span>Ce que nous avons compris de vous</h2>' +
      (synthesis.understanding ? '<div class="info-box"><h4>Compr\u00e9hension</h4><p>' + esc(synthesis.understanding) + '</p></div>' : '') +
      (synthesis.transformation ? '<div class="info-box"><h4>Transformation propos\u00e9e</h4><p>' + esc(synthesis.transformation) + '</p></div>' : '') +
      (synthesis.config_preview ? '<div class="info-box"><h4>Aper\u00e7u de la configuration</h4><p>' + esc(synthesis.config_preview) + '</p></div>' : '') +
      '</div>';
  }

  var html = '<!DOCTYPE html>\n<html lang="fr">\n<head>\n' +
    '<meta charset="UTF-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
    "<title>Guide d'installation Claude \u2014 " + esc(sessionId) + '</title>\n' +
    '<style>\n' +
    '* { margin: 0; padding: 0; box-sizing: border-box; }\n' +
    "body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #2c3e50; background: #f8fafb; }\n" +
    '.container { max-width: 900px; margin: 0 auto; padding: 40px 20px; }\n' +
    'header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 60px 40px; border-radius: 12px; margin-bottom: 40px; text-align: center; }\n' +
    'header h1 { font-size: 2.5em; margin-bottom: 10px; }\n' +
    'header p { font-size: 1.2em; opacity: 0.95; }\n' +
    '.intro-box { background: white; border-left: 4px solid #667eea; padding: 30px; margin-bottom: 40px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }\n' +
    '.intro-box h2 { color: #667eea; margin-bottom: 15px; }\n' +
    '.step { background: white; padding: 40px; margin-bottom: 30px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); border-top: 3px solid #667eea; }\n' +
    '.step-number { display: inline-block; width: 40px; height: 40px; background: #667eea; color: white; border-radius: 50%; text-align: center; line-height: 40px; font-weight: bold; margin-right: 15px; font-size: 1.2em; }\n' +
    '.step h2 { display: inline-block; color: #2c3e50; margin-bottom: 20px; }\n' +
    '.step-subtitle { color: #666; font-size: 0.95em; margin-bottom: 20px; padding-left: 55px; }\n' +
    ".code-block { background: #2c3e50; color: #ecf0f1; padding: 20px; border-radius: 6px; overflow-x: auto; margin: 20px 0; font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace; font-size: 0.9em; line-height: 1.5; position: relative; }\n" +
    '.code-block pre { background: none; border: none; padding: 0; margin: 0; color: inherit; white-space: pre-wrap; word-wrap: break-word; max-height: none; overflow: visible; }\n' +
    '.copy-btn { position: absolute; top: 10px; right: 10px; background: #667eea; color: white; border: none; padding: 8px 12px; border-radius: 4px; cursor: pointer; font-size: 0.85em; opacity: 0.7; transition: opacity 0.2s; }\n' +
    '.copy-btn:hover { opacity: 1; }\n' +
    ".path-info { background: #f0f4ff; border-left: 3px solid #667eea; padding: 15px; margin: 20px 0; border-radius: 4px; font-family: 'Monaco', monospace; font-size: 0.9em; color: #2c3e50; }\n" +
    '.info-box { background: #e8f4f8; border-left: 3px solid #3498db; padding: 20px; margin: 20px 0; border-radius: 4px; }\n' +
    '.info-box h4 { color: #2c3e50; margin-bottom: 10px; }\n' +
    '.warning-box { background: #fff3cd; border-left: 3px solid #ffc107; padding: 20px; margin: 20px 0; border-radius: 4px; }\n' +
    '.warning-box h4 { color: #856404; margin-bottom: 10px; }\n' +
    '.success-box { background: #d4edda; border-left: 3px solid #28a745; padding: 20px; margin: 20px 0; border-radius: 4px; }\n' +
    '.success-box h4 { color: #155724; margin-bottom: 10px; }\n' +
    '.agents-section { background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); border-top: 3px solid #764ba2; margin-bottom: 30px; }\n' +
    '.agent-card { background: #f8fafb; padding: 20px; margin: 15px 0; border-left: 3px solid #667eea; border-radius: 4px; }\n' +
    '.agent-card h4 { color: #667eea; margin-bottom: 8px; }\n' +
    '.agent-card p { color: #666; margin-bottom: 10px; }\n' +
    '.routine-card { background: #f8fafb; padding: 20px; margin: 15px 0; border-left: 3px solid #764ba2; border-radius: 8px; }\n' +
    '.routine-card h4 { color: #764ba2; margin-bottom: 0; }\n' +
    '.routine-card p { color: #666; margin-bottom: 10px; }\n' +
    '.cadence-badge { display: inline-block; background: #764ba2; color: white; padding: 4px 12px; border-radius: 20px; font-size: 0.8em; font-weight: 600; }\n' +
    '.memory-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 16px; margin: 20px 0; }\n' +
    '.memory-card { background: #f8fafb; padding: 20px; border-radius: 8px; border: 1px solid #e2e8f0; }\n' +
    '.memory-card h4 { color: #667eea; margin-bottom: 8px; }\n' +
    '.memory-card p { color: #666; font-size: 0.9em; margin-bottom: 6px; }\n' +
    '.memory-rec { font-style: italic; color: #764ba2 !important; font-size: 0.85em !important; }\n' +
    '.cards-row { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin: 20px 0; }\n' +
    '.plan-card { background: white; padding: 24px; border-radius: 8px; border: 2px solid #e2e8f0; }\n' +
    '.plan-card.pro { border-color: #667eea; }\n' +
    '.plan-card h4 { margin-bottom: 10px; }\n' +
    '.plan-card ul { padding-left: 18px; }\n' +
    '.plan-card li { margin: 6px 0; color: #555; }\n' +
    'table { width: 100%; border-collapse: collapse; margin: 20px 0; }\n' +
    'table th { background: #667eea; color: white; padding: 12px; text-align: left; font-weight: 600; }\n' +
    'table td { padding: 12px; border-bottom: 1px solid #ecf0f1; }\n' +
    'table tr:hover { background: #f8fafb; }\n' +
    '.checklist { list-style: none; padding: 0; }\n' +
    '.checklist li { padding: 10px 0; padding-left: 30px; position: relative; }\n' +
    ".checklist li:before { content: '\\2610'; position: absolute; left: 0; font-size: 1.2em; color: #667eea; }\n" +
    'footer { text-align: center; padding: 40px; color: #666; border-top: 1px solid #ecf0f1; margin-top: 40px; }\n' +
    'a { color: #667eea; text-decoration: none; } a:hover { text-decoration: underline; }\n' +
    "@media (max-width: 768px) { header h1 { font-size: 1.8em; } .step { padding: 20px; } .cards-row { grid-template-columns: 1fr; } .memory-grid { grid-template-columns: 1fr; } }\n" +
    '</style>\n</head>\n<body>\n<div class="container">\n' +

    '<header>' +
    '<h1>\ud83d\ude80 Votre Guide Claude Personnalis\u00e9</h1>' +
    "<p>Guide d'installation pas-\u00e0-pas \u2014 Session " + esc(sessionId) + '</p>' +
    '</header>\n' +

    '<div class="intro-box">' +
    '<h2>Avant de commencer</h2>' +
    '<p><strong>Temps total :</strong> ~20 minutes (lecture + configuration)</p>' +
    '<p><strong>Ce que vous allez faire :</strong> Configurer Claude avec vos instructions personnalis\u00e9es, votre m\u00e9moire, vos agents et vos routines.</p>' +
    '<p><strong>Ce dont vous avez besoin :</strong> Un compte Claude (gratuit ou Pro) et ce guide ouvert \u00e0 c\u00f4t\u00e9.</p>' +
    '</div>\n' +

    '<div class="step">' +
    '<h2><span class="step-number">\ud83d\udca1</span>Comprendre Claude en 2 minutes</h2>' +
    '<div class="cards-row">' +
    '<div class="plan-card">' +
    '<h4>\ud83c\udd93 Claude Gratuit</h4>' +
    '<ul>' +
    '<li>Conversations basiques</li>' +
    "<li>Pas de projets ni d'agents</li>" +
    '<li>Pas de m\u00e9moire persistante</li>' +
    '<li>Limite de messages/jour</li>' +
    '</ul></div>' +
    '<div class="plan-card pro">' +
    '<h4>\u2b50 Claude Pro (20$/mois)</h4>' +
    '<ul>' +
    '<li>Projets avec instructions personnalis\u00e9es</li>' +
    '<li>Agents sp\u00e9cialis\u00e9s (prompts d\u00e9di\u00e9s)</li>' +
    '<li>M\u00e9moire persistante entre sessions</li>' +
    '<li>Usage \u00e9tendu et mod\u00e8les avanc\u00e9s</li>' +
    '</ul></div>' +
    '</div>' +
    '<div class="info-box">' +
    '<h4>\ud83e\udde9 Les 4 briques de votre configuration</h4>' +
    '<p><strong>1. Instructions personnalis\u00e9es</strong> \u2014 Ce que Claude sait de vous \u00e0 chaque conversation.</p>' +
    '<p><strong>2. M\u00e9moire</strong> \u2014 Ce que Claude retient au fil du temps (priorit\u00e9s, pr\u00e9f\u00e9rences, contexte).</p>' +
    '<p><strong>3. Projets / Agents</strong> \u2014 Des r\u00f4les sp\u00e9cialis\u00e9s avec des prompts d\u00e9di\u00e9s.</p>' +
    '<p><strong>4. Routines</strong> \u2014 Des actions r\u00e9currentes planifi\u00e9es (briefings, reviews, audits).</p>' +
    '</div></div>\n' +

    synthesisHtml +

    '<div class="step">' +
    '<h2><span class="step-number">1</span>Instructions personnalis\u00e9es</h2>' +
    '<div class="step-subtitle">Le c\u0153ur de votre configuration \u2014 Claude les lira \u00e0 chaque conversation</div>' +
    '<div class="path-info">O\u00f9 aller : <strong>Claude.ai \u2192 Param\u00e8tres \u2192 Instructions personnalis\u00e9es</strong></div>' +
    (customInstructions ?
      '<div class="code-block"><button class="copy-btn" onclick="copyToClipboard(this)">Copier</button>' +
      '<pre>' + esc(customInstructions) + '</pre></div>' :
      "<div class=\"warning-box\"><h4>\u26a0\ufe0f Aucune instruction d\u00e9tect\u00e9e</h4><p>Le diagnostic n'a pas g\u00e9n\u00e9r\u00e9 d'instructions personnalis\u00e9es. Relancez une session approfondie.</p></div>") +
    '<div class="info-box"><h4>\ud83d\udca1 Pourquoi cette \u00e9tape ?</h4>' +
    "<p>Les instructions personnalis\u00e9es sont lues par Claude au d\u00e9but de chaque conversation. C'est comme un briefing automatique qui lui dit qui vous \u00eates, comment vous travaillez, et ce que vous attendez.</p></div>" +
    '<label style="display:flex;gap:8px;align-items:center;margin-top:12px;cursor:pointer"><input type="checkbox"> Instructions import\u00e9es et v\u00e9rifi\u00e9es</label>' +
    '</div>\n' +

    (memorySections.length > 0 ?
      '<div class="step">' +
      '<h2><span class="step-number">2</span>Ma M\u00e9moire</h2>' +
      '<div class="step-subtitle">Ce que Claude retient de vous entre les sessions</div>' +
      '<div class="memory-grid">' + memoryCardsHtml + '</div>' +
      '<div class="info-box"><h4>\ud83d\udca1 Pourquoi cette \u00e9tape ?</h4>' +
      "<p>La m\u00e9moire permet \u00e0 Claude de se souvenir de vos pr\u00e9f\u00e9rences, de vos projets en cours et de votre contexte m\u00e9tier. Plus vous l'utilisez, plus Claude devient pertinent.</p></div>" +
      '<div class="warning-box"><h4>\u26a0\ufe0f Construisez-la progressivement</h4>' +
      "<p>Pas besoin de tout remplir d'un coup. Dites simplement \u00e0 Claude : \u00ab Retiens que... \u00bb et il ajoutera l'information \u00e0 sa m\u00e9moire.</p></div>" +
      '<label style="display:flex;gap:8px;align-items:center;margin-top:12px;cursor:pointer"><input type="checkbox"> Sections m\u00e9moire pass\u00e9es en revue</label>' +
      '</div>\n' : '') +

    (agents.length > 0 ?
      '<div class="agents-section">' +
      '<h2 style="color:#764ba2;margin-bottom:30px">\ud83e\udd16 Vos Agents Sp\u00e9cialis\u00e9s</h2>' +
      "<p style=\"margin-bottom:20px\">Chaque agent est un r\u00f4le d\u00e9di\u00e9 avec un prompt sp\u00e9cifique. Cr\u00e9ez-les dans <strong>Claude.ai \u2192 Projets</strong>.</p>" +
      '<div class="info-box"><h4>\ud83d\udca1 Comment cr\u00e9er un agent</h4>' +
      "<p><strong>1.</strong> Allez sur Claude.ai \u2192 Page d'accueil<br>" +
      '<strong>2.</strong> Cliquez sur \u00ab Cr\u00e9er un projet \u00bb<br>' +
      "<strong>3.</strong> Donnez-lui le nom de l'agent<br>" +
      '<strong>4.</strong> Collez le prompt dans les instructions du projet<br>' +
      "<strong>5.</strong> Ouvrez ce projet pour utiliser l'agent</p></div>" +
      agentsHtml +
      '</div>\n' : '') +

    (routines.length > 0 ?
      '<div class="step">' +
      '<h2><span class="step-number">4</span>Vos Routines</h2>' +
      '<div class="step-subtitle">Actions r\u00e9currentes \u2014 planifi\u00e9es pour ne rien oublier</div>' +
      routinesHtml +
      '<div class="info-box"><h4>\ud83d\udca1 Pourquoi cette \u00e9tape ?</h4>' +
      '<p>Les routines vous permettent de ritualiser votre usage de Claude. Briefing du matin, review hebdo, audit mensuel\u2026 tout se d\u00e9clenche automatiquement.</p></div>' +
      '</div>\n' : '') +

    (impacts.length > 0 ?
      '<div class="step">' +
      '<h2><span class="step-number">5</span>Impacts attendus</h2>' +
      '<div class="step-subtitle">Ce que cette configuration va changer concr\u00e8tement</div>' +
      '<table><thead><tr>' +
      '<th>Domaine</th><th>M\u00e9trique</th><th>D\u00e9lai</th><th>Changement attendu</th><th>Justification</th>' +
      '</tr></thead><tbody>' +
      impactsRowsHtml +
      '</tbody></table></div>\n' : '') +

    '<div class="step">' +
    "<h2><span class=\"step-number\">\u2713</span>Checklist finale</h2>" +
    "<p>Avant de dire \u00ab c'est bon \u00bb, v\u00e9rifiez que tout est en place :</p>" +
    '<ul class="checklist">' +
    '<li>Instructions personnalis\u00e9es import\u00e9es dans Claude</li>' +
    (memorySections.length > 0 ? '<li>Sections m\u00e9moire pass\u00e9es en revue</li>' : '') +
    checklistAgentsHtml +
    checklistRoutinesHtml +
    "<li>Test de bout-en-bout effectu\u00e9 (posez une question \u00e0 Claude et v\u00e9rifiez qu'il utilise vos instructions)</li>" +
    '</ul>' +
    '<div class="success-box" style="margin-top:20px"><h4>\u2705 Si tout est coch\u00e9, vous \u00eates op\u00e9rationnel(le)</h4>' +
    "<p>Claude utilisera votre configuration \u00e0 chaque conversation. Plus vous l'utilisez, plus il s'adapte \u00e0 votre fa\u00e7on de travailler.</p></div>" +
    '</div>\n' +

    '<div class="step">' +
    '<h2><span class="step-number">?</span>Questions fr\u00e9quentes / Troubleshooting</h2>' +
    '<div style="margin-bottom:30px">' +
    '<h4 style="color:#667eea;margin-bottom:10px">\u2753 \u00ab Claude ne me reconna\u00eet pas \u00bb</h4>' +
    '<p>V\u00e9rifiez que vos instructions personnalis\u00e9es sont bien enregistr\u00e9es : <strong>Claude.ai \u2192 Param\u00e8tres \u2192 Instructions personnalis\u00e9es</strong>. Elles doivent contenir votre texte.</p></div>' +
    '<div style="margin-bottom:30px">' +
    '<h4 style="color:#667eea;margin-bottom:10px">\u2753 \u00ab Je ne trouve pas les projets/agents \u00bb</h4>' +
    '<p>Les projets et agents n\u00e9cessitent <strong>Claude Pro</strong> (20$/mois). Avec la version gratuite, seules les instructions personnalis\u00e9es sont disponibles.</p></div>' +
    '<div style="margin-bottom:30px">' +
    '<h4 style="color:#667eea;margin-bottom:10px">\u2753 \u00ab Je veux modifier un prompt \u00bb</h4>' +
    '<p>Allez dans <strong>Claude.ai \u2192 Projets</strong>, s\u00e9lectionnez le projet concern\u00e9 et modifiez les instructions du projet.</p></div>' +
    '<div style="margin-bottom:30px">' +
    '<h4 style="color:#667eea;margin-bottom:10px">\u2753 \u00ab Comment mettre \u00e0 jour la m\u00e9moire \u00bb</h4>' +
    "<p>Dites simplement \u00e0 Claude : \u00ab <strong>Retiens que...</strong> \u00bb suivi de l'information. Claude l'ajoutera \u00e0 sa m\u00e9moire pour les prochaines conversations.</p></div>" +
    '</div>\n' +

    '<footer>' +
    '<p><strong>CS Digital Setup \u2014 Votre configuration personnalis\u00e9e</strong></p>' +
    '<p style="margin-top:10px;font-size:0.9em">G\u00e9n\u00e9r\u00e9 le ' + esc(now) + ' | Session ' + esc(sessionId) + '</p>' +
    '<p style="margin-top:20px;color:#999;font-size:0.85em">Support : <a href="mailto:setup@csbusiness.fr">setup@csbusiness.fr</a></p>' +
    '</footer>\n' +

    '</div>\n' +

    '<script>\n' +
    'function copyToClipboard(button) {\n' +
    "  var codeBlock = button.parentElement;\n" +
    "  var pre = codeBlock.querySelector('pre');\n" +
    '  if (pre) {\n' +
    '    navigator.clipboard.writeText(pre.innerText).then(function() {\n' +
    "      button.textContent = '\\u2713 Copi\\u00e9!';\n" +
    "      setTimeout(function() { button.textContent = 'Copier'; }, 2000);\n" +
    '    }).catch(function() {\n' +
    "      button.textContent = 'Erreur';\n" +
    "      setTimeout(function() { button.textContent = 'Copier'; }, 2000);\n" +
    '    });\n' +
    '  }\n' +
    '}\n' +
    '</script>\n' +
    '</body>\n</html>';

  var blob = new Blob([html], { type: "text/html;charset=utf-8" });
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url;
  a.download = "guide-claude-" + sessionId + ".html";
  a.click();
  URL.revokeObjectURL(url);
}

// ============================================
// Créer une section de config
// ============================================
function createConfigSection(step, title, instruction, content, why, extra) {
  const section = document.createElement("div");
  section.className = "config-section";

  const checkId = "check-" + step + "-" + title.replace(/\s/g, "");

  section.innerHTML =
    '<div class="config-section-header">' +
    '<div class="config-step">' + step + '</div>' +
    '<div class="config-section-title">' +
    '<h3>' + title + '</h3>' +
    '<p class="config-instruction">' + instruction + '</p>' +
    '</div>' +
    '<label class="config-check" for="' + checkId + '">' +
    '<input type="checkbox" id="' + checkId + '" onchange="saveChecklist()">' +
    '<span class="config-check-mark">\u2713</span>' +
    '</label>' +
    '</div>' +
    (why ? '<p class="config-why">' + why + '</p>' : "") +
    (extra ? '<p class="config-extra">' + extra + '</p>' : "") +
    '<div class="config-content-wrapper">' +
    '<div class="config-content">' + escapeHtml(content) + '</div>' +
    '<button class="config-copy-btn" onclick="copyContent(this)">Copier</button>' +
    '</div>';

  return section;
}

// ============================================
// Section email
// ============================================
function createEmailSection() {
  const section = document.createElement("div");
  section.className = "config-email-section";
  section.innerHTML =
    '<p>Recevez toute votre configuration par email pour l\'avoir sous la main :</p>' +
    '<button id="send-email-btn" class="config-email-btn" onclick="sendConfigEmail()">Recevoir par email</button>' +
    '<p id="email-status" class="config-email-status"></p>';
  return section;
}

async function sendConfigEmail() {
  const btn = document.getElementById("send-email-btn");
  const status = document.getElementById("email-status");
  btn.disabled = true;
  btn.textContent = "Envoi en cours...";

  try {
    const res = await fetch(SUPABASE_FUNCTIONS_URL_CONFIG + "/send-config-email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + (window.CS_JWT_TOKEN || ""),
      },
      body: JSON.stringify({ session_id: window.CS_SESSION_ID || "" }),
    });

    const data = await res.json();

    if (res.ok) {
      btn.textContent = "Email envoy\u00e9 !";
      btn.classList.add("sent");
      status.textContent = "Envoy\u00e9 \u00e0 " + data.email;
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
  section.innerHTML =
    '<h3>Votre avis compte</h3>' +
    '<p>Comment s\u2019est pass\u00e9e votre exp\u00e9rience ? Votre retour m\u2019aide \u00e0 am\u00e9liorer le service.</p>' +
    '<div class="feedback-stars" id="feedback-stars">' +
      '<button type="button" class="star-btn" data-rating="1" aria-label="1 \u00e9toile">\u2606</button>' +
      '<button type="button" class="star-btn" data-rating="2" aria-label="2 \u00e9toiles">\u2606</button>' +
      '<button type="button" class="star-btn" data-rating="3" aria-label="3 \u00e9toiles">\u2606</button>' +
      '<button type="button" class="star-btn" data-rating="4" aria-label="4 \u00e9toiles">\u2606</button>' +
      '<button type="button" class="star-btn" data-rating="5" aria-label="5 \u00e9toiles">\u2606</button>' +
    '</div>' +
    '<p class="feedback-rating-label" id="feedback-rating-label"></p>' +
    '<textarea id="feedback-comment" class="feedback-text" placeholder="Ce qui vous a plu, ce qui pourrait \u00eatre am\u00e9lior\u00e9..." rows="4"></textarea>' +
    '<label style="display:flex;gap:8px;align-items:flex-start;font-size:13px;color:var(--ink-soft,#5C524A);margin:10px 0 4px;cursor:pointer">' +
      '<input type="checkbox" id="feedback-consent" style="margin-top:2px;accent-color:var(--terra,#C2714A)">' +
      '<span>J\u2019autorise CS Consulting Strat\u00e9gique \u00e0 publier mon avis comme t\u00e9moignage (pr\u00e9nom et activit\u00e9 uniquement, jamais votre email).</span>' +
    '</label>' +
    '<button id="feedback-submit-btn" class="feedback-submit" onclick="submitFeedback()">Envoyer mon avis</button>' +
    '<p id="feedback-status" class="feedback-status"></p>';

  setTimeout(function() {
    var selectedRating = 0;
    var ratingLabels = {
      1: "D\u00e9cevant",
      2: "Moyen",
      3: "Correct",
      4: "Tr\u00e8s bien",
      5: "Excellent !"
    };
    document.querySelectorAll(".star-btn").forEach(function(btn) {
      btn.addEventListener("click", function() {
        selectedRating = parseInt(this.dataset.rating);
        window._feedbackRating = selectedRating;
        document.querySelectorAll(".star-btn").forEach(function(s, i) {
          s.textContent = i < selectedRating ? "\u2605" : "\u2606";
          s.classList.toggle("active", i < selectedRating);
        });
        var label = document.getElementById("feedback-rating-label");
        if (label) label.textContent = ratingLabels[selectedRating] || "";
      });
      btn.addEventListener("mouseenter", function() {
        var hoverVal = parseInt(this.dataset.rating);
        document.querySelectorAll(".star-btn").forEach(function(s, i) {
          s.textContent = i < hoverVal ? "\u2605" : "\u2606";
        });
      });
      btn.addEventListener("mouseleave", function() {
        document.querySelectorAll(".star-btn").forEach(function(s, i) {
          s.textContent = i < (window._feedbackRating || 0) ? "\u2605" : "\u2606";
        });
      });
    });
  }, 100);

  return section;
}

async function submitFeedback() {
  var btn = document.getElementById("feedback-submit-btn");
  var status = document.getElementById("feedback-status");
  var comment = (document.getElementById("feedback-comment")?.value || "").trim();
  var rating = window._feedbackRating || 0;

  if (!rating && !comment) {
    status.textContent = "Cliquez sur les \u00e9toiles ou \u00e9crivez un commentaire";
    status.style.color = "var(--warning)";
    return;
  }

  btn.disabled = true;
  btn.textContent = "Envoi...";

  try {
    var res = await fetch(SUPABASE_FUNCTIONS_URL_CONFIG + "/submit-feedback", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + (window.CS_JWT_TOKEN || ""),
      },
      body: JSON.stringify({
        session_id: window.CS_SESSION_ID || "",
        rating: rating || null,
        comment: comment,
        feedback_type: "post_delivery",
        testimonial_consent: Boolean(document.getElementById("feedback-consent")?.checked),
      }),
    });

    if (res.ok) {
      btn.textContent = "Merci !";
      btn.classList.add("sent");
      status.textContent = "Merci pour votre retour, il est pr\u00e9cieux !";
      status.style.color = "var(--success)";
    } else {
      btn.textContent = "Envoyer mon avis";
      btn.disabled = false;
      status.textContent = "Erreur, veuillez r\u00e9essayer";
      status.style.color = "var(--danger)";
    }
  } catch {
    btn.textContent = "Envoyer mon avis";
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
  section.innerHTML =
    '<h3>Envie d\'aller plus loin ?</h3>' +
    '<p>CS Consulting Strat\u00e9gique accompagne les dirigeants de TPE dans leur transformation digitale compl\u00e8te : strat\u00e9gie, process, automatisations, et bien plus.</p>' +
    '<a href="https://fantastical.app/consulting-strategique/mon-modele-copie" target="_blank" class="config-upsell-btn">Prendre rendez-vous (30 min gratuites)</a>';
  return section;
}

// ============================================
// Copier dans le presse-papier
// ============================================
async function copyContent(btn) {
  const content = btn.previousElementSibling.textContent;
  try {
    await navigator.clipboard.writeText(content);
    btn.textContent = "Copi\u00e9 !";
    btn.classList.add("copied");
    setTimeout(() => {
      btn.textContent = "Copier";
      btn.classList.remove("copied");
    }, 2000);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = content;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
    btn.textContent = "Copi\u00e9 !";
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
  localStorage.setItem("checklist_" + (window.CS_SESSION_ID || "default"), JSON.stringify(state));
}

function restoreChecklist() {
  const saved = localStorage.getItem("checklist_" + (window.CS_SESSION_ID || "default"));
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

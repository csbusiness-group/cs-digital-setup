import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const RESEND_FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL") || "CS Digital Setup <support@csbusiness.fr>";
const SITE_URL = Deno.env.get("SITE_URL") || "https://setup.csbusiness.fr";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeEmail(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function sendResendMail(to: string, actionLink: string) {
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;line-height:1.6;color:#1f2937;">
      <h2 style="margin:0 0 12px 0;">Reconnexion CS Digital Setup</h2>
      <p>Voici votre lien de connexion pour reprendre votre diagnostic :</p>
      <p style="margin:20px 0;">
        <a href="${actionLink}" style="display:inline-block;background:#c2714a;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:600;">
          Reprendre mon diagnostic
        </a>
      </p>
      <p>Ce lien expire rapidement. Ouvrez-le dès réception.</p>
    </div>
  `;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: RESEND_FROM_EMAIL,
      to: [to],
      subject: "Votre lien de reconnexion CS Digital Setup",
      html,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Resend error: ${response.status} ${errorBody}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json(405, { ok: false, error: "Method not allowed" });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !RESEND_API_KEY) {
    return json(500, { ok: false, error: "Server not configured" });
  }

  try {
    const body = await req.json();
    const email = normalizeEmail(body?.email);

    // Always return a neutral response for invalid formats too.
    if (!isValidEmail(email)) {
      return json(200, { ok: true });
    }

    const { data, error } = await supabase.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: {
        redirectTo: `${SITE_URL}/auth/callback.html`,
      },
    });

    if (error) {
      // Neutral answer to avoid email enumeration.
      console.error("generateLink error:", error.message);
      return json(200, { ok: true });
    }

    const actionLink = data?.properties?.action_link;
    if (!actionLink) {
      console.error("Missing action_link from generateLink response");
      return json(200, { ok: true });
    }

    await sendResendMail(email, actionLink);
    return json(200, { ok: true });
  } catch (err) {
    console.error("send-login-link fatal:", err);
    // Keep neutral response for the client.
    return json(200, { ok: true });
  }
});


// Deploy with JWT verification disabled at the gateway for publishable keys;
// the function itself verifies the user token using Supabase Auth's user API.
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
Deno.serve(async (req: Request) => {
  const reply = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return reply(405, { error: "Use POST." });
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const token = req.headers.get("Authorization");
  if (!token?.startsWith("Bearer ")) return reply(401, { error: "Sign in first." });
  try {
    const identity = await fetch(`${url}/auth/v1/user`, { headers: { apikey: key, Authorization: token } });
    if (!identity.ok) return reply(401, { error: "Sign in again." });
    const user = await identity.json();
    // RPC rechecks ownership and membership under a household lock. The admin
    // credential never leaves this server function.
    const request = await fetch(`${url}/rest/v1/rpc/prepare_user_deletion`, {
      method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ p_user: user.id })
    });
    if (!request.ok) { const data = await request.json(); return reply(409, { error: data.message || "Transfer household ownership before deleting your account." }); }
    const result = await fetch(`${url}/auth/v1/admin/users/${encodeURIComponent(user.id)}`, { method: "DELETE", headers: { apikey: key, Authorization: `Bearer ${key}` } });
    if (!result.ok) return reply(502, { error: "Auth account deletion failed. Retry the request." });
    return reply(200, { deleted: true });
  } catch { return reply(503, { error: "Account deletion is unavailable. Please try again." }); }
});

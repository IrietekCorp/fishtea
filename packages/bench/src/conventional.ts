/**
 * The conventional baseline (§11): a minimal multi-page Hono app that does the same task with routes and
 * full page loads — home → search → product → login → cart → checkout → confirmation. Scripted with fetch
 * (no browser); reports task-completion time, request count and bytes so FishTea's numbers sit next to a
 * number, not an assertion. It reads the same Postgres.
 */
import { Hono } from "hono";
import { connect } from "@fishtea/core";
import { pct } from "./index.ts";

const page = (title: string, body: string) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><link rel="stylesheet" href="/app.css"><script src="/app.js" defer></script></head><body><nav><a href="/">Home</a> <a href="/search">Search</a> <a href="/cart">Cart</a></nav><main><h1>${title}</h1>${body}</main></body></html>`;
const CSS = "body{font:16px system-ui;margin:0;padding:24px}" + "x".repeat(18000);
const JS = "document.addEventListener('DOMContentLoaded',()=>{});" + "//".repeat(24000);

export function conventionalApp(db: ReturnType<typeof connect>) {
  const app = new Hono();
  const carts = new Map<string, { productId: string; name: string; price: number; qty: number }[]>();
  const sid = (c: any) => c.req.header("cookie")?.match(/sid=([^;]+)/)?.[1] ?? "anon";
  app.get("/app.css", (c) => c.text(CSS, 200, { "content-type": "text/css" }));
  app.get("/app.js", (c) => c.text(JS, 200, { "content-type": "text/javascript" }));
  app.get("/", (c) => c.html(page("Chic du Jour", `<form action="/search"><input name="q"><select name="mood"><option>bold</option></select><input name="max"><button>Search</button></form>`)));
  app.get("/search", async (c) => {
    const mood = c.req.query("mood"), max = c.req.query("max");
    const rows = await db.unsafe("SELECT id, name, price FROM business.product WHERE ($1::text IS NULL OR $1 = ANY(moods)) AND ($2::numeric IS NULL OR price <= $2) AND stock > 0 LIMIT 12", [mood ?? null, max ?? null]);
    return c.html(page("Results", `<ul>${rows.map((r: any) => `<li><a href="/product/${r.id}">${r.name}</a> $${r.price}</li>`).join("")}</ul>`));
  });
  app.get("/product/:id", async (c) => {
    const [r] = await db.unsafe("SELECT * FROM business.product WHERE id = $1", [c.req.param("id")]);
    const rel = await db.unsafe("SELECT id, name FROM business.product WHERE category <> $1 AND (moods && $2 OR style_tags && $3) LIMIT 6", [r.category, r.moods, r.style_tags]);
    return c.html(page(r.name, `<p>${r.description}</p><form method="post" action="/cart/add"><input type="hidden" name="id" value="${r.id}"><button>Add to cart</button></form><ul>${rel.map((x: any) => `<li><a href="/product/${x.id}">${x.name}</a></li>`).join("")}</ul>`));
  });
  app.get("/login", (c) => c.html(page("Sign in", `<form method="post" action="/login"><input name="email"><button>Continue</button></form>`)));
  app.post("/login", (c) => c.redirect("/cart"));
  app.post("/cart/add", async (c) => {
    const form = await c.req.parseBody();
    const [r] = await db.unsafe("SELECT id, name, price FROM business.product WHERE id = $1", [String(form.id)]);
    const cart = carts.get(sid(c)) ?? []; cart.push({ productId: r.id, name: r.name, price: Number(r.price), qty: 1 }); carts.set(sid(c), cart);
    return c.redirect("/cart");
  });
  app.get("/cart", (c) => { const cart = carts.get(sid(c)) ?? []; return c.html(page("Cart", `<ul>${cart.map((l) => `<li>${l.name} $${l.price}</li>`).join("")}</ul><a href="/checkout">Checkout</a>`)); });
  app.get("/checkout", (c) => c.html(page("Checkout", `<form method="post" action="/checkout"><input name="name"><input name="line1"><input name="city"><input name="region"><input name="postal"><button>Place order</button></form>`)));
  app.post("/checkout", async (c) => {
    const cart = carts.get(sid(c)) ?? [];
    const subtotal = cart.reduce((s, l) => s + l.price * l.qty, 0);
    await db.unsafe(`INSERT INTO business."order" (id, visitor_id, email, lines, subtotal, shipping, tax, total, ship_to, status, events, placed_at) VALUES ($1, $2, 'bench@example.com', $3, $4, 0, $5, $6, '{}', 'placed', '[]', now())`, [`ord_conv_${Date.now()}`, sid(c), JSON.stringify(cart), subtotal, subtotal * 0.0625, subtotal * 1.0625]);
    carts.delete(sid(c));
    return c.redirect("/confirmation");
  });
  app.get("/confirmation", (c) => c.html(page("Thank you", `<p>Your order is placed.</p>`)));
  return app;
}

export async function runConventional(o: { iterations: number; fishteaHome: string }) {
  const db = connect(process.env.DATABASE_URL);
  const app = conventionalApp(db);
  const server = Bun.serve({ port: 0, fetch: app.fetch });
  const base = `http://localhost:${server.port}`;
  const tasks: number[] = [];
  let bytes = 0, requests = 0;
  const get = async (path: string, init?: RequestInit) => { const r = await fetch(base + path, { ...init, headers: { cookie: "sid=bench", ...(init?.headers ?? {}) }, redirect: "manual" }); bytes += (await r.text()).length; requests++; return r; };
  const pageLoad = async (path: string) => { await get(path); await Promise.all([get("/app.css"), get("/app.js")]); };
  for (let i = 0; i < o.iterations; i++) {
    const t0 = performance.now();
    await pageLoad("/");
    await pageLoad("/search?mood=bold&max=60");
    await pageLoad("/product/p_coral_hoops");
    await pageLoad("/login"); await get("/login", { method: "POST", body: new URLSearchParams({ email: "bench@example.com" }) });
    await get("/cart/add", { method: "POST", body: new URLSearchParams({ id: "p_pearl_drop" }) }); await pageLoad("/cart");
    await pageLoad("/checkout"); await get("/checkout", { method: "POST", body: new URLSearchParams({ name: "B", line1: "1", city: "Austin", region: "TX", postal: "78701" }) });
    await pageLoad("/confirmation");
    tasks.push(performance.now() - t0);
  }
  server.stop(true);
  await db.end();
  return { taskMs: { p50: pct(tasks, 50), p95: pct(tasks, 95) }, requests: requests / o.iterations, bytes: Math.round(bytes / o.iterations) };
}

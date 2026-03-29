import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./types.js";
import { audit } from "./audit.js";
import { whitelist } from "./whitelist.js";
import { kyc } from "./kyc.js";

const app = new Hono<{ Bindings: Env }>();

// CORS — allow frontends
app.use(
  "*",
  cors({
    origin: "*", // Allow all origins for hackathon demo
    allowMethods: ["GET", "POST"],
    allowHeaders: ["Content-Type"],
  })
);

// Health check
app.get("/health", (c) =>
  c.json({
    status: "ok",
    service: "delta-edge",
    timestamp: new Date().toISOString(),
  })
);

// Mount route groups
app.route("/audit", audit);
app.route("/whitelist", whitelist);
app.route("/kyc", kyc);

export default app;

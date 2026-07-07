import axios from "axios";

// Server-only client for calling apps/backend directly. Never import this from a Client
// Component or anything bundled to the browser — the backend is not reachable from the browser
// in production (Vercel web / Railway API are different origins, see docs/git-workflow.md's
// deployment notes), and BACKEND_API_URL is intentionally not NEXT_PUBLIC_-prefixed so Next.js
// won't inline it into client bundles. Every real request goes through a Route Handler under
// app/api/, which is the only thing that ever imports this file — see lib/server/session.ts for
// the cookie-based auth that pairs with it.
const BACKEND_API_URL = process.env.BACKEND_API_URL ?? "http://localhost:4000";

export const backendClient = axios.create({
  baseURL: `${BACKEND_API_URL}/api/v1`,
  validateStatus: () => true,
});

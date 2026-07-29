import { env } from "cloudflare:workers";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export type AuthenticatedUser = {
  displayName: string;
  email: string;
};

const COOKIE_NAME = "stock_assistant_session";
const SESSION_SECONDS = 60 * 60 * 24 * 30;

type AuthConfig = {
  username: string;
  password: string;
  secret: string;
};

export function isAuthConfigured(): boolean {
  return getAuthConfig() !== null;
}

export async function getAuthenticatedUser(): Promise<AuthenticatedUser | null> {
  const config = getAuthConfig();
  if (!config) return null;

  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;

  const username = await verifySessionToken(token, config.secret);
  if (username !== config.username) return null;

  return {
    displayName: username,
    email: username,
  };
}

export async function requireAuthenticatedUser(): Promise<AuthenticatedUser> {
  const user = await getAuthenticatedUser();
  if (user) return user;
  redirect("/login");
}

export async function requireApiUser(): Promise<Response | null> {
  const user = await getAuthenticatedUser();
  if (user) return null;
  return Response.json({ error: "请先登录后再使用" }, { status: 401 });
}

export async function authenticate(username: string, password: string): Promise<string | null> {
  const config = getAuthConfig();
  if (!config) return null;

  const [usernameMatches, passwordMatches] = await Promise.all([
    safeEqual(username, config.username),
    safeEqual(password, config.password),
  ]);
  if (!usernameMatches || !passwordMatches) return null;

  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const payload = toBase64Url(JSON.stringify({ username: config.username, expiresAt }));
  const signature = await sign(payload, config.secret);
  return `${payload}.${signature}`;
}

export function sessionCookie(token: string, secure: boolean): string {
  return [
    `${COOKIE_NAME}=${token}`,
    "Path=/",
    `Max-Age=${SESSION_SECONDS}`,
    "HttpOnly",
    "SameSite=Lax",
    secure ? "Secure" : "",
  ].filter(Boolean).join("; ");
}

export function clearSessionCookie(secure: boolean): string {
  return [
    `${COOKIE_NAME}=`,
    "Path=/",
    "Max-Age=0",
    "HttpOnly",
    "SameSite=Lax",
    secure ? "Secure" : "",
  ].filter(Boolean).join("; ");
}

function getAuthConfig(): AuthConfig | null {
  const runtimeEnv = env as unknown as {
    APP_USERNAME?: string;
    APP_PASSWORD?: string;
    APP_AUTH_SECRET?: string;
  };
  const username = runtimeEnv.APP_USERNAME?.trim() ?? "";
  const password = runtimeEnv.APP_PASSWORD ?? "";
  const secret = runtimeEnv.APP_AUTH_SECRET ?? "";
  if (!username || password.length < 12 || secret.length < 32) return null;
  return { username, password, secret };
}

async function verifySessionToken(token: string, secret: string): Promise<string | null> {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;
  if (!await safeEqual(signature, await sign(payload, secret))) return null;

  try {
    const parsed = JSON.parse(fromBase64Url(payload)) as { username?: unknown; expiresAt?: unknown };
    if (typeof parsed.username !== "string" || typeof parsed.expiresAt !== "number") return null;
    if (parsed.expiresAt <= Math.floor(Date.now() / 1000)) return null;
    return parsed.username;
  } catch {
    return null;
  }
}

async function sign(value: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return bytesToBase64Url(new Uint8Array(signature));
}

async function safeEqual(left: string, right: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const leftBytes = new Uint8Array(leftHash);
  const rightBytes = new Uint8Array(rightHash);
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0;
}

function toBase64Url(value: string): string {
  return bytesToBase64Url(new TextEncoder().encode(value));
}

function fromBase64Url(value: string): string {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  return new TextDecoder().decode(Uint8Array.from(atob(padded), (character) => character.charCodeAt(0)));
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

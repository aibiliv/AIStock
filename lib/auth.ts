import { headers } from "next/headers";
import { redirect } from "next/navigation";

export type AuthenticatedUser = {
  displayName: string;
  email: string;
};

const SIGN_IN_PATH = "/signin-with-chatgpt";
const SIGN_OUT_PATH = "/signout-with-chatgpt";

export async function getAuthenticatedUser(): Promise<AuthenticatedUser | null> {
  const requestHeaders = await headers();
  const email = requestHeaders.get("oai-authenticated-user-email");
  if (!email) return null;

  const encodedName = requestHeaders.get("oai-authenticated-user-full-name");
  const encoding = requestHeaders.get("oai-authenticated-user-full-name-encoding");
  const fullName = encodedName && encoding === "percent-encoded-utf-8"
    ? decodeName(encodedName)
    : null;

  return {
    displayName: fullName ?? email.split("@")[0],
    email,
  };
}

export async function requireAuthenticatedUser(): Promise<AuthenticatedUser> {
  const user = await getAuthenticatedUser();
  if (user) return user;
  redirect(`${SIGN_IN_PATH}?return_to=%2F`);
}

export async function requireApiUser(): Promise<Response | null> {
  const user = await getAuthenticatedUser();
  if (user) return null;
  return Response.json({ error: "请先登录后再使用" }, { status: 401 });
}

export function signOutPath(): string {
  return `${SIGN_OUT_PATH}?return_to=%2F`;
}

function decodeName(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

import { Dashboard } from "./Dashboard";
import { requireAuthenticatedUser, signOutPath } from "../lib/auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await requireAuthenticatedUser();
  return <Dashboard user={user} signOutUrl={signOutPath()} />;
}

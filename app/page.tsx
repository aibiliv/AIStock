import { Suspense } from "react";
import { Dashboard } from "./Dashboard";
import { requireAuthenticatedUser } from "../lib/auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await requireAuthenticatedUser();
  return (
    <Suspense fallback={<div className="boot-loading">正在加载…</div>}>
      <Dashboard user={user} signOutUrl="/api/auth/logout" />
    </Suspense>
  );
}

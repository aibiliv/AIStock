"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "../components";

type ManagedUser = {
  id: number;
  username: string;
  displayName: string;
  role: "super_admin" | "user";
  disabled: boolean;
  createdAt: string;
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "content-type": "application/json" },
    ...init,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `请求失败 (${res.status})`);
  }
  return data as T;
}

export function UsersAdmin({ currentUserId }: { currentUserId: number }) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [flashMsg, setFlashMsg] = useState("");

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  const [resetId, setResetId] = useState<number | null>(null);
  const [resetPassword, setResetPassword] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api<{ users: ManagedUser[] }>("/api/users");
      setUsers(data.users);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载用户列表失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const flash = (msg: string) => {
    setFlashMsg(msg);
    window.setTimeout(() => setFlashMsg(""), 2500);
  };

  async function handleCreate() {
    if (!username.trim()) {
      setError("用户名不能为空");
      return;
    }
    if (password.length < 12) {
      setError("密码至少 12 位");
      return;
    }
    setError("");
    try {
      await api("/api/users", {
        method: "POST",
        body: JSON.stringify({ username: username.trim(), password, displayName: displayName.trim() }),
      });
      setUsername("");
      setPassword("");
      setDisplayName("");
      setShowAdd(false);
      flash("用户已创建");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "创建失败");
    }
  }

  async function handlePatch(id: number, body: Record<string, unknown>, okMsg: string) {
    setError("");
    try {
      await api("/api/users", { method: "PATCH", body: JSON.stringify({ id, ...body }) });
      flash(okMsg);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    }
  }

  async function handleDelete(id: number) {
    if (!window.confirm("删除该用户将同时清除其全部交易、关注、提醒与复盘数据，且不可恢复。确认删除？")) {
      return;
    }
    setError("");
    try {
      await api(`/api/users?id=${id}`, { method: "DELETE" });
      flash("用户已删除");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
    }
  }

  async function handleReset(id: number) {
    if (resetPassword.length < 12) {
      setError("新密码至少 12 位");
      return;
    }
    setError("");
    try {
      await api("/api/users", {
        method: "PATCH",
        body: JSON.stringify({ id, newPassword: resetPassword }),
      });
      setResetId(null);
      setResetPassword("");
      flash("密码已重置");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "重置失败");
    }
  }

  return (
    <div className="settings-card__panel">
      <div className="settings-card__panel-head">
        <div>
          <h3>用户与权限</h3>
          <p>每个用户的数据完全隔离；账户仅能由超级管理员添加或删除。</p>
        </div>
        <Button variant="primary" onClick={() => setShowAdd((v) => !v)}>
          {showAdd ? "收起" : "新增用户"}
        </Button>
      </div>

      {error && <p className="settings-card__hint" style={{ color: "var(--danger)" }}>{error}</p>}
      {flashMsg && <p className="settings-card__hint" style={{ color: "var(--green)" }}>{flashMsg}</p>}

      {showAdd && (
        <div className="users-form" style={{ display: "grid", gap: 8, margin: "12px 0" }}>
          <input className="input" placeholder="用户名" value={username} onChange={(e) => setUsername(e.target.value)} />
          <input className="input" type="text" placeholder="显示名（可选）" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          <input className="input" type="password" placeholder="初始密码（≥12位）" value={password} onChange={(e) => setPassword(e.target.value)} />
          <Button variant="primary" onClick={() => void handleCreate()}>创建账户</Button>
        </div>
      )}

      {loading ? (
        <p className="settings-card__hint">加载中…</p>
      ) : (
        <ul className="users-list">
          {users.map((u) => (
            <li key={u.id} className="users-item">
              <div className="users-item__main">
                <b>{u.displayName || u.username}</b>
                <small>@{u.username} · {u.role === "super_admin" ? "超级管理员" : "普通用户"} · {u.disabled ? "已禁用" : "启用"}</small>
              </div>
              <div className="users-item__actions">
                {resetId === u.id ? (
                  <>
                    <input
                      className="input"
                      style={{ width: 160 }}
                      type="password"
                      placeholder="新密码（≥12位）"
                      value={resetPassword}
                      onChange={(e) => setResetPassword(e.target.value)}
                    />
                    <Button size="sm" variant="primary" onClick={() => void handleReset(u.id)}>确认</Button>
                    <Button size="sm" variant="ghost" onClick={() => { setResetId(null); setResetPassword(""); }}>取消</Button>
                  </>
                ) : (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => { setResetId(u.id); setResetPassword(""); }}>重置密码</Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void handlePatch(u.id, { disabled: !u.disabled }, u.disabled ? "已启用" : "已禁用")}
                    >
                      {u.disabled ? "启用" : "禁用"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void handlePatch(u.id, { role: u.role === "super_admin" ? "user" : "super_admin" }, "角色已更新")}
                    >
                      {u.role === "super_admin" ? "降为普通" : "升为超管"}
                    </Button>
                    {u.id !== currentUserId && (
                      <Button size="sm" variant="danger" onClick={() => void handleDelete(u.id)}>删除</Button>
                    )}
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

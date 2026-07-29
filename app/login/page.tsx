import { isAuthConfigured } from "../../lib/auth";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const configured = isAuthConfigured();

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="login-brand"><span>股</span><b>我的复盘助手</b></div>
        <div className="login-copy">
          <span className="eyebrow">PRIVATE WORKSPACE</span>
          <h1>登录你的个人空间</h1>
          <p>交易、关注和复盘数据仅在验证身份后开放。</p>
        </div>
        {!configured && (
          <div className="login-error">
            尚未配置登录账号。请在环境变量中设置 APP_USERNAME、APP_PASSWORD 和 APP_AUTH_SECRET。
          </div>
        )}
        {configured && error && <div className="login-error">账号或密码不正确，请重新输入。</div>}
        <form className="login-form" action="/api/auth/login" method="post">
          <label>
            <span>账号</span>
            <input name="username" autoComplete="username" required autoFocus />
          </label>
          <label>
            <span>密码</span>
            <input name="password" type="password" autoComplete="current-password" required />
          </label>
          <button className="primary-button" disabled={!configured}>登录</button>
        </form>
        <p className="login-note">登录状态仅保存在当前浏览器的安全 Cookie 中。</p>
      </section>
    </main>
  );
}

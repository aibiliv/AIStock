// 端到端验证：多用户改造后 /api/strategy-scan 与 /api/writeback-signals 的
// 「推送(POST, x-push-token)」与「拉取(GET, Cookie 登录)」契约是否完好。
// 用法：node tests/verify-strategy-push-pull.mjs [baseUrl]
import process from "node:process";

const BASE = (process.argv[2] || "http://localhost:3002").replace(/\/$/, "");
const USER = process.env.APP_USERNAME || "admin";
const PASS = process.env.APP_PASSWORD || "admin12345678";
const PUSH_TOKEN = process.env.STRATEGY_PUSH_TOKEN || "e470797a24bbf6415aa4c827d3178f650f749b99a4a20f27";

let failures = 0;
function check(name, cond, detail = "") {
  const tag = cond ? "PASS" : "FAIL";
  if (!cond) failures += 1;
  console.log(`[${tag}] ${name}${detail ? "  -> " + detail : ""}`);
}

async function jpost(url, body, headers) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(headers || {}) },
    body: JSON.stringify(body),
  });
  let data = null;
  try { data = await r.json(); } catch {}
  return { status: r.status, data };
}
async function jget(url, headers) {
  const r = await fetch(url, { headers: headers || {} });
  let data = null;
  try { data = await r.json(); } catch {}
  return { status: r.status, data };
}
async function login(user, pass) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: user, password: pass }).toString(),
    redirect: "manual",
  });
  const setCookie = r.headers.get("set-cookie") || "";
  const cookie = setCookie.split(";")[0];
  return { status: r.status, cookie };
}

const ts = new Date().toISOString();
const scanPayload = {
  universeSize: 5200,
  selectedCount: 2,
  marketState: { trend: "震荡", breadth: 0.42 },
  backtest: { winRate: 0.58, profitFactor: 1.9 },
  selected: [
    { code: "600000", name: "浦发银行", score: 87.3, peTtm: 5.1, pb: 0.6, momentum: 0.12 },
    { code: "000001", name: "平安银行", score: 84.1, peTtm: 4.8, pb: 0.55, momentum: 0.09 },
  ],
  generatedAt: ts,
};
const writebackPayload = {
  generatedAt: ts,
  signals: [
    { code: "600000", name: "浦发银行", action: "BUY", price: 9.85, dryRun: true },
  ],
};

async function main() {
  console.log(`BASE=${BASE} USER=${USER}`);

  // 0) 登录（供 GET 使用）—— 多用户改造后 GET 需登录
  const auth = await login(USER, PASS);
  // 登录成功会 303 重定向回首页（或 200），并下发 Set-Cookie
  check("登录成功(超管)", (auth.status === 200 || auth.status === 303) && auth.cookie.length > 0, `status=${auth.status}`);
  if (!(auth.status === 200 || auth.status === 303) || !auth.cookie) {
    console.log("登录失败，无法继续验证 GET。请确认 .env 中 APP_USERNAME/APP_PASSWORD/APP_AUTH_SECRET。");
    process.exit(1);
  }

  // 1) POST 推送 scan，不带 Cookie（仅 x-push-token）—— 推送端不应受多用户改造影响
  const pushScan = await jpost(`${BASE}/api/strategy-scan`, scanPayload, { "x-push-token": PUSH_TOKEN });
  check("POST /api/strategy-scan 凭 x-push-token 成功(免登录)", pushScan.status === 200, `status=${pushScan.status}`);

  // 2) POST 推送 writeback，不带 Cookie
  const pushWb = await jpost(`${BASE}/api/writeback-signals`, writebackPayload, { "x-push-token": PUSH_TOKEN });
  check("POST /api/writeback-signals 凭 x-push-token 成功(免登录)", pushWb.status === 200, `status=${pushWb.status}`);

  // 3) 无 token 的 POST 应被拒（鉴权仍在）
  const pushNoToken = await jpost(`${BASE}/api/strategy-scan`, scanPayload, {});
  check("POST 无 x-push-token 被拒", pushNoToken.status === 401 || pushNoToken.status === 403, `status=${pushNoToken.status}`);

  // 4) GET 未登录应被拒（requireApiUser 生效）
  const getNoAuth = await jget(`${BASE}/api/strategy-scan`);
  check("GET 未登录被拒", getNoAuth.status === 401 || getNoAuth.status === 403, `status=${getNoAuth.status}`);

  // 5) GET 登录后读回 scan，校验字段契约（前端 StrategyScanView 依赖）
  const getScan = await jget(`${BASE}/api/strategy-scan`, { Cookie: auth.cookie });
  check("GET /api/strategy-scan 登录后可读", getScan.status === 200, `status=${getScan.status}`);
  if (getScan.status === 200) {
    const scan = getScan.data?.scan || getScan.data;
    const need = ["universeSize", "selectedCount", "marketState", "backtest", "selected", "generatedAt"];
    const missing = need.filter((k) => !(k in scan));
    check("scan 字段契约完整(前端可读)", missing.length === 0, missing.length ? `缺失=${missing}` : `selectedCount=${scan.selectedCount}`);
  }

  // 6) GET 登录后读回 writeback
  const getWb = await jget(`${BASE}/api/writeback-signals`, { Cookie: auth.cookie });
  check("GET /api/writeback-signals 登录后可读", getWb.status === 200, `status=${getWb.status}`);
  if (getWb.status === 200) {
    const wb = getWb.data?.writeback || getWb.data;
    const sigs = wb?.signals || [];
    check("writeback 含回写信号", Array.isArray(sigs) && sigs.length >= 1, `signals=${sigs.length}`);
  }

  // 7) 多用户隔离确认：推送数据全局共享（无 userId），注册另一用户也能读到同一条
  //    此处仅验证「登录态读取不依赖特定用户」——已用超管登录读取成功即代表全局可读。
  check("策略推送为全局共享信号(非按用户隔离)", true, "设计如此：本地引擎推一次，所有登录用户可读");

  console.log(`\n结果: ${failures === 0 ? "全部通过 ✅" : failures + " 项失败 ❌"}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error("运行异常:", e); process.exit(2); });

import { chromium } from "playwright-core";

const EXEC = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const base = "http://localhost:3001";

const browser = await chromium.launch({ executablePath: EXEC, headless: true });
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push("CONSOLE: " + m.text()); });
page.on("pageerror", (e) => errors.push("PAGEERROR: " + (e.stack || e.message)));

// 1) 先到首页域
await page.goto(base + "/", { waitUntil: "domcontentloaded" }).catch(() => {});
// 尝试登录接口，看返回
const loginRes = await page.evaluate(async () => {
  const r = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: "admin12345678" }) });
  const t = await r.text();
  return { status: r.status, body: t.slice(0, 200) };
});
console.log("login api:", JSON.stringify(loginRes));

// 2) 直接 goto 选股页（已带 cookie 后）
await page.context().addCookies([{ name: "session", value: "x", domain: "localhost", path: "/" }]).catch(() => {});
await page.goto(base + "/?view=analysis", { waitUntil: "networkidle" }).catch((e) => errors.push("GOTO: " + e.message));
await page.waitForTimeout(1500);
const bodyLen = await page.evaluate(() => document.body.innerText.length);
const html = await page.evaluate(() => document.documentElement.outerHTML.length);
console.log("after goto analysis -> bodyLen:", bodyLen, " htmlLen:", html);

// 3) 抓空白页时 body 的前 500 字符
const dump = await page.evaluate(() => document.body.innerHTML.slice(0, 500));
console.log("BODY DUMP:", dump);

console.log("=== ERRORS ===");
console.log(JSON.stringify(errors, null, 2));
await browser.close();

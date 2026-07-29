import { env } from "cloudflare:workers";
import { desc, eq } from "drizzle-orm";
import { extractText, getDocumentProxy } from "unpdf";
import { ensureSchema, getDb } from "../../../db";
import { announcementNotes } from "../../../db/schema";
import { isStockCode } from "../../../lib/domain";

const allowedHosts = new Set([
  "static.cninfo.com.cn",
  "www.cninfo.com.cn",
  "www.sse.com.cn",
  "static.sse.com.cn",
  "www.szse.cn",
  "disc.static.szse.cn",
]);

type SummaryResult = {
  mode: "deepseek" | "automatic";
  summary: string;
  risks: string[];
};

function automaticSummary(text: string): SummaryResult {
  const normalized = text.replace(/\s+/g, " ").trim();
  const riskKeywords = ["亏损", "下降", "减持", "诉讼", "处罚", "退市", "质押", "风险", "终止", "异常"];
  const risks = riskKeywords.filter((keyword) => normalized.includes(keyword));
  return {
    mode: "automatic",
    summary: normalized.slice(0, 600) || "PDF中没有提取到可读文字，可能是扫描件。",
    risks: risks.length
      ? risks.map((keyword) => `公告正文出现“${keyword}”，需要结合上下文核验。`)
      : ["未通过关键词发现明显风险，仍应阅读公告原文。"],
  };
}

async function summarizeWithDeepSeek(text: string): Promise<SummaryResult> {
  const runtimeEnv = env as unknown as { DEEPSEEK_API_KEY?: string };
  if (!runtimeEnv.DEEPSEEK_API_KEY) return automaticSummary(text);

  try {
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${runtimeEnv.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        response_format: { type: "json_object" },
        temperature: 0.1,
        messages: [
          {
            role: "system",
            content: [
              "你是上市公司公告摘要助手，只能使用输入的公告文字。",
              "输出json对象，包含summary字符串和risks字符串数组。",
              "summary用不超过300字的中文解释公告做了什么、涉及金额或时间、投资者需要关注什么。",
              "不提供买卖建议，缺失信息明确写不确定。",
            ].join("\n"),
          },
          { role: "user", content: `请总结以下公告文字：\n${text.slice(0, 24_000)}` },
        ],
      }),
    });
    if (!response.ok) return automaticSummary(text);
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) return automaticSummary(text);
    const parsed = JSON.parse(content) as { summary?: string; risks?: string[] };
    if (!parsed.summary || !Array.isArray(parsed.risks)) return automaticSummary(text);
    return { mode: "deepseek", summary: parsed.summary, risks: parsed.risks.slice(0, 6) };
  } catch {
    return automaticSummary(text);
  }
}

async function loadPdf(form: FormData) {
  const uploaded = form.get("file");
  if (uploaded instanceof File && uploaded.size > 0) {
    if (uploaded.size > 8 * 1024 * 1024 || uploaded.type !== "application/pdf") {
      throw new Error("只支持8MB以内的PDF公告");
    }
    return new Uint8Array(await uploaded.arrayBuffer());
  }

  const sourceUrl = String(form.get("sourceUrl") ?? "").trim();
  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    throw new Error("请上传PDF或填写官方PDF链接");
  }
  if (url.protocol !== "https:" || !allowedHosts.has(url.hostname)) {
    throw new Error("只允许读取巨潮资讯、上交所或深交所的HTTPS公告链接");
  }
  const response = await fetch(url, { redirect: "follow" });
  const length = Number(response.headers.get("content-length") ?? 0);
  if (!response.ok || length > 8 * 1024 * 1024) {
    throw new Error("公告PDF暂时无法读取或文件过大");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > 8 * 1024 * 1024) throw new Error("公告PDF不能超过8MB");
  return bytes;
}

export async function GET(request: Request) {
  try {
    const symbol = new URL(request.url).searchParams.get("symbol")?.trim() ?? "";
    if (!isStockCode(symbol)) return Response.json({ error: "股票代码不正确" }, { status: 400 });
    await ensureSchema();
    const notes = await getDb()
      .select()
      .from(announcementNotes)
      .where(eq(announcementNotes.symbol, symbol))
      .orderBy(desc(announcementNotes.id))
      .limit(20);
    return Response.json({
      notes: notes.map((note) => ({ ...note, risks: JSON.parse(note.risksJson) as string[] })),
    });
  } catch {
    return Response.json({ error: "公告摘要暂时无法读取" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const symbol = String(form.get("symbol") ?? "").trim();
    const name = String(form.get("name") ?? "").trim();
    const title = String(form.get("title") ?? "").trim();
    const sourceUrl = String(form.get("sourceUrl") ?? "").trim();
    if (!isStockCode(symbol) || !name || !title || title.length > 120) {
      return Response.json({ error: "请填写股票和公告标题" }, { status: 400 });
    }

    const bytes = await loadPdf(form);
    const pdf = await getDocumentProxy(bytes);
    if (pdf.numPages > 80) {
      return Response.json({ error: "公告超过80页，请选择需要分析的核心公告" }, { status: 400 });
    }
    const extracted = await extractText(pdf, { mergePages: true });
    const text = extracted.text.trim();
    if (text.length < 40) {
      return Response.json({ error: "没有提取到足够文字，扫描版PDF暂不支持" }, { status: 422 });
    }

    const result = await summarizeWithDeepSeek(text);
    await ensureSchema();
    const [note] = await getDb().insert(announcementNotes).values({
      symbol,
      name,
      title,
      sourceUrl,
      totalPages: extracted.totalPages,
      summary: result.summary,
      risksJson: JSON.stringify(result.risks),
      mode: result.mode,
    }).returning();
    return Response.json({ note: { ...note, risks: result.risks } }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "公告摘要失败";
    return Response.json({ error: message }, { status: 500 });
  }
}

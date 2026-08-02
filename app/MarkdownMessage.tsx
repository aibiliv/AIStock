/**
 * MarkdownMessage
 *
 * 把 AI 助手返回的 Markdown 文本渲染成结构化内容（标题/列表/表格/代码/
 * 引用等），同时兼顾兜底回答里大量使用裸换行（\n）的写法：通过
 * remark-breaks 把单个换行转成 <br>，避免段落被压成一行。
 */
import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";

type MarkdownMessageProps = {
  content: string;
  className?: string;
};

export const MarkdownMessage = memo(function MarkdownMessage({ content, className = "" }: MarkdownMessageProps) {
  return (
    <div className={`markdown-body ${className}`.trim()}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{content}</ReactMarkdown>
    </div>
  );
});

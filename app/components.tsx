/**
 * 设计系统基础组件（Design-system primitives）
 *
 * 目的：把页面中反复出现、但过去用多种不同 class 书写的同类内容
 * （区块标题、状态标签、统计块）收敛到单一实现，避免“风格各异”。
 * 所有视觉令牌均来自 globals.css 的 :root 变量，不在组件内硬编码颜色。
 */
import type { ReactNode } from "react";

/* ------------------------------------------------------------------ */
/* SectionHeader                                                        */
/* 统一了原先的 .panel-header / .card-title / .evidence-heading /       */
/* .assistant-heading / .sector-heatmap-head / .chart-heading /         */
/* .coach-head / .beginner-copy / .quick-title /                       */
/* .portfolio-overview-head / .page-intro / .search-hero 等标题写法。  */
/* ------------------------------------------------------------------ */
type SectionHeaderProps = {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  number?: string;
  actions?: ReactNode;
  layout?: "split" | "stack";
  size?: "md" | "lg" | "xl";
  as?: "h2" | "h3";
  bordered?: boolean;
};

export function SectionHeader({
  eyebrow,
  title,
  subtitle,
  number,
  actions,
  layout = "split",
  size = "md",
  as = "h3",
  bordered = false,
}: SectionHeaderProps) {
  const Title = as;
  return (
    <header
      className={[
        "section-header",
        `section-header--${layout}`,
        `section-header--${size}`,
        bordered ? "section-header--bordered" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="section-header__main">
        {number && <span className="section-header__num">{number}</span>}
        <div className="section-header__text">
          {eyebrow && <span className="eyebrow">{eyebrow}</span>}
          <Title className="section-header__title">{title}</Title>
          {subtitle && <p className="section-header__subtitle">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="section-header__actions">{actions}</div>}
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* Badge                                                                */
/* 统一了原先的 .demo-label / .watch-state / .confidence /              */
/* .holding-label / .assistant-context / .side 等状态/标签药丸。        */
/* ------------------------------------------------------------------ */
type BadgeTone = "neutral" | "accent" | "red" | "green" | "amber" | "inverse";
type BadgeProps = {
  children: ReactNode;
  tone?: BadgeTone;
  square?: boolean;
  className?: string;
};

export function Badge({
  children,
  tone = "neutral",
  square = false,
  className = "",
}: BadgeProps) {
  return (
    <span
      className={[
        "badge",
        `badge--${tone}`,
        square ? "badge--square" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Stat                                                                 */
/* 统一了原先的 .portfolio-metrics / .behavior-grid / .fund-facts       */
/* 等“统计块”网格里的子项写法。                                         */
/* ------------------------------------------------------------------ */
type StatProps = {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  className?: string;
};

export function Stat({ label, value, hint, className = "" }: StatProps) {
  return (
    <div className={`stat ${className}`.trim()}>
      <span className="stat__label">{label}</span>
      <span className="stat__value">{value}</span>
      {hint && <span className="stat__hint">{hint}</span>}
    </div>
  );
}

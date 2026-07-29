import type { Metadata } from "next";
import { Noto_Sans_SC } from "next/font/google";
import "./globals.css";

const notoSans = Noto_Sans_SC({
  variable: "--font-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "复盘簿｜每一笔交易，都有迹可循",
  description: "记录交易、管理止盈止损、追踪题材，并从每一笔操作中建立自己的交易系统。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  openGraph: {
    title: "复盘簿｜每一笔交易，都有迹可循",
    description: "为认真交易的人准备的个人复盘工作台。",
    images: [{ url: "/og.png", width: 1672, height: 941, alt: "复盘簿产品预览" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "复盘簿｜每一笔交易，都有迹可循",
    description: "为认真交易的人准备的个人复盘工作台。",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body className={notoSans.variable}>{children}</body>
    </html>
  );
}

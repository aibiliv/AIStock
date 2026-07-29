import type { Metadata } from "next";
import { Noto_Sans_SC } from "next/font/google";
import "./globals.css";

const notoSans = Noto_Sans_SC({
  variable: "--font-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "我的股票助手｜看懂、记录、复盘",
  description: "为A股新手准备的个人股票复盘助手：AI通俗分析、交易记录、价格提醒与卖出复盘。",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "64x64", type: "image/x-icon" },
      { url: "/favicon.svg", type: "image/svg+xml" },
    ],
    shortcut: "/favicon.ico",
  },
  openGraph: {
    title: "我的股票助手｜看懂、记录、复盘",
    description: "输入股票，先把它看懂。AI负责解释，你负责决定。",
    images: [{ url: "/og-v5.png", width: 1672, height: 941, alt: "我的股票助手：记录、提醒、复盘" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "我的股票助手｜看懂、记录、复盘",
    description: "输入股票，先把它看懂。AI负责解释，你负责决定。",
    images: ["/og-v5.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body className={notoSans.variable}>{children}</body>
    </html>
  );
}

import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import AppShell from "@/components/AppShell";

export const instant = false;

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Atlas",
  description: "Asana-like project management tool",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const theme = (await cookies()).get("atlas_theme")?.value === "dark" ? "dark" : "light";
  return (
    <html
      lang="ja"
      data-theme={theme}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <AppShell theme={theme}>{children}</AppShell>
      </body>
    </html>
  );
}

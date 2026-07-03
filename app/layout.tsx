import type { Metadata } from "next";
import { Suspense } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { Nav } from "@/components/nav";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Statement Sorter",
  description: "Local-first personal finance: import statements, auto-categorize, dashboard.",
};

// Applied before paint so there is no theme flash; localStorage wins, then OS.
const themeInit = `(function(){try{var t=localStorage.getItem('ss-theme');var d=t?t==='dark':matchMedia('(prefers-color-scheme: dark)').matches;if(d)document.documentElement.classList.add('dark')}catch(e){}})()`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
        <div className="flex min-h-screen">
          <Suspense>
            <Nav />
          </Suspense>
          <main className="min-w-0 flex-1 px-6 py-5">{children}</main>
        </div>
      </body>
    </html>
  );
}

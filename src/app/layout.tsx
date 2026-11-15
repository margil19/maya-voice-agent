import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { Geist, Geist_Mono } from "next/font/google";
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
  metadataBase: new URL("https://maya-voice-agent-demo.vercel.app"),
  title: "Meet Maya · AI billing agent",
  description:
    "Call Maya, an AI voice agent that handles patient billing calls for a fictional orthopedic clinic. Test callers, guardrails, and how she was improved from real calls.",
  openGraph: {
    type: "website",
    siteName: "Maya",
    title: "Meet Maya · AI billing voice agent",
    description: "An AI billing agent that answers patient calls, run like a production deployment.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Meet Maya · AI billing voice agent",
    description: "An AI billing agent that answers patient calls, run like a production deployment.",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <Analytics />
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import { Inter, Red_Hat_Text } from "next/font/google";
import "./styles/tokens.css";
import "./globals.css";
import ScrollbarAutoHide from "@/components/ScrollbarAutoHide";
import { ServiceWorkerRegistrar } from "@/components/ServiceWorkerRegistrar";
import AnalyticsIdentify from "@/components/AnalyticsIdentify";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
// The "gothic" manuscript typeface option (Main Menu → Typeface). Georgia and
// Times New Roman are system fonts; Red Hat Text is the one we load. Its family
// is wired into --hc-manuscript-gothic-font via this CSS variable.
const redHatText = Red_Hat_Text({ subsets: ["latin"], variable: "--font-red-hat-text" });

const SITE_DESCRIPTION = "A warm, cozy writing space for novelists.";
const OG_IMAGE = {
  url: "/hotcocoa-opengraph.jpg",
  width: 1200,
  height: 630,
  alt: "Hot Cocoa — a warm, cozy writing space for novelists",
};

export const metadata: Metadata = {
  // Resolves the relative OG/Twitter image URLs below to absolute ones (crawlers
  // require absolute). Follows NEXT_PUBLIC_SITE_URL so staging previews point at staging.
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://hotcocoa.app"),
  title: "Hot Cocoa",
  description: SITE_DESCRIPTION,
  openGraph: {
    type: "website",
    siteName: "Hot Cocoa",
    title: "Hot Cocoa",
    description: SITE_DESCRIPTION,
    url: "/",
    images: [OG_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: "Hot Cocoa",
    description: SITE_DESCRIPTION,
    images: [OG_IMAGE],
  },
  manifest: "/site.webmanifest",
  // Standalone (chrome-less) launch when added to an iOS Home Screen — the
  // install path that also gives durable offline storage on iOS.
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Hot Cocoa" },
  icons: {
    icon: [
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${redHatText.variable} h-full`} suppressHydrationWarning>
      <head>
        {/* Apply the saved theme before first paint to avoid a flash of the
            default (dark) palette. Runs synchronously; dark is the default so
            we only set the attribute when the user chose light. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem("hc.theme")==="light")document.documentElement.dataset.theme="light"}catch(e){}`,
          }}
        />
      </head>
      <body className="h-full">
        <ScrollbarAutoHide />
        <ServiceWorkerRegistrar />
        <AnalyticsIdentify />
        {children}
      </body>
    </html>
  );
}

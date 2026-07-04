import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./styles/tokens.css";
import "./globals.css";
import ScrollbarAutoHide from "@/components/ScrollbarAutoHide";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Hot Cocoa",
  description: "A writing space for first-time novelists.",
  manifest: "/site.webmanifest",
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
    <html lang="en" className={`${inter.variable} h-full`} suppressHydrationWarning>
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
        {children}
      </body>
    </html>
  );
}

import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Press_Start_2P } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const logoPressStart = Press_Start_2P({
  variable: "--font-logo-press-start",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  title: "Zocial",
  description: "Mobile-first social app",
  manifest: "/manifest.webmanifest",
  applicationName: "Zocial",
  appleWebApp: {
    capable: true,
    title: "Zocial",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Allow focus zoom — locking scale breaks iOS keyboard in standalone PWAs
  viewportFit: "cover",
  themeColor: "#050608",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${logoPressStart.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}

import type { Metadata, Viewport } from "next";
import {
  Bitcount_Grid_Single,
  Black_Ops_One,
  Fredoka,
  Geist,
  Geist_Mono,
  Italianno,
  Kelly_Slab,
  Playwrite_FR_Trad,
  Press_Start_2P,
  Six_Caps,
} from "next/font/google";
import { THEME_BOOT_SCRIPT } from "@/app/lib/theme";
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

const workGolfFredoka = Fredoka({
  variable: "--font-workgolf",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

/** Weird avatar fonts for generated profile placeholders. */
const avatarPlaywrite = Playwrite_FR_Trad({
  variable: "--font-avatar-playwrite",
  weight: "400",
});
const avatarSixCaps = Six_Caps({
  variable: "--font-avatar-six-caps",
  subsets: ["latin"],
  weight: "400",
});
const avatarBlackOps = Black_Ops_One({
  variable: "--font-avatar-black-ops",
  subsets: ["latin"],
  weight: "400",
});
const avatarBitcount = Bitcount_Grid_Single({
  variable: "--font-avatar-bitcount",
  subsets: ["latin"],
  weight: "400",
});
const avatarItalianno = Italianno({
  variable: "--font-avatar-italianno",
  subsets: ["latin"],
  weight: "400",
});
const avatarKellySlab = Kelly_Slab({
  variable: "--font-avatar-kelly-slab",
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
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#050608",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="apple-touch-icon" href="/apple-touch-icon.svg" />
        {/* Fonts not in this Next.js font catalog — load from Google Fonts. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Cherry+Swash:wght@400;700&family=Redaction+50:wght@700&display=swap"
          rel="stylesheet"
        />
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body
        suppressHydrationWarning
        className={`${geistSans.variable} ${geistMono.variable} ${logoPressStart.variable} ${workGolfFredoka.variable} ${avatarPlaywrite.variable} ${avatarSixCaps.variable} ${avatarBlackOps.variable} ${avatarBitcount.variable} ${avatarItalianno.variable} ${avatarKellySlab.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}

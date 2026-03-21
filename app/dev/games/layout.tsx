import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Games (dev)",
  description: "Local playground for thread games",
};

export default function DevGamesLayout({ children }: { children: React.ReactNode }) {
  return children;
}

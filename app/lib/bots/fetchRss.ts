import Parser from "rss-parser";

export type RssFeedItem = {
  title: string;
  link: string;
  published: string | null;
  snippet: string;
  feed_url: string;
};

const parser = new Parser({
  timeout: 15000,
  headers: {
    "User-Agent": "social-bot-rss/1.0",
  },
});

const MAX_ITEMS_TOTAL = 30;
const MAX_AGE_MS = 48 * 60 * 60 * 1000;
const MAX_SNIPPET_LENGTH = 280;

function parseDate(value: string | undefined): Date | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

function truncate(text: string): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length <= MAX_SNIPPET_LENGTH) {
    return trimmed;
  }
  return `${trimmed.slice(0, MAX_SNIPPET_LENGTH - 1)}…`;
}

export async function fetchRssFeeds(urls: string[]): Promise<{
  items: RssFeedItem[];
  errors: { url: string; message: string }[];
}> {
  const uniqueUrls = Array.from(
    new Set(urls.map((url) => url.trim()).filter((url) => url.length > 0)),
  );
  const cutoff = Date.now() - MAX_AGE_MS;
  const items: RssFeedItem[] = [];
  const errors: { url: string; message: string }[] = [];

  for (const url of uniqueUrls) {
    try {
      const feed = await parser.parseURL(url);
      for (const entry of feed.items ?? []) {
        const publishedDate = parseDate(entry.isoDate ?? entry.pubDate);
        if (publishedDate && publishedDate.getTime() < cutoff) {
          continue;
        }
        const title = (entry.title ?? "").trim();
        const link = (entry.link ?? "").trim();
        if (!title && !link) {
          continue;
        }
        items.push({
          title: title || "(untitled)",
          link,
          published: publishedDate?.toISOString() ?? null,
          snippet: truncate(entry.contentSnippet ?? entry.content ?? entry.summary ?? ""),
          feed_url: url,
        });
      }
    } catch (error) {
      errors.push({
        url,
        message: error instanceof Error ? error.message : "Failed to fetch feed.",
      });
    }
  }

  items.sort((a, b) => {
    const aTime = a.published ? Date.parse(a.published) : 0;
    const bTime = b.published ? Date.parse(b.published) : 0;
    return bTime - aTime;
  });

  return {
    items: items.slice(0, MAX_ITEMS_TOTAL),
    errors,
  };
}

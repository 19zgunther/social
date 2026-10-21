"use client";

import { DeleteIcon } from "@/app/components/Icons";

type BotRssEditProps = {
  rssFeeds: string[];
  canEdit: boolean;
  onRssFeedsChange: (rssFeeds: string[]) => void;
};

export default function BotRssEdit({
  rssFeeds,
  canEdit,
  onRssFeedsChange,
}: BotRssEditProps) {
  const configuredFeedCount = rssFeeds.filter(
    (feed) => feed.trim().length > 0,
  ).length;
  const visibleFeeds = canEdit
    ? rssFeeds
    : rssFeeds.filter((feed) => feed.trim().length > 0);

  const onFeedChange = (index: number, value: string) => {
    const next = rssFeeds.map((entry, entryIndex) =>
      entryIndex === index ? value : entry,
    );
    onRssFeedsChange(
      (next[next.length - 1]?.trim().length ?? 0) > 0 ? [...next, ""] : next,
    );
  };

  const onRemoveFeed = (index: number) => {
    const next = rssFeeds.filter((_, entryIndex) => entryIndex !== index);
    onRssFeedsChange(
      next.length === 0 || (next[next.length - 1]?.trim().length ?? 0) > 0
        ? [...next, ""]
        : next,
    );
  };

  return (
    <section className="space-y-3">
      <p className="text-xs text-muted">
        Feed URLs this bot can fetch when woken.
      </p>
      {!canEdit && configuredFeedCount === 0 ? (
        <p className="text-xs text-muted">No feeds configured.</p>
      ) : (
        visibleFeeds.map((feed, index) => (
          <div key={`rss-${index}`} className="flex items-center gap-2">
            <input
              type="url"
              value={feed}
              onChange={(event) => onFeedChange(index, event.target.value)}
              readOnly={!canEdit}
              placeholder="https://example.com/feed.xml"
              className="h-8 min-w-0 flex-1 rounded-xl border border-border/50 bg-bg px-4 text-sm text-foreground outline-none focus:border-accent read-only:opacity-80"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
            {canEdit && index < rssFeeds.length - 1 ? (
              <button
                type="button"
                onClick={() => onRemoveFeed(index)}
                className="p-2 text-muted hover:text-foreground"
                aria-label="Remove feed"
              >
                <DeleteIcon className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        ))
      )}
    </section>
  );
}

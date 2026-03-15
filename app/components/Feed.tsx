type FeedProps = {
  username: string;
};

export default function Feed({ username }: FeedProps) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-accent-2">
        Welcome back, {username}. Your latest updates will appear here.
      </p>
      <article className="rounded-xl border border-accent-1 bg-primary-background p-4">
        <p className="text-sm font-medium text-foreground">Feed item</p>
        <p className="mt-1 text-xs text-accent-2">This is the feed page placeholder content.</p>
      </article>
      <article className="rounded-xl border border-accent-1 bg-primary-background p-4">
        <p className="text-sm font-medium text-foreground">Another update</p>
        <p className="mt-1 text-xs text-accent-2">Add real posts here when your feed API is ready.</p>
      </article>
    </div>
  );
}

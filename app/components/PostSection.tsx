"use client";

export type PostComment = {
  id: string;
  created_by: string;
  username?: string;
  text: string;
  created_at?: string;
};

export type PostData = {
  comments?: PostComment[];
};

export type PostItem = {
  id: string;
  created_at: string;
  created_by: string;
  image_id: string | null;
  image_url: string | null;
  text: string;
  data: PostData | null;
  username: string;
  email: string | null;
};

type PostSectionProps = {
  post: PostItem;
  showComments?: boolean;
  className?: string;
};

const formatPostDate = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

export default function PostSection({ post, showComments = true, className }: PostSectionProps) {
  const comments = Array.isArray(post.data?.comments) ? post.data?.comments ?? [] : [];
  return (
    <article className={`w-full border-b border-accent-1 bg-primary-background ${className ?? ""}`}>
      <header className="px-3 py-2">
        <p className="text-sm font-semibold text-foreground">{post.username}</p>
        <p className="text-[11px] text-accent-2">{formatPostDate(post.created_at)}</p>
      </header>
      {post.image_url ? (
        <img src={post.image_url} alt="Post attachment" className="w-full aspect-square overflow-hidden border-y border-accent-1 object-cover" />
      ) : (
        <div className="h-40 w-full border-y border-accent-1 bg-secondary-background" />
      )}
      <div className="px-3 py-2">
        {post.text.trim() ? <p className="text-sm text-foreground">{post.text}</p> : null}
        {showComments ? (
          <div className="mt-2 space-y-1">
            {comments.length === 0 ? (
              <p className="text-xs text-accent-2">No comments yet.</p>
            ) : (
              comments.map((comment) => (
                <div key={comment.id} className="text-xs text-accent-2">
                  <span className="font-semibold text-foreground/90">
                    {comment.username ?? comment.created_by}
                  </span>{" "}
                  {comment.text}
                </div>
              ))
            )}
          </div>
        ) : null}
      </div>
    </article>
  );
}

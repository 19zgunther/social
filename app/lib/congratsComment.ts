import { PostCommentNode } from "@/app/types/interfaces";

export const isCongratsComment = (message: string): boolean => {
  const normalized = message.trim().toLowerCase();
  return normalized.includes("congrats") || normalized.includes("congratulations");
};

const walkComments = (
  comments: Record<string, PostCommentNode> | undefined,
  onComment: (comment: PostCommentNode) => boolean,
): boolean => {
  if (!comments) {
    return false;
  }

  for (const comment of Object.values(comments)) {
    if (!comment.deleted && onComment(comment)) {
      return true;
    }
    if (walkComments(comment.replies, onComment)) {
      return true;
    }
  }
  return false;
};

export const hasCongratsComment = (
  comments: Record<string, PostCommentNode> | undefined,
): boolean => {
  return walkComments(comments, (comment) => isCongratsComment(comment.text));
};

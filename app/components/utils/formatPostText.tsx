import type { ReactNode } from "react";
import { linkifyHttpsText } from "@/app/components/utils/linkifyHttpsText";

const COLLAPSE_OPEN_RE = /^:::collapse[ \t]+(.+?)[ \t]*$/;
const COLLAPSE_CLOSE_RE = /^:::$/;

/** Inline: **bold**, *italic*, then HTTPS linkify on plain segments. */
function formatInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  // Prefer **bold** over *italic*; non-greedy, no newlines inside markers.
  const inlineRe = /\*\*([^*\n]+)\*\*|\*([^*\n]+)\*/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = inlineRe.exec(text)) !== null) {
    if (match.index > last) {
      const plain = text.slice(last, match.index);
      nodes.push(...flattenLinkified(plain, `${keyPrefix}-p${key++}`));
    }
    if (match[1] !== undefined) {
      nodes.push(
        <strong key={`${keyPrefix}-b${key++}`} className="font-semibold">
          {formatInline(match[1], `${keyPrefix}-bi${key}`)}
        </strong>,
      );
    } else if (match[2] !== undefined) {
      nodes.push(
        <em key={`${keyPrefix}-i${key++}`} className="italic">
          {formatInline(match[2], `${keyPrefix}-ii${key}`)}
        </em>,
      );
    }
    last = match.index + match[0].length;
  }

  if (last < text.length) {
    nodes.push(...flattenLinkified(text.slice(last), `${keyPrefix}-p${key++}`));
  }

  return nodes;
}

function flattenLinkified(text: string, keyPrefix: string): ReactNode[] {
  if (!text) {
    return [];
  }
  const linked = linkifyHttpsText(text, keyPrefix);
  if (typeof linked === "string") {
    return [linked];
  }
  if (Array.isArray(linked)) {
    return linked;
  }
  return [linked];
}

type BlockPart =
  | { kind: "text"; text: string }
  | { kind: "collapse"; title: string; body: string };

function splitCollapseBlocks(text: string): BlockPart[] {
  const lines = text.split("\n");
  const parts: BlockPart[] = [];
  let plainLines: string[] = [];
  let i = 0;

  const flushPlain = () => {
    if (plainLines.length === 0) {
      return;
    }
    parts.push({ kind: "text", text: plainLines.join("\n") });
    plainLines = [];
  };

  while (i < lines.length) {
    const openMatch = COLLAPSE_OPEN_RE.exec(lines[i]!);
    if (!openMatch) {
      plainLines.push(lines[i]!);
      i += 1;
      continue;
    }

    const title = openMatch[1]!.trim();
    const bodyLines: string[] = [];
    i += 1;
    let closed = false;
    while (i < lines.length) {
      if (COLLAPSE_CLOSE_RE.test(lines[i]!)) {
        closed = true;
        i += 1;
        break;
      }
      bodyLines.push(lines[i]!);
      i += 1;
    }

    if (!closed) {
      // Unclosed fence: treat opener as plain text and continue from following lines.
      plainLines.push(`:::collapse ${title}`);
      plainLines.push(...bodyLines);
      continue;
    }

    flushPlain();
    parts.push({ kind: "collapse", title, body: bodyLines.join("\n") });
  }

  flushPlain();
  return parts;
}

/** Renders post/comment text with **bold**, *italic*, :::collapse regions, and HTTPS links. */
export function formatPostText(text: string): ReactNode {
  if (!text) {
    return text;
  }

  const parts = splitCollapseBlocks(text);
  if (parts.length === 1 && parts[0]!.kind === "text") {
    return formatInline(parts[0]!.text, "root");
  }

  const nodes: ReactNode[] = [];
  parts.forEach((part, index) => {
    if (part.kind === "text") {
      if (part.text.length === 0) {
        return;
      }
      nodes.push(
        <span key={`t-${index}`} className="whitespace-pre-wrap">
          {formatInline(part.text, `t${index}`)}
        </span>,
      );
      return;
    }

    nodes.push(
      <details
        key={`c-${index}`}
        className="my-1 rounded-md border border-border/70 bg-surface/40 px-2 py-1"
      >
        <summary className="cursor-pointer select-none text-sm font-medium text-muted">
          {formatInline(part.title, `ct${index}`)}
        </summary>
        <div className="mt-1 whitespace-pre-wrap break-words text-sm text-foreground">
          {formatInline(part.body, `cb${index}`)}
        </div>
      </details>,
    );
  });

  return nodes;
}

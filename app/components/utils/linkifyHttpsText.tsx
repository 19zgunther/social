import type { ReactNode } from "react";

const HTTPS_URL_RE = /https:\/\/\S+/gi;

const TRAILING_URL_PUNCT = new Set(".,;:!?)]}\"'");

function trimUrlForHref(raw: string): { href: string; rest: string } {
  let end = raw.length;
  while (end > 0 && TRAILING_URL_PUNCT.has(raw[end - 1]!)) {
    end -= 1;
  }
  return { href: raw.slice(0, end), rest: raw.slice(end) };
}

/** Turns segments starting with https:// into external links; leaves the rest as plain text. */
export function linkifyHttpsText(text: string): ReactNode {
  const nodes: ReactNode[] = [];
  let last = 0;
  const re = new RegExp(HTTPS_URL_RE.source, HTTPS_URL_RE.flags);
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) {
      nodes.push(text.slice(last, match.index));
    }
    const raw = match[0];
    const { href, rest } = trimUrlForHref(raw);
    if (href.length > 0) {
      nodes.push(
        <a
          key={`u-${key++}`}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="break-all text-inherit underline underline-offset-2"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          {href}
        </a>,
      );
    }
    if (rest.length > 0) {
      nodes.push(rest);
    }
    last = match.index + raw.length;
  }
  if (last < text.length) {
    nodes.push(text.slice(last));
  }
  if (nodes.length === 0) {
    return text;
  }
  return nodes;
}

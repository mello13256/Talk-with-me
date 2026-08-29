import type { ReactNode } from 'react';

const URL_PATTERN =
  /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+\.[a-z]{2,}[^\s<>"']*|[^\s<>"']+@[^\s<>"']+\.[a-z]{2,})/gi;

const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

/**
 * Returns a safe href, or null when the URL should stay plain text.
 * `javascript:` and `data:` never survive this check, which is what makes it
 * safe to turn user-typed text into an anchor.
 */
function safeHref(raw: string): string | null {
  const candidate = raw.includes('@') && !raw.includes('/') ? `mailto:${raw}` : raw;
  const normalized = /^[a-z][a-z0-9+.-]*:/i.test(candidate) ? candidate : `https://${candidate}`;
  try {
    const url = new URL(normalized);
    return SAFE_PROTOCOLS.has(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Trailing punctuation belongs to the sentence, not to the link. */
function splitTrailingPunctuation(token: string): [string, string] {
  const match = /[.,;:!?)\]}»"']+$/.exec(token);
  if (!match) return [token, ''];
  return [token.slice(0, match.index), token.slice(match.index)];
}

/**
 * Renders message text with clickable links.
 *
 * The text is tokenized into React nodes — never interpolated into HTML — so
 * there is no path from message content to markup. Combined with React's own
 * escaping, a message body cannot inject script, styles or attributes.
 */
export function linkify(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;

  for (const match of text.matchAll(URL_PATTERN)) {
    const token = match[0];
    const index = match.index ?? 0;

    if (index > lastIndex) nodes.push(text.slice(lastIndex, index));

    const [candidate, trailing] = splitTrailingPunctuation(token);
    const href = safeHref(candidate);

    if (href) {
      nodes.push(
        <a
          key={`link-${key}`}
          href={href}
          target="_blank"
          rel="noopener noreferrer nofollow ugc"
          className="underline decoration-current/40 underline-offset-2 transition-colors hover:decoration-current"
        >
          {candidate}
        </a>,
      );
      if (trailing) nodes.push(trailing);
    } else {
      nodes.push(token);
    }

    key += 1;
    lastIndex = index + token.length;
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

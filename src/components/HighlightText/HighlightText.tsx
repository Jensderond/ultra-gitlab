import './HighlightText.css';

interface HighlightTextProps {
  text: string;
  query: string;
}

export default function HighlightText({ text, query }: HighlightTextProps) {
  if (!query) {
    return <>{text}</>;
  }

  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'));

  if (parts.length === 1) {
    return <>{text}</>;
  }

  // Split with a capture group produces: [before, match, after, match, ...]
  // Odd-indexed parts are the matches
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="highlight-text-match">
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}

import styles from "./agreement-terms.module.css";

export type AgreementTermsBlock =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] };

function cleanInlineMarkdown(value: string) {
  return value
    .replace(/\*\*([^*]+)\*\*/gu, "$1")
    .replace(/__([^_]+)__/gu, "$1")
    .replace(/`([^`]+)`/gu, "$1")
    .trim();
}

export function parseAgreementTermsMarkdown(markdown: string): AgreementTermsBlock[] {
  const blocks: AgreementTermsBlock[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push({ type: "paragraph", text: cleanInlineMarkdown(paragraph.join(" ")) });
    paragraph = [];
  };
  const flushList = () => {
    if (!list.length) return;
    blocks.push({ type: "list", items: list.map(cleanInlineMarkdown) });
    list = [];
  };

  for (const sourceLine of markdown.replace(/\r\n?/gu, "\n").split("\n")) {
    const line = sourceLine.trim();
    const heading = /^(#{1,6})\s+(.+)$/u.exec(line);
    const bullet = /^[-*]\s+(.+)$/u.exec(line);

    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({
        type: "heading",
        level: heading[1].length,
        text: cleanInlineMarkdown(heading[2]),
      });
      continue;
    }
    if (bullet) {
      flushParagraph();
      list.push(bullet[1]);
      continue;
    }
    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();
  return blocks;
}

function TermsHeading({ level, text }: { level: number; text: string }) {
  if (level <= 2) return <h2>{text}</h2>;
  if (level === 3) return <h3>{text}</h3>;
  if (level === 4) return <h4>{text}</h4>;
  if (level === 5) return <h5>{text}</h5>;
  return <h6>{text}</h6>;
}

export function AgreementTerms({
  markdown,
  headingOffset = 0,
}: {
  markdown: string;
  headingOffset?: number;
}) {
  const blocks = parseAgreementTermsMarkdown(markdown);
  return (
    <div className={styles.terms}>
      {blocks.map((block, index) => {
        const key = `${block.type}:${index}`;
        if (block.type === "heading") {
          const level = headingOffset > 0
            ? Math.min(6, block.level + headingOffset)
            : Math.max(2, block.level);
          return <TermsHeading key={key} level={level} text={block.text} />;
        }
        if (block.type === "list") {
          return <ul key={key}>{block.items.map((item) => <li key={item}>{item}</li>)}</ul>;
        }
        return <p key={key}>{block.text}</p>;
      })}
    </div>
  );
}

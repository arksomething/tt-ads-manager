import clsx from "clsx";

export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={clsx("brand-mark", className)} aria-hidden="true">
      <svg viewBox="0 0 32 32" role="presentation">
        <circle cx="16" cy="16" r="15" fill="currentColor" />
        <text
          x="16"
          y="21"
          fill="white"
          fontFamily="Arial, sans-serif"
          fontSize="15"
          fontWeight="700"
          textAnchor="middle"
        >
          G
        </text>
      </svg>
    </span>
  );
}

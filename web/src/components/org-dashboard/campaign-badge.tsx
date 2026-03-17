import type { CSSProperties } from "react";

import { getCampaignColorTone } from "@/lib/campaign-colors";

type CampaignVisualProps = {
  campaignId?: string | null;
  className?: string;
  label?: string | null;
};

type CampaignBadgeProps = CampaignVisualProps & {
  compact?: boolean;
};

function resolveCampaignVisual(props: CampaignVisualProps) {
  const resolvedLabel = props.label?.trim() || "Unassigned";

  return {
    label: resolvedLabel,
    tone: getCampaignColorTone(props.campaignId ?? resolvedLabel),
  };
}

export function CampaignColorDot({
  campaignId,
  className = "",
  label,
}: CampaignVisualProps) {
  const { tone } = resolveCampaignVisual({ campaignId, label });

  return (
    <span
      aria-hidden="true"
      className={`h-2.5 w-2.5 shrink-0 rounded-full ${className}`.trim()}
      style={{
        background: tone.dot,
        boxShadow: `0 0 18px ${tone.shadow}`,
      }}
    />
  );
}

export function CampaignSwatch({
  campaignId,
  className = "",
  label,
}: CampaignVisualProps) {
  const { tone } = resolveCampaignVisual({ campaignId, label });

  return (
    <span
      aria-hidden="true"
      className={`inline-flex h-10 w-10 shrink-0 rounded-[0.95rem] ${className}`.trim()}
      style={{
        background: tone.gradient,
        boxShadow: `0 0 0 1px ${tone.border} inset, 0 12px 32px -18px ${tone.shadow}`,
      }}
    />
  );
}

export function CampaignBadge({
  campaignId,
  className = "",
  compact = false,
  label,
}: CampaignBadgeProps) {
  const { label: resolvedLabel, tone } = resolveCampaignVisual({ campaignId, label });
  const style: CSSProperties = {
    background: tone.background,
    borderColor: tone.border,
    color: tone.text,
  };

  return (
    <span
      className={`inline-flex max-w-full items-center gap-2 rounded-full border font-medium normal-case tracking-normal ${compact ? "px-2 py-0.5 text-[0.62rem]" : "px-2.5 py-1 text-xs"} ${className}`.trim()}
      style={style}
      title={resolvedLabel}
    >
      <span
        aria-hidden="true"
        className={`shrink-0 rounded-full ${compact ? "h-1.5 w-1.5" : "h-2 w-2"}`}
        style={{
          background: tone.dot,
          boxShadow: `0 0 18px ${tone.shadow}`,
        }}
      />
      <span className="truncate">{resolvedLabel}</span>
    </span>
  );
}

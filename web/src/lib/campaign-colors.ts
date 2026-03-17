export type CampaignColorTone = {
  background: string;
  backgroundStrong: string;
  border: string;
  dot: string;
  gradient: string;
  shadow: string;
  text: string;
};

function stableHash(value: string) {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function normalizeHue(value: number) {
  const hue = ((value % 360) + 360) % 360;

  if (hue >= 44 && hue <= 62) {
    return hue + 18;
  }

  if (hue >= 176 && hue <= 192) {
    return hue - 10;
  }

  return hue;
}

function toHsl(hue: number, saturation: number, lightness: number) {
  return `hsl(${Math.round(hue)} ${Math.round(saturation)}% ${Math.round(lightness)}%)`;
}

function toHsla(
  hue: number,
  saturation: number,
  lightness: number,
  alpha: number,
) {
  return `hsl(${Math.round(hue)} ${Math.round(saturation)}% ${Math.round(
    lightness,
  )}% / ${alpha})`;
}

export const unassignedCampaignTone: CampaignColorTone = {
  background:
    "linear-gradient(135deg, hsl(216 16% 74% / 0.12), hsl(216 12% 46% / 0.08))",
  backgroundStrong:
    "linear-gradient(135deg, hsl(216 16% 74% / 0.18), hsl(216 12% 46% / 0.12))",
  border: "hsl(216 18% 72% / 0.18)",
  dot: "hsl(216 16% 78%)",
  gradient:
    "linear-gradient(135deg, hsl(216 16% 80% / 0.94), hsl(216 14% 58% / 0.78))",
  shadow: "hsl(216 18% 72% / 0.18)",
  text: "hsl(216 22% 88%)",
};

export function getCampaignColorTone(seed: string | null | undefined) {
  if (!seed) {
    return unassignedCampaignTone;
  }

  const hash = stableHash(seed);
  const primaryHue = normalizeHue(hash % 360);
  const secondaryHue = normalizeHue((primaryHue + 18 + ((hash >> 9) % 24)) % 360);
  const primarySaturation = 86 + (hash % 5);
  const primaryLightness = 64 + ((hash >> 4) % 6);
  const secondarySaturation = Math.max(primarySaturation - 8, 76);
  const secondaryLightness = Math.max(primaryLightness - 10, 54);

  return {
    background: `linear-gradient(135deg, ${toHsla(
      primaryHue,
      primarySaturation,
      primaryLightness,
      0.16,
    )}, ${toHsla(secondaryHue, secondarySaturation, secondaryLightness, 0.09)})`,
    backgroundStrong: `linear-gradient(135deg, ${toHsla(
      primaryHue,
      primarySaturation,
      primaryLightness,
      0.24,
    )}, ${toHsla(secondaryHue, secondarySaturation, secondaryLightness, 0.14)})`,
    border: toHsla(primaryHue, primarySaturation, primaryLightness, 0.32),
    dot: toHsl(
      primaryHue,
      Math.min(primarySaturation + 4, 96),
      Math.min(primaryLightness + 8, 82),
    ),
    gradient: `linear-gradient(135deg, ${toHsla(
      primaryHue,
      primarySaturation,
      Math.min(primaryLightness + 4, 74),
      0.96,
    )}, ${toHsla(secondaryHue, secondarySaturation, secondaryLightness, 0.82)})`,
    shadow: toHsla(primaryHue, primarySaturation, primaryLightness, 0.24),
    text: toHsl(primaryHue, 100, 88),
  } satisfies CampaignColorTone;
}

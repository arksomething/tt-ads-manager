import type { SVGProps } from "react";

import { cn } from "@/lib/utils";

export type DashboardIconName =
  | "overview"
  | "accounts"
  | "videos"
  | "tracking"
  | "creatorHub"
  | "creators"
  | "campaigns"
  | "payouts"
  | "revenue"
  | "viralVideos"
  | "projects"
  | "integrations"
  | "api"
  | "settings"
  | "chevronDown"
  | "chevronRight"
  | "externalLink"
  | "refresh"
  | "calendar"
  | "compare"
  | "spotlight"
  | "layout"
  | "dotsHorizontal"
  | "check"
  | "warning"
  | "info"
  | "arrowUpRight"
  | "arrowDownRight";

type DashboardIconProps = SVGProps<SVGSVGElement> & {
  name: DashboardIconName;
};

export function DashboardIcon({
  name,
  className,
  ...props
}: DashboardIconProps) {
  const commonProps = {
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.6,
    viewBox: "0 0 20 20",
    className: cn("h-4 w-4", className),
    ...props,
  };

  switch (name) {
    case "overview":
      return (
        <svg {...commonProps}>
          <rect x="3" y="3" width="6" height="6" rx="1.4" />
          <rect x="11" y="3" width="6" height="4" rx="1.4" />
          <rect x="11" y="9" width="6" height="8" rx="1.4" />
          <rect x="3" y="11" width="6" height="6" rx="1.4" />
        </svg>
      );
    case "accounts":
      return (
        <svg {...commonProps}>
          <circle cx="10" cy="10" r="6.6" />
          <path d="M13 10a3 3 0 1 0-1 2.24V13a1.75 1.75 0 0 0 3.5 0V10" />
        </svg>
      );
    case "videos":
      return (
        <svg {...commonProps}>
          <rect x="3" y="4.2" width="14" height="11.6" rx="2.4" />
          <path d="m8.4 8 4.2 2.1-4.2 2.1Z" fill="currentColor" stroke="none" />
        </svg>
      );
    case "tracking":
      return (
        <svg {...commonProps}>
          <path d="M4.2 12.6a6.8 6.8 0 0 1 11.6 0" />
          <path d="M6.6 10.2a4.1 4.1 0 0 1 6.8 0" />
          <path d="M9 7.8a1.45 1.45 0 0 1 2 0" />
          <circle cx="10" cy="14.2" r="0.9" fill="currentColor" stroke="none" />
        </svg>
      );
    case "creatorHub":
      return (
        <svg {...commonProps}>
          <circle cx="10" cy="6.2" r="2.6" />
          <path d="M5.2 15.2a4.8 4.8 0 0 1 9.6 0" />
          <path d="M3.8 8.3h1.6" />
          <path d="M14.6 8.3h1.6" />
        </svg>
      );
    case "creators":
      return (
        <svg {...commonProps}>
          <circle cx="7.1" cy="7.3" r="2.2" />
          <circle cx="13.4" cy="8.4" r="1.8" />
          <path d="M3.8 15a3.6 3.6 0 0 1 6.6-1.8" />
          <path d="M11.3 14.8a2.8 2.8 0 0 1 4.9-1.3" />
        </svg>
      );
    case "campaigns":
      return (
        <svg {...commonProps}>
          <path d="M3.6 6.1a1.8 1.8 0 0 1 1.8-1.8H8l1.6 1.8h5a1.8 1.8 0 0 1 1.8 1.8v6.1a1.8 1.8 0 0 1-1.8 1.8H5.4a1.8 1.8 0 0 1-1.8-1.8Z" />
          <path d="M3.6 8.4h12.8" />
        </svg>
      );
    case "payouts":
      return (
        <svg {...commonProps}>
          <rect x="3.5" y="5.1" width="13" height="9.8" rx="2.2" />
          <path d="M7.1 10h5.8" />
          <path d="M10 7.6v4.8" />
        </svg>
      );
    case "revenue":
      return (
        <svg {...commonProps}>
          <path d="M4.1 14.8V8.9" />
          <path d="M8 14.8V5.6" />
          <path d="M11.9 14.8v-4.7" />
          <path d="M15.8 14.8V4.8" />
          <path d="M3.4 15.4h13.2" />
          <path d="m4.1 8.9 3.9-3.3 3.9 4.5 3.9-5.3" />
        </svg>
      );
    case "viralVideos":
      return (
        <svg {...commonProps}>
          <path d="M11.6 3.4c.6 2.2-.3 3.5-1.8 4.8-1.3 1.2-2.4 2.2-2.1 4.5a3.9 3.9 0 0 0 7.8-.5c0-2.2-1.2-3.7-3.9-5.8" />
          <path d="M8.8 12.3c0 1 .7 1.9 1.7 2.1" />
        </svg>
      );
    case "projects":
      return (
        <svg {...commonProps}>
          <rect x="3.8" y="4.3" width="12.4" height="11.4" rx="2.2" />
          <path d="M7 4.3v11.4" />
          <path d="M7 9.9h9.2" />
        </svg>
      );
    case "integrations":
      return (
        <svg {...commonProps}>
          <circle cx="6.1" cy="10" r="1.8" />
          <circle cx="13.9" cy="6.2" r="1.8" />
          <circle cx="13.9" cy="13.8" r="1.8" />
          <path d="m7.7 9.2 4.6-2.2" />
          <path d="m7.7 10.8 4.6 2.2" />
        </svg>
      );
    case "api":
      return (
        <svg {...commonProps}>
          <path d="m7.2 5.3-3.4 4.7 3.4 4.7" />
          <path d="m12.8 5.3 3.4 4.7-3.4 4.7" />
          <path d="m10.9 4.2-1.8 11.6" />
        </svg>
      );
    case "settings":
      return (
        <svg {...commonProps}>
          <circle cx="10" cy="10" r="2.4" />
          <path d="M10 3.8v1.4" />
          <path d="M10 14.8v1.4" />
          <path d="m14.4 5.6-1 1" />
          <path d="m6.6 13.4-1 1" />
          <path d="M16.2 10h-1.4" />
          <path d="M5.2 10H3.8" />
          <path d="m14.4 14.4-1-1" />
          <path d="m6.6 6.6-1-1" />
        </svg>
      );
    case "chevronDown":
      return (
        <svg {...commonProps}>
          <path d="m5.2 7.8 4.8 4.8 4.8-4.8" />
        </svg>
      );
    case "chevronRight":
      return (
        <svg {...commonProps}>
          <path d="m7.6 5.2 4.8 4.8-4.8 4.8" />
        </svg>
      );
    case "externalLink":
      return (
        <svg {...commonProps}>
          <path d="M11.3 4.6h4.1v4.1" />
          <path d="m8.4 11.6 7-7" />
          <path d="M8 6H5.8A2.2 2.2 0 0 0 3.6 8.2v6A2.2 2.2 0 0 0 5.8 16.4h6a2.2 2.2 0 0 0 2.2-2.2V12" />
        </svg>
      );
    case "refresh":
      return (
        <svg {...commonProps}>
          <path d="M15.8 10a5.8 5.8 0 0 1-9.8 4.2" />
          <path d="M4.2 10a5.8 5.8 0 0 1 9.8-4.2" />
          <path d="M5 4.7h3.4v3.4" />
          <path d="M15 15.3h-3.4v-3.4" />
        </svg>
      );
    case "calendar":
      return (
        <svg {...commonProps}>
          <rect x="3.5" y="4.7" width="13" height="11" rx="2.2" />
          <path d="M6.5 3.7v2.2" />
          <path d="M13.5 3.7v2.2" />
          <path d="M3.5 8h13" />
        </svg>
      );
    case "compare":
      return (
        <svg {...commonProps}>
          <path d="M4.6 13.6h4.6V6.4H4.6Z" />
          <path d="M10.8 13.6h4.6V8.8h-4.6Z" />
        </svg>
      );
    case "spotlight":
      return (
        <svg {...commonProps}>
          <path d="M7.4 6.3h5.2" />
          <path d="M6.2 10h7.6" />
          <path d="M7.4 13.7h5.2" />
          <rect x="4.2" y="3.8" width="11.6" height="12.4" rx="2.2" />
        </svg>
      );
    case "layout":
      return (
        <svg {...commonProps}>
          <rect x="3.6" y="4.3" width="12.8" height="11.4" rx="2.2" />
          <path d="M8.1 4.3v11.4" />
          <path d="M8.1 8.7h8.3" />
        </svg>
      );
    case "dotsHorizontal":
      return (
        <svg {...commonProps}>
          <circle cx="5.2" cy="10" r="1.05" fill="currentColor" stroke="none" />
          <circle cx="10" cy="10" r="1.05" fill="currentColor" stroke="none" />
          <circle cx="14.8" cy="10" r="1.05" fill="currentColor" stroke="none" />
        </svg>
      );
    case "check":
      return (
        <svg {...commonProps}>
          <path d="m4.8 10.2 3.2 3.2 7.2-7.2" />
        </svg>
      );
    case "warning":
      return (
        <svg {...commonProps}>
          <path d="M9.2 4.6 3.7 14.1a1.4 1.4 0 0 0 1.2 2.1h10.2a1.4 1.4 0 0 0 1.2-2.1L10.8 4.6a.9.9 0 0 0-1.6 0Z" />
          <path d="M10 8.2v3.5" />
          <path d="M10 14.1h.01" />
        </svg>
      );
    case "info":
      return (
        <svg {...commonProps}>
          <circle cx="10" cy="10" r="6.6" />
          <path d="M10 9.2v4.4" />
          <path d="M10 6.4h.01" />
        </svg>
      );
    case "arrowUpRight":
      return (
        <svg {...commonProps}>
          <path d="M6.2 13.8 13.8 6.2" />
          <path d="M8 6.2h5.8V12" />
        </svg>
      );
    case "arrowDownRight":
      return (
        <svg {...commonProps}>
          <path d="m6.2 6.2 7.6 7.6" />
          <path d="M8 13.8h5.8V8" />
        </svg>
      );
    default:
      return null;
  }
}

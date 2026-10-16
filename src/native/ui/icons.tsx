/**
 * Stroke icons (24px grid, drawn at 14–16px). Colour follows `currentColor`.
 */

import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function make(paths: React.ReactNode, strokeWidth = 2) {
  return function Icon({ size = 16, ...rest }: IconProps) {
    return (
      <svg
        aria-hidden="true"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        {...rest}
      >
        {paths}
      </svg>
    );
  };
}

export const SearchIcon = make(
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-4-4" />
  </>,
);
export const RefreshIcon = make(
  <>
    <path d="M20 11a8 8 0 1 0-2.3 5.7" />
    <path d="M20 4v7h-7" />
  </>,
);
export const ChevronLeft = make(<path d="M15 18l-6-6 6-6" />);
export const ChevronRight = make(<path d="M9 18l6-6-6-6" />);
export const ChevronDown = make(<path d="M6 9l6 6 6-6" />);
export const CheckIcon = make(<path d="M5 12.5l4.5 4.5L19 7.5" />, 2.4);
export const XIcon = make(<path d="M6 6l12 12M18 6L6 18" />);
export const ExternalIcon = make(
  <>
    <path d="M14 4h6v6" />
    <path d="M20 4l-9 9" />
    <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
  </>,
);
export const BranchIcon = make(
  <>
    <circle cx="6" cy="5" r="2" />
    <circle cx="6" cy="19" r="2" />
    <circle cx="18" cy="7" r="2" />
    <path d="M6 7v10M18 9c0 5-6 4-11 8" />
  </>,
);
export const CommentIcon = make(
  <path d="M20 12a7 7 0 0 1-10.2 6.2L5 20l1.6-4.2A7 7 0 1 1 20 12z" />,
);
export const FileIcon = make(
  <>
    <path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7z" />
    <path d="M14 3v4h4" />
  </>,
);
export const GearIcon = make(
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </>,
  1.8,
);
export const PlayIcon = make(<path d="M7 5l12 7-12 7z" />);
export const RetryIcon = make(
  <>
    <path d="M4 12a8 8 0 0 1 14-5.3L20 9" />
    <path d="M20 4v5h-5" />
    <path d="M20 12a8 8 0 0 1-14 5.3L4 15" />
    <path d="M4 20v-5h5" />
  </>,
);
export const StopIcon = make(<rect x="6" y="6" width="12" height="12" rx="1.5" />);
export const PinIcon = make(
  <>
    <path d="M9 4h6l-1 6 3 3H7l3-3z" />
    <path d="M12 13v7" />
  </>,
);
export const ClockIcon = make(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </>,
);
export const MergeIcon = make(
  <>
    <circle cx="6" cy="5" r="2" />
    <circle cx="6" cy="19" r="2" />
    <circle cx="18" cy="15" r="2" />
    <path d="M6 7v10M6 9c0 4 4 6 10 6" />
  </>,
);
export const InboxIcon = make(
  <>
    <path d="M4 13l2.5-7h11L20 13v6H4z" />
    <path d="M4 13h5l1 2h4l1-2h5" />
  </>,
);
export const PersonIcon = make(
  <>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 20c1.5-4 5-5 8-5s6.5 1 8 5" />
  </>,
);
export const ReturnIcon = make(
  <>
    <path d="M9 14L4 9l5-5" />
    <path d="M4 9h11a5 5 0 0 1 0 10h-3" />
  </>,
);
export const CopyIcon = make(
  <>
    <rect x="8" y="8" width="12" height="12" rx="2" />
    <path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" />
  </>,
);
export const EyeIcon = make(
  <>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </>,
);
export const PlusIcon = make(<path d="M12 5v14M5 12h14" />);
export const MoreIcon = make(
  <>
    <circle cx="5" cy="12" r="1" />
    <circle cx="12" cy="12" r="1" />
    <circle cx="19" cy="12" r="1" />
  </>,
  2.4,
);
export const MoonIcon = make(<path d="M20 14.5A8 8 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5z" />);
export const TerminalIcon = make(
  <>
    <path d="M5 8l4 4-4 4" />
    <path d="M12 16h7" />
  </>,
);
export const WarningIcon = make(
  <>
    <path d="M12 4l9 16H3z" />
    <path d="M12 10v4M12 17v.5" />
  </>,
);
export const KeyboardIcon = make(
  <>
    <rect x="3" y="6" width="18" height="12" rx="2" />
    <path d="M7 10h.01M11 10h.01M15 10h.01M17 10h.01M8 14h8" />
  </>,
);

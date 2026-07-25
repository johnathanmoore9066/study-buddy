import type { SVGProps } from "react";

type IconName =
  | "arrow-up"
  | "book-open"
  | "brain"
  | "check"
  | "chevron-down"
  | "clock"
  | "compass"
  | "file-plus"
  | "galaxy"
  | "lock"
  | "map"
  | "message"
  | "more"
  | "orbit"
  | "paperclip"
  | "plus"
  | "rotate"
  | "sparkles"
  | "x";

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName;
  size?: number;
}

export function Icon({
  name,
  size = 18,
  strokeWidth = 1.8,
  ...props
}: IconProps) {
  const paths: Record<IconName, React.ReactNode> = {
    "arrow-up": (
      <>
        <path d="m18 15-6-6-6 6" />
        <path d="M12 9v12" />
      </>
    ),
    "book-open": (
      <>
        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2Z" />
        <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7Z" />
      </>
    ),
    brain: (
      <>
        <path d="M9.5 4.5A3 3 0 0 0 4 6a3 3 0 0 0 .2 5.9A3.2 3.2 0 0 0 7 17.5a3 3 0 0 0 5 2.2V5.8a3 3 0 0 0-2.5-1.3Z" />
        <path d="M14.5 4.5A3 3 0 0 1 20 6a3 3 0 0 1-.2 5.9 3.2 3.2 0 0 1-2.8 5.6 3 3 0 0 1-5 2.2V5.8a3 3 0 0 1 2.5-1.3Z" />
        <path d="M8 9a3 3 0 0 0 4 2.8M16 9a3 3 0 0 1-4 2.8M7 17.5a3 3 0 0 1 1-2.3m9 2.3a3 3 0 0 0-1-2.3" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    "chevron-down": <path d="m6 9 6 6 6-6" />,
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    compass: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="m16 8-2.4 5.6L8 16l2.4-5.6Z" />
      </>
    ),
    "file-plus": (
      <>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
        <path d="M14 2v6h6M12 18v-6m-3 3h6" />
      </>
    ),
    galaxy: (
      <>
        <circle cx="12" cy="12" r="2" />
        <path d="M4.5 8.5c3.7-3.8 9.8-4.8 13.8-2.2 3 2 2 5.4-.9 7.7-3.8 3-9.8 4-12.8 1.3-2.3-2.1-.8-5 1.8-6.9" />
        <path d="M8 3.8c4.9 1.3 9.2 5.8 9.2 10.4 0 3.4-3.2 4.5-6.4 3.2-4-1.6-7.6-5.9-6.9-9.6.5-2.7 3.5-3.3 6.2-2.5" />
      </>
    ),
    lock: (
      <>
        <rect x="5" y="10" width="14" height="11" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      </>
    ),
    map: (
      <>
        <path d="m3 6 5-3 8 3 5-3v15l-5 3-8-3-5 3Z" />
        <path d="M8 3v15M16 6v15" />
      </>
    ),
    message: (
      <>
        <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z" />
        <path d="M8 9h8M8 13h5" />
      </>
    ),
    more: (
      <>
        <circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" />
        <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
        <circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" />
      </>
    ),
    orbit: (
      <>
        <circle cx="12" cy="12" r="2" />
        <path d="M20.2 5.8c1.4 1.4-.9 6-5.2 10.2S6.2 22.6 4.8 21.2 5.7 15.2 10 11s8.8-6.6 10.2-5.2Z" />
        <path d="M4.8 5.8C3.4 7.2 5.7 11.8 10 16s8.8 6.6 10.2 5.2-.9-6-5.2-10.2S6.2 4.4 4.8 5.8Z" />
      </>
    ),
    paperclip: <path d="m21.4 11.6-8.9 8.9a6 6 0 0 1-8.5-8.5l9.6-9.6a4 4 0 0 1 5.7 5.7l-9.6 9.6a2 2 0 0 1-2.8-2.8l8.9-8.9" />,
    plus: <path d="M12 5v14M5 12h14" />,
    rotate: (
      <>
        <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
        <path d="M3 3v5h5" />
      </>
    ),
    sparkles: (
      <>
        <path d="m12 3-1.2 3.3L7.5 7.5l3.3 1.2L12 12l1.2-3.3 3.3-1.2-3.3-1.2Z" />
        <path d="m5 14-.8 2.2L2 17l2.2.8L5 20l.8-2.2L8 17l-2.2-.8Zm13-1-.8 2.2L15 16l2.2.8L18 19l.8-2.2L21 16l-2.2-.8Z" />
      </>
    ),
    x: (
      <>
        <path d="m6 6 12 12" />
        <path d="M18 6 6 18" />
      </>
    ),
  };

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}

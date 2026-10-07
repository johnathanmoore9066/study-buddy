import type { SVGProps } from "react";

type IconName =
  | "arrow-up"
  | "book-open"
  | "check"
  | "chevron-down"
  | "clock"
  | "compass"
  | "crosshair"
  | "galaxy"
  | "lock"
  | "map"
  | "message"
  | "moon"
  | "more"
  | "paperclip"
  | "planet"
  | "plus"
  | "rotate"
  | "sparkles"
  | "star"
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
    crosshair: (
      <>
        <circle cx="12" cy="12" r="6.5" />
        <path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4" />
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
    moon: <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />,
    more: (
      <>
        <circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" />
        <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
        <circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" />
      </>
    ),
    paperclip: <path d="m21.4 11.6-8.9 8.9a6 6 0 0 1-8.5-8.5l9.6-9.6a4 4 0 0 1 5.7 5.7l-9.6 9.6a2 2 0 0 1-2.8-2.8l8.9-8.9" />,
    planet: (
      <>
        <circle cx="12" cy="12" r="5.5" fill="currentColor" stroke="none" />
        <ellipse cx="12" cy="12" rx="10.5" ry="3.6" transform="rotate(-18 12 12)" />
      </>
    ),
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
    star: (
      <path
        d="M12 2.5 13.7 10.3 21.5 12l-7.8 1.7L12 21.5l-1.7-7.8L2.5 12l7.8-1.7Z"
        fill="currentColor"
        stroke="none"
      />
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

/** Eight-point star: the long rays mark the cardinal points, as on a star chart. */
export function AsterMark({ size = 22 }: { size?: number }) {
  const ray = "M16 1.5 18 14l12.5 2L18 18l-2 12.5L14 18 1.5 16 14 14Z";
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path d={ray} fill="currentColor" />
      <path
        d={ray}
        fill="currentColor"
        opacity="0.5"
        transform="translate(16 16) rotate(45) scale(0.56) translate(-16 -16)"
      />
    </svg>
  );
}

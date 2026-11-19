// Small stroke icons (24px grid, currentColor) so the UI doesn't depend on emoji rendering.
import type { SVGProps } from 'react';

const base = (p: SVGProps<SVGSVGElement>) => ({
  width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 1.75, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true, ...p,
});

export const IconMap = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M9 4 3 6.5v13L9 17l6 2.5 6-2.5v-13L15 6.5 9 4Z" /><path d="M9 4v13M15 6.5v13" /></svg>
);
export const IconHeart = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M12 20s-7.5-4.4-7.5-10A4.5 4.5 0 0 1 12 7.2 4.5 4.5 0 0 1 19.5 10c0 5.6-7.5 10-7.5 10Z" /></svg>
);
export const IconHeartFilled = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base({ fill: 'currentColor', ...p })}><path d="M12 20s-7.5-4.4-7.5-10A4.5 4.5 0 0 1 12 7.2 4.5 4.5 0 0 1 19.5 10c0 5.6-7.5 10-7.5 10Z" /></svg>
);
export const IconPlus = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="8.5" /><path d="M12 8v8M8 12h8" /></svg>
);
export const IconStar = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="m12 3.8 2.5 5.1 5.6.8-4 4 1 5.5-5.1-2.7-5 2.7.9-5.5-4-4 5.6-.8L12 3.8Z" /></svg>
);
export const IconUser = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="12" cy="8.5" r="3.5" /><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" /></svg>
);
export const IconSearch = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></svg>
);
export const IconBasket = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M4 10h16l-1.6 8.4a2 2 0 0 1-2 1.6H7.6a2 2 0 0 1-2-1.6L4 10Z" /><path d="m8.5 10 3-6M15.5 10l-3-6" /></svg>
);
export const IconBowl = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M3.5 11h17a8.5 8.5 0 0 1-17 0Z" /><path d="M9 7c0-1 1-1.5 1-2.5M13 7c0-1 1-1.5 1-2.5" /></svg>
);
export const IconClose = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="m6 6 12 12M18 6 6 18" /></svg>
);
export const IconCheck = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
);
export const IconShare = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M12 15V4M8 8l4-4 4 4" /><path d="M5 12v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" /></svg>
);
export const IconFlag = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M5 21V4M5 4h11l-2 4 2 4H5" /></svg>
);
export const IconPin = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" /><circle cx="12" cy="10" r="2.3" /></svg>
);
export const IconPhone = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M5 4h3.5l1.5 4-2 1.3a10 10 0 0 0 6.7 6.7L16 14l4 1.5V19a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1Z" /></svg>
);
export const IconGlobe = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.4 2.4 3.5 5.2 3.5 8.5s-1.1 6.1-3.5 8.5c-2.4-2.4-3.5-5.2-3.5-8.5s1.1-6.1 3.5-8.5Z" /></svg>
);
export const IconClock = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>
);
export const IconRoute = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="6" cy="18" r="2" /><circle cx="18" cy="6" r="2" /><path d="M8 18h7.5a3.5 3.5 0 0 0 0-7h-7a3.5 3.5 0 0 1 0-7H16" /></svg>
);
export const IconChevron = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="m6 9 6 6 6-6" /></svg>
);
export const IconLock = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="5" y="10.5" width="14" height="9.5" rx="2" /><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" /></svg>
);

/** The brand mark: a map pin cut from an adire-style indigo cloth square. */
export const BrandMark = ({ size = 30 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
    <rect width="32" height="32" rx="8" fill="#2A3577" />
    <g stroke="#4A58A8" strokeWidth="1.2" fill="none">
      <path d="M0 8h32M0 16h32M0 24h32" opacity=".55" />
      <circle cx="8" cy="4" r="1.4" /><circle cx="24" cy="4" r="1.4" /><circle cx="16" cy="28" r="1.4" />
    </g>
    <path d="M16 6.5c-3.9 0-7 3-7 6.8 0 5 7 11.7 7 11.7s7-6.7 7-11.7c0-3.8-3.1-6.8-7-6.8Z" fill="#F4F5F8" />
    <circle cx="16" cy="13.3" r="2.9" fill="#D69A1D" />
  </svg>
);

import type { SVGProps } from 'react';

interface HolophyteIconProps extends SVGProps<SVGSVGElement> {
  leafColor?: string;
  leafColorDark?: string;
}

export default function HolophyteIcon({
  leafColor = 'currentColor',
  leafColorDark = 'currentColor',
  ...props
}: HolophyteIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="215 85 250 150"
      role="img"
      aria-label="Holophyte"
      {...props}
    >
      <mask id="holophyte-vein-mask">
        <rect width="680" height="320" fill="white" />
        <path
          d="M 340 230 Q 295 180 280 110"
          stroke="black"
          strokeWidth="4"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M 320 205 Q 300 200 285 190"
          stroke="black"
          strokeWidth="3"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M 302 175 Q 282 168 268 158"
          stroke="black"
          strokeWidth="3"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M 288 145 Q 270 135 258 122"
          stroke="black"
          strokeWidth="3"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M 320 205 Q 328 195 332 182"
          stroke="black"
          strokeWidth="3"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M 302 175 Q 312 165 318 152"
          stroke="black"
          strokeWidth="3"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M 288 145 Q 298 135 305 122"
          stroke="black"
          strokeWidth="3"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M 340 230 Q 385 180 400 110"
          stroke="black"
          strokeWidth="4"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M 360 205 Q 380 200 395 190"
          stroke="black"
          strokeWidth="3"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M 378 175 Q 398 168 412 158"
          stroke="black"
          strokeWidth="3"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M 392 145 Q 410 135 422 122"
          stroke="black"
          strokeWidth="3"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M 360 205 Q 352 195 348 182"
          stroke="black"
          strokeWidth="3"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M 378 175 Q 368 165 362 152"
          stroke="black"
          strokeWidth="3"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M 392 145 Q 382 135 375 122"
          stroke="black"
          strokeWidth="3"
          fill="none"
          strokeLinecap="round"
        />
      </mask>
      <g mask="url(#holophyte-vein-mask)">
        <path
          d="M 340 230 C 220 230 220 90 285 90 C 330 90 345 160 340 230 Z"
          fill={leafColor}
        />
        <path
          d="M 340 230 C 460 230 460 90 395 90 C 350 90 335 160 340 230 Z"
          fill={leafColorDark}
          opacity="0.8"
        />
      </g>
    </svg>
  );
}

import classNames from "classnames";
import { twMerge } from "tailwind-merge";

type ClassArg = Parameters<typeof classNames>[number];

/**
 * Join class names conditionally (via `classnames`), then collapse conflicting
 * Tailwind utilities so the last one wins (via `tailwind-merge`).
 *
 *   cn("px-2 py-1", isBig && "px-4", styles.card)  // -> "py-1 px-4 <hash>"
 *
 * Use it wherever a className is built from more than one source — a base plus
 * variant utilities, or Tailwind utilities alongside a CSS-module class.
 */
export function cn(...args: ClassArg[]): string {
  return twMerge(classNames(...args));
}

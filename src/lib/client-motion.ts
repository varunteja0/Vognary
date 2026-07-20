export type MotionPreferenceTarget = {
  matchMedia: (query: string) => { matches: boolean };
};

export function prefersReducedMotion(target: MotionPreferenceTarget | null = typeof window === "undefined" ? null : window): boolean {
  return Boolean(target?.matchMedia("(prefers-reduced-motion: reduce)").matches);
}

export function scrollIntoViewWithMotion(
  element: Element | null,
  options: Omit<ScrollIntoViewOptions, "behavior"> = {},
  target?: MotionPreferenceTarget | null,
): void {
  if (!element) return;
  element.scrollIntoView({ ...options, behavior: prefersReducedMotion(target) ? "auto" : "smooth" });
}
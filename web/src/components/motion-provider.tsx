"use client";

import { LazyMotion, MotionConfig } from "framer-motion";
import type { ReactNode } from "react";

const loadFeatures = () => import("@/components/motion-features").then((mod) => mod.default);

/**
 * App-wide LazyMotion boundary. Components animate with `m.*` (never `motion.*`
 * — `strict` throws on it in dev) so the full motion runtime is code-split and
 * fetched after first paint.
 *
 * `reducedMotion="user"`: when the OS asks for less motion (iOS Settings →
 * Accessibility → Reduce Motion, also a battery saver on phones), transform
 * and layout animations are skipped and only opacity still fades, so every
 * `m.*` in the app honours the setting without each one checking it.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={loadFeatures} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}

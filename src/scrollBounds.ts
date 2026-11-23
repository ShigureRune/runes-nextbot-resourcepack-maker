/** Geometry for the custom inventory scrollbar, including elastic overscroll on iOS. */
export function scrollGeometry(contentHeight: number, viewportHeight: number, scrollTop: number): {
  heightPercent: number;
  topPercent: number;
  clampedScrollTop: number;
} {
  if (!Number.isFinite(contentHeight) || !Number.isFinite(viewportHeight) ||
      contentHeight <= 0 || viewportHeight <= 0) {
    return { heightPercent: 100, topPercent: 0, clampedScrollTop: 0 };
  }
  const maxScroll = Math.max(0, contentHeight - viewportHeight);
  const clampedScrollTop = Math.max(0, Math.min(maxScroll, Number.isFinite(scrollTop) ? scrollTop : 0));
  const visiblePercent = Math.min(100, (viewportHeight / contentHeight) * 100);
  const heightPercent = Math.min(100, Math.max(8, visiblePercent));
  const ratio = maxScroll > 0 ? clampedScrollTop / maxScroll : 0;
  const topPercent = Math.max(0, Math.min(100 - heightPercent, ratio * (100 - heightPercent)));
  return { heightPercent, topPercent, clampedScrollTop };
}

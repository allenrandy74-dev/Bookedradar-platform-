/** Keep a 48-point interactive row above the phone's bottom safe area. */
export function tabBarLayout(bottomInset: number) {
  const paddingBottom = Math.max(
    8,
    Number.isFinite(bottomInset) ? bottomInset : 0,
  );
  const paddingTop = 8;
  return { height: 48 + paddingTop + paddingBottom, paddingTop, paddingBottom };
}

/** The NEPO mark, drawn with plain elements so it can be rendered by next/og ImageResponse. */
export function AppIcon({ size }: { size: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#00356b",
        color: "#ffffff",
        fontSize: size * 0.34,
        fontWeight: 800,
        letterSpacing: size * -0.01,
        fontFamily: "sans-serif",
      }}
    >
      NEPO
    </div>
  );
}

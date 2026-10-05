type LoaderProps = {
  className?: string;
  /** Visual scale relative to the default 90×24 size. */
  scale?: number;
};

export default function Loader({ className, scale = 1 }: LoaderProps) {
  if (scale === 1) {
    return <div className={className ? `loader ${className}` : "loader"} />;
  }

  return (
    <div
      className={className}
      style={{
        width: 90 * scale,
        height: 24 * scale,
        overflow: "hidden",
      }}
    >
      <div
        className="loader"
        style={{
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
      />
    </div>
  );
}

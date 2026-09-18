import * as stylex from "@stylexjs/stylex";
import { Maximize2 } from "lucide-react";
import { useEffect, useState, type KeyboardEvent } from "react";
import { colors } from "../../styles/tokens.stylex";
import { useI18n } from "../../i18n/react";
import { MermaidLightbox } from "./MermaidLightbox";
import { getCachedMermaidSvg, getMermaidTheme, renderMermaidDiagram } from "./mermaid-runtime";

export default function MermaidBlock({
  code,
  interactive = true,
}: {
  code: string;
  interactive?: boolean;
}) {
  const { t } = useI18n();
  const [theme, setTheme] = useState(getMermaidTheme);
  const cached = getCachedMermaidSvg(code);
  const [svg, setSvg] = useState(cached || "");
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const canExpand = interactive && Boolean(svg) && !error;

  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(getMermaidTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const hit = getCachedMermaidSvg(code);
    if (hit) {
      setSvg(hit);
      setError("");
      return;
    }
    let cancelled = false;
    void renderMermaidDiagram(code)
      .then((next) => {
        if (!cancelled) {
          setSvg(next);
          setError("");
        }
      })
      .catch((renderError: unknown) => {
        if (!cancelled) {
          setError(renderError instanceof Error ? renderError.message : String(renderError));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [code, theme]);

  if (error) {
    return <pre {...stylex.props(styles.error)}>{error}</pre>;
  }

  const onActivate = () => {
    if (canExpand) setOpen(true);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!canExpand) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setOpen(true);
    }
  };

  return (
    <>
      <div
        aria-expanded={canExpand ? open : undefined}
        aria-haspopup={canExpand ? "dialog" : undefined}
        aria-label={canExpand ? t("preview.expandMermaid") : undefined}
        data-mermaid-block=""
        data-mermaid-pending={svg ? undefined : ""}
        onClick={canExpand ? onActivate : undefined}
        onKeyDown={canExpand ? onKeyDown : undefined}
        role={canExpand ? "button" : undefined}
        tabIndex={canExpand ? 0 : undefined}
        title={canExpand ? t("preview.expandMermaid") : undefined}
        {...stylex.props(styles.diagram, canExpand && styles.expandable)}
      >
        <div
          dangerouslySetInnerHTML={{ __html: svg || "Rendering diagram..." }}
          {...stylex.props(styles.svgHost)}
        />
        {canExpand ? (
          <span aria-hidden="true" {...stylex.props(styles.expandBadge)}>
            <Maximize2 {...stylex.props(styles.expandIcon)} strokeWidth={1.8} />
          </span>
        ) : null}
      </div>
      {interactive ? (
        <MermaidLightbox onClose={() => setOpen(false)} open={open && Boolean(svg)} svg={svg} />
      ) : null}
    </>
  );
}

const styles = stylex.create({
  error: {
    whiteSpace: "pre-wrap",
    color: colors.danger,
    borderColor: `color-mix(in srgb, ${colors.danger} 30%, transparent)`,
    backgroundColor: `color-mix(in srgb, ${colors.danger} 5%, transparent)`,
  },
  diagram: {
    position: "relative",
    overflow: "auto",
    marginBlock: 16,
    padding: 16,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: colors.elevated,
  },
  expandable: {
    cursor: "zoom-in",
    userSelect: "none",
  },
  svgHost: {
    minWidth: 0,
  },
  expandBadge: {
    position: "absolute",
    top: 8,
    right: 8,
    display: "grid",
    width: 28,
    height: 28,
    placeItems: "center",
    pointerEvents: "none",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: `color-mix(in srgb, ${colors.border} 88%, transparent)`,
    borderRadius: 8,
    backgroundColor: `color-mix(in srgb, ${colors.elevated} 88%, transparent)`,
    color: colors.muted,
    opacity: {
      default: 0.72,
      ":is([data-mermaid-block]:hover *)": 1,
      ":is([data-mermaid-block]:focus-visible *)": 1,
    },
  },
  expandIcon: {
    width: 14,
    height: 14,
  },
});

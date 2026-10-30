import { useEffect, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { AlertCircle, Check, Copy, LoaderCircle } from "lucide-react";
import { api } from "./api";
import { useText } from "./context";

export function useLoad<T = any>(path: string, refresh = 0, poll = 0) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const run = async () => {
      try {
        const value = await api<T>(path, { signal: abort.signal });
        if (live) {
          setData(value);
          setError("");
        }
      } catch (e) {
        if (live && !(e instanceof DOMException && e.name === "AbortError"))
          setError((e as Error).message);
      } finally {
        if (live) {
          setLoading(false);
          if (poll) timer = setTimeout(run, poll);
        }
      }
    };
    setLoading(true);
    setData(null);
    setError("");
    void run();
    return () => {
      live = false;
      abort.abort();
      clearTimeout(timer);
    };
  }, [path, refresh, poll]);
  return { data, error, loading };
}
export function State({
  loading,
  error,
  children,
}: {
  loading?: boolean;
  error?: string;
  children: ReactNode;
}) {
  const t = useText();
  if (loading)
    return (
      <div className="state" role="status">
        <LoaderCircle className="spin" />
        {t("불러오는 중…", "Loading…")}
      </div>
    );
  if (error)
    return (
      <div className="error" role="alert">
        <AlertCircle size={18} />
        {error}
      </div>
    );
  return <>{children}</>;
}
export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}
export function Badge({ value }: { value: string | null | undefined }) {
  return (
    <span className={`badge ${String(value || "unknown").toLowerCase()}`}>
      {value || "—"}
    </span>
  );
}
export function PageTitle({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-title">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      <div className="toolbar">{actions}</div>
    </header>
  );
}
export function Tabs({
  values,
  selected,
  onChange,
}: {
  values: [string, string][];
  selected: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {values.map(([id, label]) => (
        <button
          key={id}
          role="tab"
          aria-selected={selected === id}
          className={selected === id ? "selected" : ""}
          onClick={() => onChange(id)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
export function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false),
    t = useText();
  return (
    <button
      type="button"
      className="icon-button"
      aria-label={t("복사", "Copy")}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? <Check size={16} /> : <Copy size={16} />}
    </button>
  );
}
export function Code({
  children,
  language = "json",
}: {
  children: string;
  language?: string;
}) {
  return (
    <div className="code-wrap">
      <CopyButton value={children} />
      <Markdown>{"```" + language + "\n" + children + "\n```"}</Markdown>
    </div>
  );
}
export function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        skipHtml
        components={{
          img: () => null,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
export function Pagination({
  page,
  total,
  size = 25,
  onChange,
}: {
  page: number;
  total: number;
  size?: number;
  onChange: (v: number) => void;
}) {
  const t = useText();
  return (
    <div className="pagination">
      <span>
        {total} {t("개 결과", "results")}
      </span>
      <button disabled={page <= 1} onClick={() => onChange(page - 1)}>
        {t("이전", "Previous")}
      </button>
      <span>
        {page} / {Math.max(1, Math.ceil(total / size))}
      </span>
      <button
        disabled={page * size >= total}
        onClick={() => onChange(page + 1)}
      >
        {t("다음", "Next")}
      </button>
    </div>
  );
}
export function ErrorMessage({ value }: { value: string }) {
  return value ? (
    <div className="error" role="alert">
      {value}
    </div>
  ) : null;
}

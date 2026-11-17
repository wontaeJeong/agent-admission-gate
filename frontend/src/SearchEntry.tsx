import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import { useText } from "./context";

export function SearchEntry() {
  const navigate = useNavigate(),
    t = useText();
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        !(event.ctrlKey || event.metaKey) ||
        event.key.toLowerCase() !== "k" ||
        event.isComposing ||
        event.keyCode === 229 ||
        (target instanceof Element &&
          target.closest(
            "input, textarea, select, [contenteditable='true'], [role='textbox']",
          ))
      )
        return;
      event.preventDefault();
      navigate("/search");
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [navigate]);
  return (
    <Link
      to="/search"
      className="icon-button"
      aria-label={t("통합 검색 (Cmd/Ctrl+K)", "Search (Cmd/Ctrl+K)")}
      title={t("통합 검색 (Cmd/Ctrl+K)", "Search (Cmd/Ctrl+K)")}
    >
      <Search size={18} />
    </Link>
  );
}

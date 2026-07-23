import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { parseCapture } from "./lib/nlp";
import { useCreateTask } from "./lib/queries";
import { useToast } from "./lib/toast";
import { LogoIcon } from "./lib/icons";

// PWA share target (manifest share_target -> GET /share?title&text&url).
// Sharing IS capture: the shared content becomes a Backlog task immediately,
// through the same NLP the capture bar uses, then this page bounces to
// Backlog. Zero extra taps, which is the whole point of a share sheet.
//
// The task title is the shared title or text; a shared url goes into notes so
// a long link never becomes an unreadable title.
export function SharePage() {
  const [params] = useSearchParams();
  const create = useCreateTask();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [failed, setFailed] = useState(false);
  // Effects run twice under StrictMode; a share must create exactly one task.
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;

    const title = (params.get("title") ?? "").trim();
    const text = (params.get("text") ?? "").trim();
    const url = (params.get("url") ?? "").trim();
    // Some apps put the link in `text` rather than `url`.
    const textIsUrl = /^https?:\/\/\S+$/.test(text);
    const captureText = title || (textIsUrl ? "Look at this link" : text) || url;

    if (!captureText) {
      navigate("/backlog", { replace: true });
      return;
    }

    const parsed = parseCapture(captureText, []);
    const notes = [textIsUrl ? text : url, !textIsUrl && title && text ? text : null]
      .filter(Boolean)
      .join("\n");
    create.mutate(
      {
        title: parsed.title || captureText,
        due_date: parsed.due_date,
        due_time: parsed.due_time,
        priority: parsed.priority ?? 4,
        labelNames: parsed.labelNames,
        notes: notes || null,
      },
      {
        onSuccess: () => {
          toast("Captured to Backlog");
          navigate("/backlog", { replace: true });
        },
        onError: () => setFailed(true),
      }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="grid min-h-[60vh] place-items-center">
      <div className="flex flex-col items-center gap-3 text-center">
        <LogoIcon className="h-8 w-8 text-primary" />
        <p className="text-sm text-subtle">
          {failed ? "Could not capture that. Are you offline?" : "Capturing…"}
        </p>
        {failed && (
          <button
            onClick={() => navigate("/backlog", { replace: true })}
            className="text-sm text-primary hover:underline"
          >
            Go to Backlog
          </button>
        )}
      </div>
    </div>
  );
}

"use client";

import { useRef, useState, useTransition } from "react";
import { uploadStatementAction } from "@/lib/actions/import";
import { Button, cx } from "@/components/ui";

export function FileDrop() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(file: File) {
    setError(null);
    setFileName(file.name);
    const formData = new FormData();
    formData.set("file", file);
    startTransition(async () => {
      const res = await uploadStatementAction(formData);
      if (res && !res.ok) setError(res.error ?? "Upload failed.");
    });
  }

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files?.[0];
          if (file) submit(file);
        }}
        onClick={() => inputRef.current?.click()}
        className={cx(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2",
          "border-dashed px-6 py-12 text-center transition-colors",
          dragOver ? "border-accent bg-info-bg" : "border-edge hover:border-accent/50",
        )}
      >
        <p className="text-sm font-medium text-ink">
          {pending ? `Processing ${fileName}…` : "Drop a statement here, or click to choose"}
        </p>
        <p className="text-xs text-ink-muted">.xlsx, .xls, or .csv — bank, credit card, or MF order book</p>
        <p className="text-xs text-ink-muted">
          Password-protected files are fine — you&apos;ll be asked for the password next.
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) submit(file);
          }}
        />
      </div>
      {error ? (
        <p className="mt-2 rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger">{error}</p>
      ) : null}
      {pending ? <Button className="mt-3" disabled>Uploading…</Button> : null}
    </div>
  );
}

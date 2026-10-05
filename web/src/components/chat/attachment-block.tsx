"use client";

import { useEffect, useState } from "react";
import { getAttachmentSignedUrl, type ChatMessageRow } from "@/lib/chat";
import { PaperclipIcon } from "./icons";
import { formatBytes } from "./types";

export function AttachmentBlock({
  message,
  darkText,
  onOpenImage,
}: {
  message: ChatMessageRow;
  darkText: boolean;
  onOpenImage?: (url: string, name: string) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [imgLoaded, setImgLoaded] = useState(false);
  const path = message.attachment_path!;
  const isImage = (message.attachment_type ?? "").startsWith("image/");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const signed = await getAttachmentSignedUrl(path, message.attachment_name);
        if (!cancelled) setUrl(signed);
      } catch (e) {
        if (!cancelled) setErr((e as Error).message || "Could not load attachment");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path, message.attachment_name]);

  const sizeLabel = message.attachment_size ? formatBytes(message.attachment_size) : "";

  if (err) {
    return <p className={`mt-1 text-xs ${darkText ? "text-slate-700" : "text-danger"}`}>{err}</p>;
  }

  if (isImage) {
    const name = message.attachment_name ?? "attachment";
    if (!url) {
      // Skeleton — keeps the bubble at a stable size while signing the URL.
      return (
        <div
          aria-hidden
          className="mt-1 h-40 w-48 max-w-full animate-pulse rounded-lg border border-glass/10 bg-glass/[0.06]"
        />
      );
    }
    return (
      <button
        type="button"
        onClick={() => onOpenImage?.(url, name)}
        className="group/img relative mt-1 block overflow-hidden rounded-lg border border-glass/10"
      >
        {!imgLoaded ? (
          <div
            aria-hidden
            className="absolute inset-0 animate-pulse bg-glass/[0.06]"
          />
        ) : null}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={name}
          onLoad={() => setImgLoaded(true)}
          className="block max-h-64 max-w-full object-contain transition group-hover/img:opacity-95"
        />
      </button>
    );
  }

  return (
    <a
      href={url ?? "#"}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => {
        if (!url) e.preventDefault();
      }}
      className={`mt-1 inline-flex items-center gap-2 rounded-lg border px-2 py-1.5 text-xs transition ${
        darkText
          ? "border-slate-900/30 bg-glass/40 text-slate-900 hover:bg-glass/60"
          : "border-glass/15 bg-glass/8 text-ink hover:bg-glass/12"
      }`}
    >
      <PaperclipIcon className="h-3.5 w-3.5" />
      <span className="max-w-[12rem] truncate">{message.attachment_name ?? "attachment"}</span>
      {sizeLabel ? <span className="opacity-70">· {sizeLabel}</span> : null}
    </a>
  );
}

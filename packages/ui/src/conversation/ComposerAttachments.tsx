import type { ConversationAttachment } from "@karont/contract";
import { FileText, Image as ImageIcon, Paperclip, X } from "lucide-react";
import {
  type ClipboardEventHandler,
  type DragEventHandler,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { t } from "../i18n/pt-BR.ts";
import {
  classifyAttachmentFile,
  formatAttachmentSize,
  MAX_CONVERSATION_ATTACHMENTS,
  MAX_IMAGE_ATTACHMENT_BYTES,
  MAX_TEXT_ATTACHMENT_BYTES,
} from "./attachmentUtils.ts";
import styles from "./ComposerAttachments.module.css";

export type PendingComposerAttachment = ConversationAttachment & {
  id: string;
  sizeBytes: number;
  previewUrl?: string;
};

type AttachmentFailure = "unsupported" | "image-too-large" | "text-too-large" | "invalid-name";

class AttachmentInputError extends Error {
  readonly code: AttachmentFailure;

  constructor(code: AttachmentFailure) {
    super(code);
    this.code = code;
  }
}

export function useComposerAttachments(enabled: boolean, contextKey: string) {
  const [attachments, setAttachments] = useState<PendingComposerAttachment[]>([]);
  const [error, setError] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const attachmentsRef = useRef<PendingComposerAttachment[]>([]);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const taskCountRef = useRef(0);
  const dragDepthRef = useRef(0);
  const enabledRef = useRef(enabled);
  const contextKeyRef = useRef(contextKey);
  const previousContextKeyRef = useRef(contextKey);
  const mountedRef = useRef(true);
  enabledRef.current = enabled;
  contextKeyRef.current = contextKey;

  const replaceAttachments = useCallback((next: PendingComposerAttachment[]) => {
    attachmentsRef.current = next;
    setAttachments(next);
  }, []);

  const clear = useCallback(() => {
    for (const attachment of attachmentsRef.current) {
      if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
    }
    replaceAttachments([]);
    setError("");
  }, [replaceAttachments]);

  const remove = useCallback(
    (attachmentId: string) => {
      const removed = attachmentsRef.current.find((attachment) => attachment.id === attachmentId);
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
      replaceAttachments(
        attachmentsRef.current.filter((attachment) => attachment.id !== attachmentId),
      );
    },
    [replaceAttachments],
  );

  const getRequestAttachments = useCallback(
    (): ConversationAttachment[] =>
      attachmentsRef.current.map(({ name, mimeType, kind, data }) => ({
        name,
        mimeType,
        kind,
        data,
      })),
    [],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      for (const attachment of attachmentsRef.current) {
        if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
      }
    };
  }, []);

  useEffect(() => {
    if (previousContextKeyRef.current === contextKey) return;
    previousContextKeyRef.current = contextKey;
    clear();
  }, [clear, contextKey]);

  const addFiles = useCallback(
    (files: File[]) => {
      if (!enabledRef.current || files.length === 0) return;
      const queueContextKey = contextKeyRef.current;
      taskCountRef.current += 1;
      setIsPreparing(true);
      setError("");

      queueRef.current = queueRef.current
        .then(async () => {
          if (!mountedRef.current || contextKeyRef.current !== queueContextKey) return;
          const warnings: string[] = [];
          for (const file of files) {
            if (!mountedRef.current || contextKeyRef.current !== queueContextKey) break;
            if (attachmentsRef.current.length >= MAX_CONVERSATION_ATTACHMENTS) {
              warnings.push(t.chat.attachmentLimit);
              break;
            }
            try {
              const attachment = await prepareAttachment(file);
              if (!mountedRef.current || contextKeyRef.current !== queueContextKey) {
                if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
                break;
              }
              replaceAttachments([...attachmentsRef.current, attachment]);
            } catch (fileError) {
              if (contextKeyRef.current === queueContextKey) {
                warnings.push(attachmentFailureMessage(fileError, file.name));
              }
            }
          }
          if (
            warnings.length > 0 &&
            mountedRef.current &&
            contextKeyRef.current === queueContextKey
          ) {
            setError([...new Set(warnings)].slice(0, 3).join(" "));
          }
        })
        .catch(() => {
          if (mountedRef.current && contextKeyRef.current === queueContextKey) {
            setError(t.chat.attachmentReadFailed("arquivo"));
          }
        })
        .finally(() => {
          taskCountRef.current -= 1;
          if (mountedRef.current && taskCountRef.current === 0) setIsPreparing(false);
        });
    },
    [replaceAttachments],
  );

  const onPaste: ClipboardEventHandler<HTMLTextAreaElement> = useCallback(
    (event) => {
      const files = Array.from(event.clipboardData.items)
        .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
        .map((item) => item.getAsFile())
        .filter((file): file is File => file !== null);
      if (files.length === 0) return;
      event.preventDefault();
      addFiles(files);
    },
    [addFiles],
  );

  const onDragEnter: DragEventHandler<HTMLFormElement> = useCallback((event) => {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDragging(true);
  }, []);

  const onDragLeave: DragEventHandler<HTMLFormElement> = useCallback((event) => {
    if (dragDepthRef.current === 0) return;
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDragging(false);
  }, []);

  const onDragOver: DragEventHandler<HTMLFormElement> = useCallback((event) => {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const onDrop: DragEventHandler<HTMLFormElement> = useCallback(
    (event) => {
      if (event.dataTransfer.files.length === 0) return;
      event.preventDefault();
      dragDepthRef.current = 0;
      setIsDragging(false);
      addFiles(Array.from(event.dataTransfer.files));
    },
    [addFiles],
  );

  return {
    attachments,
    error,
    isDragging,
    isPreparing,
    addFiles,
    clear,
    getRequestAttachments,
    onDragEnter,
    onDragLeave,
    onDragOver,
    onDrop,
    onPaste,
    remove,
  };
}

export function AttachmentPicker({
  disabled,
  onFiles,
}: {
  disabled: boolean;
  onFiles: (files: File[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        aria-label={t.chat.attachFile}
        aria-description={t.chat.attachmentRules}
        className={styles.attachButton}
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        title={t.chat.attachmentRules}
        type="button"
      >
        <Paperclip aria-hidden="true" size={16} />
      </button>
      <input
        aria-label={t.chat.chooseAttachments}
        className={styles.fileInput}
        multiple
        onChange={(event) => {
          onFiles(Array.from(event.currentTarget.files ?? []));
          event.currentTarget.value = "";
        }}
        ref={inputRef}
        type="file"
      />
    </>
  );
}

export function AttachmentChips({
  attachments,
  disabled = false,
  onRemove,
}: {
  attachments: PendingComposerAttachment[];
  disabled?: boolean;
  onRemove: (id: string) => void;
}) {
  if (attachments.length === 0) return null;
  return (
    <section aria-label={t.chat.pendingAttachments} className={styles.pendingAttachments}>
      {attachments.map((attachment) => (
        <div className={styles.pendingAttachment} key={attachment.id}>
          {attachment.kind === "image" && attachment.previewUrl ? (
            <img alt="" className={styles.attachmentThumbnail} src={attachment.previewUrl} />
          ) : (
            <span aria-hidden="true" className={styles.attachmentIcon}>
              {attachment.kind === "image" ? <ImageIcon size={16} /> : <FileText size={16} />}
            </span>
          )}
          <span className={styles.pendingAttachmentText}>
            <span className={styles.pendingAttachmentName} title={attachment.name}>
              {attachment.name}
            </span>
            <span className={styles.pendingAttachmentSize}>
              {formatAttachmentSize(attachment.sizeBytes)}
            </span>
          </span>
          <button
            aria-label={t.chat.removeAttachment(attachment.name)}
            className={styles.removeAttachment}
            disabled={disabled}
            onClick={() => onRemove(attachment.id)}
            title={t.chat.removeAttachment(attachment.name)}
            type="button"
          >
            <X aria-hidden="true" size={14} />
          </button>
        </div>
      ))}
    </section>
  );
}

async function prepareAttachment(file: File): Promise<PendingComposerAttachment> {
  const fileInfo = classifyAttachmentFile(file);
  if (!fileInfo) throw new AttachmentInputError("unsupported");

  const name = file.name || fallbackAttachmentName(fileInfo.kind, fileInfo.mimeType);
  if (name.trim() !== name || name.length > 255 || /\p{Cc}/u.test(name)) {
    throw new AttachmentInputError("invalid-name");
  }

  if (fileInfo.kind === "image") {
    if (file.size > MAX_IMAGE_ATTACHMENT_BYTES) {
      throw new AttachmentInputError("image-too-large");
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength > MAX_IMAGE_ATTACHMENT_BYTES) {
      throw new AttachmentInputError("image-too-large");
    }
    return {
      id: crypto.randomUUID(),
      name,
      mimeType: fileInfo.mimeType,
      kind: "image",
      data: encodeBase64(bytes),
      sizeBytes: bytes.byteLength,
      previewUrl: URL.createObjectURL(file),
    };
  }

  if (file.size > MAX_TEXT_ATTACHMENT_BYTES) {
    throw new AttachmentInputError("text-too-large");
  }
  const data = await file.text();
  const sizeBytes = new TextEncoder().encode(data).byteLength;
  if (sizeBytes > MAX_TEXT_ATTACHMENT_BYTES) {
    throw new AttachmentInputError("text-too-large");
  }
  return {
    id: crypto.randomUUID(),
    name,
    mimeType: fileInfo.mimeType,
    kind: "text",
    data,
    sizeBytes,
  };
}

function fallbackAttachmentName(kind: "image" | "text", mimeType: string): string {
  if (kind === "text" && mimeType === "application/json") return "arquivo.json";
  const extension =
    mimeType === "image/jpeg"
      ? "jpg"
      : mimeType.split("/")[1] || (kind === "image" ? "png" : "txt");
  return `${kind === "image" ? "imagem-colada" : "arquivo"}.${extension}`;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 32_768;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function attachmentFailureMessage(error: unknown, name: string): string {
  const safeName = name.trim() || "arquivo";
  if (!(error instanceof AttachmentInputError)) return t.chat.attachmentReadFailed(safeName);
  switch (error.code) {
    case "unsupported":
      return t.chat.attachmentUnsupported(safeName);
    case "image-too-large":
      return t.chat.attachmentImageTooLarge(safeName);
    case "text-too-large":
      return t.chat.attachmentTextTooLarge(safeName);
    case "invalid-name":
      return t.chat.attachmentInvalidName;
  }
}

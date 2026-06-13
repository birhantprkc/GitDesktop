import { useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { useFileAtRev } from "@/lib/git/queries";

const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  ico: "image/x-icon",
  svg: "image/svg+xml",
};

/** The MIME type when the path looks like a displayable image. */
export function imageMime(filePath: string): string | null {
  const dot = filePath.lastIndexOf(".");
  if (dot === -1) return null;
  return IMAGE_MIME[filePath.slice(dot + 1).toLowerCase()] ?? null;
}

/** Where to read each side of an image diff: a rev, or null = working tree. */
export interface ImageRevs {
  old: string | null;
  new: string | null;
}

function ImageSide({
  label,
  base64,
  mime,
}: {
  label: string;
  base64: string;
  mime: string;
}) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  return (
    <figure className="min-w-0 max-w-[45%] space-y-1.5 text-center">
      <figcaption className="text-xs font-medium text-muted-foreground">
        {label}
      </figcaption>
      <div
        className="inline-block border"
        // Checkerboard so transparency reads as transparency.
        style={{
          backgroundImage:
            "conic-gradient(rgba(128,128,128,0.2) 25%, transparent 0 50%, rgba(128,128,128,0.2) 0 75%, transparent 0)",
          backgroundSize: "16px 16px",
        }}
      >
        <img
          alt={label}
          src={`data:${mime};base64,${base64}`}
          className="max-h-[60vh] max-w-full"
          onLoad={(e) =>
            setSize({
              w: e.currentTarget.naturalWidth,
              h: e.currentTarget.naturalHeight,
            })
          }
        />
      </div>
      {size && (
        <p className="text-[11px] text-muted-foreground tabular-nums">
          {size.w} × {size.h}
        </p>
      )}
    </figure>
  );
}

/**
 * The old/new comparison panes by themselves — also embedded above the text
 * diff for SVGs, which are text but deserve a rendered preview too.
 */
export function ImagePanes({
  repoPath,
  filePath,
  revs,
}: {
  repoPath: string;
  filePath: string;
  revs: ImageRevs;
}) {
  const mime = imageMime(filePath) ?? "application/octet-stream";
  const oldFile = useFileAtRev(repoPath, revs.old, filePath, true);
  const newFile = useFileAtRev(repoPath, revs.new, filePath, true);

  const pending = oldFile.isPending || newFile.isPending;
  const oldB64 = oldFile.data ?? null;
  const newB64 = newFile.data ?? null;

  if (pending) {
    return (
      <div className="flex justify-center gap-6 p-6">
        <Skeleton className="h-40 w-40" />
        <Skeleton className="h-40 w-40" />
      </div>
    );
  }
  return (
    <div className="flex items-start justify-center gap-8 p-6">
      {oldB64 !== null && (
        <ImageSide
          label={newB64 === null ? "Deleted" : "Old"}
          base64={oldB64}
          mime={mime}
        />
      )}
      {newB64 !== null && (
        <ImageSide
          label={oldB64 === null ? "Added" : "New"}
          base64={newB64}
          mime={mime}
        />
      )}
      {oldB64 === null && newB64 === null && (
        <p className="py-8 text-xs text-muted-foreground">
          Could not load this image.
        </p>
      )}
    </div>
  );
}

/**
 * Old/new rendering for binary image files, replacing the "binary file"
 * placeholder wherever local revisions are available.
 */
export function ImageDiff({
  repoPath,
  filePath,
  revs,
}: {
  repoPath: string;
  filePath: string;
  revs: ImageRevs;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-3 py-1.5">
        <span className="truncate font-mono text-xs text-muted-foreground">
          {filePath}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <ImagePanes repoPath={repoPath} filePath={filePath} revs={revs} />
      </div>
    </div>
  );
}

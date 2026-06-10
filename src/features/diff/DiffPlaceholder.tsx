import { FileIcon } from "@phosphor-icons/react";

export function DiffPlaceholder({ message }: { message: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
      <FileIcon className="size-8" />
      <p className="text-xs">{message}</p>
    </div>
  );
}

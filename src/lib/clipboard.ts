import { toast } from "sonner";

export async function copyText(text: string, message = "Copied") {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(message);
  } catch {
    toast.error("Could not copy to clipboard");
  }
}

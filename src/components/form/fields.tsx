import { type ReactNode, useId } from "react";
import { MarkdownEditor } from "@/components/markdown-editor";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useFieldContext } from "@/lib/form-context";

/**
 * Bound form fields (used as `<field.TextField …/>` inside
 * `<form.AppField>`). Validation follows the app's quiet style: validators
 * gate the submit button; the only inline text is the optional `warning` —
 * a non-blocking hint, e.g. "Will be created as my-branch".
 */

function FieldWarning({
  value,
  warning,
}: {
  value: string;
  warning?: (value: string) => string | null;
}) {
  const message = warning?.(value);
  if (!message) return null;
  return (
    <p className="text-xs text-amber-600 dark:text-amber-400">{message}</p>
  );
}

export function TextField({
  label,
  placeholder,
  type,
  autoFocus,
  disabled,
  className,
  warning,
}: {
  label?: ReactNode;
  placeholder?: string;
  type?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  className?: string;
  warning?: (value: string) => string | null;
}) {
  const field = useFieldContext<string>();
  const id = useId();
  return (
    <div className="space-y-2">
      {label && <Label htmlFor={id}>{label}</Label>}
      <Input
        id={id}
        type={type}
        placeholder={placeholder}
        autoFocus={autoFocus}
        disabled={disabled}
        className={className}
        autoComplete="off"
        value={field.state.value}
        onChange={(e) => field.handleChange(e.target.value)}
        onBlur={field.handleBlur}
      />
      <FieldWarning value={field.state.value} warning={warning} />
    </div>
  );
}

export function TextareaField({
  label,
  placeholder,
  rows,
  disabled,
  className,
}: {
  label?: ReactNode;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  className?: string;
}) {
  const field = useFieldContext<string>();
  const id = useId();
  return (
    <div className="space-y-2">
      {label && <Label htmlFor={id}>{label}</Label>}
      <Textarea
        id={id}
        placeholder={placeholder}
        rows={rows}
        disabled={disabled}
        className={className}
        value={field.state.value}
        onChange={(e) => field.handleChange(e.target.value)}
        onBlur={field.handleBlur}
      />
    </div>
  );
}

export function MarkdownField({
  label,
  placeholder,
  rows,
  disabled,
  textareaClassName,
  actions,
}: {
  label?: ReactNode;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  textareaClassName?: string;
  actions?: ReactNode;
}) {
  const field = useFieldContext<string>();
  const id = useId();
  return (
    <div className="space-y-2">
      {label && <Label htmlFor={id}>{label}</Label>}
      <MarkdownEditor
        id={id}
        placeholder={placeholder}
        rows={rows}
        disabled={disabled}
        textareaClassName={textareaClassName}
        actions={actions}
        value={field.state.value}
        onChange={field.handleChange}
      />
    </div>
  );
}

export function CheckboxField({
  label,
  disabled,
  className,
}: {
  label: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  const field = useFieldContext<boolean>();
  return (
    <label
      className={
        className ??
        "flex cursor-pointer items-center gap-2 text-xs text-muted-foreground"
      }
    >
      <Checkbox
        checked={field.state.value}
        disabled={disabled}
        onCheckedChange={(checked) => field.handleChange(checked === true)}
        onBlur={field.handleBlur}
      />
      {label}
    </label>
  );
}

export function SelectField({
  label,
  items,
  disabled,
}: {
  label?: ReactNode;
  /** value → display label; option order follows the object's key order. */
  items: Record<string, string>;
  disabled?: boolean;
}) {
  const field = useFieldContext<string>();
  return (
    <div className="space-y-2">
      {label && <Label>{label}</Label>}
      <Select
        items={items}
        value={field.state.value || null}
        onValueChange={(v) => {
          if (v) field.handleChange(v);
        }}
        disabled={disabled}
      >
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(items).map(([value, display]) => (
            <SelectItem key={value} value={value}>
              {display}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

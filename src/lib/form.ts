import { createFormHook } from "@tanstack/react-form";
import {
  CheckboxField,
  MarkdownField,
  SelectField,
  TextareaField,
  TextField,
} from "@/components/form/fields";
import { SubmitButton } from "@/components/form/submit-button";
import { fieldContext, formContext } from "@/lib/form-context";

/**
 * The app's form hook. Fields render via `<form.AppField name="…">` →
 * `<field.TextField …/>` etc.; `<form.AppForm><form.SubmitButton/></form.AppForm>`
 * gives a canSubmit-gated submit button. Async `onSubmit` handlers drive the
 * submitting spinner, so mutations should be awaited (`mutateAsync`).
 */
export const { useAppForm, withForm } = createFormHook({
  fieldContext,
  formContext,
  fieldComponents: {
    TextField,
    TextareaField,
    MarkdownField,
    CheckboxField,
    SelectField,
  },
  formComponents: {
    SubmitButton,
  },
});

/** A field validator for "must not be blank" (gates submit, renders no text). */
export function required(value: string): string | undefined {
  return value.trim() ? undefined : "Required";
}

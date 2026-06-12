import { createFormHookContexts } from "@tanstack/react-form";

// Shared contexts wiring the bound field/form components to whichever form
// renders them. Split from lib/form.ts so the field components can import
// the contexts without a circular dependency.
export const { fieldContext, formContext, useFieldContext, useFormContext } =
  createFormHookContexts();

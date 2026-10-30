import { useId, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";

/** Wording can change independently of the typed answer and its permissions. */
export function WorkflowNarrativeField({ content, onChange, className = "entry-field", requiredLabel, ...input }: {
  content: { label: string; helpText?: string };
  onChange: (value: string) => void;
  className?: string;
  requiredLabel?: boolean;
} & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange" | "className" | "content">) {
  const generatedId = useId();
  const id = input.id ?? `workflow-narrative-${generatedId}`;
  const helpId = `${id}-help`;
  return <label className={className} htmlFor={id}><span>{content.label}{requiredLabel ? <strong> Required</strong> : null}</span>
    <textarea {...input} id={id} aria-describedby={[input["aria-describedby"], content.helpText ? helpId : undefined].filter(Boolean).join(" ") || undefined} onChange={event => onChange(event.target.value)} />
    {content.helpText ? <small id={helpId} style={{ whiteSpace: "pre-line" }}>{content.helpText}</small> : null}
  </label>;
}

export function WorkflowTextField({ content, onChange, className = "entry-field", ...input }: {
  content: { label: string; helpText?: string };
  onChange: (value: string) => void;
  className?: string;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "className" | "content">) {
  const generatedId = useId();
  const id = input.id ?? `workflow-text-${generatedId}`;
  const helpId = `${id}-help`;
  return <label className={className} htmlFor={id}><span>{content.label}</span>
    <input {...input} id={id} aria-describedby={[input["aria-describedby"], content.helpText ? helpId : undefined].filter(Boolean).join(" ") || undefined} onChange={event => onChange(event.target.value)} />
    {content.helpText ? <small id={helpId}>{content.helpText}</small> : null}
  </label>;
}

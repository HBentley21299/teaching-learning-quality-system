import { ExternalLink } from "lucide-react";

export function FullRecordLink({
  recordId,
  recordType,
  label = "Open record",
  className = "record-link"
}: {
  recordId: string;
  recordType: string;
  label?: string;
  className?: string;
}) {
  return (
    <a
      className={className}
      href={`#/records/${encodeURIComponent(recordType)}/${encodeURIComponent(recordId)}`}
    >
      <ExternalLink aria-hidden="true" size={14} />
      <span>{label}</span>
    </a>
  );
}

export function ActionDetailLink({ actionId, label = "View details" }: { actionId: string; label?: string }) {
  return (
    <a className="record-link" href={`#/actions/${encodeURIComponent(actionId)}`}>
      <ExternalLink aria-hidden="true" size={14} />
      <span>{label}</span>
    </a>
  );
}

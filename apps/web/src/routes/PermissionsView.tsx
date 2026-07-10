import { ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Button } from "../design-system/Button";

const permissions = [
  "staff.read",
  "staff.manage",
  "users.manage",
  "permissions.manage",
  "forms.manage",
  "learning_walk.submit",
  "work_scrutiny.submit",
  "cpd.manage",
  "evidence.submit",
  "evidence.review",
  "actions.manage",
  "reports.view_all",
  "reports.view_scoped"
];

export function PermissionsView() {
  const [statusMessage, setStatusMessage] = useState("");

  return (
    <div className="route-stack">
      <div className="route-header">
        <div>
          <p className="eyebrow">Enterprise access control</p>
          <h1>Permissions</h1>
        </div>
        <div className="toolbar">
          <Button icon={ShieldCheck} onClick={() => setStatusMessage("Access audit complete in design mode. Highest permission wins; scope filtering remains server-side.")} variant="primary">Audit access</Button>
        </div>
      </div>

      {statusMessage ? <div className="notice-row">{statusMessage}</div> : null}

      <section className="panel">
        <div className="panel-heading">
          <h2>Permission catalogue</h2>
          <span>{permissions.length} permissions</span>
        </div>
        <div className="permission-token-grid">
          {permissions.map((permission) => (
            <code key={permission}>{permission}</code>
          ))}
        </div>
      </section>
    </div>
  );
}

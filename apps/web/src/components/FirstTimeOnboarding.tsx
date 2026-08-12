import { Building2, CheckCircle2, LogOut, UsersRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "../design-system/Button";
import { api } from "../services/api";
import { getLocalToken, isAuthEnabled, signOut } from "../services/auth";
import type { CurrentUser, StaffOnboardingOptions } from "../services/types";

type FirstTimeOnboardingProps = {
  email: string;
  onComplete: (user: CurrentUser) => Promise<void> | void;
};

export function FirstTimeOnboarding({ email, onComplete }: FirstTimeOnboardingProps) {
  const [options, setOptions] = useState<StaffOnboardingOptions | null>(null);
  const [facultyId, setFacultyId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [staffCategory, setStaffCategory] = useState("");
  const [message, setMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    api.staffOnboardingOptions()
      .then(setOptions)
      .catch(() => setMessage("Account setup options could not be loaded. Please refresh and try again."));
  }, []);

  const teams = useMemo(
    () => options?.teams.filter((team) => team.parentOrgUnitId === facultyId) ?? [],
    [facultyId, options?.teams]
  );

  async function completeOnboarding() {
    if (!facultyId || !teamId || !staffCategory) {
      setMessage("Select your faculty, team and staff category.");
      return;
    }

    setIsSaving(true);
    setMessage("");
    const result = await api.completeStaffOnboarding({
      facultyOrgUnitId: facultyId,
      teamOrgUnitId: teamId,
      staffCategory
    });
    setIsSaving(false);
    if (!result.ok || !result.data) {
      setMessage(result.message ?? "Your account could not be created.");
      return;
    }
    await onComplete(result.data);
  }

  return (
    <main className="onboarding-shell">
      <header className="onboarding-header">
        <div className="brand-block onboarding-brand">
          <div className="brand-mark">iE</div>
          <div><strong>i-Elevate</strong><span>Teaching &amp; Learning</span></div>
        </div>
        {isAuthEnabled || getLocalToken() ? (
          <button className="icon-button" onClick={signOut} title="Sign out" type="button">
            <LogOut aria-hidden="true" size={17} />
          </button>
        ) : null}
      </header>

      <section className="onboarding-workspace">
        <div className="onboarding-heading">
          <span className="eyebrow">First sign-in</span>
          <h1>Set up your staff account</h1>
          <p>{email}</p>
        </div>

        <div className="onboarding-form">
          <label className="entry-field">
            <span><Building2 aria-hidden="true" size={16} /> Faculty <strong>Required</strong></span>
            <select
              disabled={!options || isSaving}
              onChange={(event) => { setFacultyId(event.target.value); setTeamId(""); }}
              value={facultyId}
            >
              <option value="">Select faculty</option>
              {options?.faculties.map((faculty) => (
                <option key={faculty.id} value={faculty.id}>{faculty.code} - {faculty.name}</option>
              ))}
            </select>
          </label>

          <label className="entry-field">
            <span><UsersRound aria-hidden="true" size={16} /> Team <strong>Required</strong></span>
            <select disabled={!facultyId || isSaving} onChange={(event) => setTeamId(event.target.value)} value={teamId}>
              <option value="">Select team</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>{team.code} - {team.name}</option>
              ))}
            </select>
          </label>

          <fieldset className="onboarding-category-fieldset" disabled={!options || isSaving}>
            <legend>Staff category <strong>Required</strong></legend>
            <div className="onboarding-category-options">
              {options?.categories.map((category) => (
                <label className={staffCategory === category.key ? "is-selected" : ""} key={category.key}>
                  <input
                    checked={staffCategory === category.key}
                    name="staff-category"
                    onChange={() => setStaffCategory(category.key)}
                    type="radio"
                    value={category.key}
                  />
                  <span>{category.name}</span>
                </label>
              ))}
            </div>
          </fieldset>

          {message ? <div className="notice-row" role="alert">{message}</div> : null}

          <div className="onboarding-actions">
            <Button
              disabled={isSaving || !options}
              icon={CheckCircle2}
              onClick={() => void completeOnboarding()}
              variant="primary"
            >
              {isSaving ? "Creating account..." : "Enter i-Elevate"}
            </Button>
          </div>
        </div>
      </section>
    </main>
  );
}

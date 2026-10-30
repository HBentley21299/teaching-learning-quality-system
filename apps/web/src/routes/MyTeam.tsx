import { AlertTriangle, ArrowUpDown, ChevronLeft, ChevronRight, ListChecks, Search, UserRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { DataTable } from "../components/DataTable";
import { WorkflowFilters } from "../components/WorkflowFilters";
import { LoadingState } from "../components/LoadingState";
import { Button } from "../design-system/Button";
import { api } from "../services/api";
import { distinctListValues, matchesListSearch, sortListRows } from "../services/listQuery";
import type { MyTeamMember } from "../services/types";

type MyTeamProps = {
  onOpenActions: (staffId: string) => void;
  onOpenProfile: (staffId: string) => void;
};

type TeamSort = "name" | "open_desc" | "overdue_desc" | "judgement" | "elevate_level_desc" | "email" | "externalId" | "faculty" | "team" | "role" | "status";

export function MyTeam({ onOpenActions, onOpenProfile }: MyTeamProps) {
  const [members, setMembers] = useState<MyTeamMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [search, setSearch] = useState("");
  const [facultyId, setFacultyId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [actionFilter, setActionFilter] = useState<"all" | "open" | "overdue">("all");
  const [sort, setSort] = useState<TeamSort>("name");
  const [direction, setDirection] = useState<"asc" | "desc">("asc");
  const [role, setRole] = useState("");
  const [outcome, setOutcome] = useState("");
  const [level, setLevel] = useState("");
  const [accountStatus, setAccountStatus] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 25;

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setLoadError("");
    api.myTeam()
      .then((nextMembers) => {
        if (!cancelled) {
          setMembers(nextMembers);
          setLoadError("");
        }
      })
      .catch(() => {
        if (!cancelled) setLoadError("Your team could not be loaded. Check your connection and try again.");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => { cancelled = true; };
  }, [loadAttempt]);

  const faculties = useMemo(
    () => uniqueUnits(members.flatMap((member) => member.faculties)),
    [members]
  );
  const teams = useMemo(
    () => uniqueUnits(
      members
        .filter((member) => !facultyId || member.faculties.some((faculty) => faculty.id === facultyId))
        .flatMap((member) => member.teams)
    ),
    [facultyId, members]
  );
  const visibleMembers = useMemo(() => {
    return sortListRows(members
      .filter((member) => {
        const matchesSearch = matchesListSearch(search,
          member.displayName,
          member.externalId,
          member.email,
          ...member.faculties.flatMap((unit) => [unit.code, unit.name]),
          ...member.teams.flatMap((unit) => [unit.code, unit.name]),
          ...member.roleNames, member.accountStatus, member.openActionCount, member.overdueActionCount,
          member.canOpenProfile ? member.elevateJudgement ?? "Not yet submitted" : "Restricted",
          member.canOpenProfile ? member.elevateLevel ? `Level ${member.elevateLevel}` : "Not awarded" : "Restricted"
        );
        return matchesSearch
          && (!facultyId || member.faculties.some((unit) => unit.id === facultyId))
          && (!teamId || member.teams.some((unit) => unit.id === teamId))
          && (!role || member.roleNames.includes(role))
          && (!accountStatus || member.accountStatus === accountStatus)
          && (!outcome || (member.canOpenProfile && (member.elevateJudgement ?? "Not yet submitted") === outcome))
          && (!level || (member.canOpenProfile && String(member.elevateLevel ?? 0) === level))
          && (actionFilter === "all" || (actionFilter === "open" && member.openActionCount > 0) || (actionFilter === "overdue" && member.overdueActionCount > 0));
      }), member => {
        if (sort === "open_desc") return member.openActionCount;
        if (sort === "overdue_desc") return member.overdueActionCount;
        if (sort === "judgement") return member.canOpenProfile ? member.elevateJudgement : undefined;
        if (sort === "elevate_level_desc") return member.canOpenProfile ? member.elevateLevel ?? 0 : undefined;
        if (sort === "faculty") return member.faculties.map(unit => unit.code).join(", ");
        if (sort === "team") return member.teams.map(unit => unit.code).join(", ");
        if (sort === "role") return member.roleNames.join(", ");
        if (sort === "status") return member.accountStatus;
        return sort === "email" ? member.email : sort === "externalId" ? member.externalId : member.displayName;
      }, direction, member => `${member.displayName}:${member.staffId}`);
  }, [actionFilter, facultyId, members, search, sort, teamId, direction, role, outcome, level, accountStatus]);

  const totals = {
    staff: members.length,
    open: members.reduce((total, member) => total + member.openActionCount, 0),
    overdue: members.reduce((total, member) => total + member.overdueActionCount, 0)
  };
  const pageCount = Math.max(1, Math.ceil(visibleMembers.length / pageSize));
  const pageMembers = visibleMembers.slice((page - 1) * pageSize, page * pageSize);
  const activeCount = [facultyId, teamId, role, outcome, level, accountStatus, actionFilter === "all" ? "" : actionFilter].filter(Boolean).length;
  const clearFilters = () => { setSearch(""); setFacultyId(""); setTeamId(""); setRole(""); setOutcome(""); setLevel(""); setAccountStatus(""); setActionFilter("all"); };

  useEffect(() => {
    setPage(1);
  }, [actionFilter, facultyId, search, sort, teamId, direction, role, outcome, level, accountStatus]);

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  return (
    <div className="route-stack my-team-workspace">
      <div className="route-header">
        <div><h1>My Team</h1><p>Find your team’s profiles, development and actions.</p></div>
      </div>

      <section className="my-team-metrics" aria-label="Team summary">
        <button disabled={isLoading || Boolean(loadError)} aria-pressed={actionFilter === "all"} onClick={() => setActionFilter("all")} type="button"><strong>{isLoading || loadError ? "—" : totals.staff}</strong><span>Team members</span></button>
        <button disabled={isLoading || Boolean(loadError)} aria-pressed={actionFilter === "open"} onClick={() => setActionFilter(actionFilter === "open" ? "all" : "open")} type="button"><strong>{isLoading || loadError ? "—" : totals.open}</strong><span>Open actions</span></button>
        <button disabled={isLoading || Boolean(loadError)} aria-pressed={actionFilter === "overdue"} onClick={() => setActionFilter(actionFilter === "overdue" ? "all" : "overdue")} type="button"><strong>{isLoading || loadError ? "—" : totals.overdue}</strong><span>Overdue</span></button>
      </section>

      <section className="panel my-team-panel">
        <div className="panel-heading"><h2>Team members</h2>{!isLoading && !loadError ? <span>{visibleMembers.length} shown</span> : null}</div>
        <WorkflowFilters activeCount={activeCount} hasQuery={Boolean(search)} onClear={clearFilters} primary={<>
          <label className="search-box"><Search size={16} aria-hidden="true" /><input aria-label="Search team members" onChange={(event) => setSearch(event.target.value)} placeholder="Search name, code, faculty or team" value={search} /></label>
          <label className="record-filter-field"><span><ArrowUpDown size={14} aria-hidden="true" />Sort by</span><select onChange={(event) => { const next = event.target.value as TeamSort; setSort(next); setDirection(next.endsWith("_desc") ? "desc" : "asc"); }} value={sort}><option value="name">Staff name</option><option value="email">Email</option><option value="externalId">Staff ID</option><option value="faculty">Faculty</option><option value="team">Team</option><option value="role">Role</option><option value="status">Account status</option><option value="open_desc">Open action count</option><option value="overdue_desc">Overdue action count</option><option value="judgement">Elevate outcome</option><option value="elevate_level_desc">Elevate level</option></select></label>
          <label className="record-filter-field"><span>Direction</span><select value={direction} onChange={event => setDirection(event.target.value as "asc" | "desc")}><option value="asc">Ascending</option><option value="desc">Descending</option></select></label>
        </>}>
          <label><span>Faculty</span><select onChange={(event) => { setFacultyId(event.target.value); setTeamId(""); }} value={facultyId}><option value="">All faculties</option>{faculties.map((unit) => <option key={unit.id} value={unit.id}>{unit.code} - {unit.name}</option>)}</select></label>
          <label><span>Team</span><select onChange={(event) => setTeamId(event.target.value)} value={teamId}><option value="">All teams</option>{teams.map((unit) => <option key={unit.id} value={unit.id}>{unit.code} - {unit.name}</option>)}</select></label>
          <label><span>Actions</span><select onChange={(event) => setActionFilter(event.target.value as "all" | "open" | "overdue")} value={actionFilter}><option value="all">Any status</option><option value="open">Has open actions</option><option value="overdue">Has overdue actions</option></select></label>
          <label><span>Role</span><select value={role} onChange={event => setRole(event.target.value)}><option value="">All roles</option>{distinctListValues(members.flatMap(member => member.roleNames)).map(value => <option key={value}>{value}</option>)}</select></label>
          <label><span>Account status</span><select value={accountStatus} onChange={event => setAccountStatus(event.target.value)}><option value="">All statuses</option>{distinctListValues(members.map(member => member.accountStatus)).map(value => <option key={value}>{value}</option>)}</select></label>
          <label><span>Elevate outcome</span><select value={outcome} onChange={event => setOutcome(event.target.value)}><option value="">All outcomes</option>{distinctListValues(members.filter(member => member.canOpenProfile).map(member => member.elevateJudgement ?? "Not yet submitted")).map(value => <option key={value}>{value}</option>)}</select></label>
          <label><span>Elevate level</span><select value={level} onChange={event => setLevel(event.target.value)}><option value="">All levels</option>{distinctListValues(members.filter(member => member.canOpenProfile).map(member => String(member.elevateLevel ?? 0))).map(value => <option key={value} value={value}>{value === "0" ? "Not awarded" : `Level ${value}`}</option>)}</select></label>
        </WorkflowFilters>

        {loadError ? <div className="empty-row" role="alert"><AlertTriangle size={18} aria-hidden="true" />{loadError}<Button onClick={() => setLoadAttempt(attempt => attempt + 1)} variant="quiet">Try again</Button></div> : isLoading ? (
          <LoadingState label="Loading your team…" />
        ) : visibleMembers.length === 0 ? (
          <div className="empty-row">{members.length ? <>No team members match the current filters. <Button onClick={clearFilters} variant="quiet">Clear filters</Button></> : "No team members are available to you yet."}</div>
        ) : (
          <DataTable rows={pageMembers} rowKey={(member) => member.staffId} columns={[
            { key: "staff", header: "Staff member", render: (member) => <span><strong>{member.displayName}</strong></span> },
            { key: "faculty", header: "Faculty", render: (member) => <UnitList units={member.faculties} /> },
            { key: "team", header: "Team", render: (member) => <UnitList units={member.teams} empty="No sub-team" /> },
            { key: "role", header: "Role", render: (member) => member.roleNames.join(", ") || "Not allocated" },
            { key: "actions", header: "Actions", render: (member) => <span className="team-action-count"><strong>{member.openActionCount}</strong> open{member.overdueActionCount ? <small>{member.overdueActionCount} overdue</small> : null}</span> },
            { key: "elevate", header: "Elevate Learning and Innovation", render: (member) => member.canOpenProfile ? <span className="team-judgement">{member.elevateJudgement ?? "Not yet submitted"}</span> : <span className="muted-copy">Restricted</span> },
            { key: "elevate-level", header: "Elevate level (this year)", render: (member) => !member.canOpenProfile ? <span className="muted-copy">Restricted</span> : member.elevateLevel ? <span className="team-judgement">Level {member.elevateLevel}</span> : <span className="muted-copy">Not awarded</span> },
            { key: "commands", header: "", render: (member) => <div className="team-row-commands"><Button disabled={!member.canOpenProfile} icon={UserRound} onClick={() => onOpenProfile(member.staffId)} variant="quiet">Personal Profile</Button><Button icon={ListChecks} onClick={() => onOpenActions(member.staffId)} variant="quiet">Actions</Button></div> }
          ]} />
        )}
        {!isLoading && !loadError && visibleMembers.length > pageSize ? (
          <div className="my-team-pagination">
            <span>Showing {(page - 1) * pageSize + 1}-{Math.min(page * pageSize, visibleMembers.length)} of {visibleMembers.length}</span>
            <div>
              <Button disabled={page === 1} icon={ChevronLeft} onClick={() => setPage((current) => Math.max(1, current - 1))} variant="quiet">Previous</Button>
              <strong>Page {page} of {pageCount}</strong>
              <Button disabled={page === pageCount} icon={ChevronRight} onClick={() => setPage((current) => Math.min(pageCount, current + 1))} variant="quiet">Next</Button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function uniqueUnits(units: MyTeamMember["faculties"]) {
  return [...new Map(units.map((unit) => [unit.id, unit])).values()]
    .sort((left, right) => left.name.localeCompare(right.name));
}

function UnitList({ units, empty = "Unassigned" }: { units: MyTeamMember["faculties"]; empty?: string }) {
  return units.length ? <span className="team-unit-list">{units.map((unit) => <span key={unit.id}><strong>{unit.code}</strong><small>{unit.name}</small></span>)}</span> : <span className="muted-copy">{empty}</span>;
}

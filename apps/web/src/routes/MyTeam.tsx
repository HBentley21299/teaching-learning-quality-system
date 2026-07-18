import { AlertTriangle, ArrowUpDown, ChevronLeft, ChevronRight, ListChecks, Search, UserRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { DataTable } from "../components/DataTable";
import { Button } from "../design-system/Button";
import { api } from "../services/api";
import type { MyTeamMember } from "../services/types";

type MyTeamProps = {
  onOpenActions: (staffId: string) => void;
  onOpenProfile: (staffId: string) => void;
};

type TeamSort = "name" | "open_desc" | "overdue_desc" | "judgement";

export function MyTeam({ onOpenActions, onOpenProfile }: MyTeamProps) {
  const [members, setMembers] = useState<MyTeamMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState("");
  const [facultyId, setFacultyId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [actionFilter, setActionFilter] = useState<"all" | "open" | "overdue">("all");
  const [sort, setSort] = useState<TeamSort>("name");
  const [page, setPage] = useState(1);
  const pageSize = 25;

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    api.myTeam()
      .then((nextMembers) => {
        if (!cancelled) {
          setMembers(nextMembers);
          setLoadError("");
        }
      })
      .catch(() => {
        if (!cancelled) setLoadError("Your team could not be loaded from the API.");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

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
    const query = search.trim().toLocaleLowerCase();
    return members
      .filter((member) => {
        const matchesSearch = !query || [
          member.displayName,
          member.externalId,
          member.email,
          ...member.faculties.flatMap((unit) => [unit.code, unit.name]),
          ...member.teams.flatMap((unit) => [unit.code, unit.name]),
          ...member.roleNames
        ].some((value) => value.toLocaleLowerCase().includes(query));
        return matchesSearch
          && (!facultyId || member.faculties.some((unit) => unit.id === facultyId))
          && (!teamId || member.teams.some((unit) => unit.id === teamId))
          && (actionFilter === "all" || (actionFilter === "open" && member.openActionCount > 0) || (actionFilter === "overdue" && member.overdueActionCount > 0));
      })
      .sort((left, right) => {
        if (sort === "open_desc") return right.openActionCount - left.openActionCount || left.displayName.localeCompare(right.displayName);
        if (sort === "overdue_desc") return right.overdueActionCount - left.overdueActionCount || left.displayName.localeCompare(right.displayName);
        if (sort === "judgement") return (left.elevateJudgement ?? "ZZZ").localeCompare(right.elevateJudgement ?? "ZZZ") || left.displayName.localeCompare(right.displayName);
        return left.displayName.localeCompare(right.displayName);
      });
  }, [actionFilter, facultyId, members, search, sort, teamId]);

  const totals = {
    staff: members.length,
    open: members.reduce((total, member) => total + member.openActionCount, 0),
    overdue: members.reduce((total, member) => total + member.overdueActionCount, 0)
  };
  const pageCount = Math.max(1, Math.ceil(visibleMembers.length / pageSize));
  const pageMembers = visibleMembers.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => {
    setPage(1);
  }, [actionFilter, facultyId, search, sort, teamId]);

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  return (
    <div className="route-stack my-team-workspace">
      <div className="route-header">
        <div><p className="eyebrow">Permission-scoped directory</p><h1>My Team</h1></div>
      </div>

      <section className="my-team-metrics" aria-label="Team summary">
        <button onClick={() => setActionFilter("all")} type="button"><strong>{totals.staff}</strong><span>Team members</span></button>
        <button onClick={() => setActionFilter("open")} type="button"><strong>{totals.open}</strong><span>Open actions</span></button>
        <button onClick={() => setActionFilter("overdue")} type="button"><strong>{totals.overdue}</strong><span>Overdue</span></button>
      </section>

      <section className="panel my-team-panel">
        <div className="panel-heading"><h2>Team members</h2><span>{visibleMembers.length} shown</span></div>
        <div className="my-team-filters">
          <label className="search-box"><Search size={16} aria-hidden="true" /><input aria-label="Search team members" onChange={(event) => setSearch(event.target.value)} placeholder="Search name, code, faculty or team" value={search} /></label>
          <label><span>Faculty</span><select onChange={(event) => { setFacultyId(event.target.value); setTeamId(""); }} value={facultyId}><option value="">All faculties</option>{faculties.map((unit) => <option key={unit.id} value={unit.id}>{unit.code} - {unit.name}</option>)}</select></label>
          <label><span>Team</span><select onChange={(event) => setTeamId(event.target.value)} value={teamId}><option value="">All teams</option>{teams.map((unit) => <option key={unit.id} value={unit.id}>{unit.code} - {unit.name}</option>)}</select></label>
          <label><span>Actions</span><select onChange={(event) => setActionFilter(event.target.value as "all" | "open" | "overdue")} value={actionFilter}><option value="all">Any status</option><option value="open">Has open actions</option><option value="overdue">Has overdue actions</option></select></label>
          <label><span><ArrowUpDown size={14} aria-hidden="true" />Sort by</span><select onChange={(event) => setSort(event.target.value as TeamSort)} value={sort}><option value="name">Staff name</option><option value="open_desc">Most open actions</option><option value="overdue_desc">Most overdue</option><option value="judgement">Elevate outcome</option></select></label>
        </div>

        {loadError ? <div className="empty-row"><AlertTriangle size={18} aria-hidden="true" />{loadError}</div> : isLoading ? (
          <div className="empty-row">Loading your team...</div>
        ) : visibleMembers.length === 0 ? (
          <div className="empty-row">No team members match the current filters.</div>
        ) : (
          <DataTable rows={pageMembers} rowKey={(member) => member.staffId} columns={[
            { key: "staff", header: "Staff member", render: (member) => <span><strong>{member.displayName}</strong><small className="table-subline">{member.externalId}</small></span> },
            { key: "faculty", header: "Faculty", render: (member) => <UnitList units={member.faculties} /> },
            { key: "team", header: "Team", render: (member) => <UnitList units={member.teams} empty="No sub-team" /> },
            { key: "role", header: "Role", render: (member) => member.roleNames.join(", ") || "Not allocated" },
            { key: "actions", header: "Actions", render: (member) => <span className="team-action-count"><strong>{member.openActionCount}</strong> open{member.overdueActionCount ? <small>{member.overdueActionCount} overdue</small> : null}</span> },
            { key: "elevate", header: "Elevate Learning and Innovation", render: (member) => member.canOpenProfile ? <span className="team-judgement">{member.elevateJudgement ?? "Not yet submitted"}</span> : <span className="muted-copy">Restricted</span> },
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

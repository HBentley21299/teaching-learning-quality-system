namespace TLQS.Api.V1;
public sealed record DashboardFacultySelection(string DashboardKey, IReadOnlyList<Guid> ExcludedFacultyIds);
public sealed record SaveDashboardFacultySelectionsRequest(IReadOnlyList<DashboardFacultySelection> Selections);

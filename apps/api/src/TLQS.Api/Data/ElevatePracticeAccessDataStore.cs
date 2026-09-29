using TLQS.Application.Security;

namespace TLQS.Api.Data;

public sealed partial class SqlFoundationDataStore
{
    public async Task<int?> GetStaffManagementDepthAsync(
        Guid staffId,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        if (!currentUser.UserAccountId.HasValue
            || !currentUser.StaffId.HasValue
            || currentUser.StaffId == staffId)
        {
            return null;
        }

        // Reuse the active management hierarchy, including its legacy line-manager
        // fallback, secondary-manager rules and cycle protection. Visibility from
        // an organisation scope or reporting permission is not management access.
        var rows = await QueryAsync(
            """
            SELECT visible.manager_depth
            FROM org.fn_visible_staff(@currentUserAccountId) visible
            WHERE visible.staff_id = @staffId
              AND visible.is_managed = 1
              AND visible.manager_depth > 0;
            """,
            command =>
            {
                command.Parameters.AddWithValue("@staffId", staffId);
                command.Parameters.AddWithValue("@currentUserAccountId", currentUser.UserAccountId.Value);
            },
            reader => (int?)reader.GetInt32(0),
            cancellationToken);

        return rows.FirstOrDefault();
    }
}

using TLQS.Application.Workflows;

namespace TLQS.Application.Security;

public static class AccountAdministrationPolicy
{
    public static void ValidateSelfAccess(bool isSelf, string? requestedStatus, bool? disabled, bool archived, bool removesAdministrator)
    {
        if (requestedStatus is not null && requestedStatus is not ("active" or "inactive" or "leaver"))
            throw new WorkflowValidationException("Choose Active, Inactive or Leaver for the account status.");
        if (isSelf && (disabled == true || archived || removesAdministrator || requestedStatus is "inactive" or "leaver"))
            throw new WorkflowValidationException("You cannot remove your own access. Ask another Administrator to make this change.");
    }
}

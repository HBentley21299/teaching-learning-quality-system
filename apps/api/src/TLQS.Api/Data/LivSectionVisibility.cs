using TLQS.Api.V1;
using TLQS.Application.Workflows;

namespace TLQS.Api.Data;

public static class LivSectionVisibility
{
    public static LivCaseSummary ForReader(LivCaseSummary record, Guid? currentStaffId)
    {
        var canReadPrivate = record.CanEdit || record.CanViewSensitive;
        var cycles = (record.Cycles ?? []).Select(cycle => cycle with
        {
            Stages = cycle.Stages.Select(stage =>
            {
                var canView = LivAccessPolicy.CanViewSection(stage.VisibleToStaff, record.CanEdit, record.CanViewSensitive);
                var canEdit = record.CanEdit || (canView && record.SubjectStaffId == currentStaffId
                    && stage.StageType is "pre_discussion" or "distance_impact");
                return stage with
                {
                    CanView = canView, CanEdit = canEdit,
                    ContextText = canView ? stage.ContextText : null,
                    AimsText = canView ? stage.AimsText : null,
                    LearnerActivityText = canView ? stage.LearnerActivityText : null,
                    ReflectionText = canView ? stage.ReflectionText : null,
                    IntendedFollowUpDate = canView ? stage.IntendedFollowUpDate : null,
                    DistanceImpactText = canView ? stage.DistanceImpactText : null,
                    DevelopmentOpportunityKeys = canView ? stage.DevelopmentOpportunityKeys : [],
                    VisitId = canView ? stage.VisitId : null
                };
            }).ToArray()
        }).ToArray();
        return record with
        {
            // This legacy field duplicates the first discussion.
            PreConversation = canReadPrivate || cycles.Any(cycle => cycle.CycleNumber == 1
                && cycle.Stages.Any(stage => stage.StageType == "pre_discussion" && stage.CanView)) ? record.PreConversation : null,
            Visits = record.Visits.Where(visit => canReadPrivate || cycles.Any(cycle =>
                cycle.Stages.Any(stage => stage.StageType == "visit" && stage.VisitId == visit.Id && stage.CanView))).ToArray(),
            Cycles = cycles
        };
    }
}

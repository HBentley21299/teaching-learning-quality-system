using TLQS.Domain.Common;

namespace TLQS.Domain.Quality;

public sealed class Activity : AuditableEntity
{
    public Guid RecordId { get; set; }
    public string ActivityType { get; set; } = string.Empty;
    public DateOnly ActivityDate { get; set; }
    public Guid? SubjectStaffId { get; set; }
    public Guid? ReviewerStaffId { get; set; }
    public Guid? OrgUnitId { get; set; }
    public string? ProgrammeArea { get; set; }
    public string? CourseLevel { get; set; }
    public string? Room { get; set; }
    public string? SummaryStrengths { get; set; }
    public string? SummaryDevelopment { get; set; }
}

public sealed class LearningWalkDetail
{
    public Guid ActivityId { get; set; }
    public string? VisitFocus { get; set; }
    public int? LearnersPresent { get; set; }
    public bool PublishToStaff { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? UpdatedAt { get; set; }
    public byte[] RowVersion { get; set; } = [];
}

public sealed class WorkScrutinyDetail
{
    public Guid ActivityId { get; set; }
    public int? SampleSize { get; set; }
    public string? WorkType { get; set; }
    public string? FeedbackStrategyNotes { get; set; }
    public bool PublishToStaff { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? UpdatedAt { get; set; }
    public byte[] RowVersion { get; set; } = [];
}

public sealed class WorkScrutinyCourseSample
{
    public Guid RecordId { get; set; }
    public Guid CourseId { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public sealed class ActionItem : AuditableEntity
{
    public Guid? SourceRecordId { get; set; }
    public string SourceFormType { get; set; } = "standalone";
    public string? SourceSubRecordType { get; set; }
    public Guid? SourceSubRecordId { get; set; }
    public string? SourceSubRecordKey { get; set; }
    public int? SourceDisplayOrder { get; set; }
    public Guid? SubjectStaffId { get; set; }
    public Guid OwnerStaffId { get; set; }
    public string Title { get; set; } = string.Empty;
    public string? Detail { get; set; }
    public Guid? PriorityLookupValueId { get; set; }
    public Guid? StatusLookupValueId { get; set; }
    public DateOnly? DueDate { get; set; }
    public DateOnly? OriginalDueDate { get; set; }
    public DateOnly? RevisedDueDate { get; set; }
    public DateOnly? CompletedDate { get; set; }
    public string? CompletionNote { get; set; }
    public Guid? CompletedByUserAccountId { get; set; }
    public DateTimeOffset? CancelledAt { get; set; }
    public Guid? CancelledByUserAccountId { get; set; }
    public string? CancellationComments { get; set; }
    public string VisibilitySetting { get; set; } = "staff_and_management";
    public bool ReminderEnabled { get; set; } = true;
    public DateTimeOffset? LastReminderSentAt { get; set; }
    public bool PublishedToStaff { get; set; }
    public Guid? CreatedByUserAccountId { get; set; }
    public Guid? UpdatedByUserAccountId { get; set; }
    public Guid? DeletedByUserAccountId { get; set; }
    public string? DeletionReason { get; set; }
}

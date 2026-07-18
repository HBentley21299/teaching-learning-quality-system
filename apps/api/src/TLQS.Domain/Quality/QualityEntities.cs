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
    public byte? PracticeObservedScore { get; set; }
    public string? PracticeObservedLabel { get; set; }
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

public sealed class ElevateEnvironmentAssessment
{
    public Guid RecordId { get; set; }
    public Guid RoomId { get; set; }
    public int TotalScore { get; set; }
    public byte ScoredValueCount { get; set; }
    public byte BarrierCount { get; set; }
    public byte BelowSecureCount { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? UpdatedAt { get; set; }
    public byte[] RowVersion { get; set; } = [];
}

public sealed class StaffProfileReflection : AuditableEntity
{
    public Guid RecordId { get; set; }
    public Guid StaffId { get; set; }
    public string Title { get; set; } = string.Empty;
    public string ReflectionText { get; set; } = string.Empty;
    public DateOnly ReflectionDate { get; set; }
    public Guid? CreatedByUserAccountId { get; set; }
}

public sealed class ActionItem : AuditableEntity
{
    public Guid? SourceRecordId { get; set; }
    public Guid? SubjectStaffId { get; set; }
    public Guid OwnerStaffId { get; set; }
    public string Title { get; set; } = string.Empty;
    public string? Detail { get; set; }
    public Guid? PriorityLookupValueId { get; set; }
    public Guid? StatusLookupValueId { get; set; }
    public DateOnly? DueDate { get; set; }
    public DateOnly? CompletedDate { get; set; }
    public bool ReminderEnabled { get; set; } = true;
    public DateTimeOffset? LastReminderSentAt { get; set; }
    public bool PublishedToStaff { get; set; }
    public Guid? CreatedByUserAccountId { get; set; }
}

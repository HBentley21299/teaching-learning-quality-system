using TLQS.Domain.Common;

namespace TLQS.Domain.Evidence;

public sealed class EvidenceItem : AuditableEntity
{
    public Guid StaffId { get; set; }
    public Guid? RelatedRecordId { get; set; }
    public Guid? RelatedActionId { get; set; }
    public Guid? MilestoneLookupValueId { get; set; }
    public DateOnly EvidenceDate { get; set; }
    public string? PillarOrTheme { get; set; }
    public string? WhatTried { get; set; }
    public string? ImplementationDetail { get; set; }
    public string? ImpactSummary { get; set; }
    public Guid? ImpactRatingLookupValueId { get; set; }
    public Guid? ReviewStatusLookupValueId { get; set; }
    public Guid? ReviewerStaffId { get; set; }
    public string? ReviewerNotes { get; set; }
    public Guid? CreatedByUserAccountId { get; set; }
}

public sealed class FileAsset
{
    public Guid Id { get; set; }
    public string BlobContainer { get; set; } = "evidence";
    public string BlobName { get; set; } = string.Empty;
    public string OriginalFileName { get; set; } = string.Empty;
    public string ContentType { get; set; } = string.Empty;
    public long FileSizeBytes { get; set; }
    public string? ChecksumSha256 { get; set; }
    public Guid? UploadedByUserAccountId { get; set; }
    public DateTimeOffset UploadedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? ArchivedAt { get; set; }
    public byte[] RowVersion { get; set; } = [];
}

public sealed class FileAttachment
{
    public Guid Id { get; set; }
    public Guid FileAssetId { get; set; }
    public Guid? EvidenceItemId { get; set; }
    public Guid? RecordId { get; set; }
    public string? SourceProcess { get; set; }
    public string? Notes { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}


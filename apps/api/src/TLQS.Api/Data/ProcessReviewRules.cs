using System.Globalization;
using System.Text.RegularExpressions;
using TLQS.Api.V1;
using TLQS.Application.Security;
using TLQS.Application.Workflows;

namespace TLQS.Api.Data;

public static partial class ProcessReviewRules
{
    public const string Digital = "digital_learning_walk";
    public const string Activate = "activate_growth_review";
    public static bool IsProcess(string key) => key is Digital or Activate;
    public static bool CanManageConfiguration(CurrentUser user) => user.UserAccountId.HasValue && user.HasPermission(PermissionKeys.FormsManage);
    public static bool CanCreate(CurrentUser user, string key) => user.UserAccountId.HasValue && user.StaffId.HasValue
        && (CanManageConfiguration(user) || user.HasPermission(key + ".submit") || user.HasPermission(key + ".manage"));
    public static bool CanViewAll(CurrentUser user, string key) => user.IsAdministrator || user.HasPermission(key + ".view_all");
    public static bool CanViewScoped(CurrentUser user, string key) => user.HasPermission(key + ".view_scoped") || user.HasPermission(key + ".manage");
    public static bool CanEdit(CurrentUser user, string key, Guid ownerStaffId, bool inScope) => user.UserAccountId.HasValue
        && (user.IsAdministrator || user.StaffId == ownerStaffId || (user.HasPermission(key + ".manage") && inScope));

    public static ProcessReviewConfiguration DefaultConfiguration(string key)
    {
        if (!IsProcess(key)) throw new WorkflowValidationException("Select a supported review process.");
        var digital = key == Digital;
        var groups = digital ? new (string Title, string[] Statements)[]
        {
            ("Learner Agency & Ownership", [
                "Learners can locate and revisit digital learning independently, using appropriate support where needed.",
                "Learners make purposeful choices about how they practise, develop or demonstrate their learning.",
                "Learners use information about their progress to identify and act on their next steps."]),
            ("Knowledge Construction & Thinking", [
                "Learners evaluate digital sources to develop and connect their subject knowledge.",
                "Learners interpret relevant data and use it to draw supported conclusions.",
                "Learners apply knowledge through digital tasks that address meaningful subject or vocational problems.",
                "Learners explain and justify the reasoning behind their work and decisions."]),
            ("Assessment, Feedback & Progress", [
                "Digital assessment provides useful evidence of learners’ understanding, gaps and misconceptions.",
                "Staff adapt teaching or support in response to digital assessment findings.",
                "Learner work or practice shows how feedback has been acted on.",
                "Digital records and learner work make progress over time visible."]),
            ("Creation & Communication", [
                "Learners create digital work with a clear subject or vocational purpose.",
                "Learners can explain the knowledge, skills and decisions demonstrated in their digital work.",
                "Learners adapt their digital communication to suit its intended audience.",
                "Learners review and refine the accuracy, clarity or quality of their digital work."]),
            ("Collaboration & Digital Environment", [
                "Learners can readily locate current course information, resources and activities in the digital classroom.",
                "Digital resources, assistive tools and support enable learners with differing access needs to participate.",
                "Digital collaboration is structured around clear learning goals and responsibilities.",
                "Shared digital work makes individual contributions and learning from peers visible."]),
            ("Digital Citizenship & Safety", [
                "Learners demonstrate relevant online safety practices, including protecting accounts and reporting concerns.",
                "Learners handle and share personal information appropriately.",
                "Learners communicate and participate professionally in digital spaces.",
                "Learners acknowledge sources and demonstrate academic and professional integrity.",
                "Learners’ use of AI follows college and assessment expectations, including checking outputs and acknowledging permitted assistance."])
        } : [
            ("Immersive Technology", []), ("Assistive Technology", []),
            ("Digital Teaching & Learning", []), ("IT", []), ("MIS", [])
        ];
        var standards = groups.Select((group, index) => new ProcessReviewStandard($"area_{index + 1}", group.Title,
            group.Statements.Select((text, statement) => new ProcessReviewStatement($"standard_{index + 1}_{statement + 1}", text)).ToArray())).ToArray();
        var labels = digital ? new Dictionary<string, string>
        {
            ["scope"] = "Scope and context", ["strengths"] = "Strengths and effective practice"
        } : new Dictionary<string, string>
        {
            ["teamsUrl"] = "Full proforma in Teams", ["headOfFacultyStaffId"] = "Head of faculty",
            ["initialPlannedDate"] = "Initial review · planned", ["initialHeldDate"] = "Initial review · held",
            ["progressPlannedDate"] = "Progress review · planned", ["progressHeldDate"] = "Progress review · held",
            ["attendeeStaffIds"] = "Actual attendees", ["snapshotDate"] = "Snapshot as of",
            ["sourceCheckedDate"] = "Teams source checked on", ["sourceMeeting"] = "Source meeting",
            ["reportedNeeds"] = "Reported needs", ["supportRequested"] = "Support requested",
            ["supportAgreed"] = "Support agreed / provider", ["impactSummary"] = "Impact evidenced so far",
            ["skillsScanTargetDate"] = "Skills Scan target closure", ["skillsScanCompletedDate"] = "Skills Scan actual closure",
            ["period"] = "Skills Scan reporting period", ["summaryUrl"] = "Skills Scan summary link",
            ["responsesReceived"] = "Responses received", ["eligibleStaff"] = "Confirmed eligible staff",
            ["packTargetDate"] = "Target preparation pack circulation", ["packCompletedDate"] = "Actual preparation pack circulation",
            ["gaps"] = "Evidence gaps or preparation barriers", ["changedPriorities"] = "Changed faculty priorities",
            ["impactEvidence"] = "Progress review impact evidence", ["impactLinks"] = "Progress review evidence links",
            ["outcomes"] = "Progress review outcomes", ["carryForward"] = "Priorities to carry into next cycle",
            ["escalations"] = "Barriers, escalation decisions and next steps"
        };
        var result=new ProcessReviewConfiguration(key, digital ? "Digital Learning Walks" : "Activate+ Growth Reviews", 1, null,
            standards, [], labels, new Dictionary<string, string>
            {
                ["requireSamplePerRating"] = "true", ["requireRationale"] = "false",
                ["initialWindow"] = "November–December", ["progressWindow"] = "April–May",
                ["meetingMinutes"] = "90", ["skillsScanLeadDays"] = "14",
                ["initialPackLeadDays"] = "7", ["progressPackLeadDays"] = "7"
            });
        return digital?result:ModernActivateConfiguration(result);
    }

    public static void ValidateConfiguration(string key, ProcessReviewConfiguration configuration)
    {
        if (!IsProcess(key) || configuration.ProcessKey != key) Fail("The configuration does not match this process.");
        Required(configuration.Title, 250, "Enter a form title.");
        if (configuration.Standards is null || configuration.Standards.Count is < 1 or > 50
            || configuration.Standards.Any(x => x is null || x.Statements is null)) Fail("Provide between 1 and 50 standards or specialist areas.");
        var standards = configuration.Standards!;
        if (standards.Select(x => x.Key).Distinct(StringComparer.OrdinalIgnoreCase).Count() != standards.Count) Fail("Every standard needs a unique key.");
        foreach (var standard in standards)
        {
            Key(standard.Key); Required(standard.Title, 300, "Enter a title for every standard.");
            if(standard.Statements.Any(x=>x is null))Fail("Provide valid statement definitions.");
            foreach (var statement in standard.Statements) { Key(statement.Key); Required(statement.Text, 2000, "Enter wording for every statement."); }
        }
        var statements = standards.SelectMany(x => x.Statements).ToArray();
        if (statements.Length > 500 || (key == Digital && statements.Length == 0)) Fail("A Digital framework needs at least one statement, with a maximum of 500.");
        if (statements.Select(x => x.Key).Distinct(StringComparer.OrdinalIgnoreCase).Count() != statements.Length) Fail("Every statement needs a unique key.");
        if (configuration.RatingOptions is null || configuration.RatingOptions.Count > 30) Fail("Use at most 30 rating options.");
        if(configuration.RatingOptions.Any(x=>x is null))Fail("Provide valid rating options.");
        if (key == Activate && configuration.RatingOptions!.Count != 0) Fail("Activate+ tracks evidence and actions; it has no maturity rating scale.");
        foreach (var rating in configuration.RatingOptions!) { Key(rating.Key); Required(rating.Label, 300, "Enter a label for every rating."); }
        if (configuration.RatingOptions.Select(x => x.Key).Distinct(StringComparer.OrdinalIgnoreCase).Count() != configuration.RatingOptions.Count) Fail("Every rating needs a unique key.");
        Dictionary(configuration.FieldLabels, 100, 300); Dictionary(configuration.Settings, 100, 1000);
        foreach (var name in new[] { "requireSamplePerRating", "requireRationale" })
            if (configuration.Settings.TryGetValue(name, out var value) && !bool.TryParse(value, out _)) Fail($"Enter true or false for {name}.");
        foreach (var name in new[] { "skillsScanLeadDays", "initialPackLeadDays", "progressPackLeadDays" })
            if (configuration.Settings.TryGetValue(name, out var value) && (!int.TryParse(value, out var days) || days is < 0 or > 365)) Fail("Preparation offsets must be from 0 to 365 days.");
        if (configuration.Settings.TryGetValue("meetingMinutes", out var duration) && (!int.TryParse(duration, out var minutes) || minutes is < 15 or > 480)) Fail("Meeting length must be from 15 to 480 minutes.");
        ValidateActivateConfiguration(configuration);
    }

    public static void ValidateSave(SaveProcessReviewRequest request, ProcessReviewConfiguration configuration)
    {
        if (request.Title?.Length > 300 || (request.Submit && string.IsNullOrWhiteSpace(request.Title))) Fail("Enter a review title of up to 300 characters.");
        if (!Regex.IsMatch(request.AcademicYear ?? "", "^[0-9]{4}/[0-9]{2}$", RegexOptions.CultureInvariant)
            || int.Parse(request.AcademicYear![..4], CultureInfo.InvariantCulture) is < 2000 or > 2199
            || int.Parse(request.AcademicYear[5..], CultureInfo.InvariantCulture) != (int.Parse(request.AcademicYear[..4], CultureInfo.InvariantCulture) + 1) % 100) Fail("Select a valid academic year, such as 2026/27.");
        if (request.FacultyOrgUnitId == Guid.Empty || request.TeamOrgUnitId == Guid.Empty) Fail("Select a valid organisation.");
        if (request.Submit && !request.FacultyOrgUnitId.HasValue) Fail("Select the faculty before submitting.");
        if (request.Data is null || request.Data.Fields is null || request.Data.Samples is null || request.Data.Responses is null) Fail("Provide the saved form fields, samples and responses.");
        var data = request.Data!;
        if(data.Samples.Any(x=>x is null)||data.Responses.Any(x=>x is null))Fail("Provide valid samples and statement responses.");
        Dictionary(data.Fields, 250, 10000);
        _=ParticipantStaffIds(data);
        if (data.Fields.Keys.Any(x => x.Equals("contributors", StringComparison.OrdinalIgnoreCase)
            || x.Equals("contributorStaffIds",StringComparison.OrdinalIgnoreCase)||x.Equals("reviewOwner",StringComparison.OrdinalIgnoreCase)
            || x.Equals("reviewOwnerStaffId",StringComparison.OrdinalIgnoreCase)||x.Equals("createdByStaffId",StringComparison.OrdinalIgnoreCase)
            || x.Equals("ownerStaffId", StringComparison.OrdinalIgnoreCase) || x.Equals("ownerName", StringComparison.OrdinalIgnoreCase))) Fail("Review ownership is taken from the signed-in creator; contributor fields are not used.");
        if (data.Samples.Count > 100 || data.Responses.Count > 500) Fail("Use at most 100 samples and 500 statement responses.");
        if (data.Samples.Select(x => x.Id).Distinct(StringComparer.OrdinalIgnoreCase).Count() != data.Samples.Count) Fail("Each sample needs a unique reference.");
        foreach (var sample in data.Samples)
        {
            Key(sample.Id); Optional(sample.Title,300); Optional(sample.SampleType,100);
            if(request.Submit){Required(sample.Title,300,"Enter a name for each sample.");Required(sample.SampleType,100,"Select each sample’s type.");}
            Optional(sample.Course, 1000); Optional(sample.Notes, 10000); Optional(sample.EvidenceLink,2000);
            if(request.Submit)Link(sample.EvidenceLink);
            if (sample.StaffIds is null || sample.StaffIds.Count > 100 || sample.StaffIds.Contains(Guid.Empty)) Fail("Select valid associated staff for each sample.");
        }
        var statements = configuration.Standards.SelectMany(x => x.Statements).Select(x => x.Key).ToHashSet(StringComparer.Ordinal);
        var ratings = configuration.RatingOptions.Select(x => x.Key).ToHashSet(StringComparer.Ordinal);
        var samples = data.Samples.Select(x => x.Id).ToHashSet(StringComparer.Ordinal);
        if (data.Responses.Select(x => x.StatementKey).Distinct(StringComparer.Ordinal).Count() != data.Responses.Count) Fail("Each statement has one overall rating, regardless of sample count.");
        foreach (var response in data.Responses)
        {
            if (!statements.Contains(response.StatementKey)) Fail("A response refers to a statement outside this review’s framework.");
            if (!string.IsNullOrEmpty(response.RatingKey) && !ratings.Contains(response.RatingKey)) Fail("Select a rating from the configured college scale.");
            if (response.SampleIds is null || response.SampleIds.Any(x => !samples.Contains(x)) || response.SampleIds.Distinct().Count() != response.SampleIds.Count) Fail("Every evidence link must refer to a sample in this review.");
            Optional(response.Rationale, 10000);
        }
        if (configuration.ProcessKey == Digital && request.Submit)
        {
            if (ratings.Count == 0) Fail("The college rating scale must be configured before a Digital Learning Walk can be submitted. Your draft can still be saved.");
            if (data.Samples.Count == 0 || !request.TeamOrgUnitId.HasValue) Fail("Select the team or area and add evidence samples before submitting.");
            if (data.Responses.Count != statements.Count || data.Responses.Any(x => string.IsNullOrEmpty(x.RatingKey))) Fail("Rate every statement before submitting.");
            if (configuration.Settings.GetValueOrDefault("requireSamplePerRating", "true") == "true" && data.Responses.Any(x => x.SampleIds.Count == 0)) Fail("Link a supporting sample to every rated statement.");
            if (configuration.Settings.GetValueOrDefault("requireRationale", "false") == "true" && data.Responses.Any(x => string.IsNullOrWhiteSpace(x.Rationale))) Fail("Add evidence and rationale for every statement.");
        }
        if (configuration.ProcessKey == Activate)
        {
            if(data.Activate is not null){ValidateActivateData(request,configuration);return;}
            if (data.Samples.Count != 0 || data.Responses.Count != 0) Fail("Activate+ uses dated snapshots rather than Digital Learning Walk samples or ratings.");
            if(request.Submit){Link(data.Fields.GetValueOrDefault("teamsUrl")); Link(data.Fields.GetValueOrDefault("summaryUrl"));}
            if (request.Submit)
            {
                Required(data.Fields.GetValueOrDefault("teamsUrl"), 2000, "Add the live Teams proforma link before recording a snapshot.");
                if (!DateOnly.TryParseExact(data.Fields.GetValueOrDefault("snapshotDate"), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out _)) Fail("Set the snapshot as-of date.");
                Required(data.Fields.GetValueOrDefault("sourceMeeting"), 100, "Select the source meeting for this snapshot.");
            }
            int? received = Number(data.Fields, "responsesReceived"), eligible = Number(data.Fields, "eligibleStaff");
            if (received.HasValue && eligible.HasValue && received > eligible) Fail("Responses received cannot exceed the confirmed eligible staff population.");
        }
    }

    public static void ValidateAction(SaveProcessReviewActionRequest request, ProcessReviewConfiguration configuration, DateOnly? previousDueDate = null)
    {
        Required(request.Title, 300, "Describe the change this action will achieve.");
        if(configuration.ProcessKey==Activate&&configuration.SkillsScanPillars is not null)
        {ValidateActivateAction(request,configuration,previousDueDate);return;}
        if (!configuration.Standards.Any(x => x.Key == request.ThemeKey)) Fail("Select a standard or specialist area from this review’s framework.");
        if (request.OwnerStaffId == Guid.Empty || request.DueDate == default) Fail("Select an action owner and completion date.");
        Required(request.SuccessEvidence, 4000, "Describe the evidence that will show success."); Optional(request.SupportRequired, 4000);
        if (request.Progress is not ("open" or "complete" or "extended" or "cancelled")) Fail("Select a valid action progress state.");
        if (request.ImpactStatus is not ("awaiting_evidence" or "assessing" or "demonstrated" or "further_change")) Fail("Select a valid impact assessment.");
        if (request.ImpactStatus == "demonstrated" && string.IsNullOrWhiteSpace(request.ImpactEvidence) && string.IsNullOrWhiteSpace(request.ImpactEvidenceLink)) Fail("Add evidence before recording demonstrated impact.");
        if (previousDueDate.HasValue && previousDueDate.Value != request.DueDate && string.IsNullOrWhiteSpace(request.DeadlineChangeReason)) Fail("Explain the reason for changing the action deadline.");
        if (request.Progress == "cancelled" && string.IsNullOrWhiteSpace(request.ProgressNote)) Fail("Explain why the action is being cancelled.");
        foreach (var value in new[] { request.ProgressNote, request.Barriers, request.NextStep, request.ImpactEvidence }) Optional(value, 4000);
        Optional(request.DeadlineChangeReason,1000);
        Link(request.EvidenceLink); Link(request.ImpactEvidenceLink);
    }

    public static bool CanRefreshUnratedDraft(ProcessReviewConfiguration previous, ProcessReviewConfiguration latest, ProcessReviewData data) =>
        previous.ProcessKey == Digital && previous.RatingOptions.Count == 0 && latest.RatingOptions.Count > 0
        && !data.Responses.Any(x => !string.IsNullOrWhiteSpace(x.RatingKey))
        && previous.Standards.SelectMany(x => x.Statements).SequenceEqual(latest.Standards.SelectMany(x => x.Statements));
    public static IReadOnlyList<Guid> ParticipantStaffIds(ProcessReviewData data)
    {
        var result=new List<Guid>();
        var head=data.Fields.GetValueOrDefault("headOfFacultyStaffId");
        if(!string.IsNullOrWhiteSpace(head))
        {
            if(!Guid.TryParse(head,out var id)||id==Guid.Empty)Fail("Select a valid head of faculty.");
            result.Add(id);
        }
        var attendees=data.Fields.GetValueOrDefault("attendeeStaffIds");
        if(!string.IsNullOrWhiteSpace(attendees))
        {
            try
            {
                var selected=System.Text.Json.JsonSerializer.Deserialize<Guid[]>(attendees);
                if(selected is null||selected.Length>100||selected.Contains(Guid.Empty))Fail("Select valid meeting attendees, up to a maximum of 100.");
                result.AddRange(selected);
            }
            catch(System.Text.Json.JsonException){Fail("Select valid meeting attendees.");}
        }
        return result.Distinct().ToArray();
    }
    private static int? Number(IReadOnlyDictionary<string, string> fields, string key)
    {
        var value = fields.GetValueOrDefault(key); if (string.IsNullOrWhiteSpace(value)) return null;
        if (!int.TryParse(value, out var number) || number is < 0 or > 100000) Fail("Skills Scan counts must be whole numbers from 0 to 100,000.");
        return number;
    }
    private static void Dictionary(IReadOnlyDictionary<string, string>? values, int maximum, int length)
    {
        if (values is null || values.Count > maximum) Fail("The form contains too many fields.");
        foreach (var (key, value) in values!) { Key(key); if(value is null)Fail("Form field values must be text; use an empty value for unfinished answers."); Optional(value, length); }
    }
    private static void Key(string? key) { if (string.IsNullOrWhiteSpace(key) || !Regex.IsMatch(key, "^[a-zA-Z0-9_.-]{1,100}$", RegexOptions.CultureInvariant)) Fail("Use a unique field key of letters, numbers, dots, hyphens or underscores."); }
    private static void Link(string? value) { if (string.IsNullOrWhiteSpace(value)) return; Optional(value, 2000); if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttps || !string.IsNullOrWhiteSpace(uri.UserInfo)) Fail("Use a complete HTTPS evidence or Teams link."); }
    private static void Required(string? value, int length, string message) { if (string.IsNullOrWhiteSpace(value)) Fail(message); Optional(value, length); }
    private static void Optional(string? value, int length) { if (value?.Length > length) Fail($"Keep this value to {length:N0} characters."); }
    [System.Diagnostics.CodeAnalysis.DoesNotReturn]
    private static void Fail(string message) => throw new WorkflowValidationException(message);
}

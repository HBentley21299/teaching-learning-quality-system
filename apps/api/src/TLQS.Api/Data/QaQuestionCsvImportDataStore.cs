using System.Globalization;
using System.Text.Json;
using Microsoft.Data.SqlClient;
using TLQS.Api.V1;
using TLQS.Application.Security;

namespace TLQS.Api.Data;

public sealed partial class SqlFoundationDataStore
{
    private async Task<AdminCsvImportPlan> BuildQaQuestionCsvPlanAsync(
        AdminCsvTable table, CurrentUser user, SqlConnection connection, SqlTransaction? transaction,
        IReadOnlyDictionary<string, AdminCsvLedgerEntry> ledger, CancellationToken token)
    {
        if (!QaQuestionCsvPlanner.CanImport(user))
            throw new UnauthorizedAccessException("Administrator access and QA review management permission are required to import QA questions.");

        var activities = new List<QaQuestionCsvActivity>();
        await using (var command = new SqlCommand("""
            SELECT activity.id,activity.activity_key,activity.name,activity.is_active,
                   COALESCE(MAX(question.default_display_order),0)
            FROM qa.activity_types activity
            LEFT JOIN qa.questions question ON question.activity_type_id=activity.id AND question.archived_at IS NULL
            WHERE activity.archived_at IS NULL
            GROUP BY activity.id,activity.activity_key,activity.name,activity.is_active
            ORDER BY activity.activity_key;
            """,connection,transaction))
        await using (var reader = await command.ExecuteReaderAsync(token))
            while (await reader.ReadAsync(token))
                activities.Add(new(reader.GetGuid(0),reader.GetString(1),reader.GetString(2),reader.GetBoolean(3),reader.GetInt32(4)));

        var questions = new List<QaQuestionCsvExistingQuestion>();
        await using (var command = new SqlCommand("""
            WITH latest AS (
                SELECT version.*,ROW_NUMBER() OVER(PARTITION BY version.question_id ORDER BY version.version_number DESC) ordinal
                FROM qa.question_versions version
            )
            SELECT question.id,activity.activity_key,latest.version_number,question.default_display_order,
                   latest.question_tag,latest.theme_or_week,latest.question_text
            FROM qa.questions question
            JOIN qa.activity_types activity ON activity.id=question.activity_type_id
            JOIN latest ON latest.question_id=question.id AND latest.ordinal=1
            WHERE question.archived_at IS NULL
            ORDER BY activity.activity_key,question.id;
            """,connection,transaction))
        await using (var reader=await command.ExecuteReaderAsync(token))
            while (await reader.ReadAsync(token))
                questions.Add(new(reader.GetGuid(0),reader.GetString(1),reader.GetInt32(2),reader.GetInt32(3),
                    reader.GetString(4),reader.IsDBNull(5) ? null : reader.GetString(5),reader.GetString(6)));

        var previous=ledger.ToDictionary(item=>item.Key,item=>new QaQuestionCsvPreviousImport(item.Value.PayloadHash,item.Value.EntityId),StringComparer.OrdinalIgnoreCase);
        var validation=QaQuestionCsvPlanner.Validate(table,activities,questions,previous);
        var changes=validation.Candidates.Select(candidate=>new AdminCsvPlannedChange(candidate.Reference,candidate.PayloadHash,candidate.RowNumber,
            (db,tx,actor,ct)=>ApplyQaQuestionCsvCandidateAsync(db,tx,actor,candidate,ct))).ToArray();
        var context=AdminCsvReader.CanonicalHash(new {
            Activities=activities.OrderBy(row=>row.Key,StringComparer.Ordinal).ToArray(),
            Questions=questions.OrderBy(row=>row.Id).ToArray()
        });
        return new("qa-questions",validation.Rows,validation.Issues,changes,context);
    }

    private static async Task<Guid> ApplyQaQuestionCsvCandidateAsync(SqlConnection connection,SqlTransaction transaction,
        CurrentUser user,QaQuestionCsvCandidate candidate,CancellationToken token)
    {
        if (!QaQuestionCsvPlanner.CanImport(user))
            throw new UnauthorizedAccessException("Administrator access and QA review management permission are required to import QA questions.");
        var id=Guid.NewGuid();
        var payload=candidate.Payload;
        await using (var command=new SqlCommand("""
            INSERT INTO qa.questions(id,activity_type_id,question_key,default_display_order,is_retired)
            VALUES(@id,@activity,@key,@order,@retired);
            INSERT INTO qa.question_versions(question_id,version_number,theme_or_week,question_text,guidance,
                is_required,allows_not_applicable,comment_required_at_expected,is_active,source_status,question_tag,created_by_user_account_id)
            VALUES(@id,1,@theme,@text,@guidance,@required,@allowsNa,@commentAt,@active,@status,@tag,@user);
            """,connection,transaction))
        {
            command.Parameters.AddWithValue("@id",id);
            command.Parameters.AddWithValue("@activity",candidate.ActivityTypeId);
            command.Parameters.AddWithValue("@key",$"qa_csv_{id:N}");
            command.Parameters.AddWithValue("@order",candidate.DisplayOrder);
            command.Parameters.AddWithValue("@retired",payload.SourceStatus!="active");
            command.Parameters.AddWithValue("@theme",ToDbValue(payload.ThemeOrWeek));
            command.Parameters.AddWithValue("@text",payload.QuestionText);
            command.Parameters.AddWithValue("@guidance",ToDbValue(payload.Guidance));
            command.Parameters.AddWithValue("@required",payload.IsRequired);
            command.Parameters.AddWithValue("@allowsNa",payload.AllowsNotApplicable);
            command.Parameters.AddWithValue("@commentAt",payload.CommentRequiredAtExpected);
            command.Parameters.AddWithValue("@active",payload.SourceStatus=="active");
            command.Parameters.AddWithValue("@status",payload.SourceStatus);
            command.Parameters.AddWithValue("@tag",payload.QuestionTag);
            command.Parameters.AddWithValue("@user",user.UserAccountId!.Value);
            await command.ExecuteNonQueryAsync(token);
        }
        await WriteAuditAsync(connection,transaction,user.UserAccountId,null,"qa_question",id,"created",
            "Created a QA question from an administrator CSV import.",null,
            JsonSerializer.Serialize(new {candidate.Reference,candidate.DisplayOrder,payload}),token);
        return id;
    }
}

public sealed record QaQuestionCsvActivity(Guid Id,string Key,string Name,bool IsActive,int MaximumDisplayOrder);
public sealed record QaQuestionCsvExistingQuestion(Guid Id,string ActivityKey,int VersionNumber,int DisplayOrder,
    string QuestionTag,string? ThemeOrWeek,string QuestionText);
public sealed record QaQuestionCsvPreviousImport(string PayloadHash,Guid EntityId);
public sealed record QaQuestionCsvPayload(string ActivityKey,string QuestionTag,string? ThemeOrWeek,string QuestionText,
    string? Guidance,int? RequestedDisplayOrder,bool IsRequired,bool AllowsNotApplicable,bool CommentRequiredAtExpected,string SourceStatus);
public sealed record QaQuestionCsvCandidate(int RowNumber,string Reference,Guid ActivityTypeId,QaQuestionCsvPayload Payload,int DisplayOrder,string PayloadHash);
public sealed record QaQuestionCsvValidation(IReadOnlyList<AdminCsvPreviewRow> Rows,IReadOnlyList<AdminCsvIssue> Issues,IReadOnlyList<QaQuestionCsvCandidate> Candidates);

/// <summary>Pure validation and append planning; existing question versions and review snapshots are never changed.</summary>
public static class QaQuestionCsvPlanner
{
    public static readonly string[] RequiredHeaders=["question_reference","activity_key","question_text"];
    public static readonly string[] OptionalHeaders=["question_tag","theme_or_week","guidance","display_order","is_required",
        "allows_not_applicable","comment_required_at_expected","source_status"];

    public static bool CanImport(CurrentUser user)=>user.IsAdministrator && user.UserAccountId.HasValue
        && user.HasPermission(PermissionKeys.QaReviewsManage);

    public static QaQuestionCsvValidation Validate(AdminCsvTable table,IReadOnlyList<QaQuestionCsvActivity> activities,
        IReadOnlyList<QaQuestionCsvExistingQuestion> questions,IReadOnlyDictionary<string,QaQuestionCsvPreviousImport> previous)
    {
        var issues=AdminCsvReader.ValidateHeaders(table,RequiredHeaders,OptionalHeaders).ToList();
        var previews=new List<AdminCsvPreviewRow>();
        var candidates=new List<QaQuestionCsvCandidate>();
        if (issues.Any(issue=>issue.Severity=="error")) return new(previews,issues,candidates);
        var catalogue=activities.ToDictionary(row=>row.Key,StringComparer.OrdinalIgnoreCase);
        var imported=previous.ToDictionary(row=>row.Key,row=>row.Value,StringComparer.OrdinalIgnoreCase);
        var bank=questions.Select(row=>Identity(row.ActivityKey,row.QuestionTag,row.ThemeOrWeek,row.QuestionText)).ToHashSet(StringComparer.Ordinal);
        var nextOrders=activities.ToDictionary(row=>row.Id,row=>row.MaximumDisplayOrder);
        var references=new Dictionary<string,(string Hash,int Row)>(StringComparer.OrdinalIgnoreCase);
        var content=new Dictionary<string,int>(StringComparer.Ordinal);

        foreach(var row in table.Rows)
        {
            var reference=AdminCsvReader.Get(row,"question_reference");
            var start=issues.Count;
            var activityKey=AdminCsvReader.Get(row,"activity_key").ToLowerInvariant();
            var text=AdminCsvReader.Get(row,"question_text");
            var tag=AdminCsvReader.Get(row,"question_tag").ToLowerInvariant();
            if(tag.Length==0) tag="general";
            var theme=Optional(AdminCsvReader.Get(row,"theme_or_week"));
            var guidance=Optional(AdminCsvReader.Get(row,"guidance"));
            var status=AdminCsvReader.Get(row,"source_status").ToLowerInvariant();
            if(status.Length==0) status="draft";
            var orderText=AdminCsvReader.Get(row,"display_order");
            int? requestedOrder=null;
            if(orderText.Length>0)
            {
                if(int.TryParse(orderText,NumberStyles.None,CultureInfo.InvariantCulture,out var order)) requestedOrder=order;
                else Error("display_order","Enter a whole number from 0 to 2,147,483,647, or leave this blank for the next order.");
            }
            var required=Boolean("is_required",true);
            var allowsNa=Boolean("allows_not_applicable",false);
            var commentAt=Boolean("comment_required_at_expected",false);
            if(reference.Length==0 || reference.Length>200 || reference.Any(char.IsControl))
                Error("question_reference","Enter a stable question reference of 1 to 200 characters without line breaks or control characters.");
            if(!catalogue.TryGetValue(activityKey,out var activity) || !activity.IsActive)
                Error("activity_key","Select an existing active QA activity key from the template instructions. Activity names and new activities cannot be imported.");
            if(text.Length==0 || text.Length>1000) Error("question_text","Enter a question of 1 to 1,000 characters.");
            if(tag.Length>80) Error("question_tag","Enter a question tag of no more than 80 characters.");
            if(theme?.Length>200) Error("theme_or_week","Theme or week must be no more than 200 characters.");
            if(guidance?.Length>2000) Error("guidance","Guidance must be no more than 2,000 characters.");
            if(status is not("active" or "draft")) Error("source_status","New criteria can be draft or active. Existing criteria cannot be archived, restored or updated through this import.");
            var payload=new QaQuestionCsvPayload(activityKey,tag,theme,text,guidance,requestedOrder,required,allowsNa,commentAt,status);
            var values=Values(payload,reference,requestedOrder);
            if(issues.Count>start) {Preview("error",values);continue;}
            if(commentAt) issues.Add(new(row.Number,"comment_required_at_expected",
                "This legacy flag is retained for compatibility and does not require evidence notes. Notes remain optional for every outcome.","warning"));
            var hash=AdminCsvReader.CanonicalHash(payload);
            if(references.TryGetValue(reference,out var first))
            {
                if(first.Hash==hash) Preview("skip",values);
                else {Error("question_reference",$"This reference has different question data on row {first.Row}. Use one unchanged payload per reference.");Preview("error",values);}
                continue;
            }
            references.Add(reference,(hash,row.Number));
            if(imported.TryGetValue(reference,out var applied))
            {
                if(applied.PayloadHash==hash) Preview("skip",values);
                else {Error("question_reference","This reference was imported previously with different data. Edit the existing question in the question bank; imports only add criteria.");Preview("error",values);}
                continue;
            }
            var identity=Identity(activityKey,tag,theme,text);
            if(bank.Contains(identity))
            {
                Error("question_text","A criterion with this activity, tag, theme and wording already exists. Edit or restore it in the question bank instead of importing a duplicate.");
                Preview("error",values);continue;
            }
            if(content.TryGetValue(identity,out var firstContentRow))
            {
                Error("question_text",$"This criterion duplicates row {firstContentRow} under another reference. Keep one reference for each criterion.");
                Preview("error",values);continue;
            }
            var resolvedOrder=requestedOrder;
            if(!resolvedOrder.HasValue)
            {
                if(nextOrders[activity!.Id]>int.MaxValue-10)
                {
                    Error("display_order","The activity has reached the automatic ordering limit. Specify an order or amend existing question ordering first.");
                    Preview("error",values);continue;
                }
                resolvedOrder=nextOrders[activity.Id]+10;
            }
            nextOrders[activity!.Id]=Math.Max(nextOrders[activity.Id],resolvedOrder.Value);
            content.Add(identity,row.Number);
            candidates.Add(new(row.Number,reference,activity.Id,payload,resolvedOrder.Value,hash));
            Preview("create",Values(payload,reference,resolvedOrder));

            void Error(string column,string message)=>issues.Add(new(row.Number,column,message));
            bool Boolean(string column,bool fallback)
            {
                var value=AdminCsvReader.Get(row,column);
                if(value.Length==0) return fallback;
                if(bool.TryParse(value,out var parsed)) return parsed;
                Error(column,"Enter true or false, or leave this blank to use the documented default.");return fallback;
            }
            void Preview(string operation,IReadOnlyDictionary<string,string?> normalized)=>previews.Add(new(row.Number,reference.Length==0 ? $"Row {row.Number}" : reference,operation,normalized));
        }
        return new(previews,issues,candidates);
    }

    private static string Identity(string activity,string tag,string? theme,string text)=>AdminCsvReader.CanonicalHash(new {
        Activity=activity.Trim().ToLowerInvariant(),Tag=tag.Trim().ToLowerInvariant(),Theme=Comparison(theme),Text=Comparison(text)
    });
    private static string Comparison(string? value)=>string.Join(" ",(value ?? "").Split((char[]?)null,StringSplitOptions.RemoveEmptyEntries)).ToUpperInvariant();
    private static string? Optional(string value)=>value.Length==0 ? null : value;
    private static IReadOnlyDictionary<string,string?> Values(QaQuestionCsvPayload payload,string reference,int? displayOrder)=>new Dictionary<string,string?>(StringComparer.OrdinalIgnoreCase) {
        ["question_reference"]=reference,["activity_key"]=payload.ActivityKey,["question_tag"]=payload.QuestionTag,
        ["theme_or_week"]=payload.ThemeOrWeek,["question_text"]=payload.QuestionText,["guidance"]=payload.Guidance,
        ["display_order"]=displayOrder?.ToString(CultureInfo.InvariantCulture),["is_required"]=payload.IsRequired ? "true" : "false",
        ["allows_not_applicable"]=payload.AllowsNotApplicable ? "true" : "false",["comment_required_at_expected"]=payload.CommentRequiredAtExpected ? "true" : "false",
        ["source_status"]=payload.SourceStatus
    };
}

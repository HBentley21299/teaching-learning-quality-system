using System.Text.Json;
using Microsoft.Data.SqlClient;
using TLQS.Api.V1;
using TLQS.Application.Security;
using TLQS.Application.Workflows;

namespace TLQS.Api.Data;

public sealed partial class SqlFoundationDataStore
{
    private async Task<ProcessReviewConfiguration> ApplyDigitalLearningWalkScaleAsync(ProcessReviewConfiguration configuration,CancellationToken ct)
    {
        var rubric=await ReadCurrentPracticeRubricAsync(ct);
        var settings=new Dictionary<string,string>(configuration.Settings??new Dictionary<string,string>(),StringComparer.Ordinal)
        {
            ["ratingScaleSource"]="learning_walk",["evidenceMode"]="ratings_only",["requireSamplePerRating"]="false",["requireRationale"]="false"
        };
        return configuration with{Settings=settings,RatingOptions=rubric.Where(option=>option.DisplayOrder is >=1 and <=5).Take(5)
            .Select(option=>new ProcessReviewRatingOption(option.DescriptorKey,$"{option.DisplayOrder} – {option.VisibleWording}",option.DisplayOrder,option.GuidanceText,option.ColorHex)).ToArray()};
    }

    private async Task<SaveProcessReviewRequest> NormalizeDigitalReviewRequestAsync(SaveProcessReviewRequest request,ProcessReviewDetail? existing,
        ProcessReviewConfiguration configuration,CancellationToken ct)
    {
        var digital=request.Data.Digital!;
        if(existing?.Data.Digital?.SelectedStandardKeys is not null&&digital.SelectedStandardKeys is null)
            throw new WorkflowValidationException("Keep the category selection when saving this Digital Learning Walk. Reload the form before saving.");
        if(existing is null&&digital.SelectedStandardKeys is null)
        {
            // Earlier clients can still create walks, but cannot omit the rest of a selected category.
            var selected=(digital.SelectedStatementKeys??[]).ToHashSet(StringComparer.Ordinal);
            var categories=configuration.Standards.Where(standard=>standard.Statements.Any(statement=>selected.Contains(statement.Key))).Select(standard=>standard.Key).ToArray();
            request=request with{Data=request.Data with{Digital=digital with{SelectedStandardKeys=categories}}};
        }
        request=request with{Data=ProcessReviewRules.NormalizeDigitalData(request.Data,configuration)};
        if(!string.IsNullOrWhiteSpace(request.Title))return request;
        if(existing is not null)return request with{Title=existing.Title};
        var areas=await QueryAsync("SELECT name FROM org.org_units WHERE id=COALESCE(@team,@faculty);",
            command=>{command.Parameters.AddWithValue("@team",ToDbValue(request.TeamOrgUnitId));command.Parameters.AddWithValue("@faculty",ToDbValue(request.FacultyOrgUnitId));},reader=>reader.GetString(0),ct);
        var context=areas.FirstOrDefault()??request.AcademicYear;
        var title=$"{configuration.Title} · {context}"+(request.RecordDate.HasValue?$" · {request.RecordDate:yyyy-MM-dd}":" draft");
        return request with{Title=title.Length>300?title[..300]:title};
    }

    private static async Task<SaveProcessReviewRequest> NormalizeDigitalDeliveryAreaAsync(SqlConnection connection,SqlTransaction transaction,
        SaveProcessReviewRequest request,ProcessReviewDetail? existing,bool formal,CancellationToken ct)
    {
        var fields=new Dictionary<string,string>(request.Data.Fields,StringComparer.Ordinal);
        var key=fields.GetValueOrDefault("deliveryAreaKey")?.Trim()??"";
        var previousKey=existing?.Data.Fields.GetValueOrDefault("deliveryAreaKey");
        var previousName=existing?.Data.Fields.GetValueOrDefault("deliveryAreaName");
        // Older submitted records can retain an unrecorded area; their history is not filled with an invented answer.
        var required=formal&&(existing?.Status!="submitted"||!string.IsNullOrWhiteSpace(previousKey));
        if(string.IsNullOrWhiteSpace(key))
        {
            if(required)throw new WorkflowValidationException("Select a Digital Learning Walk delivery area before submitting.");
            fields["deliveryAreaKey"]="";fields["deliveryAreaName"]="";
            return request with{Data=request.Data with{Fields=fields}};
        }
        string? name=null;bool active=false;
        await using(var lookup=new SqlCommand("""
            SELECT value.display_name,CONVERT(bit,CASE WHEN value.is_active=1 AND value.archived_at IS NULL
                AND type.is_active=1 AND type.archived_at IS NULL THEN 1 ELSE 0 END)
            FROM core.lookup_values value JOIN core.lookup_types type ON type.id=value.lookup_type_id
            WHERE type.lookup_key=N'liv_delivery_area' AND value.value_key=@key;
            """,connection,transaction))
        {
            lookup.Parameters.AddWithValue("@key",key);
            await using var reader=await lookup.ExecuteReaderAsync(ct);
            if(await reader.ReadAsync(ct)){name=reader.GetString(0);active=reader.GetBoolean(1);}
        }
        if(key==previousKey&&!string.IsNullOrWhiteSpace(previousName))name=previousName;
        else if(name is null||!active)throw new WorkflowValidationException("Choose an active Digital Learning Walk delivery area from the list.");
        fields["deliveryAreaKey"]=key;fields["deliveryAreaName"]=name!;
        return request with{Data=request.Data with{Fields=fields}};
    }

    private static async Task ValidateDigitalActionOwnersAsync(SqlConnection connection,SqlTransaction transaction,IReadOnlyList<Guid> owners,
        CurrentUser user,CancellationToken ct)
    {
        if(owners.Count==0)return;
        await using var command=new SqlCommand("""
            SELECT COUNT(*) FROM OPENJSON(@owners) requested
            JOIN people.staff staff ON staff.id=TRY_CONVERT(uniqueidentifier,requested.value)
            WHERE staff.archived_at IS NULL AND staff.account_status=N'active'
                AND (@all=1 OR staff.id=@self OR EXISTS(SELECT 1 FROM org.fn_visible_staff(@user) scope WHERE scope.staff_id=staff.id))
                AND EXISTS(
                    SELECT 1 FROM auth.user_accounts account JOIN auth.user_roles assignment ON assignment.user_account_id=account.id
                    JOIN auth.roles role ON role.id=assignment.role_id
                    WHERE account.staff_id=staff.id AND account.archived_at IS NULL AND account.account_status=N'active' AND account.is_disabled=0
                        AND assignment.active_from<=sysutcdatetime() AND (assignment.active_to IS NULL OR assignment.active_to>sysutcdatetime())
                        AND role.archived_at IS NULL AND role.is_active=1 AND role.precedence>=COALESCE(
                            (SELECT precedence FROM auth.roles WHERE role_key=N'programme_leader' AND archived_at IS NULL),200));
            """,connection,transaction);
        command.Parameters.AddWithValue("@owners",JsonSerializer.Serialize(owners));command.Parameters.AddWithValue("@all",ProcessReviewRules.CanManageConfiguration(user));
        command.Parameters.AddWithValue("@self",ToDbValue(user.StaffId));command.Parameters.AddWithValue("@user",ToDbValue(user.UserAccountId));
        if(Convert.ToInt32(await command.ExecuteScalarAsync(ct))!=owners.Count)
            throw new WorkflowValidationException("Digital Learning Walk action owners must be active Programme Leaders or above within your authorised staff scope.");
    }

    private static async Task<IReadOnlyList<DigitalLearningWalkDraftAction>> PendingDigitalDraftActionsAsync(SqlConnection connection,SqlTransaction transaction,
        IReadOnlyList<DigitalLearningWalkDraftAction> actions,Guid? recordId,CancellationToken ct)
    {
        if(actions.Count==0)return [];
        await using var command=new SqlCommand("""
            SELECT id,source_record_id,source_form_type FROM quality.actions WITH(UPDLOCK,HOLDLOCK)
            WHERE id IN(SELECT TRY_CONVERT(uniqueidentifier,value) FROM OPENJSON(@ids));
            """,connection,transaction);
        command.Parameters.AddWithValue("@ids",JsonSerializer.Serialize(actions.Select(action=>action.Id)));
        var existing=new HashSet<Guid>();
        await using var reader=await command.ExecuteReaderAsync(ct);
        while(await reader.ReadAsync(ct))
        {
            if(!recordId.HasValue||reader.GetGuid(1)!=recordId.Value||reader.GetString(2)!=ProcessReviewRules.Digital)
                throw new WorkflowValidationException("A draft action reference is already used by another record. Add a new action and try again.");
            existing.Add(reader.GetGuid(0));
        }
        return actions.Where(action=>!existing.Contains(action.Id)).ToArray();
    }

    private async Task PromoteDigitalDraftActionsAsync(SqlConnection connection,SqlTransaction transaction,Guid recordId,
        IReadOnlyList<DigitalLearningWalkDraftAction> draftActions,ProcessReviewConfiguration configuration,CurrentUser user,CancellationToken ct)
    {
        foreach(var draft in draftActions)
        {
            await using(var prior=new SqlCommand("SELECT source_record_id,source_form_type FROM quality.actions WITH(UPDLOCK,HOLDLOCK) WHERE id=@id;",connection,transaction))
            {
                prior.Parameters.AddWithValue("@id",draft.Id);
                await using var reader=await prior.ExecuteReaderAsync(ct);
                if(await reader.ReadAsync(ct))
                {
                    if(reader.GetGuid(0)!=recordId||reader.GetString(1)!=ProcessReviewRules.Digital)
                        throw new WorkflowValidationException("A draft action reference is already used by another record. Add a new action and try again.");
                    continue;
                }
            }
            var action=new SaveProcessReviewActionRequest(draft.Title.Trim(),draft.ThemeKey,draft.OwnerStaffId!.Value,draft.DueDate!.Value,"","");
            ProcessReviewRules.ValidateAction(action,configuration);
            var theme=configuration.Standards.First(standard=>standard.Key==draft.ThemeKey).Title;
            await using(var insert=new SqlCommand("""
                INSERT INTO quality.actions(id,source_record_id,source_form_type,owner_staff_id,action_theme,title,detail,
                    status_lookup_value_id,due_date,original_due_date,published_to_staff,visibility_setting,created_by_user_account_id,intended_evidence,intended_impact)
                VALUES(@id,@record,@key,@owner,@theme,@title,@title,
                    (SELECT TOP(1) value.id FROM core.lookup_values value JOIN core.lookup_types type ON type.id=value.lookup_type_id WHERE type.lookup_key=N'action_status' AND value.value_key=N'open'),
                    @due,@due,1,N'staff_and_management',@user,N'',N'');
                INSERT INTO quality.process_review_actions(action_id,theme_key,support_required,success_evidence,impact_status)
                VALUES(@id,@themeKey,N'',N'',N'awaiting_evidence');
                """,connection,transaction))
            {
                AddProcessActionParameters(insert,draft.Id,recordId,ProcessReviewRules.Digital,theme,action,user);
                await insert.ExecuteNonQueryAsync(ct);
            }
            var update=new ProcessReviewActionUpdate(Guid.Empty,DateTimeOffset.UtcNow,user.DisplayName,"open",null,null,null,null,action.DueDate,null,"awaiting_evidence",null,null);
            await using(var history=new SqlCommand("INSERT quality.process_review_action_updates(action_id,updated_by_user_account_id,update_json)VALUES(@id,@user,@json);",connection,transaction))
            {
                history.Parameters.AddWithValue("@id",draft.Id);history.Parameters.AddWithValue("@user",user.UserAccountId!.Value);
                history.Parameters.AddWithValue("@json",JsonSerializer.Serialize(update,ProcessJson));await history.ExecuteNonQueryAsync(ct);
            }
            await WriteAuditAsync(connection,transaction,user.UserAccountId,recordId,"action",draft.Id,"action.created",
                $"{action.Title} assigned when the Digital Learning Walk was submitted.",null,JsonSerializer.Serialize(action,ProcessJson),ct);
            await InsertDomainEventAsync(connection,transaction,"action.assigned","action",draft.Id,recordId,"{}",user.UserAccountId,ct);
        }
    }
}

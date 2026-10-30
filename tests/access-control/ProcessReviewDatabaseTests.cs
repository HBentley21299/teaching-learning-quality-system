using System.Data;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using TLQS.Api.Data;
using TLQS.Api.Exports;
using TLQS.Api.V1;
using TLQS.Application.Security;
using TLQS.Application.Workflows;
using Xunit;

namespace TLQS.AccessControl.Tests;

[Collection("List query database checks")]
public sealed class ProcessReviewDatabaseTests
{
    private static readonly CancellationToken Token=CancellationToken.None;
    private static ProcessReviewData Empty=>new(new Dictionary<string,string>(),[],[]);

    [AccountAdministrationDatabaseFact]
    public async Task Drafts_scale_versions_creator_identity_scope_concurrency_and_exports_are_durable()
    {
        await using var db=await ReviewDatabase.CreateAsync();var store=db.Store();var author=db.Admin();
        var partial=new SaveProcessReviewRequest("","2026/27",null,null,null,Empty with{Fields=new Dictionary<string,string>{{"scope","Partially completed"}},Samples=[new("S1","","learner_work",null,null,[],"https:","Unfinished notes")]});
        var draft=await store.SaveProcessReviewAsync(ProcessReviewRules.Digital,null,partial,author,Token);
        Assert.Equal(author.StaffId,draft.OwnerStaffId);Assert.Equal("draft",draft.Status);Assert.Equal("Partially completed",draft.Data.Fields["scope"]);
        Assert.Equal("",draft.Data.Samples[0].Title);Assert.Equal("https:",draft.Data.Samples[0].EvidenceLink);
        Assert.Empty(draft.Configuration.RatingOptions);
        var formsEditor=db.User(1,PermissionKeys.FormsManage);
        Assert.Null(await store.GetProcessReviewAsync(draft.RecordId,formsEditor,Token));
        Assert.Null(await store.GetRecordNavigationAsync(draft.RecordId,formsEditor,Token));
        Assert.Empty(await store.GetProcessReviewsAsync(ProcessReviewRules.Digital,"2026/27",db.User(1,PermissionKeys.ReportsViewAll),Token));
        var config=await store.GetProcessReviewConfigurationAsync(ProcessReviewRules.Digital,Token);
        var configured=await store.SaveProcessReviewConfigurationAsync(ProcessReviewRules.Digital,config with{RatingOptions=[new("a","College category A"),new("b","College category B")]},formsEditor,Token);
        Assert.Equal(2,configured.Version);
        await Assert.ThrowsAsync<DBConcurrencyException>(()=>store.SaveProcessReviewConfigurationAsync(ProcessReviewRules.Digital,config,formsEditor,Token));
        var writer=db.Admin(1);
        draft=await store.SaveProcessReviewAsync(ProcessReviewRules.Digital,draft.RecordId,partial with{RowVersion=draft.RowVersion},writer,Token);
        Assert.Equal(author.StaffId,draft.OwnerStaffId);Assert.Equal(2,draft.Configuration.Version);Assert.Equal(2,draft.Configuration.RatingOptions.Count);
        var sample=new ProcessReviewSample("S1","Learner work","learner_work",new DateOnly(2026,10,30),"Course A",[author.StaffId!.Value],"https://college.example/evidence","Work and feedback");
        var complete=new SaveProcessReviewRequest("Digital review","2026/27",db.Faculty,db.TeamA,new DateOnly(2026,10,30),
            new(new Dictionary<string,string>{{"scope","Context"},{"strengths","Evidence of effective practice"}},[sample],draft.Configuration.Standards.SelectMany(x=>x.Statements).Select(x=>new ProcessReviewResponse(x.Key,"a",["S1"],"Linked evidence")).ToArray()),true,draft.RowVersion);
        var submitted=await store.SaveProcessReviewAsync(ProcessReviewRules.Digital,draft.RecordId,complete,writer,Token);
        Assert.Equal("submitted",submitted.Status);Assert.Equal(author.StaffId,submitted.OwnerStaffId);
        await Assert.ThrowsAsync<WorkflowValidationException>(()=>store.SaveProcessReviewAsync(ProcessReviewRules.Digital,submitted.RecordId,
            complete with{Data=Empty,Submit=false,RowVersion=submitted.RowVersion},writer,Token));
        Assert.Equal(24,(await store.GetProcessReviewAsync(submitted.RecordId,writer,Token))!.Data.Responses.Count);
        await Assert.ThrowsAsync<DBConcurrencyException>(()=>store.SaveProcessReviewAsync(ProcessReviewRules.Digital,draft.RecordId,complete,writer,Token));
        var changedConfig=configured with{Title="Future framework",Standards=configured.Standards.Select((x,i)=>i==0?x with{Title="Future standard title"}:x).ToArray()};
        await store.SaveProcessReviewConfigurationAsync(ProcessReviewRules.Digital,changedConfig,formsEditor,Token);
        var historical=(await store.GetProcessReviewAsync(submitted.RecordId,writer,Token))!;
        Assert.Equal(2,historical.Configuration.Version);Assert.Equal("Learner Agency & Ownership",historical.Configuration.Standards[0].Title);
        var scoped=db.User(2,ProcessReviewRules.Digital+".view_scoped");
        Assert.NotNull(await store.GetProcessReviewAsync(submitted.RecordId,scoped,Token));
        var outside=await store.SaveProcessReviewAsync(ProcessReviewRules.Digital,null,complete with{Title="Other team",TeamOrgUnitId=db.TeamB,Submit=false,RowVersion=null},writer,Token);
        Assert.Null(await store.GetProcessReviewAsync(outside.RecordId,scoped,Token));
        var export=await store.GetProcessReviewExportAsync(ProcessReviewRules.Digital,"2026/27",scoped,Token);
        var safe=BusinessWorkbookExportBuilder.Build(export);
        Assert.Equal(new[]{"Form entries","Samples","Responses","Sample links","Actions","Updates"},safe.Sheets.Select(x=>x.Name));
        Assert.Equal(24,safe.Sheets.Single(x=>x.Name=="Responses").Rows.Count);
        Assert.DoesNotContain(safe.Sheets.SelectMany(x=>x.Columns),x=>x.Contains("contributor",StringComparison.OrdinalIgnoreCase)||x.Contains("visibility",StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(safe.Sheets.SelectMany(x=>x.Rows).SelectMany(x=>x),value=>value==submitted.RecordId.ToString()||value==author.StaffId.ToString());
        Assert.NotEmpty(new ExcelExportService().CreateWorkbook(export).Content);
    }

    [AccountAdministrationDatabaseFact]
    public async Task Teams_snapshots_and_assigned_native_actions_keep_separate_authority_and_history()
    {
        await using var db=await ReviewDatabase.CreateAsync();var store=db.Store();var admin=db.Admin();
        await db.UseLegacyActivateConfigurationAsync();
        var fields=new Dictionary<string,string>{{"teamsUrl","https://college.sharepoint.com/review"},{"snapshotDate","2026-11-24"},{"sourceCheckedDate","2026-11-24"},{"sourceMeeting","Initial review"},{"area_1_summary","Initial summary"}};
        var request=new SaveProcessReviewRequest("Faculty cycle","2026/27",db.Faculty,null,new DateOnly(2026,11,24),new(fields,[],[]),true);
        var review=await store.SaveProcessReviewAsync(ProcessReviewRules.Activate,null,request,admin,Token);
        Assert.Single(review.Snapshots);var original=review.Snapshots[0];
        fields=new Dictionary<string,string>(fields){{"reportedNeeds","Further support required"}};fields["area_1_summary"]="Updated summary";fields["snapshotDate"]="2027-04-22";fields["sourceMeeting"]="Progress review";
        review=await store.SaveProcessReviewAsync(ProcessReviewRules.Activate,review.RecordId,request with{Data=new(fields,[],[]),RowVersion=review.RowVersion},admin,Token);
        Assert.Equal(2,review.Snapshots.Count);Assert.Equal("Initial summary",review.Snapshots.Single(x=>x.SnapshotId==original.SnapshotId).Data.Fields["area_1_summary"]);
        var actionRequest=new SaveProcessReviewActionRequest("Improve access",review.Configuration.Standards[0].Key,db.StaffIds[1],new DateOnly(2027,1,15),"Specialist lead","Learners can use resources independently");
        var action=await store.SaveProcessReviewActionAsync(review.RecordId,null,actionRequest,admin,Token);
        Assert.Equal("Immersive Technology",action.ThemeLabel);Assert.Equal("awaiting_evidence",action.ImpactStatus);Assert.Single(action.Updates);
        var assignee=db.User(1);
        Assert.Null(await store.GetProcessReviewAsync(review.RecordId,assignee,Token));
        Assert.Null(await store.GetRecordNavigationAsync(review.RecordId,assignee,Token));
        var mine=(await store.GetProcessReviewActionAsync(action.ActionId,assignee,Token))!;Assert.True(mine.CanEdit);
        Assert.Null(await store.GetProcessReviewActionAsync(action.ActionId,db.User(2),Token));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(()=>store.SaveProcessReviewActionAsync(review.RecordId,action.ActionId,actionRequest with{OwnerStaffId=db.StaffIds[2],RowVersion=mine.RowVersion},assignee,Token));
        var completed=await store.SaveProcessReviewActionAsync(review.RecordId,action.ActionId,actionRequest with{Progress="complete",ProgressNote="Resources revised",RowVersion=mine.RowVersion},assignee,Token);
        Assert.Equal("complete",completed.Progress);Assert.Equal("awaiting_evidence",completed.ImpactStatus);Assert.Equal(2,completed.Updates.Count);
        Assert.Equal(assignee.UserAccountId,await db.ScalarAsync<Guid>($"SELECT completed_by_user_account_id FROM quality.actions WHERE id='{action.ActionId}';"));
        var evidenceUpdate=await store.SaveProcessReviewActionAsync(review.RecordId,action.ActionId,actionRequest with{Progress="complete",ProgressNote="Coordinator added evidence",RowVersion=completed.RowVersion},admin,Token);
        Assert.Equal(assignee.UserAccountId,await db.ScalarAsync<Guid>($"SELECT completed_by_user_account_id FROM quality.actions WHERE id='{action.ActionId}';"));
        var reopened=await store.SaveProcessReviewActionAsync(review.RecordId,action.ActionId,actionRequest with{RowVersion=evidenceUpdate.RowVersion},admin,Token);
        Assert.Equal(1,await db.ScalarAsync<int>($"SELECT COUNT(*) FROM quality.actions WHERE id='{action.ActionId}' AND completed_date IS NULL AND completed_by_user_account_id IS NULL AND completion_note IS NULL;"));
        var cancelled=await store.SaveProcessReviewActionAsync(review.RecordId,action.ActionId,actionRequest with{Progress="cancelled",ProgressNote="Support no longer required",RowVersion=reopened.RowVersion},assignee,Token);
        Assert.Equal(assignee.UserAccountId,await db.ScalarAsync<Guid>($"SELECT cancelled_by_user_account_id FROM quality.actions WHERE id='{action.ActionId}';"));
        reopened=await store.SaveProcessReviewActionAsync(review.RecordId,action.ActionId,actionRequest with{RowVersion=cancelled.RowVersion},admin,Token);
        Assert.Equal(1,await db.ScalarAsync<int>($"SELECT COUNT(*) FROM quality.actions WHERE id='{action.ActionId}' AND cancelled_at IS NULL AND cancelled_by_user_account_id IS NULL AND cancellation_comments IS NULL;"));
        await Assert.ThrowsAsync<DBConcurrencyException>(()=>store.SaveProcessReviewActionAsync(review.RecordId,action.ActionId,actionRequest with{RowVersion=mine.RowVersion},assignee,Token));
        await Assert.ThrowsAsync<WorkflowValidationException>(()=>store.SaveProcessReviewActionAsync(review.RecordId,action.ActionId,actionRequest with{ImpactStatus="demonstrated",RowVersion=completed.RowVersion},assignee,Token));
        // Native date changes keep the shared central action row and its extension history aligned.
        await store.SaveProcessReviewActionAsync(review.RecordId,action.ActionId,actionRequest with{DueDate=new DateOnly(2027,2,1),DeadlineChangeReason="Further specialist support required",RowVersion=reopened.RowVersion},admin,Token);
        Assert.Equal(new DateTime(2027,2,1),await db.ScalarAsync<DateTime>($"SELECT revised_due_date FROM quality.actions WHERE id='{action.ActionId}';"));
        var live=(await store.GetProcessReviewActionAsync(action.ActionId,assignee,Token))!;Assert.Equal("open",live.Progress);Assert.Equal(new DateOnly(2027,2,1),live.DueDate);
        var assessed=await store.SaveProcessReviewActionAsync(review.RecordId,action.ActionId,actionRequest with{DueDate=live.DueDate,ImpactStatus="demonstrated",ImpactEvidence="Learners confirm increased independence",RowVersion=live.RowVersion},assignee,Token);
        Assert.Equal("demonstrated",assessed.ImpactStatus);Assert.Equal("open",assessed.Progress);
        var export=BusinessWorkbookExportBuilder.Build(await store.GetProcessReviewExportAsync(ProcessReviewRules.Activate,"2026/27",admin,Token,"https://college.example/i-elevate"));
        Assert.Equal(2,export.Sheets.Single(x=>x.Name=="Snapshots").Rows.Count);Assert.Single(export.Sheets.Single(x=>x.Name=="Actions").Rows);
        Assert.Contains("Immersive Technology summary",export.Sheets.Single(x=>x.Name=="Snapshots").Columns);
        Assert.Contains(export.Sheets.Single(x=>x.Name=="Actions").Rows.Single(),x=>x==$"https://college.example/i-elevate/actions/{action.ActionId}");
        Assert.Equal(8,export.Sheets.Single(x=>x.Name=="Updates").Rows.Count);
        var oldConfiguration=await store.GetProcessReviewConfigurationAsync(ProcessReviewRules.Activate,Token);
        await store.SaveProcessReviewConfigurationAsync(ProcessReviewRules.Activate,ProcessReviewRules.DefaultConfiguration(ProcessReviewRules.Activate) with{RowVersion=oldConfiguration.RowVersion},admin,Token);
        var modern=new ActivateGrowthReviewData(true,[],[],[],new Dictionary<string,decimal?>(),MeetingMinutes:"Recorded in the revised form");
        var upgraded=await store.SaveProcessReviewAsync(ProcessReviewRules.Activate,review.RecordId,request with{Data=review.Data with{Activate=modern},RowVersion=review.RowVersion,Submit=false},admin,Token);
        Assert.NotNull(upgraded.LegacyConfiguration);Assert.Null(upgraded.LegacyConfiguration.SkillsScanPillars);
        Assert.Equal(2,upgraded.Snapshots.Count);Assert.Equal(review.Data.Fields["teamsUrl"],upgraded.Data.Fields["teamsUrl"]);
        Assert.Equal(6,upgraded.Configuration.SkillsScanPillars!.Count);Assert.Equal(admin.StaffId,upgraded.OwnerStaffId);
    }

    [AccountAdministrationDatabaseFact]
    public async Task Activate_scope_participants_manual_averages_and_joint_actions_preserve_authority_and_history()
    {
        await using var db=await ReviewDatabase.CreateAsync();var store=db.Store();var admin=db.Admin();
        var date=new DateOnly(2026,10,30);
        var context=await store.ResolveActivateReviewContextAsync(new(db.Faculty,true,[],RecordDate:date),admin,Token);
        Assert.Equal(2,context.SelectedSubTeamOrgUnitIds.Count);Assert.Equal(3,context.Participants.Count);
        Assert.True(context.Participants.Single(x=>x.StaffId==db.StaffIds[0]).IsLocked);
        Assert.True(context.Participants.Single(x=>x.StaffId==db.StaffIds[1]).IsLocked);
        var pl=context.Participants.Single(x=>x.StaffId==db.StaffIds[2]);Assert.False(pl.IsLocked);Assert.Equal(2,pl.OrgUnitNames.Count);
        var averages=new Dictionary<string,decimal?>{{"digital_proficiency",1.25m},{"digital_productivity",3.75m},{"information_literacy",null}};
        var data=new ActivateGrowthReviewData(true,context.SelectedSubTeamOrgUnitIds,[],[db.StaffIds[2]],averages,date.AddMonths(5),"Discussed source evaluation","Independent learners","Evaluate digital sources");
        var request=new SaveProcessReviewRequest("Joint area review","2026/27",db.Faculty,null,date,Empty with{Activate=data});
        var review=await store.SaveProcessReviewAsync(ProcessReviewRules.Activate,null,request,admin,Token);
        Assert.Equal(2,review.SelectedSubTeams!.Count);Assert.Equal(2,review.Participants!.Count);Assert.DoesNotContain(review.Participants,x=>x.StaffId==db.StaffIds[2]);
        Assert.Contains(db.StaffIds[0],review.Data.Activate!.ParticipantStaffIds);Assert.Contains(db.StaffIds[1],review.Data.Activate.HeadOfFacultyStaffIds!);
        Assert.Equal(1.25m,review.Data.Activate.SkillsScanScores["digital_proficiency"]);
        var draftExport=BusinessWorkbookExportBuilder.Build(await store.GetProcessReviewExportAsync(ProcessReviewRules.Activate,"2026/27",admin,Token));
        var draftScan=draftExport.Sheets.Single(x=>x.Name=="Skills Scan");
        Assert.Equal(15,draftScan.Rows.Count);var meanIndex=draftScan.Columns.ToList().IndexOf("Pillar mean (complete submitted results only)");
        Assert.All(draftScan.Rows,row=>Assert.True(string.IsNullOrEmpty(row[meanIndex])));
        review=await store.SaveProcessReviewAsync(ProcessReviewRules.Activate,review.RecordId,request with{Data=review.Data,Submit=true,RowVersion=review.RowVersion},admin,Token);
        Assert.Empty(review.Snapshots);Assert.Equal("submitted",review.Status);
        await Assert.ThrowsAsync<WorkflowValidationException>(()=>store.SaveProcessReviewAsync(ProcessReviewRules.Activate,review.RecordId,
            request with{RecordDate=null,Data=review.Data,RowVersion=review.RowVersion},admin,Token));
        // A changed organisation must not silently replace the people or area names recorded at the meeting.
        await db.ExecuteAsync($"UPDATE org.org_units SET name=N'Renamed faculty' WHERE id='{db.Faculty}';UPDATE org.org_unit_leaderships SET leader_staff_id='{db.StaffIds[2]}' WHERE org_unit_id='{db.Faculty}';");
        var frozen=await store.ResolveActivateReviewContextAsync(new(db.Faculty,true,review.Data.Activate!.SubTeamOrgUnitIds,review.RecordId,date),admin,Token);
        Assert.Contains(frozen.Participants,x=>x.StaffId==db.StaffIds[1]&&x.Roles.Contains("Head of faculty"));
        Assert.Contains(frozen.Participants,x=>x.StaffId==db.StaffIds[2]&&x.Roles.Contains("Programme leader"));
        var restoredData=review.Data.Activate with{RemovedProgrammeLeaderStaffIds=[],ParticipantStaffIds=review.Data.Activate.ParticipantStaffIds.Append(db.StaffIds[2]).ToArray()};
        review=await store.SaveProcessReviewAsync(ProcessReviewRules.Activate,review.RecordId,request with{Data=review.Data with{Activate=restoredData},RowVersion=review.RowVersion},admin,Token);
        Assert.Contains(review.Participants!,x=>x.StaffId==db.StaffIds[2]&&x.Roles.Contains("Programme leader"));
        Assert.All(review.SelectedSubTeams!,x=>Assert.Equal("Faculty A",x.ParentName));
        Assert.NotNull(await store.GetProcessReviewAsync(review.RecordId,db.User(2,ProcessReviewRules.Activate+".view_scoped"),Token));
        Assert.Null(await store.GetProcessReviewAsync(review.RecordId,db.User(2),Token));
        var actionRequest=new SaveProcessReviewActionRequest("",review.Configuration.ActionThemes![0].Key,Guid.Empty,date.AddMonths(2),"","Learners evaluate the reliability of digital sources",
            ResponsibleStaffIds:[db.StaffIds[1],db.StaffIds[2]],ImpactAreaKey:"information_literacy",Detail:"Model how to evaluate sources and compare vocational evidence",ReviewDate:date.AddMonths(2));
        var action=await store.SaveProcessReviewActionAsync(review.RecordId,null,actionRequest,admin,Token);
        Assert.Equal(2,action.ResponsibleStaff!.Count);Assert.Equal("Information literacy",action.ImpactAreaLabel);
        Assert.Equal(1,await db.ScalarAsync<int>("SELECT COUNT(*) FROM quality.actions;"));
        Assert.Equal(2,await db.ScalarAsync<int>("SELECT COUNT(*) FROM quality.process_review_action_assignees;"));
        Assert.Equal(actionRequest.Detail,await db.ScalarAsync<string>($"SELECT detail FROM quality.actions WHERE id='{action.ActionId}';"));
        var secondary=db.User(2);var assigned=(await store.GetProcessReviewActionAsync(action.ActionId,secondary,Token))!;
        Assert.True(assigned.CanEdit);Assert.Null(await store.GetProcessReviewAsync(review.RecordId,secondary,Token));
        action=await store.SaveProcessReviewActionAsync(review.RecordId,action.ActionId,actionRequest with{Progress="complete",ProgressNote="Guidance delivered",RowVersion=assigned.RowVersion},secondary,Token);
        Assert.Equal("complete",action.Progress);Assert.Equal("awaiting_evidence",action.ImpactStatus);
        Assert.Equal(secondary.UserAccountId,await db.ScalarAsync<Guid>($"SELECT completed_by_user_account_id FROM quality.actions WHERE id='{action.ActionId}';"));
        var export=BusinessWorkbookExportBuilder.Build(await store.GetProcessReviewExportAsync(ProcessReviewRules.Activate,"2026/27",admin,Token));
        Assert.Contains(export.Sheets,x=>x.Name=="Review scope");Assert.Contains(export.Sheets,x=>x.Name=="Participants");
        var scan=export.Sheets.Single(x=>x.Name=="Skills Scan");Assert.Equal(15,scan.Rows.Count);
        Assert.Equal(2,scan.Rows.Count(row=>row[meanIndex]=="2.5"));Assert.Equal(13,scan.Rows.Count(row=>string.IsNullOrEmpty(row[meanIndex])));
        var primary=export.Sheets.Single(x=>x.Name=="Form entries");Assert.Equal(15,primary.Columns.Count(x=>x.Contains("entered average (1–5)")));Assert.Equal(6,primary.Columns.Count(x=>x.Contains("pillar mean")));
        var actionRow=Assert.Single(export.Sheets.Single(x=>x.Name=="Actions").Rows);Assert.Contains(actionRow,x=>x=="Test staff 1; Test staff 2");
        var structuralEdit=actionRequest with{Title="Amended action",ThemeKey=review.Configuration.ActionThemes![1].Key,
            ResponsibleStaffIds=[db.StaffIds[2]],ImpactAreaKey="digital_wellbeing",Detail="Audit regression amended action",
            SuccessEvidence="Learners describe healthier digital routines",Progress=action.Progress,RowVersion=action.RowVersion};
        await store.SaveProcessReviewActionAsync(review.RecordId,action.ActionId,structuralEdit,admin,Token);
        var auditFilter=$"entity_id='{action.ActionId}' AND action=N'action.updated' AND JSON_VALUE(after_json,N'$.detail')=N'Audit regression amended action'";
        using var beforeAudit=JsonDocument.Parse(await db.ScalarAsync<string>($"SELECT before_json FROM ops.audit_logs WHERE {auditFilter};"));
        using var afterAudit=JsonDocument.Parse(await db.ScalarAsync<string>($"SELECT after_json FROM ops.audit_logs WHERE {auditFilter};"));
        Assert.Equal(actionRequest.Detail,beforeAudit.RootElement.GetProperty("detail").GetString());
        Assert.Equal(actionRequest.SuccessEvidence,beforeAudit.RootElement.GetProperty("successEvidence").GetString());
        Assert.Equal(actionRequest.ThemeKey,beforeAudit.RootElement.GetProperty("themeKey").GetString());
        Assert.Equal(actionRequest.ImpactAreaKey,beforeAudit.RootElement.GetProperty("impactAreaKey").GetString());
        Assert.Equal(2,beforeAudit.RootElement.GetProperty("responsibleStaffIds").GetArrayLength());
        Assert.Empty(beforeAudit.RootElement.GetProperty("updates").EnumerateArray());
        Assert.Equal(structuralEdit.Detail,afterAudit.RootElement.GetProperty("detail").GetString());
        Assert.Equal(structuralEdit.SuccessEvidence,afterAudit.RootElement.GetProperty("successEvidence").GetString());
        Assert.Equal(structuralEdit.ThemeKey,afterAudit.RootElement.GetProperty("themeKey").GetString());
        Assert.Equal(structuralEdit.ImpactAreaKey,afterAudit.RootElement.GetProperty("impactAreaKey").GetString());
        Assert.Equal(db.StaffIds[2],Assert.Single(afterAudit.RootElement.GetProperty("responsibleStaffIds").EnumerateArray()).GetGuid());
    }

    [AccountAdministrationDatabaseFact]
    public async Task Linked_follow_ups_keep_previous_results_separate_share_actions_and_preserve_source_authority()
    {
        await using var db=await ReviewDatabase.CreateAsync();var store=db.Store();var admin=db.Admin();
        var date=new DateOnly(2026,10,30);
        var initial=new ActivateGrowthReviewData(true,[],[],[],new Dictionary<string,decimal?>
            {{"digital_proficiency",2.65m},{"digital_productivity",2.7m}},new DateOnly(2026,11,1),
            "Original meeting minutes","Original strengths","Original development");
        var sourceRequest=new SaveProcessReviewRequest("Initial growth review","2026/27",db.Faculty,null,date,Empty with{Activate=initial});
        var parent=await store.SaveProcessReviewAsync(ProcessReviewRules.Activate,null,sourceRequest,admin,Token);
        var actionRequest=new SaveProcessReviewActionRequest("",parent.Configuration.ActionThemes![0].Key,Guid.Empty,date.AddMonths(3),"","Independent digital practice",
            ResponsibleStaffIds:[db.StaffIds[1]],ImpactAreaKey:"digital_productivity",Detail:"Evaluate the revised practice resources",ReviewDate:date.AddMonths(3));
        var action=await store.SaveProcessReviewActionAsync(parent.RecordId,null,actionRequest,admin,Token);
        await Assert.ThrowsAsync<UnauthorizedAccessException>(()=>store.CreateActivateFollowUpAsync(parent.RecordId,new("2027/28"),db.User(2,ProcessReviewRules.Activate+".submit"),Token));
        await Assert.ThrowsAsync<DBConcurrencyException>(()=>store.CreateActivateFollowUpAsync(parent.RecordId,new("2027/28",RowVersion:"stale-version"),admin,Token));
        Assert.Equal(1,await db.ScalarAsync<int>("SELECT COUNT(*) FROM core.records;"));
        var create=new CreateActivateFollowUpRequest("2027/28",new DateOnly(2027,11,4),parent.RowVersion);
        var followUp=await store.CreateActivateFollowUpAsync(parent.RecordId,create,db.Admin(1),Token);
        Assert.True(followUp.IsFollowUp);Assert.Equal("draft",followUp.Status);Assert.Equal(db.StaffIds[1],followUp.OwnerStaffId);
        Assert.Equal(parent.RecordId,followUp.ParentReview!.RecordId);Assert.Equal("2026/27",followUp.ParentReview.AcademicYear);
        Assert.Equal("2027/28",followUp.AcademicYear);Assert.Equal(new DateOnly(2027,11,4),followUp.RecordDate);
        Assert.Equal(2,followUp.SelectedSubTeams!.Count);Assert.Contains(followUp.SelectedSubTeams,team=>team.OrgUnitId==db.TeamA);
        Assert.Empty(followUp.Data.Fields);Assert.Empty(followUp.Data.Activate!.SkillsScanScores);
        Assert.Null(followUp.Data.Activate.MeetingMinutes);Assert.Null(followUp.Data.Activate.Strengths);Assert.Null(followUp.Data.Activate.Development);Assert.Null(followUp.Data.Activate.FollowUpDate);
        Assert.Equal(2.65m,followUp.ParentReviewContext!.SkillsScanScores["digital_proficiency"]);Assert.Equal("Original meeting minutes",followUp.ParentReviewContext.MeetingMinutes);Assert.Equal("draft",followUp.ParentReviewContext.Review.Status);
        Assert.Contains(followUp.Participants!,person=>person.StaffId==db.StaffIds[1]&&person.IsLocked&&person.Roles.Contains("Review owner")&&person.Roles.Contains("Head of faculty"));
        Assert.Contains(followUp.Participants!,person=>person.StaffId==db.StaffIds[0]&&!person.IsLocked&&person.Roles.Contains("Additional participant"));
        Assert.Equal(action.ActionId,Assert.Single(followUp.Actions).ActionId);Assert.Equal(parent.RecordId,followUp.Actions[0].RecordId);
        var again=await store.CreateActivateFollowUpAsync(parent.RecordId,create with{AcademicYear="2028/29",RowVersion="old-token"},admin,Token);
        Assert.Equal(followUp.RecordId,again.RecordId);Assert.Equal(2,await db.ScalarAsync<int>("SELECT COUNT(*) FROM core.records;"));
        Assert.Equal(1,await db.ScalarAsync<int>("SELECT COUNT(*) FROM quality.actions;"));Assert.Equal(1,await db.ScalarAsync<int>("SELECT COUNT(*) FROM quality.process_review_follow_ups;"));
        var registered=(await store.GetProcessReviewsAsync(ProcessReviewRules.Activate,"2027/28",admin,Token)).Single();
        Assert.True(registered.IsFollowUp);Assert.Equal(parent.RecordId,registered.ParentReview!.RecordId);Assert.Equal(1,registered.OpenActionCount);
        var reportedAction=Assert.Single(await store.GetProcessReviewActionsAsync(ProcessReviewRules.Activate,"2027/28",admin,Token));
        Assert.Equal(action.ActionId,reportedAction.ActionId);Assert.Equal("2026/27",reportedAction.AcademicYear);Assert.Equal(followUp.RecordId,Assert.Single(reportedAction.AssociatedReviewIds!));
        Assert.Equal(followUp.RecordId,Assert.Single((await store.GetProcessReviewAsync(parent.RecordId,admin,Token))!.FollowUpReviews!).RecordId);
        var changed=followUp.Data.Activate with{SubTeamOrgUnitIds=[db.TeamB]};
        await Assert.ThrowsAsync<WorkflowValidationException>(()=>store.SaveProcessReviewAsync(ProcessReviewRules.Activate,followUp.RecordId,
            new(followUp.Title,followUp.AcademicYear,db.Faculty,null,followUp.RecordDate,followUp.Data with{Activate=changed},RowVersion:followUp.RowVersion),db.Admin(1),Token));
        parent=await store.SaveProcessReviewAsync(ProcessReviewRules.Activate,parent.RecordId,sourceRequest with{Data=parent.Data with{Activate=parent.Data.Activate! with
            {SkillsScanScores=new Dictionary<string,decimal?>{{"digital_proficiency",5m}},MeetingMinutes="Amended original notes"}},Submit=true,RowVersion=parent.RowVersion},admin,Token);
        followUp=(await store.GetProcessReviewAsync(followUp.RecordId,admin,Token))!;
        Assert.Equal(2.65m,followUp.ParentReviewContext!.SkillsScanScores["digital_proficiency"]);Assert.Equal("Original meeting minutes",followUp.ParentReviewContext.MeetingMinutes);
        Assert.Equal("draft",followUp.ParentReviewContext.Review.Status);Assert.Equal("submitted",followUp.ParentReview!.Status);
        var laterTeam=Guid.NewGuid();
        await db.ExecuteAsync($"INSERT org.org_units(id,parent_org_unit_id,org_unit_type,name)VALUES('{laterTeam}','{db.Faculty}',N'team',N'Later team');UPDATE org.org_unit_leaderships SET leader_staff_id='{db.StaffIds[2]}' WHERE org_unit_id='{db.Faculty}';");
        followUp=await store.SaveProcessReviewAsync(ProcessReviewRules.Activate,followUp.RecordId,new(followUp.Title,followUp.AcademicYear,followUp.FacultyOrgUnitId,null,
            followUp.RecordDate!.Value.AddDays(1),followUp.Data,RowVersion:followUp.RowVersion),db.Admin(1),Token);
        Assert.Equal(2,followUp.SelectedSubTeams!.Count);Assert.DoesNotContain(followUp.SelectedSubTeams,scope=>scope.OrgUnitId==laterTeam);
        Assert.Contains(followUp.Participants!,person=>person.StaffId==db.StaffIds[1]&&person.Roles.Contains("Head of faculty"));
        var restricted=(await store.GetProcessReviewAsync(followUp.RecordId,db.User(1),Token))!;
        Assert.True(restricted.IsFollowUp);Assert.Null(restricted.ParentReview);Assert.Null(restricted.ParentReviewContext);
        Assert.Null(await store.GetProcessReviewAsync(parent.RecordId,db.User(1),Token));
        Assert.Equal(action.ActionId,Assert.Single(restricted.Actions).ActionId);Assert.True(restricted.Actions[0].CanEdit);
        var restrictedReported=Assert.Single(await store.GetProcessReviewActionsAsync(ProcessReviewRules.Activate,"2027/28",db.User(1),Token));
        Assert.Equal(action.ActionId,restrictedReported.ActionId);Assert.Equal(followUp.RecordId,Assert.Single(restrictedReported.AssociatedReviewIds!));
        await store.SaveProcessReviewActionAsync(parent.RecordId,action.ActionId,actionRequest with{Progress="complete",ProgressNote="Reviewed at the linked meeting",RowVersion=action.RowVersion},db.User(1),Token);
        followUp=(await store.GetProcessReviewAsync(followUp.RecordId,admin,Token))!;Assert.Equal("complete",Assert.Single(followUp.Actions).Progress);
        Assert.Equal(1,await db.ScalarAsync<int>("SELECT COUNT(*) FROM quality.actions;"));
        var export=BusinessWorkbookExportBuilder.Build(await store.GetProcessReviewExportAsync(ProcessReviewRules.Activate,"2027/28",admin,Token));
        Assert.Single(export.Sheets.Single(x=>x.Name=="Form entries").Rows);Assert.Single(export.Sheets.Single(x=>x.Name=="Actions").Rows);
        var scan=export.Sheets.Single(x=>x.Name=="Skills Scan");var scoreIndex=scan.Columns.ToList().IndexOf("Entered average (1–5)");
        Assert.All(scan.Rows,row=>Assert.True(string.IsNullOrEmpty(row[scoreIndex])));
        Assert.Contains(export.Sheets,x=>x.Name=="Previous Skills Scan");Assert.Contains(export.Sheets,x=>x.Name=="Review links");
        Assert.Contains(export.Sheets.Single(x=>x.Name=="Previous Skills Scan").Rows.SelectMany(x=>x),x=>x=="2.65");
        var previousScan=export.Sheets.Single(x=>x.Name=="Previous Skills Scan");var previousMean=previousScan.Columns.ToList().IndexOf("Previous pillar mean (complete submitted results only)");
        Assert.All(previousScan.Rows,row=>Assert.True(string.IsNullOrEmpty(row[previousMean])));
        Assert.DoesNotContain(export.Sheets.SelectMany(x=>x.Rows).SelectMany(x=>x),value=>value==parent.RecordId.ToString()||value==followUp.RecordId.ToString());
        Assert.All(export.Sheets,sheet=>Assert.All(sheet.Rows,row=>Assert.Equal(sheet.Columns.Count,row.Count)));
        Assert.NotEmpty(new ExcelExportService().CreateWorkbook(export).Content);
        // A later follow-up sees the same original action, without creating another central action row.
        var third=await store.CreateActivateFollowUpAsync(followUp.RecordId,new("2028/29",new DateOnly(2028,11,4),followUp.RowVersion),admin,Token);
        Assert.Equal(action.ActionId,Assert.Single(third.Actions).ActionId);Assert.Empty(third.Data.Activate!.SkillsScanScores);
        Assert.Equal(followUp.RecordId,third.ParentReview!.RecordId);Assert.Equal(1,await db.ScalarAsync<int>("SELECT COUNT(*) FROM quality.actions;"));
    }

    private sealed class ReviewDatabase:IAsyncDisposable
    {
        private readonly string master;private readonly string name="TLQS_ProcessReviewTest_"+Guid.NewGuid().ToString("N");private bool created;
        public string ConnectionString{get;private set;}="";
        public Guid Faculty{get;}=Guid.NewGuid();public Guid TeamA{get;}=Guid.NewGuid();public Guid TeamB{get;}=Guid.NewGuid();
        public Guid[] StaffIds{get;}=[Guid.NewGuid(),Guid.NewGuid(),Guid.NewGuid()];
        private Guid[] Accounts{get;}=[Guid.NewGuid(),Guid.NewGuid(),Guid.NewGuid()];
        private ReviewDatabase(string master)=>this.master=master;
        public CurrentUser User(int index,params string[] permissions)=>new(Accounts[index],StaffIds[index],$"Test staff {index}",$"review{index}@example.invalid",permissions.ToHashSet(),[]);
        public CurrentUser Admin(int index=0)=>User(index,PermissionKeys.FormsManage) with{IsAdministrator=true};
        public SqlFoundationDataStore Store()=>new(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?>{{"ConnectionStrings:TlqsDatabase",ConnectionString}}).Build(),NullLogger<SqlFoundationDataStore>.Instance);
        public static async Task<ReviewDatabase> CreateAsync()
        {
            var builder=new SqlConnectionStringBuilder(Environment.GetEnvironmentVariable("TLQS_TEST_SQL_MASTER"));
            if(!builder.InitialCatalog.Equals("master",StringComparison.OrdinalIgnoreCase)||!string.IsNullOrEmpty(builder.AttachDBFilename)
                ||!(builder.DataSource.StartsWith("(localdb)",StringComparison.OrdinalIgnoreCase)||builder.DataSource is "." or "localhost"))throw new InvalidOperationException("Process review tests require an explicit local, unattached Database=master connection.");
            var db=new ReviewDatabase(builder.ConnectionString);
            await using(var connection=new SqlConnection(db.master)){await connection.OpenAsync();await using var command=new SqlCommand($"CREATE DATABASE [{db.name}];",connection){CommandTimeout=120};await command.ExecuteNonQueryAsync();db.created=true;}
            builder.InitialCatalog=db.name;db.ConnectionString=builder.ConnectionString;
            try
            {
                foreach(var schema in new[]{"core","people","auth","org","quality","ops"})await db.ExecuteAsync($"CREATE SCHEMA {schema};");
                await db.ExecuteAsync("""
                    CREATE TABLE people.staff(id uniqueidentifier PRIMARY KEY,display_name nvarchar(200),account_status nvarchar(50) DEFAULT N'active',archived_at datetimeoffset NULL);
                    CREATE TABLE auth.user_accounts(id uniqueidentifier PRIMARY KEY,staff_id uniqueidentifier REFERENCES people.staff(id));
                    CREATE TABLE auth.permissions(id uniqueidentifier PRIMARY KEY,permission_key nvarchar(150),name nvarchar(200),description nvarchar(1000),category nvarchar(100),is_system bit);
                    CREATE TABLE core.modules(id uniqueidentifier PRIMARY KEY,module_key nvarchar(100),name nvarchar(200),description nvarchar(1000),route_prefix nvarchar(200),display_order int,is_enabled bit);
                    CREATE TABLE org.org_units(id uniqueidentifier PRIMARY KEY,parent_org_unit_id uniqueidentifier NULL,org_unit_type nvarchar(50),name nvarchar(200),is_active bit DEFAULT 1,archived_at datetimeoffset NULL);
                    CREATE TABLE org.test_scopes(user_id uniqueidentifier,org_unit_id uniqueidentifier);
                    CREATE TABLE org.org_unit_leaderships(org_unit_id uniqueidentifier,leader_staff_id uniqueidentifier,leadership_role nvarchar(50),active_from date,active_to date NULL,archived_at datetimeoffset NULL);
                    CREATE TABLE core.records(id uniqueidentifier PRIMARY KEY,module_id uniqueidentifier REFERENCES core.modules(id),record_type nvarchar(100),title nvarchar(300),owner_staff_id uniqueidentifier REFERENCES people.staff(id),org_unit_id uniqueidentifier,record_date date,created_by_user_account_id uniqueidentifier,updated_by_user_account_id uniqueidentifier,academic_year_key nvarchar(20),created_at datetimeoffset DEFAULT sysutcdatetime(),updated_at datetimeoffset NULL,archived_at datetimeoffset NULL);
                    CREATE TABLE core.lookup_types(id uniqueidentifier PRIMARY KEY,lookup_key nvarchar(100));
                    CREATE TABLE core.lookup_values(id uniqueidentifier PRIMARY KEY,lookup_type_id uniqueidentifier,value_key nvarchar(100));
                    CREATE TABLE quality.actions(id uniqueidentifier PRIMARY KEY,source_record_id uniqueidentifier REFERENCES core.records(id),source_form_type nvarchar(100),owner_staff_id uniqueidentifier REFERENCES people.staff(id),action_theme nvarchar(300),title nvarchar(300),detail nvarchar(max),status_lookup_value_id uniqueidentifier,due_date date,review_date date,original_due_date date,revised_due_date date,published_to_staff bit,visibility_setting nvarchar(50),created_by_user_account_id uniqueidentifier,intended_evidence nvarchar(max),intended_impact nvarchar(max),completed_date date,completed_by_user_account_id uniqueidentifier,completion_note nvarchar(max),cancelled_at datetimeoffset,cancelled_by_user_account_id uniqueidentifier,cancellation_comments nvarchar(max),updated_at datetimeoffset,updated_by_user_account_id uniqueidentifier,archived_at datetimeoffset,row_version rowversion);
                    CREATE TABLE quality.action_extensions(id uniqueidentifier DEFAULT NEWID(),action_id uniqueidentifier,previous_due_date date,extended_due_date date,reason nvarchar(1000),created_by_user_account_id uniqueidentifier);
                    CREATE TABLE ops.audit_logs(user_account_id uniqueidentifier,record_id uniqueidentifier,entity_name nvarchar(100),entity_id uniqueidentifier,action nvarchar(100),summary nvarchar(max),before_json nvarchar(max),after_json nvarchar(max));
                    CREATE TABLE ops.domain_events(event_type nvarchar(100),aggregate_type nvarchar(100),aggregate_id uniqueidentifier,source_record_id uniqueidentifier,payload_json nvarchar(max),published_by_user_account_id uniqueidentifier);
                    """);
                await db.ExecuteAsync("CREATE FUNCTION org.fn_visible_org_units(@user uniqueidentifier) RETURNS TABLE AS RETURN SELECT org_unit_id FROM org.test_scopes WHERE user_id=@user;");
                await db.ExecuteAsync("CREATE FUNCTION org.fn_visible_staff(@user uniqueidentifier) RETURNS TABLE AS RETURN SELECT staff_id FROM auth.user_accounts WHERE id=@user;");
                for(var i=0;i<3;i++)await db.ExecuteAsync($"INSERT people.staff(id,display_name)VALUES('{db.StaffIds[i]}',N'Test staff {i}');INSERT auth.user_accounts(id,staff_id)VALUES('{db.Accounts[i]}','{db.StaffIds[i]}');");
                await db.ExecuteAsync($"""
                    INSERT org.org_units(id,org_unit_type,name)VALUES('{db.Faculty}',N'faculty',N'Faculty A');
                    INSERT org.org_units(id,parent_org_unit_id,org_unit_type,name)VALUES('{db.TeamA}','{db.Faculty}',N'team',N'Team A'),('{db.TeamB}','{db.Faculty}',N'team',N'Team B');
                    INSERT org.test_scopes(user_id,org_unit_id)VALUES('{db.Accounts[2]}','{db.TeamA}');
                    INSERT org.org_unit_leaderships(org_unit_id,leader_staff_id,leadership_role,active_from)
                    VALUES('{db.Faculty}','{db.StaffIds[1]}',N'manager','2020-01-01'),('{db.TeamA}','{db.StaffIds[2]}',N'manager','2020-01-01'),('{db.TeamB}','{db.StaffIds[2]}',N'manager','2020-01-01');
                    DECLARE @type uniqueidentifier=NEWID();INSERT core.lookup_types(id,lookup_key)VALUES(@type,N'action_status');
                    INSERT core.lookup_values(id,lookup_type_id,value_key)VALUES(NEWID(),@type,N'open'),(NEWID(),@type,N'complete'),(NEWID(),@type,N'extended'),(NEWID(),@type,N'cancelled');
                    """);
                var root=new DirectoryInfo(AppContext.BaseDirectory);while(root is not null&&!File.Exists(Path.Combine(root.FullName,"database","migrations","094_process_reviews.sql")))root=root.Parent;
                var migration=await File.ReadAllTextAsync(Path.Combine(root!.FullName,"database","migrations","094_process_reviews.sql"));
                foreach(var batch in Regex.Split(migration,@"^\s*GO\s*$",RegexOptions.Multiline|RegexOptions.IgnoreCase).Where(x=>!string.IsNullOrWhiteSpace(x)))await db.ExecuteAsync(batch);
                migration=await File.ReadAllTextAsync(Path.Combine(root.FullName,"database","migrations","095_activate_growth_review_workflow.sql"));
                foreach(var batch in Regex.Split(migration,@"^\s*GO\s*$",RegexOptions.Multiline|RegexOptions.IgnoreCase).Where(x=>!string.IsNullOrWhiteSpace(x)))await db.ExecuteAsync(batch);
                migration=await File.ReadAllTextAsync(Path.Combine(root.FullName,"database","migrations","096_activate_linked_follow_ups.sql"));
                foreach(var batch in Regex.Split(migration,@"^\s*GO\s*$",RegexOptions.Multiline|RegexOptions.IgnoreCase).Where(x=>!string.IsNullOrWhiteSpace(x)))await db.ExecuteAsync(batch);
                return db;
            }
            catch{await db.DisposeAsync();throw;}
        }
        public async Task ExecuteAsync(string sql){await using var connection=new SqlConnection(ConnectionString);await connection.OpenAsync();await using var command=new SqlCommand(sql,connection){CommandTimeout=120};await command.ExecuteNonQueryAsync();}
        public async Task<T> ScalarAsync<T>(string sql){await using var connection=new SqlConnection(ConnectionString);await connection.OpenAsync();await using var command=new SqlCommand(sql,connection);return(T)(await command.ExecuteScalarAsync())!;}
        public async Task UseLegacyActivateConfigurationAsync()
        {
            var legacy=ProcessReviewRules.DefaultConfiguration(ProcessReviewRules.Activate) with{Version=1,SkillsScanPillars=null,ActionThemes=null};
            await using var connection=new SqlConnection(ConnectionString);await connection.OpenAsync();
            await using var command=new SqlCommand("INSERT quality.process_review_configurations(process_key,version,configuration_json)VALUES(N'activate_growth_review',1,@json);",connection);
            command.Parameters.AddWithValue("@json",JsonSerializer.Serialize(legacy,new JsonSerializerOptions(JsonSerializerDefaults.Web)));await command.ExecuteNonQueryAsync();
        }
        public async ValueTask DisposeAsync()
        {
            if(!created)return;SqlConnection.ClearAllPools();await using var connection=new SqlConnection(master);await connection.OpenAsync();
            await using var command=new SqlCommand($"ALTER DATABASE [{name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;DROP DATABASE [{name}];",connection){CommandTimeout=120};await command.ExecuteNonQueryAsync();created=false;
        }
    }
}

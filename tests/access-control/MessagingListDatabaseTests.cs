using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using TLQS.Api.Data;
using TLQS.Api.V1;
using Xunit;

namespace TLQS.AccessControl.Tests;

[Collection("List query database checks")]
public sealed class MessagingListDatabaseTests
{
    [AccountAdministrationDatabaseFact]
    public async Task FilteringFindsOldDeliveriesBeyondFiveHundredAndSortsBeforePaging()
    {
        var master = Environment.GetEnvironmentVariable("TLQS_TEST_SQL_MASTER")!;
        var name = "TLQS_ListTest_" + Guid.NewGuid().ToString("N");
        await using var server = new SqlConnection(master); await server.OpenAsync();
        await using (var create = new SqlCommand($"CREATE DATABASE [{name}]", server)) await create.ExecuteNonQueryAsync();
        var builder = new SqlConnectionStringBuilder(master) { InitialCatalog = name };
        try
        {
            await using var connection = new SqlConnection(builder.ConnectionString); await connection.OpenAsync();
            await using (var setup = new SqlCommand("""
                CREATE SCHEMA ops;
                """, connection)) await setup.ExecuteNonQueryAsync();
            await using (var setup = new SqlCommand("""
                CREATE TABLE ops.message_templates(id uniqueidentifier, name nvarchar(200));
                CREATE TABLE ops.message_template_versions(id uniqueidentifier,message_template_id uniqueidentifier,version_number int);
                CREATE TABLE ops.message_outbox(id uniqueidentifier,template_version_id uniqueidentifier,triggering_event nvarchar(100),status nvarchar(50),
                    attempt_count int,queued_at datetimeoffset,delivered_at datetimeoffset NULL,failed_at datetimeoffset NULL,last_error nvarchar(200) NULL,provider_response_id nvarchar(100) NULL);
                CREATE TABLE ops.message_outbox_recipients(outbox_id uniqueidentifier,recipient_type nvarchar(50),email_address nvarchar(200));
                DECLARE @template uniqueidentifier=NEWID(), @version uniqueidentifier=NEWID();
                INSERT ops.message_templates VALUES(@template,N'Zoë development');
                INSERT ops.message_template_versions VALUES(@version,@template,1);
                ;WITH numbers AS (SELECT TOP(550) ROW_NUMBER() OVER(ORDER BY (SELECT NULL)) AS n FROM sys.all_objects)
                INSERT ops.message_outbox SELECT NEWID(),@version,CASE WHEN n=1 THEN N'old_action' ELSE N'review' END,
                    CASE WHEN n=1 THEN N'failed' ELSE N'delivered' END,n,DATEADD(day,CONVERT(int,n),CONVERT(datetimeoffset,'2024-01-01')),NULL,NULL,
                    CASE WHEN n=1 THEN N'literal % bracket [' END,NULL FROM numbers;
                INSERT ops.message_outbox_recipients SELECT id,N'to',N'person@example.invalid' FROM ops.message_outbox;
                """, connection)) await setup.ExecuteNonQueryAsync();
            var store = new SqlFoundationDataStore(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?>
                { ["ConnectionStrings:TlqsDatabase"] = builder.ConnectionString }).Build(), NullLogger<SqlFoundationDataStore>.Instance);
            var old = await store.GetMessageDeliveriesPageAsync(new(Search: "zoe literal % [", Status: "failed"), 1, 25, default);
            Assert.Equal(1, old.TotalCount); Assert.Equal("old_action", Assert.Single(old.Items).TriggeringEvent);
            Assert.Contains("delivered", old.FilterOptions!.Status); Assert.Contains("review", old.FilterOptions.Type);
            var ordered = await store.GetMessageDeliveriesPageAsync(new(SortBy: "attempts", SortDirection: "asc"), 2, 10, default);
            Assert.Equal(550, ordered.TotalCount); Assert.Equal(55, ordered.TotalPages);
            Assert.Equal(Enumerable.Range(11,10), ordered.Items.Select(item => item.AttemptCount));
            var dates = await store.GetMessageDeliveriesPageAsync(new(FromDate: new(2024,1,2), ToDate: new(2024,1,2)), 99, 25, default);
            Assert.Equal(1, dates.Page); Assert.Single(dates.Items);
            var empty = await store.GetMessageDeliveriesPageAsync(new(Search: "missing person"), 9, 25, default);
            Assert.Empty(empty.Items); Assert.Equal(0, empty.TotalCount); Assert.NotEmpty(empty.FilterOptions!.Person);
            var safe = await store.GetMessageDeliveriesPageAsync(new(SortBy: "attempts]; DROP TABLE ops.message_outbox;--"), 1, 1, default);
            Assert.Equal(550, safe.TotalCount); Assert.Equal(550, Assert.Single(safe.Items).AttemptCount);
        }
        finally
        {
            SqlConnection.ClearAllPools();
            await using var cleanup = new SqlCommand($"ALTER DATABASE [{name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [{name}];", server);
            await cleanup.ExecuteNonQueryAsync();
        }
    }
}

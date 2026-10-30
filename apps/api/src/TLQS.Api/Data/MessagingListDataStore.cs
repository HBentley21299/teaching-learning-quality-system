using Microsoft.Data.SqlClient;
using TLQS.Api.V1;

namespace TLQS.Api.Data;

public sealed partial class SqlFoundationDataStore
{
    private const string MessageListSource = """
        WITH deliveries AS (
            SELECT outbox.id, template.name AS title, version.version_number,
                   outbox.triggering_event AS type, outbox.status,
                   COALESCE(STRING_AGG(CONVERT(nvarchar(max), CONCAT(recipient.recipient_type, N': ', recipient.email_address)), N'; '), N'') AS person,
                   outbox.attempt_count AS attempts, outbox.queued_at AS date,
                   outbox.delivered_at, outbox.failed_at, outbox.last_error, outbox.provider_response_id
            FROM ops.message_outbox outbox
            JOIN ops.message_template_versions version ON version.id = outbox.template_version_id
            JOIN ops.message_templates template ON template.id = version.message_template_id
            LEFT JOIN ops.message_outbox_recipients recipient ON recipient.outbox_id = outbox.id
            GROUP BY outbox.id, template.name, version.version_number, outbox.triggering_event,
                     outbox.status, outbox.attempt_count, outbox.queued_at, outbox.delivered_at,
                     outbox.failed_at, outbox.last_error, outbox.provider_response_id
        )
        """;

    private const string MessageListFilter = """
        WHERE (@status IS NULL OR status = @status)
          AND (@type IS NULL OR type = @type)
          AND (@person IS NULL OR person = @person)
          AND (@fromDate IS NULL OR CONVERT(date, date) >= @fromDate)
          AND (@toDate IS NULL OR CONVERT(date, date) <= @toDate)
          AND NOT EXISTS (
              SELECT 1 FROM STRING_SPLIT(@search, N' ') term
              WHERE term.value <> N'' AND CHARINDEX(term.value COLLATE Latin1_General_100_CI_AI,
                  CONCAT(title, N' ', version_number, N' ', type, N' ', status, N' ', person, N' ', attempts,
                         N' ', CONVERT(nvarchar(10), date, 23), N' ', CONVERT(nvarchar(10), date, 103), N' ', last_error, N' ', provider_response_id)
                  COLLATE Latin1_General_100_CI_AI) = 0
          )
        """;

    public async Task<PagedResult<MessageDeliverySummary>> GetMessageDeliveriesPageAsync(
        ListQuery query, int page, int pageSize, CancellationToken cancellationToken)
    {
        pageSize = Math.Clamp(pageSize, 1, 100);
        page = Math.Max(1, page);
        void Bind(SqlCommand command)
        {
            command.Parameters.AddWithValue("@search", string.Join(' ', (query.Search ?? "").Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries)));
            command.Parameters.AddWithValue("@status", ToDbValue(string.IsNullOrWhiteSpace(query.Status) ? null : query.Status));
            command.Parameters.AddWithValue("@type", ToDbValue(string.IsNullOrWhiteSpace(query.Type) ? null : query.Type));
            command.Parameters.AddWithValue("@person", ToDbValue(string.IsNullOrWhiteSpace(query.Person) ? null : query.Person));
            command.Parameters.AddWithValue("@fromDate", (object?)query.FromDate?.ToDateTime(TimeOnly.MinValue) ?? DBNull.Value);
            command.Parameters.AddWithValue("@toDate", (object?)query.ToDate?.ToDateTime(TimeOnly.MinValue) ?? DBNull.Value);
        }
        var counts = await QueryAsync(MessageListSource + "SELECT COUNT(*) FROM deliveries " + MessageListFilter,
            Bind, reader => reader.GetInt32(0), cancellationToken);
        var total = counts[0];
        var totalPages = Math.Max(1, (int)Math.Ceiling(total / (double)pageSize));
        page = Math.Min(page, totalPages);
        var column = query.SortBy switch
        {
            "title" => "title", "status" => "status", "person" => "person", "type" => "type", "attempts" => "attempts", _ => "date"
        };
        var direction = string.Equals(query.SortDirection, "asc", StringComparison.OrdinalIgnoreCase) ? "ASC" : "DESC";
        var rows = await QueryAsync(MessageListSource + """
            SELECT id, title, version_number, type, status, person, attempts, date,
                   delivered_at, failed_at, last_error, provider_response_id FROM deliveries
            """ + "\n" + MessageListFilter + $" ORDER BY [{column}] {direction}, id ASC OFFSET @offset ROWS FETCH NEXT @size ROWS ONLY;",
            command => { Bind(command); command.Parameters.AddWithValue("@offset", (page - 1) * pageSize); command.Parameters.AddWithValue("@size", pageSize); },
            reader => new MessageDeliverySummary(reader.GetGuid(0), reader.GetString(1), reader.GetInt32(2), reader.GetString(3),
                reader.GetString(4), reader.GetString(5), reader.GetInt32(6), reader.GetFieldValue<DateTimeOffset>(7),
                GetDateTimeOffsetOrNull(reader, 8), GetDateTimeOffsetOrNull(reader, 9), GetStringOrNull(reader, 10), GetStringOrNull(reader, 11)), cancellationToken);
        var options = await QueryAsync(MessageListSource + "SELECT DISTINCT status, type, person FROM deliveries;",
            reader => (Status: reader.GetString(0), Type: reader.GetString(1), Person: reader.GetString(2)), cancellationToken);
        static string[] Values(IEnumerable<string> values) => values.Where(value => !string.IsNullOrWhiteSpace(value)).Distinct(StringComparer.OrdinalIgnoreCase).Order(StringComparer.OrdinalIgnoreCase).ToArray();
        return new(rows, page, pageSize, total, totalPages, new(Values(options.Select(row => row.Status)), Values(options.Select(row => row.Type)), Values(options.Select(row => row.Person))));
    }
}

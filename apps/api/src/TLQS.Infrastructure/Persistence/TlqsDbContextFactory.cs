using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace TLQS.Infrastructure.Persistence;

public sealed class TlqsDbContextFactory : IDesignTimeDbContextFactory<TlqsDbContext>
{
    public TlqsDbContext CreateDbContext(string[] args)
    {
        var options = new DbContextOptionsBuilder<TlqsDbContext>()
            .UseSqlServer("Server=(localdb)\\mssqllocaldb;Database=TLQS_DesignTime;Trusted_Connection=True;MultipleActiveResultSets=true")
            .Options;

        return new TlqsDbContext(options);
    }
}


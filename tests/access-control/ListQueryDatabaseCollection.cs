using Xunit;

namespace TLQS.AccessControl.Tests;

// LocalDB shares one memory pool across disposable databases. Keep these wider
// list-query fixtures away from the concurrent administration transaction tests.
[CollectionDefinition("List query database checks", DisableParallelization = true)]
public sealed class ListQueryDatabaseCollection;

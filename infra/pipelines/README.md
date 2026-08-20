# Delivery pipelines

`.github/workflows/ci.yml` builds and tests every approved change.

`.github/workflows/release-on-premises.yml` creates a checksummed Windows/IIS release ZIP when an authorised maintainer runs it manually. It never connects to the college network or deploys directly to IIS or SQL Server. College IT downloads the approved package and uses the guarded on-premises deployment script.

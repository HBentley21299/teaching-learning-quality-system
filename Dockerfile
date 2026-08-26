# syntax=docker/dockerfile:1

# The browser application is compiled first because Microsoft Entra identifiers
# are public build-time configuration embedded by Vite. Do not pass secrets here.
FROM node:24-bookworm-slim AS web-build
WORKDIR /src/apps/web

COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci

COPY apps/web/ ./

ARG VITE_ENTRA_CLIENT_ID
ARG VITE_ENTRA_TENANT_ID
ARG VITE_ENTRA_API_SCOPE
ENV VITE_API_BASE_URL="" \
    VITE_ENTRA_CLIENT_ID=${VITE_ENTRA_CLIENT_ID} \
    VITE_ENTRA_TENANT_ID=${VITE_ENTRA_TENANT_ID} \
    VITE_ENTRA_API_SCOPE=${VITE_ENTRA_API_SCOPE} \
    VITE_ENABLE_LOCAL_LOGIN=false

RUN test -n "$VITE_ENTRA_CLIENT_ID" \
    && test -n "$VITE_ENTRA_TENANT_ID" \
    && test -n "$VITE_ENTRA_API_SCOPE" \
    && npm run build


FROM mcr.microsoft.com/dotnet/sdk:10.0-bookworm-slim AS api-build
WORKDIR /src

COPY global.json Directory.Packages.props NuGet.Config ./
COPY apps/api/src/TLQS.Domain/TLQS.Domain.csproj apps/api/src/TLQS.Domain/
COPY apps/api/src/TLQS.Application/TLQS.Application.csproj apps/api/src/TLQS.Application/
COPY apps/api/src/TLQS.Infrastructure/TLQS.Infrastructure.csproj apps/api/src/TLQS.Infrastructure/
COPY apps/api/src/TLQS.Api/TLQS.Api.csproj apps/api/src/TLQS.Api/
RUN dotnet restore apps/api/src/TLQS.Api/TLQS.Api.csproj

COPY apps/api/src/ apps/api/src/
RUN dotnet publish apps/api/src/TLQS.Api/TLQS.Api.csproj \
    --configuration Release \
    --no-restore \
    --output /app/publish \
    /p:UseAppHost=false

COPY --from=web-build /src/apps/web/dist/ /app/publish/wwwroot/


FROM mcr.microsoft.com/dotnet/aspnet:10.0-bookworm-slim AS runtime

# curl drives the container health check. The GSSAPI library supports a future
# Kerberos-integrated OC-DB connection if the college configures a keytab.
RUN apt-get update \
    && apt-get install --yes --no-install-recommends curl libgssapi-krb5-2 \
    && rm -rf /var/lib/apt/lists/* \
    && install --directory --owner=app --group=app /var/lib/ielevate/keys

WORKDIR /app
COPY --from=api-build --chown=app:app /app/publish/ ./

ENV ASPNETCORE_ENVIRONMENT=Production \
    ASPNETCORE_HTTP_PORTS=8080 \
    DOTNET_EnableDiagnostics=0 \
    DataProtection__KeyPath=/var/lib/ielevate/keys

EXPOSE 8080
VOLUME ["/var/lib/ielevate/keys"]

USER app

# Supplying the forwarded scheme avoids the intended production HTTPS redirect
# when Docker probes Kestrel directly. Readiness also proves OC-DB connectivity.
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl --fail --silent --show-error \
        --header "X-Forwarded-Proto: https" \
        http://127.0.0.1:8080/health/ready || exit 1

ENTRYPOINT ["dotnet", "TLQS.Api.dll"]

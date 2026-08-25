targetScope = 'resourceGroup'

@description('Short lower-case name used in Azure resource names.')
@minLength(3)
@maxLength(18)
param namePrefix string = 'ielevate-oldham'

@allowed([
  'dev'
  'test'
  'prod'
])
param environmentName string = 'prod'

param location string = resourceGroup().location
param entraTenantId string
param entraApiAudience string
param sqlEntraAdministratorLogin string
param sqlEntraAdministratorObjectId string

@description('Break-glass SQL administrator login. The application itself uses managed identity.')
param sqlAdministratorLogin string = 'ielevatesqladmin'

@secure()
param sqlAdministratorPassword string

@description('Public IPv4 address allowed temporarily for migrations. Leave empty after deployment.')
param deploymentIpAddress string = ''

param appServiceSkuName string = 'B1'
param appServiceSkuTier string = 'Basic'
param sqlMaximumVcores int = 2
param sqlAutoPauseDelayMinutes int = 60

var suffix = uniqueString(subscription().subscriptionId, resourceGroup().id, namePrefix, environmentName)
var appServicePlanName = 'asp-${namePrefix}-${environmentName}'
var webAppName = 'app-${namePrefix}-${environmentName}-${take(suffix, 6)}'
var sqlServerName = 'sql-${namePrefix}-${environmentName}-${take(suffix, 6)}'
var sqlDatabaseName = 'ielevate'
var storageAccountName = 'st${take(suffix, 20)}'
var keyVaultName = 'kv-${take(namePrefix, 10)}-${take(suffix, 8)}'
var logAnalyticsName = 'log-${namePrefix}-${environmentName}'
var applicationInsightsName = 'appi-${namePrefix}-${environmentName}'
var dataProtectionContainerName = 'data-protection'
var dataProtectionKeyName = 'data-protection'
var applicationUrl = 'https://${webAppName}.azurewebsites.net'
var sqlConnectionString = 'Server=tcp:${sqlServerName}.database.windows.net,1433;Database=${sqlDatabaseName};Authentication=Active Directory Default;Encrypt=True;TrustServerCertificate=False;Connection Timeout=30;MultipleActiveResultSets=True;Application Name=i-Elevate'
var commonTags = {
  application: 'i-Elevate'
  environment: environmentName
  managedBy: 'bicep'
  dataClassification: 'staff-confidential'
}

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: logAnalyticsName
  location: location
  tags: commonTags
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
  }
}

resource applicationInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: applicationInsightsName
  location: location
  kind: 'web'
  tags: commonTags
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
    IngestionMode: 'LogAnalytics'
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
  }
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageAccountName
  location: location
  tags: commonTags
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    accessTier: 'Hot'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    defaultToOAuthAuthentication: true
    minimumTlsVersion: 'TLS1_2'
    publicNetworkAccess: 'Enabled'
    supportsHttpsTrafficOnly: true
    networkAcls: {
      bypass: 'AzureServices'
      defaultAction: 'Allow'
    }
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {
    deleteRetentionPolicy: {
      enabled: true
      days: 30
    }
    containerDeleteRetentionPolicy: {
      enabled: true
      days: 30
    }
  }
}

resource dataProtectionContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: dataProtectionContainerName
  properties: {
    publicAccess: 'None'
  }
}

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: keyVaultName
  location: location
  tags: commonTags
  properties: {
    tenantId: entraTenantId
    sku: {
      family: 'A'
      name: 'standard'
    }
    accessPolicies: []
    enablePurgeProtection: true
    enableRbacAuthorization: true
    enabledForDeployment: false
    enabledForDiskEncryption: false
    enabledForTemplateDeployment: false
    publicNetworkAccess: 'Enabled'
    softDeleteRetentionInDays: 90
    networkAcls: {
      bypass: 'AzureServices'
      defaultAction: 'Allow'
    }
  }
}

resource dataProtectionKey 'Microsoft.KeyVault/vaults/keys@2023-07-01' = {
  parent: keyVault
  name: dataProtectionKeyName
  properties: {
    kty: 'RSA'
    keySize: 2048
    keyOps: [
      'wrapKey'
      'unwrapKey'
    ]
    attributes: {
      enabled: true
    }
  }
}

resource sqlServer 'Microsoft.Sql/servers@2023-08-01-preview' = {
  name: sqlServerName
  location: location
  tags: commonTags
  properties: {
    administratorLogin: sqlAdministratorLogin
    administratorLoginPassword: sqlAdministratorPassword
    minimalTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'
    restrictOutboundNetworkAccess: 'Disabled'
  }
}

resource sqlEntraAdministrator 'Microsoft.Sql/servers/administrators@2023-08-01-preview' = {
  parent: sqlServer
  name: 'ActiveDirectory'
  properties: {
    administratorType: 'ActiveDirectory'
    azureADOnlyAuthentication: false
    login: sqlEntraAdministratorLogin
    principalType: 'User'
    sid: sqlEntraAdministratorObjectId
    tenantId: entraTenantId
  }
}

resource sqlDatabase 'Microsoft.Sql/servers/databases@2023-08-01-preview' = {
  parent: sqlServer
  name: sqlDatabaseName
  location: location
  tags: commonTags
  sku: {
    name: 'GP_S_Gen5_${sqlMaximumVcores}'
    tier: 'GeneralPurpose'
    family: 'Gen5'
    capacity: sqlMaximumVcores
  }
  properties: {
    autoPauseDelay: sqlAutoPauseDelayMinutes
    minCapacity: 0.5
    readScale: 'Disabled'
    requestedBackupStorageRedundancy: 'Local'
    zoneRedundant: false
  }
  dependsOn: [
    sqlEntraAdministrator
  ]
}

resource allowAzureServices 'Microsoft.Sql/servers/firewallRules@2023-08-01-preview' = {
  parent: sqlServer
  name: 'AllowAzureServices'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

resource allowDeploymentIp 'Microsoft.Sql/servers/firewallRules@2023-08-01-preview' = if (!empty(deploymentIpAddress)) {
  parent: sqlServer
  name: 'TemporaryDeploymentAddress'
  properties: {
    startIpAddress: deploymentIpAddress
    endIpAddress: deploymentIpAddress
  }
}

resource appServicePlan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: appServicePlanName
  location: location
  tags: commonTags
  kind: 'linux'
  sku: {
    name: appServiceSkuName
    tier: appServiceSkuTier
    size: appServiceSkuName
    capacity: 1
  }
  properties: {
    reserved: true
  }
}

resource webApp 'Microsoft.Web/sites@2023-12-01' = {
  name: webAppName
  location: location
  tags: commonTags
  kind: 'app,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    clientAffinityEnabled: false
    httpsOnly: true
    publicNetworkAccess: 'Enabled'
    serverFarmId: appServicePlan.id
    siteConfig: {
      alwaysOn: true
      appCommandLine: 'dotnet TLQS.Api.dll'
      ftpsState: 'Disabled'
      healthCheckPath: '/health/ready'
      http20Enabled: true
      httpLoggingEnabled: true
      linuxFxVersion: 'DOTNETCORE|10.0'
      minTlsVersion: '1.2'
      remoteDebuggingEnabled: false
      use32BitWorkerProcess: false
      appSettings: [
        {
          name: 'ASPNETCORE_ENVIRONMENT'
          value: 'Production'
        }
        {
          name: 'Authentication__AllowDevelopmentUser'
          value: 'false'
        }
        {
          name: 'Authentication__Audience'
          value: entraApiAudience
        }
        {
          name: 'Authentication__TenantId'
          value: entraTenantId
        }
        {
          name: 'ConnectionStrings__TlqsDatabase'
          value: sqlConnectionString
        }
        {
          name: 'Cors__AllowedOrigins__0'
          value: applicationUrl
        }
        {
          name: 'DataProtection__BlobUri'
          value: 'https://${storage.name}.blob.core.windows.net/${dataProtectionContainer.name}/keys.xml'
        }
        {
          name: 'DataProtection__KeyVaultKeyIdentifier'
          value: 'https://${keyVault.name}.vault.azure.net/keys/${dataProtectionKey.name}'
        }
        {
          name: 'Messaging__ApplicationUrl'
          value: applicationUrl
        }
        {
          name: 'Messaging__Enabled'
          value: 'false'
        }
        {
          name: 'Messaging__TestMode'
          value: 'true'
        }
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: applicationInsights.properties.ConnectionString
        }
        {
          name: 'ApplicationInsightsAgent_EXTENSION_VERSION'
          value: '~3'
        }
        {
          name: 'SCM_DO_BUILD_DURING_DEPLOYMENT'
          value: 'false'
        }
        {
          name: 'WEBSITE_HEALTHCHECK_MAXPINGFAILURES'
          value: '3'
        }
      ]
    }
  }
}

var storageBlobDataContributorRoleId = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
resource storageBlobDataContributorRole 'Microsoft.Authorization/roleDefinitions@2022-04-01' existing = {
  scope: subscription()
  name: storageBlobDataContributorRoleId
}

resource storageRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, webApp.id, storageBlobDataContributorRoleId)
  scope: storage
  properties: {
    principalId: webApp.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: storageBlobDataContributorRole.id
  }
}

var keyVaultCryptoUserRoleId = '12338af0-0e69-4776-bea7-57ae8d297424'
resource keyVaultCryptoUserRole 'Microsoft.Authorization/roleDefinitions@2022-04-01' existing = {
  scope: subscription()
  name: keyVaultCryptoUserRoleId
}

resource keyVaultRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, webApp.id, keyVaultCryptoUserRoleId)
  scope: keyVault
  properties: {
    principalId: webApp.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: keyVaultCryptoUserRole.id
  }
}

output applicationUrl string = applicationUrl
output applicationInsightsName string = applicationInsights.name
output dataProtectionBlobUri string = 'https://${storage.name}.blob.core.windows.net/${dataProtectionContainer.name}/keys.xml'
output keyVaultName string = keyVault.name
output logAnalyticsName string = logAnalytics.name
output sqlDatabaseName string = sqlDatabase.name
output sqlServerFullyQualifiedDomainName string = sqlServer.properties.fullyQualifiedDomainName
output storageAccountName string = storage.name
output webAppManagedIdentityObjectId string = webApp.identity.principalId
output webAppName string = webApp.name

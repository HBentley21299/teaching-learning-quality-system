@description('Short environment name, such as dev, test or prod.')
@allowed([
  'dev'
  'test'
  'prod'
])
param environmentName string = 'dev'

@description('Azure region for all resources.')
param location string = resourceGroup().location

@description('Application name prefix. Use lowercase letters, numbers and hyphens.')
@minLength(2)
@maxLength(5)
param appName string = 'tlqs'

@description('Display name for the Entra group or user that administers Azure SQL.')
param sqlAdministratorLogin string

@description('Object ID for the Entra group or user that administers Azure SQL.')
param sqlAdministratorObjectId string

@description('Principal type of the Azure SQL Entra administrator.')
@allowed([
  'Group'
  'User'
])
param sqlAdministratorPrincipalType string = 'Group'

@description('College Microsoft Entra tenant ID.')
param entraTenantId string = tenant().tenantId

@description('Client ID/audience of the Entra API app registration.')
param entraApiAudience string

@description('Temporarily permit one public IP to run first-time migrations. Disable after migration.')
param enableSqlMigrationAccess bool = false

@description('Public IPv4 address allowed to run migrations when enableSqlMigrationAccess is true.')
param migrationClientIp string = '0.0.0.0'

var nameHash = uniqueString(subscription().id, resourceGroup().id, appName, environmentName)
var suffix = '${appName}-${environmentName}'
var sqlServerName = take('${suffix}-sql-${nameHash}', 63)
var sqlDatabaseName = '${suffix}-db'
var storageName = toLower(replace('${appName}${environmentName}${nameHash}', '-', ''))
var appInsightsName = '${suffix}-appi'
var logAnalyticsName = '${suffix}-logs'
var appServicePlanName = '${suffix}-plan'
var appServiceName = take('${suffix}-app-${nameHash}', 60)
var keyVaultName = take('${suffix}-kv-${nameHash}', 24)
var sqlPrivateDnsZoneName = 'privatelink${environment().suffixes.sqlServerHostname}'
var blobPrivateDnsZoneName = 'privatelink.blob.${environment().suffixes.storage}'
var sqlConnectionString = 'Server=tcp:${sqlServer.properties.fullyQualifiedDomainName},1433;Initial Catalog=${sqlDatabase.name};Encrypt=True;TrustServerCertificate=False;Connection Timeout=30;Authentication=Active Directory Managed Identity;'
var blobContributorRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')
var keyVaultSecretsUserRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: logAnalyticsName
  location: location
  properties: {
    retentionInDays: 30
    features: {
      enableLogAccessUsingOnlyResourcePermissions: true
    }
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
  }
}

resource network 'Microsoft.Network/virtualNetworks@2023-11-01' = {
  name: '${suffix}-vnet'
  location: location
  properties: {
    addressSpace: {
      addressPrefixes: [
        '10.42.0.0/16'
      ]
    }
  }
}

resource appSubnet 'Microsoft.Network/virtualNetworks/subnets@2023-11-01' = {
  name: 'app-service-integration'
  parent: network
  properties: {
    addressPrefix: '10.42.1.0/24'
    delegations: [
      {
        name: 'web-apps'
        properties: {
          serviceName: 'Microsoft.Web/serverFarms'
        }
      }
    ]
  }
}

resource privateEndpointSubnet 'Microsoft.Network/virtualNetworks/subnets@2023-11-01' = {
  name: 'private-endpoints'
  parent: network
  properties: {
    addressPrefix: '10.42.2.0/24'
    privateEndpointNetworkPolicies: 'Disabled'
  }
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageName
  location: location
  sku: {
    name: environmentName == 'prod' ? 'Standard_GRS' : 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    minimumTlsVersion: 'TLS1_2'
    publicNetworkAccess: 'Disabled'
    supportsHttpsTrafficOnly: true
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  name: 'default'
  parent: storage
  properties: {
    isVersioningEnabled: true
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

resource evidenceContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  name: 'evidence'
  parent: blobService
  properties: {
    publicAccess: 'None'
  }
}

resource sqlServer 'Microsoft.Sql/servers@2023-08-01-preview' = {
  name: sqlServerName
  location: location
  tags: {
    application: appName
    environment: environmentName
  }
  properties: {
    administrators: {
      administratorType: 'ActiveDirectory'
      principalType: sqlAdministratorPrincipalType
      login: sqlAdministratorLogin
      sid: sqlAdministratorObjectId
      tenantId: entraTenantId
    }
    minimalTlsVersion: '1.2'
    publicNetworkAccess: enableSqlMigrationAccess ? 'Enabled' : 'Disabled'
    restrictOutboundNetworkAccess: 'Enabled'
  }
}

resource migrationFirewallRule 'Microsoft.Sql/servers/firewallRules@2023-08-01-preview' = if (enableSqlMigrationAccess) {
  name: 'temporary-migration-client'
  parent: sqlServer
  properties: {
    startIpAddress: migrationClientIp
    endIpAddress: migrationClientIp
  }
}

resource sqlDatabase 'Microsoft.Sql/servers/databases@2023-08-01-preview' = {
  name: sqlDatabaseName
  parent: sqlServer
  location: location
  sku: {
    name: 'GP_S_Gen5'
    tier: 'GeneralPurpose'
    family: 'Gen5'
    capacity: 1
  }
  properties: {
    autoPauseDelay: environmentName == 'prod' ? -1 : 60
    useFreeLimit: environmentName != 'prod'
    freeLimitExhaustionBehavior: environmentName == 'prod' ? 'BillOverUsage' : 'AutoPause'
    minCapacity: json('0.5')
    zoneRedundant: false
  }
}

resource shortTermRetention 'Microsoft.Sql/servers/databases/backupShortTermRetentionPolicies@2023-08-01-preview' = {
  name: 'default'
  parent: sqlDatabase
  properties: {
    retentionDays: environmentName == 'prod' ? 35 : 7
    diffBackupIntervalInHours: 12
  }
}

resource sqlPrivateDnsZone 'Microsoft.Network/privateDnsZones@2020-06-01' = {
  name: sqlPrivateDnsZoneName
  location: 'global'
}

resource blobPrivateDnsZone 'Microsoft.Network/privateDnsZones@2020-06-01' = {
  name: blobPrivateDnsZoneName
  location: 'global'
}

resource sqlDnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = {
  name: '${suffix}-sql-vnet-link'
  parent: sqlPrivateDnsZone
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: network.id
    }
  }
}

resource blobDnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = {
  name: '${suffix}-blob-vnet-link'
  parent: blobPrivateDnsZone
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: network.id
    }
  }
}

resource sqlPrivateEndpoint 'Microsoft.Network/privateEndpoints@2023-11-01' = {
  name: '${suffix}-sql-pe'
  location: location
  properties: {
    subnet: {
      id: privateEndpointSubnet.id
    }
    privateLinkServiceConnections: [
      {
        name: 'sql'
        properties: {
          privateLinkServiceId: sqlServer.id
          groupIds: [
            'sqlServer'
          ]
        }
      }
    ]
  }
}

resource sqlPrivateDnsZoneGroup 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2023-11-01' = {
  name: 'default'
  parent: sqlPrivateEndpoint
  properties: {
    privateDnsZoneConfigs: [
      {
        name: 'sql'
        properties: {
          privateDnsZoneId: sqlPrivateDnsZone.id
        }
      }
    ]
  }
}

resource blobPrivateEndpoint 'Microsoft.Network/privateEndpoints@2023-11-01' = {
  name: '${suffix}-blob-pe'
  location: location
  properties: {
    subnet: {
      id: privateEndpointSubnet.id
    }
    privateLinkServiceConnections: [
      {
        name: 'blob'
        properties: {
          privateLinkServiceId: storage.id
          groupIds: [
            'blob'
          ]
        }
      }
    ]
  }
}

resource blobPrivateDnsZoneGroup 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2023-11-01' = {
  name: 'default'
  parent: blobPrivateEndpoint
  properties: {
    privateDnsZoneConfigs: [
      {
        name: 'blob'
        properties: {
          privateDnsZoneId: blobPrivateDnsZone.id
        }
      }
    ]
  }
}

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: keyVaultName
  location: location
  properties: {
    tenantId: entraTenantId
    sku: {
      family: 'A'
      name: 'standard'
    }
    enableRbacAuthorization: true
    enableSoftDelete: true
    enablePurgeProtection: true
    publicNetworkAccess: 'Enabled'
  }
}

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: appServicePlanName
  location: location
  sku: {
    name: environmentName == 'prod' ? 'P0v3' : 'B1'
    tier: environmentName == 'prod' ? 'PremiumV3' : 'Basic'
  }
  kind: 'linux'
  properties: {
    reserved: true
  }
}

resource apiApp 'Microsoft.Web/sites@2023-12-01' = {
  name: appServiceName
  location: location
  kind: 'app,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    clientAffinityEnabled: false
    virtualNetworkSubnetId: appSubnet.id
    siteConfig: {
      linuxFxVersion: 'DOTNETCORE|10.0'
      alwaysOn: environmentName == 'prod'
      ftpsState: 'Disabled'
      http20Enabled: true
      healthCheckPath: '/health/ready'
      minTlsVersion: '1.2'
      vnetRouteAllEnabled: true
      appSettings: [
        {
          name: 'ASPNETCORE_ENVIRONMENT'
          value: 'Production'
        }
        {
          name: 'ASPNETCORE_FORWARDEDHEADERS_ENABLED'
          value: 'true'
        }
        {
          name: 'ASPNETCORE_HTTP_PORTS'
          value: '8080'
        }
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: appInsights.properties.ConnectionString
        }
        {
          name: 'ApplicationInsightsAgent_EXTENSION_VERSION'
          value: '~3'
        }
        {
          name: 'Authentication__AllowDevelopmentUser'
          value: 'false'
        }
        {
          name: 'Authentication__TenantId'
          value: entraTenantId
        }
        {
          name: 'Authentication__Audience'
          value: entraApiAudience
        }
        {
          name: 'ConnectionStrings__TlqsDatabase'
          value: sqlConnectionString
        }
        {
          name: 'Storage__AccountUri'
          value: storage.properties.primaryEndpoints.blob
        }
        {
          name: 'Storage__EvidenceContainer'
          value: evidenceContainer.name
        }
        {
          name: 'WEBSITE_RUN_FROM_PACKAGE'
          value: '1'
        }
      ]
    }
  }
}

resource blobRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, apiApp.id, blobContributorRoleId)
  scope: storage
  properties: {
    principalId: apiApp.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: blobContributorRoleId
  }
}

resource keyVaultRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, apiApp.id, keyVaultSecretsUserRoleId)
  scope: keyVault
  properties: {
    principalId: apiApp.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: keyVaultSecretsUserRoleId
  }
}

output appServiceName string = apiApp.name
output appUrl string = 'https://${apiApp.properties.defaultHostName}'
output appManagedIdentityObjectId string = apiApp.identity.principalId
output sqlServerName string = sqlServer.name
output sqlServerFqdn string = sqlServer.properties.fullyQualifiedDomainName
output sqlDatabaseName string = sqlDatabase.name
output storageAccountName string = storage.name
output keyVaultUri string = keyVault.properties.vaultUri

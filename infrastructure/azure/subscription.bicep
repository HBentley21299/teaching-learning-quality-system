targetScope = 'subscription'

param resourceGroupName string = 'rg-ielevate-prod-uks'
param location string = 'uksouth'
param namePrefix string = 'ielevate-oldham'
param environmentName string = 'prod'
param entraTenantId string
param entraApiAudience string
param sqlEntraAdministratorLogin string
param sqlEntraAdministratorObjectId string
param sqlAdministratorLogin string = 'ielevatesqladmin'
@secure()
param sqlAdministratorPassword string
param deploymentIpAddress string = ''
param appServiceSkuName string = 'B1'
param appServiceSkuTier string = 'Basic'
param sqlMaximumVcores int = 2
param sqlAutoPauseDelayMinutes int = 60

resource resourceGroup 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: resourceGroupName
  location: location
  tags: {
    application: 'i-Elevate'
    environment: environmentName
    managedBy: 'bicep'
  }
}

module platform './main.bicep' = {
  name: 'ielevate-${environmentName}'
  scope: resourceGroup
  params: {
    namePrefix: namePrefix
    environmentName: environmentName
    location: location
    entraTenantId: entraTenantId
    entraApiAudience: entraApiAudience
    sqlEntraAdministratorLogin: sqlEntraAdministratorLogin
    sqlEntraAdministratorObjectId: sqlEntraAdministratorObjectId
    sqlAdministratorLogin: sqlAdministratorLogin
    sqlAdministratorPassword: sqlAdministratorPassword
    deploymentIpAddress: deploymentIpAddress
    appServiceSkuName: appServiceSkuName
    appServiceSkuTier: appServiceSkuTier
    sqlMaximumVcores: sqlMaximumVcores
    sqlAutoPauseDelayMinutes: sqlAutoPauseDelayMinutes
  }
}

output applicationUrl string = platform.outputs.applicationUrl
output resourceGroupName string = resourceGroup.name
output sqlDatabaseName string = platform.outputs.sqlDatabaseName
output sqlServerFullyQualifiedDomainName string = platform.outputs.sqlServerFullyQualifiedDomainName
output webAppManagedIdentityObjectId string = platform.outputs.webAppManagedIdentityObjectId
output webAppName string = platform.outputs.webAppName

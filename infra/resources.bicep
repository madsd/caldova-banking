param environmentName string
param location string
param suffix string
param principalId string
param principalName string
param tenantId string
@secure()
param demoAccessKeyHash string
param tags object

var token = toLower(take(replace(environmentName, '-', ''), 10))
var aiName = 'aicald${token}${suffix}'
var projectName = 'caldova'
var searchName = 'srch-caldova-${token}-${suffix}'
var storageName = 'stcald${token}${suffix}'
var serviceBusName = 'sb-caldova-${token}-${suffix}'
var sqlServerName = 'sql-caldova-${token}-${suffix}'
var registryName = 'crcald${token}${suffix}'
var environmentNameResource = 'cae-caldova-${token}'
var webName = 'ca-caldova-web-${token}'
var workerName = 'ca-caldova-worker-${token}'
var documentName = 'doc-caldova-${token}-${suffix}'
var logName = 'log-caldova-${token}'
var insightsName = 'appi-caldova-${token}'
var vaultName = 'kv-cald-${take(token, 8)}-${suffix}'
var cognitiveServicesUserRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'a97b65f3-24c7-4388-baec-2e87135dc908')
var foundryUserRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '53ca6127-db72-4b80-b1b0-d745d6d5456d')
var searchDataReaderRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '1407120a-92aa-4202-b7e9-c0e197c71c8f')
var searchDataContributorRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '8ebe5a00-799e-43f5-93ac-243d3dce84a7')
var searchServiceContributorRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7ca78c08-252a-4471-8644-bb5ff32d4ba0')
var blobContributorRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')
var serviceBusSenderRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '69a216fc-b8fb-44d8-bc22-1f3c2cd27a39')
var serviceBusReceiverRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4f6d3b9b-027b-4f4c-9142-0e5a2a2247e0')
var acrPullRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: logName
  location: location
  tags: tags
  properties: {
    retentionInDays: 30
    sku: {
      name: 'PerGB2018'
    }
  }
}

resource insights 'Microsoft.Insights/components@2020-02-02' = {
  name: insightsName
  location: location
  kind: 'web'
  tags: tags
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logs.id
  }
}

resource registry 'Microsoft.ContainerRegistry/registries@2023-11-01-preview' = {
  name: registryName
  location: location
  tags: tags
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: false
    publicNetworkAccess: 'Enabled'
  }
}

resource managedEnvironment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: environmentNameResource
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logs.properties.customerId
        sharedKey: logs.listKeys().primarySharedKey
      }
    }
  }
}

resource ai 'Microsoft.CognitiveServices/accounts@2025-04-01-preview' = {
  name: aiName
  location: location
  kind: 'AIServices'
  identity: {
    type: 'SystemAssigned'
  }
  sku: {
    name: 'S0'
  }
  tags: tags
  properties: {
    allowProjectManagement: true
    customSubDomainName: aiName
    disableLocalAuth: true
    publicNetworkAccess: 'Enabled'
  }
}

resource chatDeployment 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: ai
  name: 'gpt-5.4-mini'
  sku: {
    name: 'DataZoneStandard'
    capacity: 50
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: 'gpt-5.4-mini'
      version: '2026-03-17'
    }
    versionUpgradeOption: 'OnceCurrentVersionExpired'
  }
}

resource embeddingDeployment 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: ai
  name: 'text-embedding-3-small'
  dependsOn: [
    chatDeployment
  ]
  sku: {
    name: 'DataZoneStandard'
    capacity: 50
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: 'text-embedding-3-small'
      version: '1'
    }
    versionUpgradeOption: 'OnceCurrentVersionExpired'
  }
}

resource transcriptionDeployment 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: ai
  name: 'gpt-4o-transcribe'
  dependsOn: [
    embeddingDeployment
  ]
  sku: {
    name: 'DataZoneStandard'
    capacity: 10
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: 'gpt-4o-transcribe'
      version: '2025-03-20'
    }
    versionUpgradeOption: 'OnceCurrentVersionExpired'
  }
}

module foundryProject './project.bicep' = {
  name: 'foundry-project'
  params: {
    accountName: ai.name
    projectName: projectName
    location: location
  }
}

resource projectResource 'Microsoft.CognitiveServices/accounts/projects@2025-04-01-preview' existing = {
  parent: ai
  name: projectName
}

resource search 'Microsoft.Search/searchServices@2024-03-01-preview' = {
  name: searchName
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  tags: tags
  sku: {
    name: 'basic'
  }
  properties: {
    disableLocalAuth: true
    hostingMode: 'default'
    partitionCount: 1
    publicNetworkAccess: 'enabled'
    replicaCount: 1
    semanticSearch: 'free'
  }
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageName
  location: location
  kind: 'StorageV2'
  sku: {
    name: 'Standard_LRS'
  }
  tags: tags
  properties: {
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    minimumTlsVersion: 'TLS1_2'
    publicNetworkAccess: 'Enabled'
    supportsHttpsTrafficOnly: true
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {
    deleteRetentionPolicy: {
      enabled: true
      days: 7
    }
  }
}

resource invoices 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'invoices'
  properties: {
    publicAccess: 'None'
  }
}

resource serviceBus 'Microsoft.ServiceBus/namespaces@2024-01-01' = {
  name: serviceBusName
  location: location
  sku: {
    name: 'Basic'
    tier: 'Basic'
  }
  tags: tags
  properties: {
    disableLocalAuth: true
    minimumTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'
  }
}

resource bankEvents 'Microsoft.ServiceBus/namespaces/queues@2024-01-01' = {
  parent: serviceBus
  name: 'bank-events'
  properties: {
    deadLetteringOnMessageExpiration: true
    defaultMessageTimeToLive: 'P7D'
    lockDuration: 'PT1M'
    maxDeliveryCount: 5
  }
}

resource sqlServer 'Microsoft.Sql/servers@2023-08-01-preview' = {
  name: sqlServerName
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  tags: tags
  properties: {
    administrators: {
      administratorType: 'ActiveDirectory'
      azureADOnlyAuthentication: true
      login: principalName
      principalType: 'User'
      sid: principalId
      tenantId: tenantId
    }
    minimalTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'
    restrictOutboundNetworkAccess: 'Disabled'
    version: '12.0'
  }
}

resource allowAzureServices 'Microsoft.Sql/servers/firewallRules@2023-08-01-preview' = {
  parent: sqlServer
  name: 'AllowAzureServices'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

resource database 'Microsoft.Sql/servers/databases@2023-08-01-preview' = {
  parent: sqlServer
  name: 'caldova'
  location: location
  sku: {
    name: 'GP_S_Gen5_1'
    tier: 'GeneralPurpose'
    family: 'Gen5'
    capacity: 1
  }
  properties: {
    autoPauseDelay: -1
    maxSizeBytes: 34359738368
    minCapacity: json('0.5')
    zoneRedundant: false
  }
}

resource documentIntelligence 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  name: documentName
  location: location
  kind: 'FormRecognizer'
  identity: {
    type: 'SystemAssigned'
  }
  sku: {
    name: 'S0'
  }
  tags: tags
  properties: {
    customSubDomainName: documentName
    disableLocalAuth: true
    publicNetworkAccess: 'Enabled'
  }
}

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: vaultName
  location: location
  tags: tags
  properties: {
    enableRbacAuthorization: true
    enableSoftDelete: true
    publicNetworkAccess: 'Enabled'
    sku: {
      family: 'A'
      name: 'standard'
    }

    tenantId: tenantId
  }
}

resource workerScaleIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-caldova-worker-${token}'
  location: location
  tags: tags
}

resource web 'Microsoft.App/containerApps@2025-02-02-preview' = {
  name: webName
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  tags: union(tags, { 'azd-service-name': 'web' })
  properties: {
    environmentId: managedEnvironment.id
    configuration: {
      activeRevisionsMode: 'Single'
      secrets: [
        {
          name: 'demo-access-key-hash'
          value: demoAccessKeyHash
        }
      ]
      ingress: {
        allowInsecure: false
        external: true
        targetPort: 3000
        transport: 'auto'
      }
    }
    template: {
      containers: [
        {
          name: 'web'
          image: 'mcr.microsoft.com/k8se/quickstart:latest'
          env: [
            { name: 'NODE_ENV', value: 'production' }
            { name: 'SQL_SERVER', value: '${sqlServer.name}${environment().suffixes.sqlServerHostname}' }
            { name: 'SQL_DATABASE', value: database.name }
            { name: 'FOUNDRY_PROJECT_ENDPOINT', value: 'https://${ai.name}.services.ai.azure.com/api/projects/${projectName}' }
            { name: 'AZURE_OPENAI_ENDPOINT', value: 'https://${ai.name}.openai.azure.com' }
            { name: 'FOUNDRY_MODEL', value: chatDeployment.name }
            { name: 'EMBEDDING_MODEL', value: embeddingDeployment.name }
            { name: 'TRANSCRIPTION_MODEL', value: transcriptionDeployment.name }
            { name: 'SEARCH_ENDPOINT', value: 'https://${search.name}.search.windows.net' }
            { name: 'SEARCH_INDEX_NAME', value: 'banking-knowledge' }
            { name: 'SERVICE_BUS_NAMESPACE', value: serviceBus.name }
            { name: 'SERVICE_BUS_QUEUE', value: bankEvents.name }
            { name: 'STORAGE_BLOB_ENDPOINT', value: 'https://${storage.name}.blob.${environment().suffixes.storage}' }
            { name: 'DOCUMENT_INTELLIGENCE_ENDPOINT', value: 'https://${documentIntelligence.name}.cognitiveservices.azure.com' }
            { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: insights.properties.ConnectionString }
            { name: 'DEMO_PUBLIC_ORIGIN', value: 'https://${webName}.${managedEnvironment.properties.defaultDomain}' }
            { name: 'DEMO_ACCESS_KEY_HASH', secretRef: 'demo-access-key-hash' }
          ]
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
        }
      ]
      scale: {
        maxReplicas: 3
        minReplicas: 1
      }
    }
  }
}

resource worker 'Microsoft.App/containerApps@2025-02-02-preview' = {
  name: workerName
  location: location
  dependsOn: [
    workerServiceBusReceiver
  ]
  identity: {
    type: 'SystemAssigned, UserAssigned'
    userAssignedIdentities: {
      '${workerScaleIdentity.id}': {}
    }
  }
  tags: union(tags, { 'azd-service-name': 'worker' })
  properties: {
    environmentId: managedEnvironment.id
    configuration: {
      activeRevisionsMode: 'Single'
    }
    template: {
      containers: [
        {
          name: 'worker'
          image: 'mcr.microsoft.com/k8se/quickstart:latest'
          env: [
            { name: 'SQL_SERVER', value: '${sqlServer.name}${environment().suffixes.sqlServerHostname}' }
            { name: 'SQL_DATABASE', value: database.name }
            { name: 'SERVICE_BUS_NAMESPACE', value: serviceBus.name }
            { name: 'SERVICE_BUS_QUEUE', value: bankEvents.name }
            { name: 'AZURE_CLIENT_ID', value: workerScaleIdentity.properties.clientId }
            { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: insights.properties.ConnectionString }
          ]
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
        }
      ]
      scale: {
        maxReplicas: 1
        minReplicas: 0
        rules: [
          {
            name: 'bank-events'
            custom: {
              type: 'azure-servicebus'
              metadata: {
                messageCount: '1'
                namespace: serviceBus.name
                queueName: bankEvents.name
              }
              identity: workerScaleIdentity.id
            }
          }
        ]
      }
    }
  }
}

resource webAcrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, web.id, acrPullRole)
  scope: registry
  properties: {
    principalId: web.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: acrPullRole
  }
}

resource workerAcrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, worker.id, acrPullRole)
  scope: registry
  properties: {
    principalId: worker.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: acrPullRole
  }
}

resource webFoundryUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(ai.id, web.id, cognitiveServicesUserRole)
  scope: ai
  properties: {
    principalId: web.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: cognitiveServicesUserRole
  }
}

resource webFoundryProjectUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(projectResource.id, web.id, foundryUserRole)
  scope: projectResource
  dependsOn: [
    foundryProject
  ]
  properties: {
    principalId: web.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: foundryUserRole
  }
}

resource webDocumentIntelligenceUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(documentIntelligence.id, web.id, cognitiveServicesUserRole)
  scope: documentIntelligence
  properties: {
    principalId: web.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: cognitiveServicesUserRole
  }
}

resource webSearchReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(search.id, web.id, searchDataReaderRole)
  scope: search
  properties: {
    principalId: web.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: searchDataReaderRole
  }
}

resource deployerSearchContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(search.id, principalId, searchDataContributorRole)
  scope: search
  properties: {
    principalId: principalId
    principalType: 'User'
    roleDefinitionId: searchDataContributorRole
  }
}

resource deployerSearchServiceContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(search.id, principalId, searchServiceContributorRole)
  scope: search
  properties: {
    principalId: principalId
    principalType: 'User'
    roleDefinitionId: searchServiceContributorRole
  }
}

resource deployerFoundryUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(ai.id, principalId, cognitiveServicesUserRole)
  scope: ai
  properties: {
    principalId: principalId
    principalType: 'User'
    roleDefinitionId: cognitiveServicesUserRole
  }
}

resource webBlobContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, web.id, blobContributorRole)
  scope: storage
  properties: {
    principalId: web.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: blobContributorRole
  }
}

resource webServiceBusSender 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(serviceBus.id, web.id, serviceBusSenderRole)
  scope: serviceBus
  properties: {
    principalId: web.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: serviceBusSenderRole
  }
}

resource workerServiceBusReceiver 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(serviceBus.id, workerScaleIdentity.id, serviceBusReceiverRole)
  scope: serviceBus
  properties: {
    principalId: workerScaleIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: serviceBusReceiverRole
  }
}

output registryEndpoint string = registry.properties.loginServer
output webName string = web.name
output workerName string = worker.name
output webUri string = 'https://${web.properties.configuration.ingress.fqdn}'
output sqlServer string = '${sqlServer.name}${environment().suffixes.sqlServerHostname}'
output sqlDatabase string = database.name
output searchEndpoint string = 'https://${search.name}.search.windows.net'
output foundryProjectEndpoint string = 'https://${ai.name}.services.ai.azure.com/api/projects/${projectName}'
output azureOpenAIEndpoint string = 'https://${ai.name}.openai.azure.com'
output webPrincipalId string = web.identity.principalId
output workerPrincipalId string = workerScaleIdentity.properties.principalId
output workerIdentityName string = workerScaleIdentity.name

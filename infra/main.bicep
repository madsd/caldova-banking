targetScope = 'subscription'

@minLength(1)
param environmentName string
param location string
param principalId string
param principalName string
param tenantId string
@secure()
param demoAccessKeyHash string

var token = toLower(take(replace(environmentName, '-', ''), 12))
var suffix = take(uniqueString(subscription().id, environmentName), 6)
var resourceGroupName = 'rg-caldova-${token}'
var commonTags = {
  'azd-env-name': environmentName
  application: 'caldova-agentic-banking'
  dataClassification: 'synthetic'
}

resource rg 'Microsoft.Resources/resourceGroups@2024-11-01' = {
  name: resourceGroupName
  location: location
  tags: commonTags
}

module resources './resources.bicep' = {
  name: 'caldova-resources'
  scope: rg
  params: {
    environmentName: environmentName
    location: location
    suffix: suffix
    principalId: principalId
    principalName: principalName
    tenantId: tenantId
    demoAccessKeyHash: demoAccessKeyHash
    tags: commonTags
  }
}

output AZURE_RESOURCE_GROUP string = rg.name
output AZURE_CONTAINER_REGISTRY_ENDPOINT string = resources.outputs.registryEndpoint
output SERVICE_WEB_NAME string = resources.outputs.webName
output SERVICE_WORKER_NAME string = resources.outputs.workerName
output WEB_URI string = resources.outputs.webUri
output SQL_SERVER string = resources.outputs.sqlServer
output SQL_DATABASE string = resources.outputs.sqlDatabase
output SEARCH_ENDPOINT string = resources.outputs.searchEndpoint
output SEARCH_INDEX_NAME string = 'banking-knowledge'
output FOUNDRY_PROJECT_ENDPOINT string = resources.outputs.foundryProjectEndpoint
output AZURE_OPENAI_ENDPOINT string = resources.outputs.azureOpenAIEndpoint
output FOUNDRY_MODEL string = 'gpt-5.4-mini'
output EMBEDDING_MODEL string = 'text-embedding-3-small'
output TRANSCRIPTION_MODEL string = 'gpt-4o-transcribe'
output WEB_IDENTITY_NAME string = resources.outputs.webName
output WEB_IDENTITY_PRINCIPAL_ID string = resources.outputs.webPrincipalId
output WORKER_IDENTITY_NAME string = resources.outputs.workerIdentityName
output WORKER_IDENTITY_PRINCIPAL_ID string = resources.outputs.workerPrincipalId

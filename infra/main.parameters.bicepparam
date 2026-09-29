using './main.bicep'

param environmentName = readEnvironmentVariable('AZURE_ENV_NAME')
param location = readEnvironmentVariable('AZURE_LOCATION')
param principalId = readEnvironmentVariable('AZURE_PRINCIPAL_ID')
param principalName = readEnvironmentVariable('AZURE_PRINCIPAL_NAME')
param tenantId = readEnvironmentVariable('AZURE_TENANT_ID')
param demoAccessKeyHash = readEnvironmentVariable('DEMO_ACCESS_KEY_HASH')

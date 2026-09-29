export async function register() {
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.APPLICATIONINSIGHTS_CONNECTION_STRING
  ) {
    const { useAzureMonitor: configureAzureMonitor } = await import(
      "@azure/monitor-opentelemetry"
    );
    configureAzureMonitor({
      azureMonitorExporterOptions: {
        connectionString: process.env.APPLICATIONINSIGHTS_CONNECTION_STRING,
      },
    });
  }
}

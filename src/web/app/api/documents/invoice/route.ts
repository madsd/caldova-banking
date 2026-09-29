import DocumentIntelligence, {
  getLongRunningPoller,
  isUnexpected,
  type AnalyzeOperationOutput,
} from "@azure-rest/ai-document-intelligence";
import { DefaultAzureCredential } from "@azure/identity";
import { BlobServiceClient } from "@azure/storage-blob";
import { prepareBillPayment } from "@/lib/store";
import { requireDemoSession } from "@/lib/demo-session";

export const runtime = "nodejs";

const credential = new DefaultAzureCredential();

export async function POST(request: Request) {
  const endpoint = process.env.DOCUMENT_INTELLIGENCE_ENDPOINT;
  const storageEndpoint = process.env.STORAGE_BLOB_ENDPOINT;
  if (!endpoint || !storageEndpoint) {
    return Response.json(
      { error: "Invoice understanding is not configured." },
      { status: 503 },
    );
  }

  try {
    const form = await request.formData();
    const upload = form.get("file");
    const personaId = form.get("personaId");
    if (!(upload instanceof File) || typeof personaId !== "string") {
      return Response.json(
        { error: "A customer and invoice file are required." },
        { status: 400 },
      );
    }
    if (upload.size > 10 * 1024 * 1024) {
      return Response.json(
        { error: "Invoice files must be 10 MB or smaller." },
        { status: 413 },
      );
    }

    const bytes = Buffer.from(await upload.arrayBuffer());
    const blobService = new BlobServiceClient(storageEndpoint, credential);
    const container = blobService.getContainerClient("invoices");
    await container.createIfNotExists();
    const safeName = upload.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const blobName = `${personaId}/${crypto.randomUUID()}-${safeName}`;
    await container.getBlockBlobClient(blobName).uploadData(bytes, {
      blobHTTPHeaders: {
        blobContentType: upload.type || "application/octet-stream",
      },
      metadata: { personaId },
    });

    const client = DocumentIntelligence(endpoint, credential);
    const initialResponse = await client
      .path("/documentModels/{modelId}:analyze", "prebuilt-invoice")
      .post({
        contentType: "application/json",
        body: { base64Source: bytes.toString("base64") },
      });

    if (isUnexpected(initialResponse)) {
      throw new Error(initialResponse.body.error?.message ?? "Invoice analysis failed.");
    }

    const poller = getLongRunningPoller(client, initialResponse);
    const result = (await poller.pollUntilDone()).body as AnalyzeOperationOutput;
    const fields = result.analyzeResult?.documents?.[0]?.fields;
    const merchant =
      fields?.VendorName?.valueString ?? fields?.VendorName?.content ?? "the payee";
    const total =
      fields?.InvoiceTotal?.valueCurrency?.amount ??
      fields?.AmountDue?.valueCurrency?.amount;
    const currency =
      fields?.InvoiceTotal?.valueCurrency?.currencyCode ??
      fields?.AmountDue?.valueCurrency?.currencyCode ??
      "UAH";
    const dueDate = fields?.DueDate?.valueDate;
    const invoiceId =
      fields?.InvoiceId?.valueString ?? fields?.InvoiceId?.content ?? undefined;

    if (!total) {
      return Response.json(
        { error: "The invoice total could not be extracted confidently." },
        { status: 422 },
      );
    }
    const intent = await prepareBillPayment(
      personaId,
      merchant,
      total,
      invoiceId,
      dueDate,
      requireDemoSession(request),
    );

    return Response.json({
      merchant,
      total,
      currency,
      dueDate,
      invoiceId,
      confidence: result.analyzeResult?.documents?.[0]?.confidence,
      intent,
      prompt: [
        `Review this invoice from ${merchant}`,
        total ? `for ${total} ${currency}` : "",
        dueDate ? `due ${dueDate}` : "",
        invoiceId ? `(invoice ${invoiceId})` : "",
        "and prepare the payment for my approval.",
      ]
        .filter(Boolean)
        .join(" "),
    });
  } catch (cause: unknown) {
    const message =
      cause instanceof Error ? cause.message : "Invoice processing failed.";
    return Response.json({ error: message }, { status: 500 });
  }
}

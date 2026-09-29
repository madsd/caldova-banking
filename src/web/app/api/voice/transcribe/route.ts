import {
  DefaultAzureCredential,
  getBearerTokenProvider,
} from "@azure/identity";
import { AzureOpenAI } from "openai";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const model = process.env.TRANSCRIPTION_MODEL;
  if (!endpoint || !model) {
    return Response.json(
      { error: "Voice transcription is not configured." },
      { status: 503 },
    );
  }

  try {
    const form = await request.formData();
    const audio = form.get("audio");
    if (!(audio instanceof File)) {
      return Response.json(
        { error: "An audio recording is required." },
        { status: 400 },
      );
    }
    if (audio.size > 10 * 1024 * 1024) {
      return Response.json(
        { error: "Audio recordings must be 10 MB or smaller." },
        { status: 413 },
      );
    }

    const credential = new DefaultAzureCredential();
    const client = new AzureOpenAI({
      endpoint,
      apiVersion: "2025-04-01-preview",
      azureADTokenProvider: getBearerTokenProvider(
        credential,
        "https://cognitiveservices.azure.com/.default",
      ),
    });
    const transcription = await client.audio.transcriptions.create({
      file: audio,
      model,
    });
    return Response.json({ text: transcription.text });
  } catch (cause: unknown) {
    const message =
      cause instanceof Error ? cause.message : "Voice transcription failed.";
    return Response.json({ error: message }, { status: 500 });
  }
}

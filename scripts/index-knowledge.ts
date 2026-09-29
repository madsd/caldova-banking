import {
  DefaultAzureCredential,
  getBearerTokenProvider,
} from "@azure/identity";
import {
  SearchClient,
  SearchIndexClient,
  type SearchIndex,
} from "@azure/search-documents";
import { readdir, readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { AzureOpenAI } from "openai";

const endpoint = required("SEARCH_ENDPOINT");
const openAIEndpoint = required("AZURE_OPENAI_ENDPOINT");
const indexName = process.env.SEARCH_INDEX_NAME ?? "banking-knowledge";
const embeddingModel =
  process.env.EMBEDDING_MODEL ?? "text-embedding-3-small";
const credential = new DefaultAzureCredential();

async function main() {
  const knowledgeDirectory = resolve(process.cwd(), "knowledge");
  const names = (await readdir(knowledgeDirectory)).filter((name) =>
    name.endsWith(".md"),
  );
  const sourceDocuments = await Promise.all(
    names.map(async (name) => {
      const content = await readFile(resolve(knowledgeDirectory, name), "utf8");
      const title =
        content.match(/^#\s+(.+)$/m)?.[1] ?? basename(name, ".md");
      return {
        id: basename(name, ".md"),
        title,
        category: basename(name, ".md").replaceAll("-", " "),
        content,
        sourceUrl: `/knowledge/${name}`,
      };
    }),
  );

  const openai = new AzureOpenAI({
    endpoint: openAIEndpoint,
    apiVersion: "2025-04-01-preview",
    azureADTokenProvider: getBearerTokenProvider(
      credential,
      "https://cognitiveservices.azure.com/.default",
    ),
  });
  const embedded = await Promise.all(
    sourceDocuments.map(async (document) => {
      const response = await openai.embeddings.create({
        model: embeddingModel,
        input: document.content,
      });
      return { ...document, contentVector: response.data[0].embedding };
    }),
  );
  const dimensions = embedded[0]?.contentVector.length;
  if (!dimensions) throw new Error("No knowledge embeddings were generated.");

  const index: SearchIndex = {
    name: indexName,
    fields: [
      { name: "id", type: "Edm.String", key: true, filterable: true },
      {
        name: "title",
        type: "Edm.String",
        searchable: true,
      },
      {
        name: "category",
        type: "Edm.String",
        searchable: true,
        filterable: true,
        facetable: true,
      },
      {
        name: "content",
        type: "Edm.String",
        searchable: true,
      },
      {
        name: "sourceUrl",
        type: "Edm.String",
      },
      {
        name: "contentVector",
        type: "Collection(Edm.Single)",
        searchable: true,
        hidden: true,
        vectorSearchDimensions: dimensions,
        vectorSearchProfileName: "banking-vector-profile",
      },
    ],
    vectorSearch: {
      algorithms: [{ name: "banking-hnsw", kind: "hnsw" }],
      profiles: [
        {
          name: "banking-vector-profile",
          algorithmConfigurationName: "banking-hnsw",
        },
      ],
    },
    semanticSearch: {
      configurations: [
        {
          name: "banking-semantic",
          prioritizedFields: {
            titleField: { name: "title" },
            contentFields: [{ name: "content" }],
            keywordsFields: [{ name: "category" }],
          },
        },
      ],
    },
  };

  const indexClient = new SearchIndexClient(endpoint, credential);
  await indexClient.createOrUpdateIndex(index);
  const searchClient = new SearchClient(endpoint, indexName, credential);
  const result = await searchClient.mergeOrUploadDocuments(embedded);
  const failures = result.results.filter((item) => !item.succeeded);
  if (failures.length > 0) {
    throw new Error(
      `Failed to index: ${failures.map((item) => item.key).join(", ")}`,
    );
  }
  let verified = false;
  for (let attempt = 0; attempt < 12 && !verified; attempt += 1) {
    const verification = await searchClient.search("mobile top-up limit", {
      top: sourceDocuments.length,
      select: ["id", "title"],
    });
    for await (const hit of verification.results) {
      if (hit.document.id === "mobile-top-ups") {
        verified = true;
        break;
      }
    }
    if (!verified && attempt < 11) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  if (!verified) {
    throw new Error("Knowledge retrieval verification did not return the mobile top-up policy after indexing.");
  }
  console.log(
    `Indexed ${embedded.length} banking knowledge documents; retrieval verified.`,
  );
}

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

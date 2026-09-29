# Invoice payments

Caldova can extract a payee, invoice number, due date, currency, and total from an uploaded invoice. The original document is stored in a customer-scoped Azure Blob container and analyzed with Azure AI Document Intelligence. Extracted data is a proposal input, not payment authorization. The customer must review and approve the resulting bill payment.

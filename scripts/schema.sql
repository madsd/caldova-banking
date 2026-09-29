SET XACT_ABORT ON;
GO

IF OBJECT_ID('customers', 'U') IS NULL
BEGIN
  CREATE TABLE customers (
    id nvarchar(40) NOT NULL PRIMARY KEY,
    display_name nvarchar(120) NOT NULL,
    initials nvarchar(4) NOT NULL,
    descriptor nvarchar(120) NOT NULL,
    advisor_name nvarchar(120) NOT NULL,
    advisor_initials nvarchar(4) NOT NULL,
    locale nvarchar(12) NOT NULL DEFAULT 'uk-UA',
    sort_order int NOT NULL,
    created_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME()
  );
END;
GO

IF COL_LENGTH('customers', 'advisor_name') IS NULL
BEGIN
  ALTER TABLE customers ADD advisor_name nvarchar(120) NULL;
END;
IF COL_LENGTH('customers', 'advisor_initials') IS NULL
BEGIN
  ALTER TABLE customers ADD advisor_initials nvarchar(4) NULL;
END;
GO

IF OBJECT_ID('accounts', 'U') IS NULL
BEGIN
  CREATE TABLE accounts (
    id nvarchar(64) NOT NULL PRIMARY KEY,
    display_name nvarchar(100) NOT NULL,
    masked_number nvarchar(24) NOT NULL,
    account_type nvarchar(30) NOT NULL,
    currency char(3) NOT NULL,
    balance decimal(18,2) NOT NULL,
    is_primary bit NOT NULL DEFAULT 0,
    updated_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME()
  );
END;
GO

IF COL_LENGTH('accounts', 'account_type') IS NULL
BEGIN
  ALTER TABLE accounts ADD account_type nvarchar(30) NOT NULL
    CONSTRAINT DF_accounts_account_type DEFAULT 'current';
END;
IF COL_LENGTH('accounts', 'is_primary') IS NULL
BEGIN
  ALTER TABLE accounts ADD is_primary bit NOT NULL
    CONSTRAINT DF_accounts_is_primary DEFAULT 0;
END;
GO

IF OBJECT_ID('account_holders', 'U') IS NULL
BEGIN
  CREATE TABLE account_holders (
    customer_id nvarchar(40) NOT NULL,
    account_id nvarchar(64) NOT NULL,
    holder_role nvarchar(30) NOT NULL DEFAULT 'owner',
    CONSTRAINT PK_account_holders PRIMARY KEY (customer_id, account_id),
    CONSTRAINT FK_account_holders_customer FOREIGN KEY (customer_id)
      REFERENCES customers(id),
    CONSTRAINT FK_account_holders_account FOREIGN KEY (account_id)
      REFERENCES accounts(id)
  );
END;
GO

IF OBJECT_ID('cards', 'U') IS NULL
BEGIN
  CREATE TABLE cards (
    id nvarchar(64) NOT NULL PRIMARY KEY,
    account_id nvarchar(64) NOT NULL,
    masked_pan nvarchar(24) NOT NULL,
    network nvarchar(20) NOT NULL,
    card_status nvarchar(20) NOT NULL,
    daily_limit decimal(18,2) NOT NULL,
    CONSTRAINT FK_cards_account FOREIGN KEY (account_id) REFERENCES accounts(id)
  );
END;
GO

IF OBJECT_ID('mobile_numbers', 'U') IS NULL
BEGIN
  CREATE TABLE mobile_numbers (
    id uniqueidentifier NOT NULL PRIMARY KEY DEFAULT NEWID(),
    customer_id nvarchar(40) NOT NULL,
    masked_number nvarchar(40) NOT NULL,
    operator nvarchar(80) NOT NULL,
    is_primary bit NOT NULL DEFAULT 0,
    CONSTRAINT FK_mobile_customer FOREIGN KEY (customer_id) REFERENCES customers(id)
  );
END;
GO

IF OBJECT_ID('payees', 'U') IS NULL
BEGIN
  CREATE TABLE payees (
    id uniqueidentifier NOT NULL PRIMARY KEY DEFAULT NEWID(),
    customer_id nvarchar(40) NOT NULL,
    display_name nvarchar(160) NOT NULL,
    masked_identifier nvarchar(100) NOT NULL,
    payee_type nvarchar(40) NOT NULL,
    verified bit NOT NULL DEFAULT 0,
    CONSTRAINT FK_payees_customer FOREIGN KEY (customer_id) REFERENCES customers(id)
  );
END;
GO

IF OBJECT_ID('products', 'U') IS NULL
BEGIN
  CREATE TABLE products (
    id nvarchar(64) NOT NULL PRIMARY KEY,
    display_name nvarchar(160) NOT NULL,
    product_type nvarchar(60) NOT NULL,
    search_document_id nvarchar(120) NULL,
    active bit NOT NULL DEFAULT 1
  );
END;
GO

IF OBJECT_ID('customer_transactions', 'U') IS NULL
BEGIN
  CREATE TABLE customer_transactions (
    id nvarchar(64) NOT NULL PRIMARY KEY,
    account_id nvarchar(64) NOT NULL,
    merchant nvarchar(160) NOT NULL,
    category nvarchar(80) NOT NULL,
    amount decimal(18,2) NOT NULL CHECK (amount > 0),
    currency char(3) NOT NULL,
    direction nvarchar(10) NOT NULL CHECK (direction IN ('credit', 'debit')),
    note nvarchar(240) NOT NULL,
    booked_at datetime2 NOT NULL,
    demo_session_id uniqueidentifier NULL,
    CONSTRAINT FK_transactions_account FOREIGN KEY (account_id)
      REFERENCES accounts(id)
  );
  CREATE INDEX IX_transactions_account_date
    ON customer_transactions(account_id, booked_at DESC);
END;
GO

IF COL_LENGTH('customer_transactions', 'demo_session_id') IS NULL
BEGIN
  ALTER TABLE customer_transactions ADD demo_session_id uniqueidentifier NULL;
END;
GO

IF OBJECT_ID('payment_orders', 'U') IS NULL
BEGIN
  CREATE TABLE payment_orders (
    id uniqueidentifier NOT NULL PRIMARY KEY DEFAULT NEWID(),
    customer_id nvarchar(40) NOT NULL,
    source_account_id nvarchar(64) NOT NULL,
    payment_type nvarchar(40) NOT NULL,
    amount decimal(18,2) NOT NULL,
    currency char(3) NOT NULL,
    status nvarchar(30) NOT NULL,
    provider_reference nvarchar(120) NULL,
    created_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),
    completed_at datetime2 NULL
  );
END;
GO

IF OBJECT_ID('ledger_accounts', 'U') IS NULL
BEGIN
  CREATE TABLE ledger_accounts (
    id nvarchar(160) NOT NULL PRIMARY KEY,
    display_name nvarchar(160) NOT NULL,
    account_class nvarchar(30) NOT NULL
  );
END;
GO

IF OBJECT_ID('ledger_postings', 'U') IS NULL
BEGIN
  CREATE TABLE ledger_postings (
    id uniqueidentifier NOT NULL PRIMARY KEY,
    customer_transaction_id nvarchar(64) NOT NULL,
    posted_at datetime2 NOT NULL,
    CONSTRAINT FK_posting_transaction FOREIGN KEY (customer_transaction_id)
      REFERENCES customer_transactions(id)
  );
END;
GO

IF OBJECT_ID('ledger_entries', 'U') IS NULL
BEGIN
  CREATE TABLE ledger_entries (
    id bigint IDENTITY(1,1) NOT NULL PRIMARY KEY,
    posting_id uniqueidentifier NOT NULL,
    ledger_account_id nvarchar(160) NOT NULL,
    debit decimal(18,2) NOT NULL DEFAULT 0,
    credit decimal(18,2) NOT NULL DEFAULT 0,
    CONSTRAINT CK_ledger_one_side CHECK (
      (debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0)
    ),
    CONSTRAINT FK_ledger_posting FOREIGN KEY (posting_id)
      REFERENCES ledger_postings(id),
    CONSTRAINT FK_ledger_account FOREIGN KEY (ledger_account_id)
      REFERENCES ledger_accounts(id)
  );
END;
GO

IF OBJECT_ID('mobile_topups', 'U') IS NULL
BEGIN
  CREATE TABLE mobile_topups (
    id uniqueidentifier NOT NULL PRIMARY KEY,
    transaction_id nvarchar(64) NOT NULL,
    customer_id nvarchar(40) NOT NULL,
    operator nvarchar(80) NOT NULL,
    masked_phone nvarchar(40) NOT NULL,
    status nvarchar(30) NOT NULL,
    provider_reference nvarchar(120) NOT NULL,
    CONSTRAINT FK_topup_transaction FOREIGN KEY (transaction_id)
      REFERENCES customer_transactions(id)
  );
END;
GO

IF OBJECT_ID('recurring_payments', 'U') IS NULL
BEGIN
  CREATE TABLE recurring_payments (
    id uniqueidentifier NOT NULL PRIMARY KEY DEFAULT NEWID(),
    customer_id nvarchar(40) NOT NULL,
    merchant nvarchar(160) NOT NULL,
    expected_amount decimal(18,2) NOT NULL,
    cadence nvarchar(30) NOT NULL,
    next_expected_at datetime2 NULL,
    active bit NOT NULL DEFAULT 1
  );
END;
GO

IF OBJECT_ID('standing_orders', 'U') IS NULL
BEGIN
  CREATE TABLE standing_orders (
    id uniqueidentifier NOT NULL PRIMARY KEY DEFAULT NEWID(),
    customer_id nvarchar(40) NOT NULL,
    instruction_json nvarchar(max) NOT NULL,
    status nvarchar(30) NOT NULL,
    next_run_at datetime2 NULL
  );
END;
GO

IF OBJECT_ID('conversations', 'U') IS NULL
BEGIN
  CREATE TABLE conversations (
    id uniqueidentifier NOT NULL PRIMARY KEY DEFAULT NEWID(),
    customer_id nvarchar(40) NOT NULL,
    foundry_conversation_id nvarchar(160) NULL,
    created_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME()
  );
END;
GO

IF OBJECT_ID('messages', 'U') IS NULL
BEGIN
  CREATE TABLE messages (
    id uniqueidentifier NOT NULL PRIMARY KEY DEFAULT NEWID(),
    conversation_id uniqueidentifier NOT NULL,
    role nvarchar(20) NOT NULL,
    content nvarchar(max) NOT NULL,
    created_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_messages_conversation FOREIGN KEY (conversation_id)
      REFERENCES conversations(id)
  );
END;
GO

IF OBJECT_ID('tool_invocations', 'U') IS NULL
BEGIN
  CREATE TABLE tool_invocations (
    id uniqueidentifier NOT NULL PRIMARY KEY DEFAULT NEWID(),
    conversation_id uniqueidentifier NULL,
    customer_id nvarchar(40) NOT NULL,
    tool_name nvarchar(100) NOT NULL,
    arguments_hash char(64) NOT NULL,
    invocation_status nvarchar(30) NOT NULL,
    duration_ms int NULL,
    created_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME()
  );
END;
GO

IF OBJECT_ID('action_intents', 'U') IS NULL
BEGIN
  CREATE TABLE action_intents (
    id uniqueidentifier NOT NULL PRIMARY KEY,
    customer_id nvarchar(40) NOT NULL,
    intent_type nvarchar(40) NOT NULL,
    title nvarchar(120) NOT NULL,
    status nvarchar(40) NOT NULL,
    amount decimal(18,2) NOT NULL,
    fee decimal(18,2) NOT NULL,
    source_account_id nvarchar(64) NOT NULL,
    source_account_label nvarchar(120) NOT NULL,
    destination_account_id nvarchar(64) NULL,
    destination_label nvarchar(200) NOT NULL,
    fields_json nvarchar(max) NOT NULL,
    evidence_json nvarchar(max) NOT NULL,
    receipt nvarchar(80) NULL,
    created_at datetime2 NOT NULL,
    completed_at datetime2 NULL,
    demo_session_id uniqueidentifier NULL,
    CONSTRAINT FK_intent_customer FOREIGN KEY (customer_id) REFERENCES customers(id),
    CONSTRAINT FK_intent_account FOREIGN KEY (source_account_id) REFERENCES accounts(id)
  );
  CREATE INDEX IX_intents_customer_status
    ON action_intents(customer_id, status, created_at DESC);
END;
GO

IF COL_LENGTH('action_intents', 'demo_session_id') IS NULL
BEGIN
  ALTER TABLE action_intents ADD demo_session_id uniqueidentifier NULL;
END;
GO

IF COL_LENGTH('action_intents', 'destination_account_id') IS NULL
BEGIN
  ALTER TABLE action_intents ADD destination_account_id nvarchar(64) NULL;
END;
GO

IF COL_LENGTH('action_intents', 'source_event_id') IS NULL
BEGIN
  ALTER TABLE action_intents ADD source_event_id nvarchar(128) NULL;
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'UX_action_intents_source_event'
    AND object_id = OBJECT_ID('action_intents')
)
BEGIN
  CREATE UNIQUE INDEX UX_action_intents_source_event
    ON action_intents(source_event_id)
    WHERE source_event_id IS NOT NULL;
END;
GO

IF OBJECT_ID('approvals', 'U') IS NULL
BEGIN
  CREATE TABLE approvals (
    id uniqueidentifier NOT NULL PRIMARY KEY,
    action_intent_id uniqueidentifier NOT NULL,
    customer_id nvarchar(40) NOT NULL,
    decision nvarchar(20) NOT NULL,
    decided_at datetime2 NOT NULL,
    CONSTRAINT FK_approval_intent FOREIGN KEY (action_intent_id)
      REFERENCES action_intents(id)
  );
END;
GO

IF OBJECT_ID('execution_idempotency', 'U') IS NULL
BEGIN
  CREATE TABLE execution_idempotency (
    idempotency_key nvarchar(200) NOT NULL PRIMARY KEY,
    action_intent_id uniqueidentifier NOT NULL,
    created_at datetime2 NOT NULL,
    CONSTRAINT FK_idempotency_intent FOREIGN KEY (action_intent_id)
      REFERENCES action_intents(id)
  );
END;
GO

IF OBJECT_ID('automation_rules', 'U') IS NULL
BEGIN
  CREATE TABLE automation_rules (
    id uniqueidentifier NOT NULL PRIMARY KEY DEFAULT NEWID(),
    customer_id nvarchar(40) NOT NULL,
    event_type nvarchar(60) NOT NULL,
    rule_json nvarchar(max) NOT NULL,
    status nvarchar(30) NOT NULL,
    approved_at datetime2 NULL,
    demo_session_id uniqueidentifier NULL
  );
END;
GO

IF COL_LENGTH('automation_rules', 'demo_session_id') IS NULL
BEGIN
  ALTER TABLE automation_rules ADD demo_session_id uniqueidentifier NULL;
END;
GO

IF OBJECT_ID('domain_events', 'U') IS NULL
BEGIN
  CREATE TABLE domain_events (
    id uniqueidentifier NOT NULL PRIMARY KEY DEFAULT NEWID(),
    event_type nvarchar(60) NOT NULL,
    customer_id nvarchar(40) NOT NULL,
    payload_json nvarchar(max) NOT NULL,
    occurred_at datetime2 NOT NULL,
    processed_at datetime2 NULL
  );
END;
GO

IF OBJECT_ID('audit_events', 'U') IS NULL
BEGIN
  CREATE TABLE audit_events (
    sequence_id bigint IDENTITY(1,1) NOT NULL PRIMARY KEY,
    customer_id nvarchar(40) NULL,
    event_type nvarchar(80) NOT NULL,
    correlation_id nvarchar(100) NOT NULL,
    detail_json nvarchar(max) NOT NULL,
    created_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME()
  );
END;
GO

IF OBJECT_ID('support_cases', 'U') IS NULL
BEGIN
  CREATE TABLE support_cases (
    id uniqueidentifier NOT NULL PRIMARY KEY,
    customer_id nvarchar(40) NOT NULL,
    status nvarchar(40) NOT NULL,
    reason nvarchar(500) NOT NULL,
    summary nvarchar(max) NOT NULL,
    evidence_json nvarchar(max) NOT NULL,
    created_at datetime2 NOT NULL,
    demo_session_id uniqueidentifier NOT NULL,
    CONSTRAINT FK_support_case_customer FOREIGN KEY (customer_id)
      REFERENCES customers(id)
  );
  CREATE INDEX IX_support_cases_session_created
    ON support_cases(demo_session_id, created_at DESC);
END;
GO

IF OBJECT_ID('advisor_messages', 'U') IS NULL
BEGIN
  CREATE TABLE advisor_messages (
    id uniqueidentifier NOT NULL PRIMARY KEY,
    customer_id nvarchar(40) NOT NULL,
    status nvarchar(20) NOT NULL
      CHECK (status IN ('draft', 'sent')),
    topic nvarchar(120) NOT NULL,
    body nvarchar(max) NOT NULL,
    evidence_json nvarchar(max) NOT NULL,
    created_at datetime2 NOT NULL,
    sent_at datetime2 NULL,
    demo_session_id uniqueidentifier NOT NULL,
    CONSTRAINT FK_advisor_message_customer FOREIGN KEY (customer_id)
      REFERENCES customers(id)
  );
  CREATE INDEX IX_advisor_messages_session_created
    ON advisor_messages(demo_session_id, created_at DESC);
END;
GO

IF OBJECT_ID('agent_plans', 'U') IS NULL
BEGIN
  CREATE TABLE agent_plans (
    id uniqueidentifier NOT NULL PRIMARY KEY,
    customer_id nvarchar(40) NOT NULL,
    status nvarchar(40) NOT NULL,
    plan_json nvarchar(max) NOT NULL,
    updated_at datetime2 NOT NULL,
    demo_session_id uniqueidentifier NOT NULL,
    CONSTRAINT FK_agent_plan_customer FOREIGN KEY (customer_id)
      REFERENCES customers(id)
  );
  CREATE UNIQUE INDEX UX_agent_plans_session_customer
    ON agent_plans(demo_session_id, customer_id);
END;
GO

MERGE customers AS target
USING (VALUES
  ('andrii', 'Andrii Kovalenko', 'AK', 'Salary customer', 'Olena Marchenko', 'OM', 1),
  ('iryna', 'Iryna Melnyk', 'IM', 'Household planner', 'Olena Marchenko', 'OM', 2),
  ('oleksii', 'Oleksii Bondar', 'OB', 'Frequent traveler', 'Olena Marchenko', 'OM', 3),
  ('sofia', 'Sofia Hrytsenko', 'SH', 'Freelancer', 'Olena Marchenko', 'OM', 4),
  ('danylo', 'Danylo Savchuk', 'DS', 'Security-conscious', 'Olena Marchenko', 'OM', 5)
) AS source(
  id, display_name, initials, descriptor, advisor_name, advisor_initials,
  sort_order
)
ON target.id = source.id
WHEN MATCHED THEN UPDATE SET
  display_name = source.display_name,
  initials = source.initials,
  descriptor = source.descriptor,
  advisor_name = source.advisor_name,
  advisor_initials = source.advisor_initials,
  sort_order = source.sort_order
WHEN NOT MATCHED THEN INSERT
  (
    id, display_name, initials, descriptor, advisor_name, advisor_initials,
    sort_order
  )
  VALUES (
    source.id, source.display_name, source.initials, source.descriptor,
    source.advisor_name, source.advisor_initials, source.sort_order
  );
GO

UPDATE customers
SET
  advisor_name = COALESCE(advisor_name, 'Caldova Bank advisor'),
  advisor_initials = COALESCE(advisor_initials, 'CB');

ALTER TABLE customers ALTER COLUMN advisor_name nvarchar(120) NOT NULL;
ALTER TABLE customers ALTER COLUMN advisor_initials nvarchar(4) NOT NULL;
GO

MERGE accounts AS target
USING (VALUES
  ('acc-andrii-main', 'Universal', '•• 4821', 'current', 'UAH', 18420.50, 1),
  ('acc-andrii-digital', 'Digital card', '•• 9101', 'digital', 'UAH', 6815.20, 0),
  ('acc-andrii-savings', 'Savings jar', '•• 3048', 'savings', 'UAH', 74500.00, 0),
  ('acc-iryna-main', 'Universal', '•• 1137', 'current', 'UAH', 12580.25, 1),
  ('acc-iryna-family', 'Family card', '•• 6420', 'digital', 'UAH', 9340.80, 0),
  ('acc-iryna-savings', 'Family reserve', '•• 2215', 'savings', 'UAH', 38600.00, 0),
  ('acc-oleksii-main', 'Universal', '•• 7072', 'current', 'UAH', 31240.80, 1),
  ('acc-oleksii-travel', 'Travel card', '•• 3377', 'travel', 'EUR', 1430.55, 0),
  ('acc-oleksii-digital', 'Digital card', '•• 1956', 'digital', 'UAH', 4720.00, 0),
  ('acc-sofia-main', 'Digital', '•• 2964', 'current', 'UAH', 8240.10, 1),
  ('acc-sofia-tax', 'Tax reserve', '•• 8804', 'savings', 'UAH', 19650.00, 0),
  ('acc-danylo-main', 'Universal', '•• 8550', 'current', 'UAH', 22105.65, 1),
  ('acc-danylo-internet', 'Internet card', '•• 0098', 'digital', 'UAH', 2500.00, 0)
) AS source(id, display_name, masked_number, account_type, currency, balance, is_primary)
ON target.id = source.id
WHEN MATCHED THEN UPDATE SET
  display_name = source.display_name,
  masked_number = source.masked_number,
  account_type = source.account_type,
  currency = source.currency,
  balance = source.balance,
  is_primary = source.is_primary,
  updated_at = SYSUTCDATETIME()
WHEN NOT MATCHED THEN INSERT
  (id, display_name, masked_number, account_type, currency, balance, is_primary)
  VALUES (source.id, source.display_name, source.masked_number, source.account_type,
          source.currency, source.balance, source.is_primary);
GO

MERGE account_holders AS target
USING (VALUES
  ('andrii', 'acc-andrii-main'),
  ('andrii', 'acc-andrii-digital'),
  ('andrii', 'acc-andrii-savings'),
  ('iryna', 'acc-iryna-main'),
  ('iryna', 'acc-iryna-family'),
  ('iryna', 'acc-iryna-savings'),
  ('oleksii', 'acc-oleksii-main'),
  ('oleksii', 'acc-oleksii-travel'),
  ('oleksii', 'acc-oleksii-digital'),
  ('sofia', 'acc-sofia-main'),
  ('sofia', 'acc-sofia-tax'),
  ('danylo', 'acc-danylo-main'),
  ('danylo', 'acc-danylo-internet')
) AS source(customer_id, account_id)
ON target.customer_id = source.customer_id AND target.account_id = source.account_id
WHEN NOT MATCHED THEN INSERT (customer_id, account_id)
  VALUES (source.customer_id, source.account_id);
GO

MERGE cards AS target
USING (VALUES
  ('card-andrii-main', 'acc-andrii-main', '•••• 4821', 'VISA', 'active', 50000.00),
  ('card-andrii-digital', 'acc-andrii-digital', '•••• 9101', 'VISA', 'active', 20000.00),
  ('card-iryna-main', 'acc-iryna-main', '•••• 1137', 'Mastercard', 'active', 40000.00),
  ('card-iryna-family', 'acc-iryna-family', '•••• 6420', 'VISA', 'active', 20000.00),
  ('card-oleksii-main', 'acc-oleksii-main', '•••• 7072', 'VISA', 'active', 60000.00),
  ('card-oleksii-travel', 'acc-oleksii-travel', '•••• 3377', 'Mastercard', 'active', 5000.00),
  ('card-oleksii-digital', 'acc-oleksii-digital', '•••• 1956', 'VISA', 'active', 15000.00),
  ('card-sofia-main', 'acc-sofia-main', '•••• 2964', 'VISA', 'active', 30000.00),
  ('card-danylo-main', 'acc-danylo-main', '•••• 8550', 'Mastercard', 'active', 40000.00),
  ('card-danylo-internet', 'acc-danylo-internet', '•••• 0098', 'VISA', 'active', 10000.00)
) AS source(id, account_id, masked_pan, network, card_status, daily_limit)
ON target.id = source.id
WHEN NOT MATCHED THEN INSERT
  (id, account_id, masked_pan, network, card_status, daily_limit)
  VALUES (source.id, source.account_id, source.masked_pan, source.network,
          source.card_status, source.daily_limit);
GO

IF NOT EXISTS (SELECT 1 FROM mobile_numbers)
BEGIN
  INSERT INTO mobile_numbers (customer_id, masked_number, operator, is_primary)
  VALUES
    ('andrii', '+380 67 ••• 42 19', 'Kyivstar', 1),
    ('iryna', '+380 50 ••• 18 04', 'Vodafone', 1),
    ('oleksii', '+380 93 ••• 77 20', 'Lifecell', 1),
    ('sofia', '+380 66 ••• 09 51', 'Vodafone', 1),
    ('danylo', '+380 68 ••• 31 88', 'Kyivstar', 1);
END;
GO

MERGE ledger_accounts AS target
USING (VALUES
  ('PAYMENT-CLEARING', 'External payment clearing', 'asset')
) AS source(id, display_name, account_class)
ON target.id = source.id
WHEN NOT MATCHED THEN INSERT (id, display_name, account_class)
  VALUES (source.id, source.display_name, source.account_class);
GO

MERGE ledger_accounts AS target
USING (
  SELECT
    CONCAT('CUSTOMER-LIABILITY:', id) AS id,
    CONCAT(display_name, ' customer liability') AS display_name,
    CAST('liability' AS nvarchar(30)) AS account_class
  FROM accounts
) AS source
ON target.id = source.id
WHEN NOT MATCHED THEN INSERT (id, display_name, account_class)
  VALUES (source.id, source.display_name, source.account_class);
GO

IF NOT EXISTS (SELECT 1 FROM customer_transactions)
BEGIN
  INSERT INTO customer_transactions
    (id, account_id, merchant, category, amount, currency, direction, note, booked_at)
  VALUES
    ('tx-andrii-topup', 'acc-andrii-main', 'Kyivstar', 'Mobile top-up', 200, 'UAH', 'debit', 'Mobile top-up to +380 67 ••• 42 19', '2026-08-28T10:15:00'),
    ('tx-andrii-salary', 'acc-andrii-main', 'Salary', 'Incoming payment', 42800, 'UAH', 'credit', 'Monthly salary', '2026-08-27T08:00:00'),
    ('tx-andrii-market', 'acc-andrii-main', 'Silpo', 'Groceries', 1264.30, 'UAH', 'debit', 'Card purchase', '2026-08-26T18:21:00'),
    ('tx-iryna-netflix', 'acc-iryna-main', 'Netflix', 'Subscriptions', 429, 'UAH', 'debit', 'Recurring subscription; increased by ₴60', '2026-08-31T06:00:00'),
    ('tx-iryna-atb', 'acc-iryna-main', 'ATB', 'Groceries', 1842.40, 'UAH', 'debit', 'Card purchase', '2026-08-30T17:05:00'),
    ('tx-oleksii-hotel', 'acc-oleksii-main', 'Scandic Stockholm', 'Travel', 6850, 'UAH', 'debit', 'SEK card purchase converted to UAH', '2026-08-30T15:10:00'),
    ('tx-oleksii-fx', 'acc-oleksii-main', 'Foreign exchange fee', 'Bank fee', 102.75, 'UAH', 'debit', '1.5% non-UAH transaction fee', '2026-08-30T15:11:00'),
    ('tx-sofia-client', 'acc-sofia-main', 'Design client', 'Incoming payment', 19600, 'UAH', 'credit', 'Invoice 2026-081', '2026-08-22T09:40:00'),
    ('tx-sofia-tax', 'acc-sofia-main', 'Tax reserve', 'Savings', 3900, 'UAH', 'debit', 'Manual reserve transfer', '2026-08-22T09:45:00'),
    ('tx-danylo-merchant', 'acc-danylo-main', 'DIGITALRIVER IE', 'Online purchase', 1499, 'UAH', 'debit', 'Card-not-present transaction; merchant of record', '2026-09-01T23:42:00'),
    ('tx-danylo-pharmacy', 'acc-danylo-main', 'ANC Pharmacy', 'Health', 638.20, 'UAH', 'debit', 'Card purchase', '2026-08-30T12:19:00');

  INSERT INTO mobile_topups
    (id, transaction_id, customer_id, operator, masked_phone, status, provider_reference)
  VALUES
    (NEWID(), 'tx-andrii-topup', 'andrii', 'Kyivstar', '+380 67 ••• 42 19', 'completed', 'seed-topup-1');
END;
GO

MERGE customer_transactions AS target
USING (VALUES
  ('tx-andrii-digital-food', 'acc-andrii-digital', 'Bolt Food', 'Dining', 486.00, 'UAH', 'debit', 'Digital card purchase', '2026-09-01T18:42:00'),
  ('tx-andrii-digital-refund', 'acc-andrii-digital', 'Rozetka refund', 'Refund', 899.00, 'UAH', 'credit', 'Returned purchase', '2026-08-30T11:05:00'),
  ('tx-andrii-savings-interest', 'acc-andrii-savings', 'Savings interest', 'Interest', 312.40, 'UAH', 'credit', 'Monthly savings interest', '2026-09-01T05:00:00'),
  ('tx-iryna-family-market', 'acc-iryna-family', 'Novus', 'Groceries', 1326.75, 'UAH', 'debit', 'Family card purchase', '2026-09-01T16:25:00'),
  ('tx-iryna-savings-transfer', 'acc-iryna-savings', 'Monthly reserve', 'Savings', 5000.00, 'UAH', 'credit', 'Transfer from Universal', '2026-08-29T08:15:00'),
  ('tx-oleksii-travel-train', 'acc-oleksii-travel', 'SJ Rail', 'Travel', 48.50, 'EUR', 'debit', 'Train ticket in Sweden', '2026-09-01T07:30:00'),
  ('tx-oleksii-digital-taxi', 'acc-oleksii-digital', 'Bolt', 'Transport', 318.00, 'UAH', 'debit', 'Digital card purchase', '2026-08-31T22:10:00'),
  ('tx-sofia-tax-reserve', 'acc-sofia-tax', 'Tax allocation', 'Savings', 4900.00, 'UAH', 'credit', 'Freelance income reserve', '2026-08-28T10:00:00'),
  ('tx-danylo-internet-stream', 'acc-danylo-internet', 'Spotify', 'Subscriptions', 199.00, 'UAH', 'debit', 'Internet card recurring payment', '2026-09-01T06:00:00')
) AS source(id, account_id, merchant, category, amount, currency, direction, note, booked_at)
ON target.id = source.id
WHEN NOT MATCHED THEN INSERT
  (id, account_id, merchant, category, amount, currency, direction, note, booked_at)
  VALUES (source.id, source.account_id, source.merchant, source.category,
          source.amount, source.currency, source.direction, source.note,
          source.booked_at);
GO

;WITH months AS (
  SELECT CAST('2026-03-01' AS date) AS month_start, 0 AS month_index
  UNION ALL SELECT CAST('2026-04-01' AS date), 1
  UNION ALL SELECT CAST('2026-05-01' AS date), 2
  UNION ALL SELECT CAST('2026-06-01' AS date), 3
  UNION ALL SELECT CAST('2026-07-01' AS date), 4
  UNION ALL SELECT CAST('2026-08-01' AS date), 5
),
patterns AS (
  SELECT *
  FROM (VALUES
    ('andrii', 'acc-andrii-main', '01', 'Salary', 'Incoming payment', 42800.00, 350.00, 'UAH', 'credit', 'Monthly salary', 2),
    ('andrii', 'acc-andrii-main', '02', 'Apartment rent', 'Housing', 12500.00, 0.00, 'UAH', 'debit', 'Monthly rent', 4),
    ('andrii', 'acc-andrii-main', '03', 'Caldova Utilities', 'Utilities', 1800.00, 80.00, 'UAH', 'debit', 'Electricity, water and heating', 8),
    ('andrii', 'acc-andrii-main', '04', 'Silpo', 'Groceries', 2600.00, 130.00, 'UAH', 'debit', 'Monthly grocery spending', 12),
    ('andrii', 'acc-andrii-main', '05', 'WOG', 'Transport', 1500.00, 70.00, 'UAH', 'debit', 'Fuel purchases', 18),
    ('andrii', 'acc-andrii-digital', '06', 'Bolt Food', 'Dining', 1100.00, 90.00, 'UAH', 'debit', 'Food delivery', 21),
    ('andrii', 'acc-andrii-digital', '07', 'Netflix', 'Subscriptions', 429.00, 0.00, 'UAH', 'debit', 'Monthly subscription', 24),
    ('andrii', 'acc-andrii-savings', '08', 'Savings interest', 'Interest', 275.00, 5.00, 'UAH', 'credit', 'Monthly savings interest', 27),

    ('iryna', 'acc-iryna-main', '01', 'Salary', 'Incoming payment', 36500.00, 250.00, 'UAH', 'credit', 'Monthly salary', 2),
    ('iryna', 'acc-iryna-main', '02', 'Apartment rent', 'Housing', 10500.00, 0.00, 'UAH', 'debit', 'Monthly rent', 4),
    ('iryna', 'acc-iryna-main', '03', 'Caldova Utilities', 'Utilities', 2200.00, 90.00, 'UAH', 'debit', 'Household utilities', 8),
    ('iryna', 'acc-iryna-main', '04', 'ATB', 'Groceries', 3400.00, 120.00, 'UAH', 'debit', 'Monthly grocery spending', 12),
    ('iryna', 'acc-iryna-main', '05', 'School club', 'Family', 1600.00, 100.00, 'UAH', 'debit', 'After-school activities', 17),
    ('iryna', 'acc-iryna-family', '06', 'Netflix', 'Subscriptions', 429.00, 0.00, 'UAH', 'debit', 'Family subscription', 20),
    ('iryna', 'acc-iryna-family', '07', 'Family cafe', 'Dining', 1300.00, 75.00, 'UAH', 'debit', 'Family dining', 24),
    ('iryna', 'acc-iryna-savings', '08', 'Savings interest', 'Interest', 190.00, 4.00, 'UAH', 'credit', 'Monthly reserve interest', 27),

    ('oleksii', 'acc-oleksii-main', '01', 'Salary', 'Incoming payment', 52000.00, 400.00, 'UAH', 'credit', 'Monthly salary', 2),
    ('oleksii', 'acc-oleksii-main', '02', 'Apartment rent', 'Housing', 15000.00, 0.00, 'UAH', 'debit', 'Monthly rent', 4),
    ('oleksii', 'acc-oleksii-main', '03', 'Caldova Utilities', 'Utilities', 2100.00, 85.00, 'UAH', 'debit', 'Household utilities', 8),
    ('oleksii', 'acc-oleksii-main', '04', 'Novus', 'Groceries', 3800.00, 150.00, 'UAH', 'debit', 'Monthly grocery spending', 12),
    ('oleksii', 'acc-oleksii-main', '05', 'WOG', 'Transport', 2500.00, 110.00, 'UAH', 'debit', 'Fuel purchases', 16),
    ('oleksii', 'acc-oleksii-main', '06', 'Booking.com', 'Travel', 4500.00, 500.00, 'UAH', 'debit', 'Travel accommodation', 19),
    ('oleksii', 'acc-oleksii-digital', '07', 'Bolt', 'Transport', 900.00, 65.00, 'UAH', 'debit', 'Taxi rides', 22),
    ('oleksii', 'acc-oleksii-digital', '08', 'YouTube Premium', 'Subscriptions', 199.00, 0.00, 'UAH', 'debit', 'Monthly subscription', 25),
    ('oleksii', 'acc-oleksii-travel', '09', 'SJ Rail', 'Travel', 48.50, 3.50, 'EUR', 'debit', 'Rail tickets in Sweden', 27),

    ('sofia', 'acc-sofia-main', '01', 'Design clients', 'Freelance income', 32000.00, 1000.00, 'UAH', 'credit', 'Monthly client invoices', 3),
    ('sofia', 'acc-sofia-main', '02', 'Studio rent', 'Housing', 9000.00, 0.00, 'UAH', 'debit', 'Home studio rent', 5),
    ('sofia', 'acc-sofia-main', '03', 'Silpo', 'Groceries', 2800.00, 125.00, 'UAH', 'debit', 'Monthly grocery spending', 11),
    ('sofia', 'acc-sofia-main', '04', 'Adobe', 'Subscriptions', 899.00, 0.00, 'UAH', 'debit', 'Creative software subscription', 14),
    ('sofia', 'acc-sofia-main', '05', 'Coworking space', 'Business services', 2200.00, 80.00, 'UAH', 'debit', 'Coworking membership', 18),
    ('sofia', 'acc-sofia-main', '06', 'Tax reserve', 'Savings', 6400.00, 200.00, 'UAH', 'debit', 'Monthly tax allocation', 20),
    ('sofia', 'acc-sofia-tax', '07', 'Tax allocation', 'Savings', 6400.00, 200.00, 'UAH', 'credit', 'Transfer from Digital account', 20),
    ('sofia', 'acc-sofia-main', '08', 'Vodafone', 'Mobile', 650.00, 20.00, 'UAH', 'debit', 'Mobile and data plan', 25),

    ('danylo', 'acc-danylo-main', '01', 'Salary', 'Incoming payment', 47000.00, 300.00, 'UAH', 'credit', 'Monthly salary', 2),
    ('danylo', 'acc-danylo-main', '02', 'Home loan payment', 'Housing', 14000.00, 0.00, 'UAH', 'debit', 'Monthly mortgage payment', 5),
    ('danylo', 'acc-danylo-main', '03', 'Caldova Utilities', 'Utilities', 1900.00, 75.00, 'UAH', 'debit', 'Household utilities', 8),
    ('danylo', 'acc-danylo-main', '04', 'Silpo', 'Groceries', 3100.00, 135.00, 'UAH', 'debit', 'Monthly grocery spending', 12),
    ('danylo', 'acc-danylo-main', '05', 'ANC Pharmacy', 'Health', 800.00, 65.00, 'UAH', 'debit', 'Pharmacy purchases', 16),
    ('danylo', 'acc-danylo-main', '06', 'WOG', 'Transport', 2100.00, 90.00, 'UAH', 'debit', 'Fuel purchases', 19),
    ('danylo', 'acc-danylo-internet', '07', 'Spotify', 'Subscriptions', 199.00, 0.00, 'UAH', 'debit', 'Monthly music subscription', 22),
    ('danylo', 'acc-danylo-internet', '08', 'Cloud storage', 'Subscriptions', 120.00, 0.00, 'UAH', 'debit', 'Monthly cloud storage', 25)
  ) AS value_set(
    customer_id, account_id, sequence_id, merchant, category, base_amount,
    monthly_variance, currency, direction, note, day_of_month
  )
),
history AS (
  SELECT
    CONCAT(
      'hist-', patterns.customer_id, '-',
      CONVERT(char(6), months.month_start, 112), '-',
      patterns.sequence_id
    ) AS id,
    patterns.account_id,
    patterns.merchant,
    patterns.category,
    CAST(
      patterns.base_amount + months.month_index * patterns.monthly_variance
      AS decimal(18, 2)
    ) AS amount,
    patterns.currency,
    patterns.direction,
    patterns.note,
    DATEADD(day, patterns.day_of_month - 1, months.month_start) AS booked_at
  FROM patterns
  CROSS JOIN months
)
MERGE customer_transactions AS target
USING history AS source
ON target.id = source.id
WHEN NOT MATCHED THEN INSERT
  (id, account_id, merchant, category, amount, currency, direction, note, booked_at)
  VALUES (source.id, source.account_id, source.merchant, source.category,
          source.amount, source.currency, source.direction, source.note,
          source.booked_at);
GO

DELETE FROM customer_transactions
WHERE id IN ('hist-andrii-202608-01', 'hist-sofia-202608-01');
GO

UPDATE customer_transactions
SET demo_session_id = '00000000-0000-0000-0000-000000000000'
WHERE demo_session_id IS NULL
  AND id NOT LIKE 'tx-%'
  AND id NOT LIKE 'hist-%';

UPDATE action_intents
SET demo_session_id = '00000000-0000-0000-0000-000000000000'
WHERE demo_session_id IS NULL;

UPDATE automation_rules
SET demo_session_id = '00000000-0000-0000-0000-000000000000'
WHERE demo_session_id IS NULL;
GO

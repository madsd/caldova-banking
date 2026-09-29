# Payment safety and approvals

Every consequential payment needs explicit customer approval of the exact amount, payee, source account, and fee. Approval is customer-scoped, single-use, and recorded with an audit event. The assistant cannot approve or execute its own proposal. If the available balance or a policy limit changes, execution must fail rather than silently modifying the payment.

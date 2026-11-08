# Architecture Roadmap & Future Work

The following capabilities were intentionally excluded from the initial `mcp-gateway` MVP to maintain code clarity, zero-dependency offline verification, and adherence to core gateway responsibilities. They represent our architectural roadmap for enterprise production deployments.

---

## 1. Protocol & Transport Extensions
- **gRPC and Apache Thrift Translation**: Extend the crawler and executor beyond OpenAPI REST to parse Protobuf definitions (`.proto`) and Thrift IDL files, compiling them directly into MCP tools with binary serialization.
- **Header & Cookie Parameter Support**: Add declarative policy for passing, generating, or masking HTTP request headers (e.g. `X-Correlation-ID`, `X-Tenant-ID`) and secure cookies for legacy enterprise backends.
- **Native MCP Server Reverse Proxying**: Allow the gateway to aggregate existing standalone MCP servers (e.g. GitHub MCP server, Slack MCP server) alongside REST-derived tools under uniform identity, policy, and audit logging.

## 2. Distributed Scale & Registry Management
- **Distributed Crawling Engine**: Decouple the crawler into asynchronous background workers capable of continuously crawling thousands of internal service specs registered in service meshes (Consul, Eureka, Backstage).
- **Registry Management UI & Database**: Provide a web-based catalog console with role-based access control, tool health metrics, and automated PR generation for organizations preferring UI-driven approvals.

## 3. Advanced Identity & Authentication
- **OAuth2 / OIDC for Callers**: Replace static bearer tokens with dynamic OAuth 2.0 authorization server integration, JWKS verification, and JWT claim inspection (e.g. Okta, Auth0, Keycloak).
- **Third-Party Token Exchange (RFC 8693)**: Perform on-behalf-of token exchange to downscope caller tokens into ephemeral, short-lived service tokens before dispatching downstream HTTP calls.
- **Session-Aware Authorization**: Track multi-turn agent conversation contexts to enforce conditional authorization policies (e.g. requiring a human manager confirmation tool call before allowing a destructive action).

## 4. Agent Safety, Prompt Defense & Financial Governance
- **Prompt-Injection Filtering of Tool Responses**: Run lightweight classification models or heuristic analyzers on downstream API responses before returning them to the agent, preventing indirect prompt injections embedded in external content.
- **Idempotency & Dry-Run Support**: Support `dry_run: true` parameters and `Idempotency-Key` headers for write and destructive operations so agents can preview modifications without committing mutations.
- **Tool-Description Evaluation Harness**: An automated evaluation framework that measures LLM tool selection accuracy and benchmark hallucinations against diverse tool description phrasing variations.
- **Per-Agent Financial Budgets & Rate Quotas**: Enforce monetary and token quotas per agent ID (e.g. maximum $10 of API costs or 1,000 requests per day) with automatic circuit breaking.

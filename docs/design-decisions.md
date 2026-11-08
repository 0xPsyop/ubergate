# Design Decisions & Architectural Trade-offs

This document explains the rationale behind key engineering decisions in `ubergate`.

---

## 1. Why Git as the Control Plane?

Instead of building a separate administrative UI and database to store enabled tools, `ubergate` uses YAML files in a Git repository as its control plane.

**Rationale:**
- **Auditability and Attribution**: Every tool enablement, modification, or ownership transfer is captured in a Git commit signed by an author, providing an immutable audit trail for compliance (SOC2/ISO27001).
- **Code Review Workflows**: Organizations already have rigorous PR review processes. Using `.github/CODEOWNERS` ensures that security and compliance teams must sign off on any pull request touching `/config/tools.yaml`.
- **Zero Additional Infrastructure**: Eliminates the operational overhead, backups, and security patching required for a dedicated management database or admin dashboard.
- **GitOps and CI/CD Automation**: Enabling tools is as simple as merging a pull request. The gateway hot-reloads configuration files upon change without downtime.

---

## 2. Why Disabled-by-Default? ("Discovery != Exposure")

When crawling an OpenAPI spec containing dozens or hundreds of operations, every derived tool starts with `enabled: false`.

**Rationale:**
- **Preventing Unintended LLM Access**: Automated exposure of enterprise endpoints to AI agents introduces prompt injection risks, unintended side effects, and catastrophic data mutations (e.g. an agent mistakenly invoking `DELETE /users/{id}`).
- **Enforcing Intentionality**: A human backend engineer or platform administrator must review the derived tool name, description, risk level, and schema, and explicitly flip `enabled: true`.
- **Handling Upstream Drift**: When an upstream team modifies an API endpoint, the crawler detects the hash mismatch and automatically sets `enabled: false` and `needs_review: true`. This prevents an altered contract from executing unexpectedly until it has been verified.

---

## 3. Why Stateless Per-Request MCP Servers?

The gateway does not maintain long-lived stateful MCP connections with session affinity. Instead, for every incoming HTTP POST to `/mcp`, it instantiates a fresh `McpServer` and `StreamableHTTPServerTransport({ sessionIdGenerator: undefined })`.

**Rationale:**
- **Horizontal Scalability**: A stateless gateway can be deployed behind any standard layer 7 load balancer (e.g. AWS ALB, Envoy, NGINX, Cloudflare) with zero sticky session requirements.
- **Caller Context Isolation**: Instantiating a per-request server closes over the authenticated caller's identity and privileges. There is zero risk of caller cross-talk, memory leaks across persistent sockets, or token leakage.
- **Fail-Fast Lifecycle**: If a single request crashes or times out, it is cleanly aborted and garbage collected without impacting other active agent connections.

---

## 4. Why Three Meta-Tools Instead of Full Catalog Registration?

Conventional MCP servers register every available API endpoint in the `tools/list` response. In contrast, `ubergate` registers only three meta-tools:
1. `search_tools(query, limit)`
2. `get_schema(tool_id)`
3. `invoke_tool(tool_id, arguments, fields)`

**Rationale:**
- **Context Window Conservation**: Registering 120 endpoints consumes over 14,000 tokens before the agent begins thinking. Three meta-tools consume fewer than 220 tokens (**98.5% reduction**).
- **Model Attention and Hallucination**: When an LLM prompt contains hundreds of competing tool definitions, tool selection accuracy drops dramatically. Giving the agent search capabilities mimics human cognitive search: find candidates, inspect schemas on demand, and invoke.
- **Dynamic Authorization**: The gateway filters search and schema queries against the caller's specific policy rules. Hidden tools do not leak existence to unauthorized actors.

---

## 5. Why First-Match-Wins Policy Evaluation?

Policy evaluation in `src/middleware/policy.ts` iterates through `config/policy.yaml` rules in sequential order, terminating on the first matching rule.

**Rationale:**
- **Predictability and Transparency**: Complex permission systems with deny-overrides, additive permissions, or weighted scores frequently produce surprising security bugs where an administrator cannot easily reason about access.
- **Familiar Firewall Semantics**: First-match-wins mimics AWS security groups, iptables, and Kubernetes network policies. Specific overrides are placed at the top (e.g. allow human write for specific tools), followed by broad catch-all denials.

---

## 6. Why Audit Logs Store Hashes Instead of Raw Payloads?

`src/middleware/audit.ts` records `args_sha256: crypto.createHash('sha256').update(JSON.stringify(args)).digest('hex')` rather than the raw argument JSON.

**Rationale:**
- **PII and Data Leakage Protection**: Tool arguments often contain credit cards, passwords, phone numbers, or healthcare data. Storing raw arguments in plaintext JSONL log files turns audit storage into a massive data liability.
- **Cryptographic Verifiability**: If a dispute or security incident arises, investigators who have the alleged payload can hash it and verify whether it matches the exact audit record without requiring persistent plaintext storage in logs.

---

## 7. Why Character / 4 Token Approximation in the Benchmark?

The benchmark suite (`bench/compare.ts`) estimates tokens using `Math.ceil(chars / 4)`.

**Rationale:**
- **Offline Self-Containment**: Relying on external tokenizer packages (like `@dqbd/tiktoken` or Python `tiktoken`) introduces native C/Rust binaries, large BPE dictionary downloads, and platform incompatibilities.
- **Standard Industry Heuristic**: OpenAI, Anthropic, and Google documentation recommend 1 token ≈ 4 characters of English text or JSON as the standard rule of thumb for token estimation across modern tokenizers.
- **Equal Bias Baseline**: Because both the naive baseline and the gateway discovery flows are evaluated using the identical heuristic, relative reduction percentages (e.g. 98.5% and 95.5%) are mathematically robust and invariant to minor tokenizer differences.

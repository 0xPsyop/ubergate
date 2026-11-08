# Benchmark Results: MCP Gateway vs Naive MCP Server

Date of benchmark run: **2026-11-08**

## Methodology
- **Synthetic API Catalog**: 30 resources with 4 CRUD operations each (= **120 operations**), generated dynamically by `bench/gen-large-spec.ts`.
- **Token Estimation Heuristic**: `ceil(characters / 4)` (standard LLM token approximation rule-of-thumb).
- **Naive MCP Baseline**: Conventional MCP server exposing all 120 endpoints in the initial `tools/list` catalog payload.
- **MCP Gateway**: Exposes only 3 lightweight discovery meta-tools (`search_tools`, `get_schema`, `invoke_tool`).
- **Discovery Flow**: Simulates an agent performing `search_tools { query: "user", limit: 8 }` followed by `get_schema { tool_id: "enterprise.createUser" }`.
- **Response Projection**: Demonstrates selective field trimming on downstream responses.

---

## 1. Catalog Context Consumption (Initial `tools/list`)

| Architecture | Characters | Est. Tokens | Initial Context Reduction |
| :--- | :--- | :--- | :--- |
| **Naive MCP (`tools/list` all 120 tools)** | 58,469 | **14,618** | Baseline (0.0%) |
| **MCP Gateway (`tools/list` 3 meta-tools)** | 876 | **219** | **-98.5%** |

---

## 2. End-to-End Task Flow Comparison

| Step / Flow | Payload | Characters | Est. Tokens |
| :--- | :--- | :--- | :--- |
| **Naive MCP: Initial Catalog** | 120 tool schemas upfront | 58,469 | 14,618 |
| **Gateway: Initial Catalog** | 3 meta-tools (`search_tools`, `get_schema`, `invoke_tool`) | 876 | 219 |
| **Gateway: `search_tools` Result** | 8 tool summaries (id, server, risk, description) | 723 | 181 |
| **Gateway: `get_schema` Result** | Full schema for 1 chosen tool | 1,015 | 254 |
| **Gateway: Total Discovery Flow** | Initial catalog + search + schema | **2,614** | **654** |

> **Net Token Savings on Discovery Flow: 95.5% reduction** (654 vs 14,618 tokens).

---

## 3. Response Projection Savings

| Response Type | Payload | Characters | Est. Tokens | Size Reduction |
| :--- | :--- | :--- | :--- | :--- |
| **Full Downstream Response** | Full resource with metadata & arrays | 490 | 123 | Baseline |
| **Projected Response (`name, status`)** | Only requested fields retained | 41 | 11 | **-91.1%** |

---

*Generated automatically by `npm run bench` (tsx bench/compare.ts).*

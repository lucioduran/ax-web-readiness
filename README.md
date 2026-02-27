---
license: cc-by-4.0
language:
  - en
tags:
  - ax
  - ai-agent-experience
  - web-audit
  - llms-txt
  - robots-txt
  - structured-data
  - mcp
  - agent-json
  - ai-readiness
  - security-txt
  - openapi
  - http-headers
pretty_name: "AX Web Readiness — AI Agent Experience Audit of Top 10K Websites"
size_categories:
  - 1K<n<10K
task_categories:
  - tabular-classification
---

# AX Web Readiness

**The first large-scale dataset measuring how ready the web is for AI agents.**

This dataset contains AI Agent Experience (AX) audit results for the top 10,000 websites (ranked by [Tranco](https://tranco-list.eu/)), generated with [ax-audit](https://github.com/lucioduran/ax-audit) — an open-source tool that evaluates 9 key standards that AI agents rely on to discover, understand, and interact with web services.

## Why This Dataset Matters

As AI agents become primary consumers of web content, websites need machine-readable metadata beyond traditional SEO. Standards like `llms.txt`, `agent.json` (A2A), MCP protocol, and structured data enable agents to autonomously navigate and use web services. This dataset quantifies adoption across the web's most visited domains.

## Methodology

- **Source**: Tranco top 10K domains (research-grade popularity ranking)
- **Tool**: [ax-audit](https://github.com/lucioduran/ax-audit) v2.1.0
- **Protocol**: HTTPS GET to each domain's root URL
- **Timeout**: 15 seconds per domain
- **Date**: February 2026

## Checks & Weights

| Check | Weight | What It Measures |
|-------|--------|------------------|
| LLMs.txt | 15% | Presence and quality of `/llms.txt` per the llmstxt.org spec |
| Robots.txt | 15% | AI crawler configuration in `robots.txt` |
| Structured Data | 13% | JSON-LD / schema.org structured data |
| HTTP Headers | 13% | Security headers + RFC 5988 Link headers for AI discovery |
| Agent Card (A2A) | 10% | `/.well-known/agent.json` — Agent-to-Agent protocol |
| MCP Protocol | 10% | `/.well-known/mcp.json` — Model Context Protocol |
| Security.txt | 8% | `/.well-known/security.txt` per RFC 9116 |
| Meta Tags | 8% | AI-relevant meta tags and `rel` links in HTML |
| OpenAPI | 8% | `/.well-known/openapi.json` API specification |

## Schema

Each row represents one audited domain with ~45 flat columns:

| Column | Type | Description |
|--------|------|-------------|
| `rank` | int | Tranco rank (1 = most popular) |
| `domain` | string | Domain name (e.g., `google.com`) |
| `url` | string | Full URL audited |
| `overall_score` | int | Weighted AX readiness score (0–100) |
| `grade_label` | string | `Excellent` / `Good` / `Fair` / `Poor` |
| `grade_color` | string | `green` / `yellow` / `orange` / `red` |
| `duration_ms` | int | Audit duration in milliseconds |
| `{check}_score` | int | Individual check score (0–100) |
| `{check}_pass` | int | Number of passing findings |
| `{check}_warn` | int | Number of warning findings |
| `{check}_fail` | int | Number of failing findings |
| `has_llms_txt` | bool | Whether `/llms.txt` exists |
| `has_robots_txt` | bool | Whether `/robots.txt` exists |
| `has_agent_json` | bool | Whether `/.well-known/agent.json` exists |
| `has_mcp_json` | bool | Whether `/.well-known/mcp.json` exists |
| `has_security_txt` | bool | Whether `/.well-known/security.txt` exists |
| `has_openapi` | bool | Whether `/.well-known/openapi.json` exists |
| `timestamp` | string | ISO 8601 audit timestamp |

Check prefixes: `llms_txt`, `robots_txt`, `structured_data`, `http_headers`, `agent_json`, `mcp`, `security_txt`, `meta_tags`, `openapi`.

## Reproduce

```bash
git clone https://github.com/lucioduran/ax-audit.git
cd ax-audit/dataset
npm install
node crawl.js --limit 10000
```

## License

This dataset is released under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The underlying tool (ax-audit) is licensed under Apache 2.0.

## Citation

```bibtex
@dataset{duran2026axwebreadiness,
  title={AX Web Readiness: AI Agent Experience Audit of Top 10K Websites},
  author={Duran, Lucio},
  year={2026},
  url={https://huggingface.co/datasets/lucioduran/ax-web-readiness},
  note={Generated with ax-audit v2.1.0}
}
```

## Links

- [ax-audit on GitHub](https://github.com/lucioduran/ax-audit)
- [ax-audit on npm](https://www.npmjs.com/package/ax-audit)
- [Tranco List](https://tranco-list.eu/)
- [llmstxt.org](https://llmstxt.org/)
- [Model Context Protocol](https://modelcontextprotocol.io/)

# Agent WebUI

[![GitHub Repo stars](https://img.shields.io/github/stars/Knuckles-Team/agent-webui)](https://github.com/Knuckles-Team/agent-webui/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/Knuckles-Team/agent-webui)](https://github.com/Knuckles-Team/agent-webui/forks)
[![GitHub contributors](https://img.shields.io/github/contributors/Knuckles-Team/agent-webui)](https://github.com/Knuckles-Team/agent-webui/graphs/contributors)
[![GitHub license](https://img.shields.io/github/license/Knuckles-Team/agent-webui)](LICENSE)
[![GitHub last commit (by committer)](https://img.shields.io/github/last-commit/Knuckles-Team/agent-webui)](https://github.com/Knuckles-Team/agent-webui/commits/main)
[![GitHub pull requests](https://img.shields.io/github/issues-pr/Knuckles-Team/agent-webui)](https://github.com/Knuckles-Team/agent-webui/pulls)
[![GitHub closed pull requests](https://img.shields.io/github/issues-pr-closed/Knuckles-Team/agent-webui)](https://github.com/Knuckles-Team/agent-webui/pulls?q=is%3Apr+is%3Aclosed)
[![GitHub issues](https://img.shields.io/github/issues/Knuckles-Team/agent-webui)](https://github.com/Knuckles-Team/agent-webui/issues)
[![GitHub top language](https://img.shields.io/github/languages/top/Knuckles-Team/agent-webui)](https://github.com/Knuckles-Team/agent-webui)
[![GitHub language count](https://img.shields.io/github/languages/count/Knuckles-Team/agent-webui)](https://github.com/Knuckles-Team/agent-webui)
[![GitHub repo size](https://img.shields.io/github/repo-size/Knuckles-Team/agent-webui)](https://github.com/Knuckles-Team/agent-webui)
[![GitHub repo file count (file type)](https://img.shields.io/github/directory-file-count/Knuckles-Team/agent-webui)](https://github.com/Knuckles-Team/agent-webui)
[![PyPI - Version](https://img.shields.io/pypi/v/agent-webui)](https://pypi.org/project/agent-webui/)
[![PyPI - Downloads](https://img.shields.io/pypi/dd/agent-webui)](https://pypi.org/project/agent-webui/)
[![PyPI - License](https://img.shields.io/pypi/l/agent-webui)](https://pypi.org/project/agent-webui/)
[![PyPI - Wheel](https://img.shields.io/pypi/wheel/agent-webui)](https://pypi.org/project/agent-webui/)
[![PyPI - Implementation](https://img.shields.io/pypi/implementation/agent-webui)](https://pypi.org/project/agent-webui/)
[![Build](https://github.com/Knuckles-Team/agent-webui/actions/workflows/release.yml/badge.svg)](https://github.com/Knuckles-Team/agent-webui/actions/workflows/release.yml)
[![Documentation](https://github.com/Knuckles-Team/agent-webui/actions/workflows/advisory.yml/badge.svg?branch=main)](https://knuckles-team.github.io/agent-webui/)

![Agent WebUI — governed agents, knowledge, and workflows](public/og-image-v1.png)

## Overview

Agent WebUI is the browser interface for GraphOS. It combines agent chat, governed tool use, knowledge exploration, and operational views in a React application with a FastAPI host.

Current package Version: 2.6.0.

## Key Capabilities

- Stream agent responses, sources, tool calls, and approval requests.
- Observe agent routing and workflow activity as it happens.
- Explore documents, graph data, code intelligence, and structured objects.
- Use governed MCP Apps without exposing service credentials to the browser.
- Serve browser clients through AG-UI and optional ACP sessions.

## Documentation

The [Agent WebUI documentation](https://knuckles-team.github.io/agent-webui/) includes [architecture](https://knuckles-team.github.io/agent-webui/architecture/), [feature reference](https://knuckles-team.github.io/agent-webui/features/), and [deployment and operations](https://knuckles-team.github.io/agent-webui/deployment/).

<a id="build--deploy"></a>
The deployment guide documents the [Build & Deploy contract](https://knuckles-team.github.io/agent-webui/deployment/).

## Architecture

The React application presents browser-safe views and protocols. Its FastAPI host composes with GraphOS, which owns authentication, routing, and public gateway contracts; epistemic-graph owns durable knowledge and reasoning.

## Quick Start

Requires Python 3.12+, Node.js, uv, and pnpm. From a checkout, install dependencies and run the backend and frontend in separate terminals:

```bash
git clone https://github.com/Knuckles-Team/agent-webui.git
cd agent-webui
pnpm install --frozen-lockfile
pnpm run dev:server
pnpm run dev
```

Add provider settings as needed. See the [deployment guide](https://knuckles-team.github.io/agent-webui/deployment/) for the complete service setup.

## Contributing

Issues and pull requests are welcome. Follow [AGENTS.md](AGENTS.md) for repository conventions and validation guidance. Keep examples free of credentials and private endpoints.

## License

Agent WebUI is available under the [MIT License](LICENSE).

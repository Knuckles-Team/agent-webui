# Agent WebUI

![PyPI - Version](https://img.shields.io/pypi/v/agent-webui)
![PyPI - Downloads](https://img.shields.io/pypi/dd/agent-webui)
![GitHub Repo stars](https://img.shields.io/github/stars/Knuckles-Team/agent-webui)
![GitHub forks](https://img.shields.io/github/forks/Knuckles-Team/agent-webui)
![GitHub contributors](https://img.shields.io/github/contributors/Knuckles-Team/agent-webui)
![PyPI - License](https://img.shields.io/pypi/l/agent-webui)
![GitHub](https://img.shields.io/github/license/Knuckles-Team/agent-webui)

![GitHub last commit (by committer)](https://img.shields.io/github/last-commit/Knuckles-Team/agent-webui)
![GitHub pull requests](https://img.shields.io/github/issues-pr/Knuckles-Team/agent-webui)
![GitHub closed pull requests](https://img.shields.io/github/issues-pr-closed/Knuckles-Team/agent-webui)
![GitHub issues](https://img.shields.io/github/issues/Knuckles-Team/agent-webui)

![GitHub top language](https://img.shields.io/github/languages/top/Knuckles-Team/agent-webui)
![GitHub language count](https://img.shields.io/github/languages/count/Knuckles-Team/agent-webui)
![GitHub repo size](https://img.shields.io/github/repo-size/Knuckles-Team/agent-webui)
![GitHub repo file count (file type)](https://img.shields.io/github/directory-file-count/Knuckles-Team/agent-webui)
![PyPI - Wheel](https://img.shields.io/pypi/wheel/agent-webui)
![PyPI - Implementation](https://img.shields.io/pypi/implementation/agent-webui)

_Version: 0.1.15_

A React-based chat interface for Pydantic AI Agents built using Agent Utilities.

Built with [Vercel AI SDK](https://sdk.vercel.ai/) and designed to work with Pydantic AI's streaming chat API.

## Features

- Streaming message responses with reasoning display
- Tool call visualization with collapsible input/output
- Interactive Elicitation Forms for structured user input
- Conversation persistence via localStorage
- Dynamic model and tool selection
- Dark/light theme support
- Mobile-responsive sidebar
- Scheduling jobs
- Memory
- MCP Support
- Multi-model support

## Development

```sh
pnpm install
pnpm run dev:server  # start the Python backend (requires agent/ setup)
pnpm run dev         # start the Vite dev server
```

## License

MIT

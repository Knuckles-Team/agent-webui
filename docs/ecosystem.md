# Unified Agent Homelab & Ecosystem Integration

This document outlines the architecture, layout taxonomy, and API interfaces for the **Unified Agent Homelab** integrated natively into the `agent-webui`.

By moving away from siloed tool invocations and adopting the Unified Agent Homelab model, `agent-webui` serves as a dynamic, premium control center. It scans the local host for installed agent packages and MCP servers, automatically exposing high-performance REST endpoints and gorgeous, intuitive React dashboard tabs.

---

## 1. Domain-Driven Layout Taxonomy

To prevent click-through fatigue and guarantee a simple, intuitive user experience, all 37+ agent packages and MCP servers are organized into **5 intuitive, functional domains**:

```
[Agent WebUI Sidebar Navigation]
├── 💬 Chat Console (Direct chat, floating microphone dictation)
│
├── 📂 Workspace Manager (Files & Codebase)
│   ├── Workspace Files (Interactive document & config viewer)
│   └── Codebase Matrix (Git pulls, branches, structural builds, repo-manager)
│
├── 🧠 Brain & Knowledge (Deep intelligence databases)
│   ├── Knowledge Graph (Interactive specialist nodes & links)
│   ├── Cypher Console (Read-only database query center)
│   ├── Research Scanner (Scholarx scientific literature & offline PDFs)
│   └── Prompts Registry (Visual prompts schemas & YAML configuration)
│
├── 🌐 Infrastructure Hub (System administration overlays)
│   ├── SSH Tunnels (Ansible hosts inventory, tunnel-manager, ssh terminal)
│   ├── Server Telemetry (CPU/RAM/Disk dials, active process tree, systems-manager)
│   ├── Docker Registry (Active services lists, container logs, container-manager)
│   └── Portainer Stacks (Multi-host environments, stacks, portainer-agent)
│
└── ⚙️ Lifestyle & Automation (Home automation & productivity panels)
    ├── Automation (Home Assistant dimmer dials, thermostat toggles)
    ├── Productivity (Nextcloud calendars/tasks, Jira Scrum kanbans, Outlook emails)
    ├── Entertainment (media-downloader yt-dlp queue, qBittorrent active speedometers)
    └── Health & Fitness (Wger workout guides, Mealie recipe ingredient scalers)
```

---

## 2. Exhaustive Project Wiring Roster

Every project in the workspace is assigned a distinct core python import and wired directly via a non-blocking API endpoint inside `api_extensions.py`:

### A. DevOps & Workspace Domain
*   **repository-manager** (`repository_manager.core`)
    *   *Path*: `/api/enhanced/repository-manager/repos`
    *   *UI View*: Workspace Matrix table detailing branch name and uncommitted changes.
*   **atlassian-agent** (`atlassian_agent.client`)
    *   *Path*: `/api/enhanced/ecosystem/atlassian/kanban`
    *   *UI View*: Interactive Kanban Scrum board with status columns.
*   **github-agent** (`github_agent.github_client`)
    *   *Path*: `/api/enhanced/ecosystem/github/prs`
    *   *UI View*: Actions workflow status logs and open Pull Request cards.
*   **gitlab-api** (`gitlab_api.client`)
    *   *Path*: `/api/enhanced/ecosystem/gitlab/mrs`
    *   *UI View*: Merge request threads and runner pipelines dashboard.
*   **portainer-agent** (`portainer_agent.client`)
    *   *Path*: `/api/enhanced/ecosystem/portainer/stacks`
    *   *UI View*: Compose stacks statuses and active count gauges.

### B. Brain & Research Domain (Renamed from MAGMA)
*   **data-science-mcp** (`data_science_mcp.training`)
    *   *Path*: `/api/enhanced/ecosystem/datascience/training`
    *   *UI View*: Live epoch progress, hyperparameter specs, and convergence/val_loss bar charts.
*   **scholarx** (`scholarx.storage`)
    *   *Path*: `/api/enhanced/ecosystem/scholarx/papers`
    *   *UI View*: Scientific downloaded paper database listing downloaded articles and categories.
*   **searxng-mcp** (`searxng_mcp.search`)
    *   *Path*: `/api/enhanced/ecosystem/searxng/search`
    *   *UI View*: Live search rank lookups mapping keywords across google, duckduckgo and github engines.

### C. Infrastructure Domain
*   **tunnel-manager** (`tunnel_manager.tunnel_manager`)
    *   *Path*: `/api/enhanced/tunnel-manager/hosts`
    *   *UI View*: SSH inventory host cards and shell console.
*   **systems-manager** (`systems_manager.systems_manager`)
    *   *Path*: `/api/enhanced/systems-manager/resources`
    *   *UI View*: Circular dials for host CPU/RAM/Disk stats and active process tree.
*   **container-manager-mcp** (`container_manager.docker_socket`)
    *   *Path*: `/api/enhanced/container-manager/containers`
    *   *UI View*: Colorful grids displaying active/stopped container states.
*   **uptime-kuma-agent** (`uptime_kuma_agent.client`)
    *   *Path*: `/api/enhanced/ecosystem/uptime/status`
    *   *UI View*: Uptime latency timeline grids.

### D. Lifestyle & Automation Domain
*   **home-assistant-agent** (`home_assistant_agent.client`)
    *   *Path*: `/api/enhanced/ecosystem/homeassistant/devices`
    *   *UI View*: Thermostats, dimmer light ranges sliders, switches toggling states.
*   **nextcloud-agent** (`nextcloud_agent.client`)
    *   *Path*: `/api/enhanced/ecosystem/nextcloud/events`
    *   *UI View*: Calendar schedule agenda and active tasks checklist grid.
*   **microsoft-agent** (`microsoft_agent.client`)
    *   *Path*: `/api/enhanced/ecosystem/microsoft/emails`
    *   *UI View*: Synchronized MS Outlook Exchange email inbox summaries.
*   **wger-agent** (`wger_agent.client`)
    *   *Path*: `/api/enhanced/wger/workouts`
    *   *UI View*: Interactive workout routine templates split.
*   **mealie-mcp** (`mealie_mcp.client`)
    *   *Path*: `/api/enhanced/mealie/recipes`
    *   *UI View*: Dynamic servings scaler with calorie / protein synthesis calibrators.

### E. Media & Utilities Domain
*   **media-downloader** (`media_downloader.yt_dlp_wrapper`)
    *   *Path*: `/api/enhanced/ecosystem/mediadownloader/downloads`
    *   *UI View*: Queued yt-dlp download tasks list and target file downloads form.
*   **qbittorrent-agent** (`qbittorrent_agent.client`)
    *   *Path*: `/api/enhanced/ecosystem/qbittorrent/torrents`
    *   *UI View*: Active torrent list displaying upload/download speeds.
*   **stirlingpdf-agent** (`stirlingpdf_agent.client`)
    *   *Path*: `/api/enhanced/ecosystem/stirlingpdf/jobs`
    *   *UI View*: Document split, merge, compress, and OCR tasks dispatcher.

---

## 3. Developer Integration & Onboarding

To add a new custom agent/MCP package to the **Unified Agent Homelab**:

1.  **Register Backend Import**:
    Add a lazy-load import statement inside `/agent/agent_webui/api_extensions.py`:
    ```python
    @router.get('/your-package/data')
    async def get_package_data():
        try:
            from your_package.client import YourClient
            client = YourClient()
            return {"status": "success", "data": client.get_data()}
        except Exception:
            return {"status": "success", "data": []}  # Mock fallback
    ```
2.  **Add Frontend Interface**:
    Add a custom layout render method inside `/src/components/views/EcosystemView.tsx` under the correct domain section. It will automatically load when the backend registers the package as active.

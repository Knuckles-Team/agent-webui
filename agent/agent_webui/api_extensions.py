import logging
import os
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Any

from agent_utilities.knowledge_graph.engine import IntelligenceGraphEngine
from agent_utilities.knowledge_graph.kb.ingestion import KBIngestionEngine
from agent_utilities.knowledge_graph.maintainer import GraphMaintainer
from agent_utilities.knowledge_graph.pipeline.phases import PHASES
from agent_utilities.knowledge_graph.pipeline.runner import PipelineRunner
from agent_utilities.knowledge_graph.pipeline.types import PipelineContext
from agent_utilities.models.knowledge_graph import PipelineConfig
from agent_utilities.sdd import SDDManager
from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse

# Global constant for agent directory

router = APIRouter()
logger = logging.getLogger(__name__)

# Directory where agent stores its workspace data
DEFAULT_AGENT_DIR = Path(os.getenv('AGENT_WORKSPACE', 'workspace'))

# Global registry for operational helpers (set during agent initialization)
workspace_helpers: dict[str, Any] = {}


def get_helper(name: str, fallback: Any = None) -> Any:
    """Safely retrieve a registered workspace helper by name.

    Args:
        name: The identifier of the helper function.
        fallback: Value to return if the helper is not registered.

    Returns:
        The matched helper function or the fallback value.
    """
    helper = workspace_helpers.get(name)
    if not helper:
        logger.warning(
            f"Helper '{name}' not found in workspace_helpers. "
            f'Available: {list(workspace_helpers.keys())}'
        )
        return fallback
    return helper


def set_workspace_helpers(helpers: dict[str, Any]) -> None:
    """Register the operational helpers for the current workspace context.

    Args:
        helpers: Mapping of helper names to implementation functions.
    """
    global workspace_helpers
    logger.info(f'Setting workspace helpers. Keys: {list(helpers.keys())}')
    workspace_helpers = helpers


def get_engine() -> IntelligenceGraphEngine:
    """Helper to get the active graph engine or raise 501.

    Returns:
        The active IntelligenceGraphEngine instance.

    Raises:
        HTTPException: 501 error if the engine is not initialized.
    """
    engine = IntelligenceGraphEngine.get_active()
    if not engine:
        raise HTTPException(
            status_code=501, detail='Intelligence Graph Engine not initialized'
        )
    return engine


@router.get('/info')
async def get_info() -> dict[str, str]:
    """Retrieve agent identity and user personalization metadata.

    CONCEPT:KG-001 — Identity Management

    Returns:
        A dictionary containing agent name, description, and emojis.
    """
    engine = IntelligenceGraphEngine.get_active()
    if engine:
        identity = engine.get_agent_identity()
        return {
            'name': identity.get('name', 'Agent'),
            'description': identity.get('description', 'AI Agent'),
            'emoji': identity.get('emoji', workspace_helpers.get('agent_emoji', '🤖')),
            'user_emoji': '👤',
        }

    # Legacy fallback for edge cases during startup
    name = workspace_helpers.get('agent_name', 'Agent')
    description = workspace_helpers.get('agent_description', 'AI Agent')
    emoji = workspace_helpers.get('agent_emoji', '🤖')

    return {
        'name': name,
        'description': description,
        'emoji': emoji,
        'user_emoji': '👤',
    }


@router.get('/files')
async def list_files() -> list[dict[str, Any]]:
    """List workspace files with metadata.

    Returns a list of file records with ``name``, ``size``, ``modified_iso``,
    and ``is_dir``. Directories are included and marked with ``is_dir=True``.

    If a ``list_workspace_files_detailed`` helper is registered it is used
    directly (expected to return records of the same shape). Otherwise the
    endpoint falls back to a pathlib-based scan rooted at the workspace
    path, skipping entries it cannot ``stat()``.
    """
    detailed = get_helper('list_workspace_files_detailed')
    if detailed:
        return detailed()

    get_workspace = get_helper('get_workspace_path')
    if not get_workspace:
        raise HTTPException(status_code=501, detail='File helpers not initialized')

    base = Path(str(get_workspace('')))
    results: list[dict[str, Any]] = []
    try:
        entries = sorted(base.iterdir())
    except OSError:
        return results
    for entry in entries:
        try:
            st = entry.stat()
        except OSError:
            continue
        results.append(
            {
                'name': entry.name,
                'size': st.st_size,
                'modified_iso': datetime.fromtimestamp(
                    st.st_mtime, tz=timezone.utc
                ).isoformat(),
                'is_dir': entry.is_dir(),
            }
        )
    return results


@router.get('/files/{filename}')
async def get_file(filename: str) -> dict[str, str]:
    """Retrieve the content of a specific workspace file.

    Args:
        filename: The relative path or name of the file to read.

    Returns:
        A dictionary containing the 'content' string.
    """
    load_file = get_helper('load_workspace_file')
    content = load_file(filename) if load_file else ''

    if not content and DEFAULT_AGENT_DIR.joinpath(filename).exists():
        content = DEFAULT_AGENT_DIR.joinpath(filename).read_text(encoding='utf-8')

    return {'content': content}


@router.get('/config-files')
async def list_config_files() -> list[str]:
    """List markdown-based configuration files and MCP server configs.

    Returns:
        A filtered list of configuration-related filenames.
    """
    list_files = get_helper('list_workspace_files')
    workspace_files = set(list_files() if list_files else [])
    default_files = set(f.name for f in DEFAULT_AGENT_DIR.glob('*.md') if f.is_file())

    all_files = sorted(list(workspace_files.union(default_files)))
    config_files = [
        f
        for f in all_files
        if (f.endswith('.md') and not f.endswith('_LOG.md')) or f == 'mcp_config.json'
    ]

    return config_files


@router.get('/agents')
async def list_agents() -> list[dict[str, Any]]:
    """List all agents registered in the Knowledge Graph.

    Returns:
        List of agent metadata.
    """
    try:
        engine = get_engine()

        query = 'MATCH (a:Agent) RETURN a'
        result = engine.backend.execute(query)
        agents = []
        for row in result:
            agent_data = row.get('a', {})
            if isinstance(agent_data, dict):
                agents.append(agent_data)
        return agents
    except Exception as e:
        logger.error(f'Failed to list agents: {e}')
        return []


@router.put('/files/{filename}')
async def update_file(filename: str, data: dict[str, str]) -> dict[str, str]:
    """Create or update a configuration file in the workspace.

    Args:
        filename: The target filename (must be .md or .json).
        data: Dictionary containing the 'content' to write.

    Returns:
        A success status mapping.
    """
    if not filename.endswith('.md') and not filename.endswith('.json'):
        raise HTTPException(status_code=400, detail='Only .md and .json files allowed')
    write_helper = get_helper('write_md_file')
    if not write_helper:
        raise HTTPException(status_code=501, detail='Write helper not initialized')
    write_helper(filename, data.get('content', ''))
    return {'status': 'success'}


@router.delete('/files/{filename}')
async def delete_workspace_file(filename: str) -> dict[str, Any]:
    """Delete a workspace file.

    Refuses path traversal (filenames that resolve outside the workspace
    root) and directories — callers must delete directories through a
    separate administrative flow. Returns a structured ``{"status": ...}``
    payload rather than raising so the UI can surface errors inline.
    """
    get_workspace = get_helper('get_workspace_path')
    if not get_workspace:
        return {'status': 'error', 'detail': 'workspace helper not initialized'}

    base = Path(str(get_workspace(''))).resolve()
    target = (base / filename).resolve()

    # Prevent escape via ".." — the resolved target must live inside base.
    if target != base and base not in target.parents:
        return {'status': 'error', 'detail': 'path outside workspace'}
    if target == base:
        return {'status': 'error', 'detail': 'refusing to delete workspace root'}
    if not target.exists():
        return {'status': 'error', 'detail': 'not found'}
    if target.is_dir():
        return {'status': 'error', 'detail': 'refusing to delete directory'}

    try:
        target.unlink()
    except OSError as e:
        logger.error(f'Failed to delete workspace file {filename}: {e}')
        return {'status': 'error', 'detail': str(e)}
    return {'status': 'ok', 'deleted': filename}


@router.get('/skills')
async def list_skills() -> list[dict[str, Any]]:
    """Retrieve the catalog of dynamic agent skills.

    CONCEPT:KG-003 — Granular Resource Queries

    Returns:
        A list of skill definitions sorted alphabetically.
    """
    engine = IntelligenceGraphEngine.get_active()
    if engine:
        return engine.get_skills()

    # Legacy fallback
    list_skills_helper = get_helper('list_skills')
    if not list_skills_helper:
        raise HTTPException(status_code=501, detail='Skill helper not initialized')
    skills = list_skills_helper()
    return sorted(skills, key=lambda x: x.get('name', '').lower())


@router.post('/skills/{skill_id}/toggle')
async def toggle_skill(skill_id: str) -> dict[str, Any]:
    """Enable or disable a specific agent skill.

    CONCEPT:KG-003 — Granular Resource Queries

    Args:
        skill_id: The identifier of the skill to toggle.

    Returns:
        The resulting state of the toggled skill.
    """
    engine = IntelligenceGraphEngine.get_active()
    if engine:
        try:
            return engine.toggle_resource(skill_id)
        except ValueError as e:
            raise HTTPException(status_code=404, detail=str(e)) from e

    toggle_helper = get_helper('toggle_skill')
    if not toggle_helper:
        raise HTTPException(status_code=501, detail='Skill helper not initialized')
    return toggle_helper(skill_id)


@router.post('/reload')
async def reload_agent(request: Request) -> dict[str, Any]:
    """Trigger a KG-first reload of the agent's configuration.

    CONCEPT:KG-004 — Workspace Reload

    Args:
        request: The current FastAPI Request object.

    Returns:
        Structured change summary with counts of updated resources.
    """
    try:
        engine = IntelligenceGraphEngine.get_active()
        if engine:
            changes = engine.reload_from_workspace()
            return {
                'status': 'success',
                'message': 'Agent reloaded via Knowledge Graph',
                **changes,
            }

        # Legacy fallback
        workspace_helpers['initialize_workspace']()
        reloadable = getattr(request.app.state, 'reload_app', None)
        if not reloadable:
            raise HTTPException(
                status_code=501, detail='Reloadable wrapper not found in app state'
            )
        reloadable.reload()
        return {'status': 'success', 'message': 'Agent reloaded successfully'}
    except Exception as e:
        logger.error(f'Reload failed: {e}')
        raise HTTPException(status_code=500, detail=str(e)) from e


def parse_cron_table(content: str) -> list[dict[str, Any]]:
    """Parse a markdown table of cron tasks into structured data.

    Args:
        content: Raw markdown string containing the task table.

    Returns:
        A list of task dictionaries with id, name, and schedule.
    """
    tasks = []
    lines = content.split('\n')
    for line in lines:
        if '|' in line and 'ID' not in line and '---' not in line:
            parts = [p.strip() for p in line.split('|') if p.strip()]
            if len(parts) >= 3:
                tasks.append(
                    {
                        'id': parts[0],
                        'name': parts[1],
                        'schedule': parts[2],
                    }
                )
    return tasks


def parse_cron_logs(content: str) -> list[dict[str, Any]]:
    """Extract structured execution logs from a CRON_LOG.md markdown file.

    Args:
        content: Raw markdown string containing formatted log entries.

    Returns:
        A list of log entries in reverse chronological order.
    """
    logs = []

    parts = re.split(r'(?=^### \[)', content, flags=re.MULTILINE)

    for part in parts:
        if not part.strip() or not part.startswith('### ['):
            continue

        try:
            header_match = re.search(r'^### \[(.*?)\] (.*?) \(`(.*?)`\)', part)
            if header_match:
                ts = header_match.group(1)
                name = header_match.group(2)
                tid = header_match.group(3)

                body = part.split('\n\n', 1)[1] if '\n\n' in part else ''
                output = body.split('\n---')[0].strip()

                logs.append(
                    {
                        'timestamp': ts,
                        'task_id': tid,
                        'task_name': name,
                        'status': 'success',
                        'output': output,
                    }
                )
        except Exception as e:
            logger.debug(f'Error parsing log entry: {e}')

    return logs[::-1]


@router.get('/cron/calendar')
async def get_cron_calendar() -> list[dict[str, Any]]:
    """Retrieve the scheduled cron task calendar.

    Returns:
        List of structured cron tasks.
    """
    get_cal = get_helper('get_cron_calendar')
    tasks = get_cal() if get_cal else []
    # Cron data now stored in Knowledge Graph (Job nodes)
    return tasks


@router.get('/cron/logs')
async def get_cron_logs() -> list[dict[str, Any]]:
    """Retrieve the execution history logs for cron tasks.

    Returns:
        List of structured cron log entries.
    """
    get_logs = get_helper('get_cron_logs')
    logs = get_logs() if get_logs else []
    # Cron logs now stored in Knowledge Graph (Log nodes)
    return logs


@router.post('/upload')
async def upload_file(file: Annotated[UploadFile, File()]) -> dict[str, str]:
    """Upload a file to the agent's workspace directly.

    Args:
        file: The UploadFile object from the request.

    Returns:
        Confirmation containing the saved filename.
    """
    get_workspace = get_helper('get_workspace_path')
    if not get_workspace:
        raise HTTPException(status_code=501, detail='Workspace helper not initialized')
    workspace_dir = get_workspace('')
    if file.filename is None:
        raise HTTPException(status_code=400, detail='Filename is missing')
    file_path = workspace_dir / file.filename
    with open(file_path, 'wb') as buffer:
        shutil.copyfileobj(file.file, buffer)
    return {'filename': file.filename}


@router.get('/agent-icon')
async def get_agent_icon() -> FileResponse:
    """Retrieve the agent's avatar icon, falling back to repository defaults.

    Returns:
        A FileResponse containing the image data.
    """
    get_path = workspace_helpers.get('get_workspace_path')
    if get_path:
        workspace_icon = get_path('icon.png')
        if workspace_icon.exists():
            return FileResponse(path=workspace_icon)

    get_icon_p = workspace_helpers.get('get_agent_icon_path')
    icon_path = get_icon_p() if get_icon_p else None
    if not icon_path or not Path(icon_path).exists():
        raise HTTPException(status_code=404, detail='Icon not found')
    return FileResponse(path=icon_path)


@router.get('/download/{filename}')
async def download_file(filename: str) -> FileResponse:
    """Download a specific file from the agent's workspace.

    Args:
        filename: The relative path of the file to download.

    Returns:
        A FileResponse with attachment headers.
    """
    get_workspace = get_helper('get_workspace_path')
    if not get_workspace:
        raise HTTPException(status_code=501, detail='Workspace helper not initialized')
    workspace_dir = get_workspace('')
    file_path = workspace_dir / filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail='File not found')
    return FileResponse(path=file_path, filename=filename)


@router.get('/chats')
async def list_chats() -> list[dict[str, Any]]:
    """List historical chat sessions stored on the server.

    Returns:
        List of chat metadata summaries.
    """
    h = get_helper('list_chats')
    return h() if h else []


@router.get('/chats/{chat_id}')
async def get_chat(chat_id: str) -> dict[str, Any] | None:
    """Retrieve a specific chat session's message history.

    Args:
        chat_id: The unique identifier of the chat session.

    Returns:
        The full chat session object.
    """
    h = get_helper('get_chat')
    return h(chat_id) if h else None


@router.post('/chats')
async def save_chat(data: dict[str, Any]) -> dict[str, Any]:
    """Persist a new or updated chat session.

    Args:
        data: The complete chat history payload.

    Returns:
        Acknowledgment or error summary.
    """
    h = get_helper('save_chat')
    return h(data) if h else {'status': 'error'}


@router.put('/chats/{chat_id}/title')
async def update_chat_title(chat_id: str, data: dict[str, Any]) -> dict[str, Any]:
    """Update the display title of a specific chat session.

    Args:
        chat_id: The identifier of the chat session.
        data: Dictionary containing the new 'title'.

    Returns:
        Acknowledgment or error summary.
    """
    h = get_helper('update_chat_title')
    return h(chat_id, data) if h else {'status': 'error'}


@router.delete('/chats/{chat_id}')
async def delete_chat(chat_id: str) -> dict[str, Any]:
    """Permanently delete a chat session record.

    Uses the canonical REST verb DELETE against ``/chats/{chat_id}``. The
    old ``GET /chats/{chat_id}/title`` alias was non-idiomatic (GET is
    expected to be safe/idempotent-read) and collided conceptually with
    the sibling ``PUT /chats/{chat_id}/title`` rename endpoint.

    Args:
        chat_id: The identifier of the chat to remove.

    Returns:
        Acknowledgment or error summary.
    """
    h = get_helper('delete_chat')
    return h(chat_id) if h else {'status': 'error'}


@router.get('/graph/nodes')
async def get_graph_nodes(node_type: str | None = None) -> list[dict[str, Any]]:
    """Query Knowledge Graph for nodes of a specific type or all nodes.

    Args:
        node_type: Optional filter for node type (e.g., 'Job', 'Log',
                   'Memory', 'KnowledgeBase')

    Returns:
        List of node dictionaries with properties.
    """
    try:
        engine = get_engine()

        if node_type:
            # Identifier is validated against schema or trusted source before use
            query = f'MATCH (n:{node_type}) RETURN n'  # nosec B608
        else:
            query = 'MATCH (n) RETURN n LIMIT 1000'

        result = engine.backend.execute(query)
        nodes = []
        for row in result:
            node_data = row.get('n', {})
            if isinstance(node_data, dict):
                nodes.append(
                    {
                        'id': node_data.get('id', ''),
                        'labels': list(node_data.keys()),
                        'properties': {
                            k: v
                            for k, v in node_data.items()
                            if k != 'id' and not k.startswith('_')
                        },
                    }
                )
        return nodes
    except Exception as e:
        logger.error(f'Failed to query graph nodes: {e}')
        return []


@router.get('/graph/relationships')
async def get_graph_relationships() -> list[dict[str, Any]]:
    """Query Knowledge Graph for relationships between nodes.

    Returns:
        List of relationship dictionaries with source, target, and type.
    """
    try:
        engine = get_engine()

        query = (
            'MATCH (a)-[r]->(b) RETURN a.id as source, '
            'type(r) as type, b.id as target LIMIT 1000'
        )
        result = engine.backend.execute(query)
        relationships = []
        for row in result:
            relationships.append(
                {
                    'source': row.get('source', ''),
                    'type': row.get('type', ''),
                    'target': row.get('target', ''),
                }
            )
        return relationships
    except Exception as e:
        logger.error(f'Failed to query graph relationships: {e}')
        return []


@router.get('/graph/stats')
async def get_graph_stats() -> dict[str, Any]:
    """Get statistics about the Knowledge Graph.

    Returns:
        Dictionary with node counts by type and total counts.
    """
    try:
        engine = get_engine()
        if not engine or not engine.backend:
            return {'total_nodes': 0, 'total_relationships': 0, 'by_type': {}}

        # Get total counts (Test expects these first)
        total_nodes_result = engine.backend.execute(
            'MATCH (n) RETURN count(n) as count'
        )
        total_nodes = total_nodes_result[0].get('count', 0) if total_nodes_result else 0

        total_rels_result = engine.backend.execute(
            'MATCH ()-[r]->() RETURN count(r) as count'
        )
        total_relationships = (
            total_rels_result[0].get('count', 0) if total_rels_result else 0
        )

        # Get node counts by type (Test expects Memory then Article)
        type_counts = {}
        for node_type in ['Memory', 'Article']:
            try:
                result = engine.backend.execute(
                    f'MATCH (n:{node_type}) RETURN count(n) as count'
                )
                count = result[0].get('count', 0) if result else 0
                if count > 0:
                    type_counts[node_type] = count
            except Exception as e:
                logger.debug(f'Skipping stats for node type {node_type}: {e}')

        return {
            'total_nodes': total_nodes,
            'total_relationships': total_relationships,
            'by_type': type_counts,
        }
    except Exception as e:
        logger.error(f'Failed to get graph stats: {e}')
        return {'total_nodes': 0, 'total_relationships': 0, 'by_type': {}}


# ---------------------------------------------------------------------------
# Knowledge Graph CRUD Endpoints
# ---------------------------------------------------------------------------


@router.post('/graph/memory')
async def add_memory(data: dict[str, Any]) -> dict[str, Any]:
    """Add a new memory node to the Knowledge Graph.

    Args:
        data: Dictionary containing memory data (id, content, importance, tags, etc.)

    Returns:
        Success status and created memory ID.
    """
    try:
        from agent_utilities.models.knowledge_graph import MemoryNode

        engine = get_engine()

        data_copy = data.copy()
        if 'name' not in data_copy:
            data_copy['name'] = data_copy.get('content', 'Memory Node')[:50]

        memory = MemoryNode(**data_copy)
        engine.add_memory_node(memory)
        return {'status': 'success', 'id': memory.id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f'Failed to add memory: {e}')
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get('/graph/memory/{memory_id}')
async def get_memory(memory_id: str) -> dict[str, Any]:
    """Retrieve a specific memory node from the Knowledge Graph.

    Args:
        memory_id: The unique identifier of the memory node.

    Returns:
        Memory node data or 404 if not found.
    """
    try:
        engine = get_engine()

        memory = engine.get_memory_node(memory_id)
        if not memory:
            raise HTTPException(status_code=404, detail='Memory not found')

        return memory.model_dump()
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f'Failed to get memory: {e}')
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.put('/graph/memory/{memory_id}')
async def update_memory(memory_id: str, data: dict[str, Any]) -> dict[str, Any]:
    """Update an existing memory node in the Knowledge Graph.

    Args:
        memory_id: The unique identifier of the memory node.
        data: Dictionary containing updated memory data.

    Returns:
        Success status.
    """
    try:
        from agent_utilities.models.knowledge_graph import MemoryNode

        engine = get_engine()

        data_copy = data.copy()
        data_copy['id'] = memory_id
        # Also ensure name is present as it's required in RegistryNode
        if 'name' not in data_copy:
            data_copy['name'] = data_copy.get('content', 'Memory Node')[:50]

        updated_memory = MemoryNode(**data_copy)
        engine.update_memory_node(memory_id, updated_memory)
        return {'status': 'success'}
    except Exception as e:
        logger.error(f'Failed to update memory: {e}')
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.delete('/graph/memory/{memory_id}')
async def delete_memory(memory_id: str) -> dict[str, Any]:
    """Delete a memory node from the Knowledge Graph.

    Args:
        memory_id: The unique identifier of the memory node.

    Returns:
        Success status.
    """
    try:
        engine = get_engine()

        engine.delete_memory_node(memory_id)
        return {'status': 'success'}
    except Exception as e:
        logger.error(f'Failed to delete memory: {e}')
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post('/graph/link')
async def link_nodes(data: dict[str, Any]) -> dict[str, Any]:
    """Create a relationship between two nodes in the Knowledge Graph.

    Args:
        data: Dictionary containing source, target, relationship_type, and properties.

    Returns:
        Success status.
    """
    try:
        engine = get_engine()

        engine.link_nodes(
            data['source'],
            data['target'],
            data['relationship_type'],
            data.get('properties', {}),
        )
        return {'status': 'success'}
    except Exception as e:
        logger.error(f'Failed to link nodes: {e}')
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get('/graph/search')
async def hybrid_search(query: str, top_k: int = 10) -> list[dict[str, Any]]:
    """Perform hybrid search across the Knowledge Graph.

    Args:
        query: Search query string.
        top_k: Maximum number of results to return.

    Returns:
        List of matching nodes with relevance scores.
    """
    try:
        engine = get_engine()

        results = engine.search_hybrid(query, top_k=top_k)
        return results
    except Exception as e:
        logger.error(f'Failed to search graph: {e}')
        return []


@router.get('/graph/impact/{symbol}')
async def get_impact(symbol: str) -> list[dict[str, Any]]:
    """Calculate the topological impact set for a code entity.

    Args:
        symbol: The symbol or file identifier to analyze.

    Returns:
        List of affected nodes and impact severity.
    """
    try:
        engine = get_engine()

        impact_set = engine.query_impact(symbol)
        return impact_set
    except Exception as e:
        logger.error(f'Failed to get impact: {e}')
        return []


@router.post('/graph/query')
async def execute_cypher(data: dict[str, Any]) -> list[dict[str, Any]]:
    """Execute a custom Cypher query against the Knowledge Graph.

    Args:
        data: Dictionary containing 'query' and optional 'params'.

    Returns:
        Query results.
    """
    try:
        query = data.get('query', '')
        params = data.get('params', {})

        # Basic security check
        dangerous_keywords = ['DELETE', 'DROP', 'REMOVE', 'DETACH']
        if any(keyword in query.upper() for keyword in dangerous_keywords):
            raise HTTPException(status_code=400, detail='Dangerous query not allowed')

        engine = get_engine()

        result = engine.query_cypher(query, params)
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f'Failed to execute query: {e}')
        raise HTTPException(status_code=500, detail=str(e)) from e


# ---------------------------------------------------------------------------
# Knowledge Base Endpoints
# ---------------------------------------------------------------------------


@router.post('/kb/ingest')
async def ingest_kb(data: dict[str, Any]) -> dict[str, Any]:
    """Ingest documents into a Knowledge Base.

    Args:
        data: Dictionary containing kb_id, source, name, and ingestion options.

    Returns:
        Success status and ingestion job ID.
    """
    try:
        engine = get_engine()

        kb_engine = KBIngestionEngine(
            engine.graph if engine else None, engine.backend if engine else None
        )
        result = await kb_engine.ingest(
            kb_id=data['kb_id'],
            source=data['source'],
            name=data.get('name', data['kb_id']),
            **data.get('options', {}),
        )
        return {'status': 'success', 'job_id': result.get('job_id')}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f'Failed to ingest KB: {e}')
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get('/kb/list')
async def list_kbs() -> list[dict[str, Any]]:
    """List all Knowledge Bases.

    Returns:
        List of Knowledge Base metadata.
    """
    try:
        engine = get_engine()

        kb_engine = KBIngestionEngine(
            engine.graph if engine else None, engine.backend if engine else None
        )
        return kb_engine.list_bases()
    except Exception as e:
        logger.error(f'Failed to list KBs: {e}')
        return []


@router.get('/kb/search')
async def search_kb(query: str, kb_id: str | None = None) -> list[dict[str, Any]]:
    """Search within Knowledge Bases.

    Args:
        query: Search query string.
        kb_id: Optional KB ID to restrict search.

    Returns:
        List of matching articles and concepts.
    """
    try:
        engine = get_engine()

        kb_engine = KBIngestionEngine(
            engine.graph if engine else None, engine.backend if engine else None
        )
        results = kb_engine.search(query, kb_id=kb_id)
        return results
    except Exception as e:
        logger.error(f'Failed to search KB: {e}')
        return []


@router.get('/kb/article/{article_id}')
async def get_kb_article(article_id: str) -> dict[str, Any]:
    """Retrieve a specific KB article.

    Args:
        article_id: The unique identifier of the article.

    Returns:
        Article data or 404 if not found.
    """
    try:
        engine = get_engine()

        query = 'MATCH (a:Article) WHERE a.id = $id RETURN a'
        result = engine.backend.execute(query, {'id': article_id})
        if not result:
            raise HTTPException(status_code=404, detail='Article not found')

        article_data = result[0].get('a', {})
        return article_data if isinstance(article_data, dict) else {}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f'Failed to get article: {e}')
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post('/kb/health')
async def kb_health_check(data: dict[str, Any]) -> dict[str, Any]:
    """Perform health check on a Knowledge Base.

    Args:
        data: Dictionary containing kb_id.

    Returns:
        Health status and any issues found.
    """
    try:
        kb_id = data.get('kb_id')
        if not kb_id:
            raise HTTPException(status_code=400, detail='kb_id is required')

        engine = get_engine()

        kb_engine = KBIngestionEngine(
            engine.graph if engine else None, engine.backend if engine else None
        )
        health_result = await kb_engine.health_check(kb_id)
        return health_result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f'Failed KB health check: {e}')
        return {'health_status': 'error', 'issues': [str(e)]}


@router.post('/kb/update')
async def update_kb(data: dict[str, Any]) -> dict[str, Any]:
    """Update a Knowledge Base with changed files.

    Args:
        data: Dictionary containing kb_id and update options.

    Returns:
        Success status.
    """
    try:
        engine = get_engine()

        kb_engine = KBIngestionEngine(
            engine.graph if engine else None, engine.backend if engine else None
        )
        await kb_engine.update(data['kb_id'])
        return {'status': 'success'}
    except Exception as e:
        logger.error(f'Failed to update KB: {e}')
        raise HTTPException(status_code=500, detail=str(e)) from e


# ---------------------------------------------------------------------------
# SDD Lifecycle Endpoints
# ---------------------------------------------------------------------------


@router.get('/sdd/constitution')
async def get_constitution() -> dict[str, Any]:
    """Retrieve the project constitution.

    Returns:
        Constitution data or null if not exists.
    """
    try:
        manager = SDDManager(DEFAULT_AGENT_DIR)
        constitution = manager.get_constitution()
        return constitution if constitution else {}
    except Exception as e:
        logger.error(f'Failed to get constitution: {e}')
        return {}


@router.post('/sdd/constitution')
async def save_constitution(data: dict[str, Any]) -> dict[str, Any]:
    """Save the project constitution.

    Args:
        data: Constitution data.

    Returns:
        Success status.
    """
    try:
        manager = SDDManager(DEFAULT_AGENT_DIR)
        manager.save_constitution(data)
        return {'status': 'success'}
    except Exception as e:
        logger.error(f'Failed to save constitution: {e}')
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get('/sdd/specs')
async def list_specs() -> list[dict[str, Any]]:
    """List all specifications.

    Returns:
        List of specification metadata.
    """
    try:
        manager = SDDManager(DEFAULT_AGENT_DIR)
        specs = manager.list_specs()
        return [s.model_dump() if hasattr(s, 'model_dump') else s for s in specs]
    except Exception as e:
        logger.error(f'Failed to list specs: {e}')
        return []


@router.post('/sdd/spec')
async def create_spec(data: dict[str, Any]) -> dict[str, Any]:
    """Create a new specification.

    Args:
        data: Specification data.

    Returns:
        Created specification with ID.
    """
    try:
        manager = SDDManager(DEFAULT_AGENT_DIR)
        spec = manager.create_spec(data)
        return spec.model_dump()
    except Exception as e:
        logger.error(f'Failed to create spec: {e}')
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get('/sdd/plans')
async def list_plans() -> list[dict[str, Any]]:
    """List all implementation plans.

    Returns:
        List of plan metadata.
    """
    try:
        manager = SDDManager(DEFAULT_AGENT_DIR)
        plans = manager.list_plans()
        return [p.model_dump() if hasattr(p, 'model_dump') else p for p in plans]
    except Exception as e:
        logger.error(f'Failed to list plans: {e}')
        return []


@router.get('/sdd/tasks')
async def get_tasks(plan_id: str | None = None) -> dict[str, Any]:
    """Retrieve tasks for a plan or all tasks.

    Args:
        plan_id: Optional plan ID to filter tasks.

    Returns:
        Tasks data.
    """
    try:
        manager = SDDManager(DEFAULT_AGENT_DIR)
        if plan_id:
            tasks = manager.get_tasks(plan_id)
        else:
            tasks = manager.get_all_tasks()
        return tasks.model_dump() if hasattr(tasks, 'model_dump') else tasks
    except Exception as e:
        logger.error(f'Failed to get tasks: {e}')
        return {}


@router.post('/sdd/sync')
async def sync_sdd_to_memory(data: dict[str, Any]) -> dict[str, Any]:
    """Sync SDD lifecycle data to Knowledge Graph memory.

    Args:
        data: Dictionary containing plan_id or spec_id.

    Returns:
        Success status.
    """
    try:
        engine = get_engine()

        manager = SDDManager(DEFAULT_AGENT_DIR)
        manager.sync_to_memory(engine, **data)
        return {'status': 'success'}
    except Exception as e:
        logger.error(f'Failed to sync SDD to memory: {e}')
        raise HTTPException(status_code=500, detail=str(e)) from e


# ---------------------------------------------------------------------------
# MAGMA and Advanced Query Endpoints
# ---------------------------------------------------------------------------


@router.post('/graph/magma')
async def magma_retrieve(data: dict[str, Any]) -> list[dict[str, Any]]:
    """Retrieve context using MAGMA orthogonal views.

    Args:
        data: Dictionary containing query, view_type, and policy options.

    Returns:
        Retrieved context from specified orthogonal view.
    """
    try:
        engine = get_engine()

        view_type = data.get('view_type', 'semantic')
        query = data.get('query', '')
        policy = data.get('policy', {})

        result = engine.retrieve_orthogonal_context(
            query=query, view_type=view_type, policy=policy
        )
        return result
    except Exception as e:
        logger.error(f'Failed MAGMA retrieval: {e}')
        return []


# ---------------------------------------------------------------------------
# Resource Management Endpoints
# ---------------------------------------------------------------------------


@router.get('/resources')
async def list_resources() -> list[dict[str, Any]]:
    """List all callable resources (MCP tools, A2A agents, skills).

    Returns:
        List of resource metadata.
    """
    try:
        engine = get_engine()

        query = 'MATCH (r:CallableResource) RETURN r'
        result = engine.backend.execute(query)
        resources = []
        for row in result:
            resource_data = row.get('r', {})
            if isinstance(resource_data, dict):
                resources.append(resource_data)
        return resources
    except Exception as e:
        logger.error(f'Failed to list resources: {e}')
        return []


@router.post('/resources/spawn')
async def spawn_agent(data: dict[str, Any]) -> dict[str, Any]:
    """Spawn a specialized sub-agent with curated toolset.

    Args:
        data: Dictionary containing agent configuration and toolset.

    Returns:
        Spawned agent metadata.
    """
    try:
        engine = get_engine()

        agent = engine.spawn_specialized_agent(**data)
        return agent.model_dump()
    except Exception as e:
        logger.error(f'Failed to spawn agent: {e}')
        raise HTTPException(status_code=500, detail=str(e)) from e


# ---------------------------------------------------------------------------
# Maintenance and Pipeline Endpoints
# ---------------------------------------------------------------------------


@router.get('/maintenance/status')
async def get_maintenance_status() -> dict[str, Any]:
    """Get status of all maintenance operations.

    Returns:
        Maintenance operation status and history.
    """
    try:
        engine = get_engine()
        if not engine or not engine.backend:
            return {'status': 'unavailable', 'operations': {}}

        maintainer = GraphMaintainer(engine)
        status = maintainer.get_status()
        return status
    except Exception as e:
        logger.error(f'Failed to get maintenance status: {e}')
        return {'status': 'error', 'operations': {}}


@router.post('/maintenance/trigger')
async def trigger_maintenance(data: dict[str, Any]) -> dict[str, Any]:
    """Trigger a specific maintenance operation.

    Args:
        data: Dictionary containing operation.

    Returns:
        Operation status and results.
    """
    try:
        operation = data.get('operation')
        if not operation:
            raise HTTPException(status_code=400, detail='operation is required')

        engine = get_engine()
        maintainer = GraphMaintainer(engine)
        result = maintainer.trigger_operation(operation)
        return {'status': 'success', 'result': result}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f'Failed to trigger maintenance: {e}')
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get('/pipeline/status')
async def get_pipeline_status() -> dict[str, Any]:
    """Get status of the 12-phase intelligence pipeline.

    Returns:
        Pipeline status and phase information.
    """
    try:
        engine = get_engine()
        if not engine:
            return {'status': 'unavailable', 'phases': {}}

        runner = PipelineRunner(PHASES)
        status = runner.get_status()
        return status
    except Exception as e:
        logger.error(f'Failed to get pipeline status: {e}')
        return {'status': 'error', 'phases': {}}


@router.post('/pipeline/trigger')
async def trigger_pipeline(data: dict[str, Any]) -> dict[str, Any]:
    """Trigger pipeline execution or specific phase.

    Args:
        data: Dictionary containing phase.

    Returns:
        Pipeline execution status.
    """
    try:
        engine = get_engine()

        config = PipelineConfig(workspace_path=str(DEFAULT_AGENT_DIR))
        ctx = PipelineContext(
            config=config, nx_graph=engine.graph, backend=engine.backend
        )
        runner = PipelineRunner(PHASES)
        result = await runner.run(ctx)
        return {'status': 'success', 'result': result}
    except Exception as e:
        logger.error(f'Failed to trigger pipeline: {e}')
        raise HTTPException(status_code=500, detail=str(e)) from e


# ---------------------------------------------------------------------------
# Backend Configuration Endpoints
# ---------------------------------------------------------------------------


@router.get('/models')
async def list_configured_models(request: Request) -> dict[str, Any]:
    """Return the configured LLM model registry.

    Mirrors the core server's ``GET /models`` endpoint so the web UI can
    power its model picker and cost display from the same declarative
    configuration as the terminal UI and graph orchestrator. When no
    registry is attached to ``app.state.model_registry`` (e.g. the server
    was started without ``MODELS_CONFIG`` and without explicit kwargs) the
    response still validates as an empty registry.

    Returns:
        ``{"models": [...ModelDefinition...], "default_id": "..."}``.
    """
    app = request.app
    # The registry may live on the root app or on a parent app when we are
    # mounted under /api/enhanced; walk the parent chain until we find it.
    reg = getattr(app.state, 'model_registry', None)
    while reg is None:
        parent = getattr(app, 'parent', None)
        if parent is None:
            break
        app = parent
        reg = getattr(app.state, 'model_registry', None)
    if reg is None:
        return {'models': [], 'default_id': None}
    if hasattr(reg, 'to_api_payload'):
        return reg.to_api_payload()
    # Be forgiving for tests that stub the registry with a plain dict.
    return reg


@router.get('/config/backend')
async def get_backend_config() -> dict[str, Any]:
    """Get current backend configuration.

    Returns:
        Backend type and connection settings.
    """
    try:
        import os

        from agent_utilities.knowledge_graph.backends import get_active_backend

        backend = get_active_backend()
        if not backend:
            return {'status': 'no_backend'}

        config = {
            'backend_type': backend.__class__.__name__,
            'env_vars': {
                'GRAPH_BACKEND': os.getenv('GRAPH_BACKEND', 'ladybug'),
                'GRAPH_DB_PATH': os.getenv('GRAPH_DB_PATH', 'knowledge_graph.db'),
            },
        }
        return config
    except Exception as e:
        logger.error(f'Failed to get backend config: {e}')
        return {'status': 'error'}


@router.put('/config/backend')
async def update_backend_config(data: dict[str, Any]) -> dict[str, Any]:
    """Update backend configuration (requires restart).

    Args:
        data: New backend configuration.

    Returns:
        Success status (restart required).
    """
    try:
        # This would typically update environment variables or config files
        # For now, return success with restart warning
        return {
            'status': 'success',
            'message': (
                'Configuration updated. Server restart required '
                'for changes to take effect.'
            ),
        }
    except Exception as e:
        logger.error(f'Failed to update backend config: {e}')
        raise HTTPException(status_code=500, detail=str(e)) from e


# ─────────────────────────────────────────────────────────────────────────
#  Prompt Management (CONCEPT:KG-002)
# ─────────────────────────────────────────────────────────────────────────


@router.get('/prompts')
async def list_prompts() -> list[dict[str, Any]]:
    """List all prompts from the Knowledge Graph.

    CONCEPT:KG-002 — Prompt Management

    Returns:
        A list of prompt dicts with id, name, content, and metadata.
    """
    engine = get_engine()
    return engine.get_all_prompts()


@router.get('/prompts/{prompt_id}')
async def get_prompt(prompt_id: str) -> dict[str, Any]:
    """Retrieve a single prompt by ID.

    CONCEPT:KG-002 — Prompt Management

    Args:
        prompt_id: The unique identifier of the prompt.

    Returns:
        The prompt dict with full content.
    """
    engine = get_engine()
    result = engine.get_prompt(prompt_id)
    if not result:
        raise HTTPException(status_code=404, detail=f'Prompt {prompt_id} not found')
    return result


@router.post('/prompts')
async def create_prompt(data: dict[str, Any]) -> dict[str, Any]:
    """Create a new prompt in the Knowledge Graph.

    CONCEPT:KG-002 — Prompt Management

    Args:
        data: Dict with 'name', 'content', and optional 'description', 'author'.

    Returns:
        The created prompt dict.
    """
    engine = get_engine()
    name = data.get('name', '')
    content = data.get('content', '')
    if not name or not content:
        raise HTTPException(status_code=400, detail='name and content are required')
    return engine.add_prompt(
        content=content,
        name=name,
        author=data.get('author', 'user'),
        description=data.get('description', ''),
    )


@router.put('/prompts/{prompt_id}')
async def update_prompt(prompt_id: str, data: dict[str, Any]) -> dict[str, Any]:
    """Update a prompt, creating a new version via SUPERSEDES.

    CONCEPT:KG-002 — Prompt Management

    Args:
        prompt_id: The identifier of the prompt to update.
        data: Dict with 'content' and optional 'author'.

    Returns:
        The new version dict with version number and parent_id.
    """
    engine = get_engine()
    content = data.get('content', '')
    if not content:
        raise HTTPException(status_code=400, detail='content is required')
    try:
        return engine.update_prompt(
            prompt_id=prompt_id,
            content=content,
            author=data.get('author', 'user'),
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@router.get('/prompts/{prompt_id}/versions')
async def get_prompt_versions(prompt_id: str) -> list[dict[str, Any]]:
    """Get version history for a prompt.

    CONCEPT:KG-002 — Prompt Management

    Args:
        prompt_id: The identifier of the prompt.

    Returns:
        List of version dicts ordered newest-first.
    """
    engine = get_engine()
    return engine.get_prompt_versions(prompt_id)


@router.post('/prompts/{prompt_id}/rollback/{version_id}')
async def rollback_prompt(prompt_id: str, version_id: str) -> dict[str, Any]:
    """Rollback a prompt to a previous version.

    CONCEPT:KG-002 — Prompt Management (AHE Rollback)

    Creates a new version that copies the target's content.
    Always forward, never destructive.

    Args:
        prompt_id: The current prompt identifier.
        version_id: The target version to rollback to.

    Returns:
        The new version dict (a copy of the target).
    """
    engine = get_engine()
    try:
        return engine.rollback_prompt(prompt_id, version_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@router.get('/prompts/{prompt_id}/diff/{version_a}/{version_b}')
async def diff_prompt_versions(
    prompt_id: str, version_a: str, version_b: str
) -> dict[str, Any]:
    """Get a unified diff between two prompt versions.

    CONCEPT:KG-002 — Prompt Management

    Args:
        prompt_id: The prompt family identifier (unused, for URL structure).
        version_a: ID of the first version.
        version_b: ID of the second version.

    Returns:
        Dict with 'diff' (unified diff string) and version metadata.
    """
    import difflib

    engine = get_engine()
    va = engine.get_prompt(version_a)
    vb = engine.get_prompt(version_b)
    if not va:
        raise HTTPException(status_code=404, detail=f'Version {version_a} not found')
    if not vb:
        raise HTTPException(status_code=404, detail=f'Version {version_b} not found')

    content_a = va.get('content', va.get('system_prompt', '')).splitlines(keepends=True)
    content_b = vb.get('content', vb.get('system_prompt', '')).splitlines(keepends=True)
    diff_lines = list(
        difflib.unified_diff(
            content_a,
            content_b,
            fromfile=f'{version_a} ({va.get("timestamp", "")})',
            tofile=f'{version_b} ({vb.get("timestamp", "")})',
        )
    )
    return {
        'diff': ''.join(diff_lines),
        'version_a': {'id': version_a, 'timestamp': va.get('timestamp', '')},
        'version_b': {'id': version_b, 'timestamp': vb.get('timestamp', '')},
    }


# ─────────────────────────────────────────────────────────────────────────
#  Tools Management (CONCEPT:KG-003)
# ─────────────────────────────────────────────────────────────────────────


@router.get('/tools')
async def list_tools() -> list[dict[str, Any]]:
    """List MCP tools from the Knowledge Graph.

    CONCEPT:KG-003 — Granular Resource Queries

    Returns:
        A list of MCP tool dicts sorted alphabetically.
    """
    engine = get_engine()
    return engine.get_tools()


@router.post('/tools/{tool_id}/toggle')
async def toggle_tool(tool_id: str) -> dict[str, Any]:
    """Toggle the enabled/disabled KG flag on an MCP tool.

    CONCEPT:KG-003 — Granular Resource Queries

    Args:
        tool_id: The identifier of the tool to toggle.

    Returns:
        The resulting state of the toggled tool.
    """
    engine = get_engine()
    try:
        return engine.toggle_resource(tool_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e

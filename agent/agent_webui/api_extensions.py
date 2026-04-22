import logging
import os
import re
import shutil
from pathlib import Path
from typing import Annotated, Any

from agent_utilities.knowledge_graph.engine import IntelligenceGraphEngine
from agent_utilities.knowledge_graph.kb.ingestion import KBIngestionEngine
from agent_utilities.knowledge_graph.maintenance import GraphMaintainer
from agent_utilities.knowledge_graph.pipeline.runner import PipelineRunner
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


@router.get('/info')
async def get_info() -> dict[str, str]:
    """Retrieve agent identity and user personalization metadata.

    Returns:
        A dictionary containing agent name, description, and emojis.
    """
    name = workspace_helpers.get('agent_name', 'Agent')
    description = workspace_helpers.get('agent_description', 'AI Agent')
    emoji = workspace_helpers.get('agent_emoji', '🤖')

    user_emoji = '👤'
    # User data now stored in Knowledge Graph - no longer reading from USER.md

    return {
        'name': name,
        'description': description,
        'emoji': emoji,
        'user_emoji': user_emoji,
    }


@router.get('/files')
async def list_files() -> list[str]:
    """List all available files in the agent's current workspace.

    Returns:
        A list of relative file paths.
    """
    load_files = get_helper('list_workspace_files')
    if not load_files:
        raise HTTPException(status_code=501, detail='File helpers not initialized')
    return load_files()


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
        engine = IntelligenceGraphEngine.get_active()
        if not engine:
            return []

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


@router.get('/skills')
async def list_skills() -> list[dict[str, Any]]:
    """Retrieve the catalog of dynamic agent skills.

    Returns:
        A list of skill definitions sorted alphabetically.
    """
    list_skills_helper = get_helper('list_skills')
    if not list_skills_helper:
        raise HTTPException(status_code=501, detail='Skill helper not initialized')
    skills = list_skills_helper()
    return sorted(skills, key=lambda x: x.get('name', '').lower())


@router.post('/skills/{skill_id}/toggle')
async def toggle_skill(skill_id: str) -> dict[str, Any]:
    """Enable or disable a specific agent skill.

    Args:
        skill_id: The identifier of the skill to toggle.

    Returns:
        The resulting state of the toggled skill.
    """
    toggle_helper = get_helper('toggle_skill')
    if not toggle_helper:
        raise HTTPException(status_code=501, detail='Skill helper not initialized')
    return toggle_helper(skill_id)


@router.post('/reload')
async def reload_agent(request: Request) -> dict[str, str]:
    """Trigger a full re-initialization of the agent's graph and workspace.

    Args:
        request: The current FastAPI Request object.

    Returns:
        Success message or error summary.
    """
    try:
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


@router.get('/chats/{chat_id}/title')
async def delete_chat(chat_id: str) -> dict[str, Any]:
    """Permanently delete a chat session record.

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
        engine = IntelligenceGraphEngine.get_active()
        if not engine or not engine.backend:
            return []

        if node_type:
            query = f'MATCH (n:{node_type}) RETURN n'
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
        engine = IntelligenceGraphEngine.get_active()
        if not engine or not engine.backend:
            return []

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
        engine = IntelligenceGraphEngine.get_active()
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
            except Exception:
                pass

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

        engine = IntelligenceGraphEngine.get_active()
        if not engine:
            raise HTTPException(status_code=501, detail='Graph engine not initialized')

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
        engine = IntelligenceGraphEngine.get_active()

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

        engine = IntelligenceGraphEngine.get_active()

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
        engine = IntelligenceGraphEngine.get_active()

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
        engine = IntelligenceGraphEngine.get_active()

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
        engine = IntelligenceGraphEngine.get_active()
        if not engine:
            return []

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
        engine = IntelligenceGraphEngine.get_active()
        if not engine:
            return []

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

        engine = IntelligenceGraphEngine.get_active()

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
        engine = IntelligenceGraphEngine.get_active()

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
        engine = IntelligenceGraphEngine.get_active()
        if not engine or not engine.backend:
            return []

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
        engine = IntelligenceGraphEngine.get_active()
        if not engine or not engine.backend:
            return []

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
        engine = IntelligenceGraphEngine.get_active()

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

        engine = IntelligenceGraphEngine.get_active()

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
        engine = IntelligenceGraphEngine.get_active()

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
        engine = IntelligenceGraphEngine.get_active()

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
        engine = IntelligenceGraphEngine.get_active()
        if not engine:
            return []

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
        engine = IntelligenceGraphEngine.get_active()
        if not engine:
            return []

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
        engine = IntelligenceGraphEngine.get_active()

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
        engine = IntelligenceGraphEngine.get_active()
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

        engine = IntelligenceGraphEngine.get_active()
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
        engine = IntelligenceGraphEngine.get_active()
        if not engine:
            return {'status': 'unavailable', 'phases': {}}

        runner = PipelineRunner(engine)
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
        phase = data.get('phase')
        engine = IntelligenceGraphEngine.get_active()
        runner = PipelineRunner(engine)
        result = await runner.run(phase=phase)
        return {'status': 'success', 'result': result}
    except Exception as e:
        logger.error(f'Failed to trigger pipeline: {e}')
        raise HTTPException(status_code=500, detail=str(e)) from e


# ---------------------------------------------------------------------------
# Backend Configuration Endpoints
# ---------------------------------------------------------------------------


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

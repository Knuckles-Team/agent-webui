#!/usr/bin/python
# coding: utf-8
"""
Enhanced API Extensions for Agent WebUI.

This module defines specialized FastAPI routes for workspace management,
file operations (upload/download), cron task monitoring, and chat persistence.
It uses a registration-based helper system to interact with the underlying
agent's workspace.
"""

from __future__ import annotations

import logging
import re
import shutil
from pathlib import Path
from typing import Any, Dict, List

from fastapi import APIRouter, Request, UploadFile, File, HTTPException
from fastapi.responses import FileResponse

from agent_utilities.agent_utilities import get_agent_workspace

logger = logging.getLogger(__name__)

router = APIRouter(prefix='/api/enhanced')
AGENT_WORKSPACE = get_agent_workspace()
DEFAULT_AGENT_DIR = Path(__file__).parent / 'agent'

# GLOBAL: Registry for workspace implementation helpers
workspace_helpers: Dict[str, Any] = {}


def get_helper(name: str, fallback: Any = None) -> Any:
    """Retrieve a registered workspace helper by name.

    Args:
        name: The identifier of the helper function.
        fallback: Value to return if the helper is not registered.

    Returns:
        The matched helper function or the fallback value.
    """
    helper = workspace_helpers.get(name)
    if not helper:
        logger.warning(
            f"Helper '{name}' not found in workspace_helpers. Available: {list(workspace_helpers.keys())}"
        )
        return fallback
    return helper


def set_workspace_helpers(helpers: Dict[str, Any]) -> None:
    """Register the operational helpers for the current workspace context.

    Args:
        helpers: Mapping of helper names to implementation functions.
    """
    global workspace_helpers
    logger.info(f'Setting workspace helpers. Keys: {list(helpers.keys())}')
    workspace_helpers = helpers


@router.get('/info')
async def get_info() -> Dict[str, str]:
    """Retrieve agent identity and user personalization metadata.

    Returns:
        A dictionary containing agent name, description, and emojis.
    """
    name = workspace_helpers.get('agent_name', 'Agent')
    description = workspace_helpers.get('agent_description', 'AI Agent')
    emoji = workspace_helpers.get('agent_emoji', '🤖')

    user_emoji = '👤'
    try:
        content = workspace_helpers['load_workspace_file']('USER.md')
        match = re.search(r'\* \*\*Emoji:\*\* (.*)', content)
        if match:
            user_emoji = match.group(1).strip()
    except Exception:
        pass

    return {
        'name': name,
        'description': description,
        'emoji': emoji,
        'user_emoji': user_emoji,
    }


@router.get('/files')
async def list_files() -> List[str]:
    """List all available files in the agent's current workspace.

    Returns:
        A list of relative file paths.
    """
    load_files = get_helper('list_workspace_files')
    if not load_files:
        raise HTTPException(status_code=501, detail='File helpers not initialized')
    return load_files()


@router.get('/files/{filename}')
async def get_file(filename: str) -> Dict[str, str]:
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
async def list_config_files() -> List[str]:
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


@router.put('/files/{filename}')
async def update_file(filename: str, data: Dict[str, str]) -> Dict[str, str]:
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
async def list_skills() -> List[Dict[str, Any]]:
    """Retrieve the catalog of dynamic agent skills.

    Returns:
        A list of skill definitions sorted alphabetically.
    """
    skills = workspace_helpers['list_skills']()
    return sorted(skills, key=lambda x: x.get('name', '').lower())


@router.post('/skills/{skill_id}/toggle')
async def toggle_skill(skill_id: str) -> Dict[str, Any]:
    """Enable or disable a specific agent skill.

    Args:
        skill_id: The identifier of the skill to toggle.

    Returns:
        The resulting state of the toggled skill.
    """
    return workspace_helpers['toggle_skill'](skill_id)


@router.post('/reload')
async def reload_agent(request: Request) -> Dict[str, str]:
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
        raise HTTPException(status_code=500, detail=str(e))


def parse_cron_table(content: str) -> List[Dict[str, Any]]:
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


def parse_cron_logs(content: str) -> List[Dict[str, Any]]:
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
async def get_cron_calendar() -> List[Dict[str, Any]]:
    """Retrieve the scheduled cron task calendar.

    Returns:
        List of structured cron tasks.
    """
    get_cal = get_helper('get_cron_calendar')
    tasks = get_cal() if get_cal else []
    if not tasks:
        cron_path = DEFAULT_AGENT_DIR / 'CRON.md'
        if cron_path.exists():
            tasks = parse_cron_table(cron_path.read_text(encoding='utf-8'))
    return tasks


@router.get('/cron/logs')
async def get_cron_logs() -> List[Dict[str, Any]]:
    """Retrieve the execution history logs for cron tasks.

    Returns:
        List of structured cron log entries.
    """
    get_logs = get_helper('get_cron_logs')
    logs = get_logs() if get_logs else []

    if not logs:
        log_path = DEFAULT_AGENT_DIR / 'CRON_LOG.md'
        if log_path.exists():
            logs = parse_cron_logs(log_path.read_text(encoding='utf-8'))
    return logs


@router.post('/upload')
async def upload_file(file: UploadFile = File(...)) -> Dict[str, str]:
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
async def list_chats() -> List[Dict[str, Any]]:
    """List historical chat sessions stored on the server.

    Returns:
        List of chat metadata summaries.
    """
    h = get_helper('list_chats')
    return h() if h else []


@router.get('/chats/{chat_id}')
async def get_chat(chat_id: str) -> Dict[str, Any] | None:
    """Retrieve a specific chat session's message history.

    Args:
        chat_id: The unique identifier of the chat session.

    Returns:
        The full chat session object.
    """
    h = get_helper('get_chat')
    return h(chat_id) if h else None


@router.post('/chats')
async def save_chat(data: Dict[str, Any]) -> Dict[str, Any]:
    """Persist a new or updated chat session.

    Args:
        data: The complete chat history payload.

    Returns:
        Acknowledgment or error summary.
    """
    h = get_helper('save_chat')
    return h(data) if h else {'status': 'error'}


@router.put('/chats/{chat_id}/title')
async def update_chat_title(chat_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
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
async def delete_chat(chat_id: str) -> Dict[str, Any]:
    """Permanently delete a chat session record.

    Args:
        chat_id: The identifier of the chat to remove.

    Returns:
        Acknowledgment or error summary.
    """
    h = get_helper('delete_chat')
    return h(chat_id) if h else {'status': 'error'}

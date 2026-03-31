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


workspace_helpers: Dict[str, Any] = {}


def get_helper(name: str, fallback: Any = None):
    helper = workspace_helpers.get(name)
    if not helper:
        logger.warning(
            f"Helper '{name}' not found in workspace_helpers. Available: {list(workspace_helpers.keys())}"
        )
        return fallback
    return helper


def set_workspace_helpers(helpers: Dict[str, Any]):
    global workspace_helpers
    logger.info(f'Setting workspace helpers. Keys: {list(helpers.keys())}')
    workspace_helpers = helpers


@router.get('/info')
async def get_info():
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
async def list_files():
    load_files = get_helper('list_workspace_files')
    if not load_files:
        raise HTTPException(status_code=501, detail='File helpers not initialized')
    return load_files()


@router.get('/files/{filename}')
async def get_file(filename: str):

    load_file = get_helper('load_workspace_file')
    content = load_file(filename) if load_file else ''

    if not content and DEFAULT_AGENT_DIR.joinpath(filename).exists():
        content = DEFAULT_AGENT_DIR.joinpath(filename).read_text(encoding='utf-8')

    return {'content': content}


@router.get('/config-files')
async def list_config_files():

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
async def update_file(filename: str, data: Dict[str, str]):
    if not filename.endswith('.md') and not filename.endswith('.json'):
        raise HTTPException(status_code=400, detail='Only .md and .json files allowed')
    write_helper = get_helper('write_md_file')
    if not write_helper:
        raise HTTPException(status_code=501, detail='Write helper not initialized')
    write_helper(filename, data.get('content', ''))
    return {'status': 'success'}


@router.get('/skills')
async def list_skills():
    skills = workspace_helpers['list_skills']()
    return sorted(skills, key=lambda x: x.get('name', '').lower())


@router.post('/skills/{skill_id}/toggle')
async def toggle_skill(skill_id: str):
    return workspace_helpers['toggle_skill'](skill_id)


@router.post('/reload')
async def reload_agent(request: Request):
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
async def get_cron_calendar():
    get_cal = get_helper('get_cron_calendar')
    tasks = get_cal() if get_cal else []
    if not tasks:
        cron_path = DEFAULT_AGENT_DIR / 'CRON.md'
        if cron_path.exists():
            tasks = parse_cron_table(cron_path.read_text(encoding='utf-8'))
    return tasks


@router.get('/cron/logs')
async def get_cron_logs():
    get_logs = get_helper('get_cron_logs')
    logs = get_logs() if get_logs else []

    if not logs:
        log_path = DEFAULT_AGENT_DIR / 'CRON_LOG.md'
        if log_path.exists():
            logs = parse_cron_logs(log_path.read_text(encoding='utf-8'))
    return logs


@router.post('/upload')
async def upload_file(file: UploadFile = File(...)):
    get_workspace = get_helper('get_workspace_path')
    if not get_workspace:
        raise HTTPException(status_code=501, detail='Workspace helper not initialized')
    workspace_dir = get_workspace('')
    file_path = workspace_dir / file.filename
    with open(file_path, 'wb') as buffer:
        shutil.copyfileobj(file.file, buffer)
    return {'filename': file.filename}


@router.get('/agent-icon')
async def get_agent_icon():

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
async def download_file(filename: str):
    get_workspace = get_helper('get_workspace_path')
    if not get_workspace:
        raise HTTPException(status_code=501, detail='Workspace helper not initialized')
    workspace_dir = get_workspace('')
    file_path = workspace_dir / filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail='File not found')
    return FileResponse(path=file_path, filename=filename)


@router.get('/chats')
async def list_chats():
    h = get_helper('list_chats')
    return h() if h else []


@router.get('/chats/{chat_id}')
async def get_chat(chat_id: str):
    h = get_helper('get_chat')
    return h(chat_id) if h else None


@router.post('/chats')
async def save_chat(data: Dict[str, Any]):
    h = get_helper('save_chat')
    return h(data) if h else {'status': 'error'}


@router.put('/chats/{chat_id}/title')
async def update_chat_title(chat_id: str, data: Dict[str, Any]):
    h = get_helper('update_chat_title')
    return h(chat_id, data) if h else {'status': 'error'}


@router.delete('/chats/{chat_id}')
async def delete_chat(chat_id: str):
    h = get_helper('delete_chat')
    return h(chat_id) if h else {'status': 'error'}

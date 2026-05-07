import React, { useState, useEffect } from 'react';
import type { GraphNode } from './GraphAdapter';

interface GraphOverlayUIProps {
  selectedNode: GraphNode | null;
  onClose: () => void;
  onSave: (properties: any) => void;
  onDelete: () => void;
  onAddNode: (labels: string[], properties: any) => void;
}

export const GraphOverlayUI: React.FC<GraphOverlayUIProps> = ({
  selectedNode,
  onClose,
  onSave,
  onDelete,
  onAddNode,
}) => {
  const [isAdding, setIsAdding] = useState(false);
  const [editName, setEditName] = useState('');
  const [editLabel, setEditLabel] = useState('KnowledgeBase');

  useEffect(() => {
    if (selectedNode) {
      setEditName(selectedNode.properties.name || selectedNode.id);
      setEditLabel(selectedNode.labels[0] || 'KnowledgeBase');
      setIsAdding(false);
    }
  }, [selectedNode]);

  if (!selectedNode && !isAdding) {
    return (
      <div className="absolute top-4 left-4 z-50">
        <button
          onClick={() => {
            setIsAdding(true);
            setEditName('New Node');
            setEditLabel('KnowledgeBase');
          }}
          className="bg-blue-600 text-white px-4 py-2 rounded shadow hover:bg-blue-500"
        >
          + Add Node
        </button>
      </div>
    );
  }

  return (
    <div className="absolute top-4 left-4 w-80 bg-slate-800 text-slate-200 border border-slate-700 rounded-lg shadow-xl p-4 flex flex-col gap-4 z-50">
      <div className="flex justify-between items-center border-b border-slate-700 pb-2">
        <h3 className="font-semibold text-lg">
          {isAdding ? 'Add Node' : 'Edit Node'}
        </h3>
        <button onClick={() => { onClose(); setIsAdding(false); }} className="text-slate-400 hover:text-white">
          ✕
        </button>
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-xs text-slate-400 uppercase tracking-wider">Node Type (Label)</label>
        <select
          value={editLabel}
          onChange={(e) => setEditLabel(e.target.value)}
          disabled={!isAdding}
          className="bg-slate-900 border border-slate-700 rounded px-3 py-2 disabled:opacity-50"
        >
          <option value="KnowledgeBase">KnowledgeBase</option>
          <option value="Folder">Folder</option>
          <option value="File">File</option>
          <option value="Project">Project</option>
          <option value="KBConcept">KBConcept</option>
          <option value="Person">Person</option>
          <option value="User">User</option>
          <option value="Memory">Memory</option>
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-xs text-slate-400 uppercase tracking-wider">Name</label>
        <input
          type="text"
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white"
        />
      </div>

      <div className="flex justify-between pt-4 mt-2 border-t border-slate-700">
        {!isAdding && (
          <button
            onClick={onDelete}
            className="text-red-400 hover:text-red-300 px-3 py-1.5 rounded hover:bg-red-900/30"
          >
            Delete
          </button>
        )}
        <div className="flex gap-2 ml-auto">
          <button
            onClick={() => { onClose(); setIsAdding(false); }}
            className="text-slate-400 hover:text-white px-3 py-1.5"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              if (isAdding) {
                onAddNode([editLabel], { name: editName });
                setIsAdding(false);
              } else {
                onSave({ name: editName });
              }
            }}
            className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-1.5 rounded"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
};

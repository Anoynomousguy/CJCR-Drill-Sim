import { useDraggable } from '@dnd-kit/core';
import { useMemo, useState } from 'react';
import { DISCIPLINE_LABEL, MOVEMENTS, type MoveDef } from '../engine/movements';
import type { Discipline } from '../engine/types';
import { useStore } from '../state/store';

const ORDER: Discipline[] = ['foot', 'rifle', 'colour'];

export function Library() {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | Discipline>('all');
  const addMovement = useStore((s) => s.addMovement);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = MOVEMENTS.filter((m) => {
      if (filter !== 'all' && m.discipline !== filter) return false;
      if (!q) return true;
      return (
        m.title.toLowerCase().includes(q) ||
        m.words.toLowerCase().includes(q) ||
        m.reference.toLowerCase().includes(q)
      );
    });
    return ORDER.map((discipline) => ({
      discipline,
      items: matches.filter((m) => m.discipline === discipline),
    })).filter((g) => g.items.length);
  }, [query, filter]);

  return (
    <aside className="panel library">
      <div className="panel-head">
        <h2>Movement library</h2>
        <span className="muted small">{MOVEMENTS.length} drill movements</span>
      </div>
      <div className="library-controls">
        <input
          className="search"
          placeholder="Search movements, commands…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="chips">
          <button className={filter === 'all' ? 'chip on' : 'chip'} onClick={() => setFilter('all')}>
            All
          </button>
          {ORDER.map((d) => (
            <button
              key={d}
              className={filter === d ? 'chip on' : 'chip'}
              onClick={() => setFilter(d)}
            >
              {d === 'foot' ? 'Foot' : d === 'rifle' ? 'Rifle' : 'Colour'}
            </button>
          ))}
        </div>
      </div>
      <div className="library-list">
        {groups.map((group) => (
          <div key={group.discipline} className="library-group">
            <div className="group-title">{DISCIPLINE_LABEL[group.discipline]}</div>
            {group.items.map((def) => (
              <LibraryItem key={def.type} def={def} onAdd={() => addMovement(def.type)} />
            ))}
          </div>
        ))}
        {!groups.length && <p className="muted small pad">No movements match that search.</p>}
      </div>
      <p className="library-hint">Drag a movement into the programme, or click to add it to the end.</p>
    </aside>
  );
}

function LibraryItem({ def, onAdd }: { def: MoveDef; onAdd: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `lib:${def.type}` });
  return (
    <button
      ref={setNodeRef}
      className={`library-item${isDragging ? ' dragging' : ''}`}
      onClick={onAdd}
      {...attributes}
      {...listeners}
      title={def.help}
    >
      <span className="library-item-title">{def.title}</span>
      <span className="library-item-words">{def.words}</span>
    </button>
  );
}

import React, { useEffect, useState } from 'react';
import { Sidebar } from './components/layout/Sidebar.tsx';
import { TaskPanel } from './components/task/TaskPanel.tsx';
import { Settings } from './components/settings/Settings.tsx';
import { useTaskStore } from './store/useTaskStore.ts';
import { useSettingsStore } from './store/useSettingsStore.ts';

export default function App() {
  const [showSettings, setShowSettings] = useState(false);
  const { tasks, selectedTaskId, loading, fetchTasks } = useTaskStore();
  const { fetchSettings } = useSettingsStore();

  useEffect(() => {
    fetchTasks();
    fetchSettings();
  }, []);

  const selectedTask = tasks.find((t) => t.id === selectedTaskId);

  return (
    <div className="flex h-screen overflow-hidden bg-[#1e1e2e] font-mono">
      <Sidebar onOpenSettings={() => setShowSettings(true)} />

      <main className="flex-1 overflow-hidden flex flex-col">
        {loading ? (
          <div className="flex-1 flex items-center justify-center text-[#6c7086] text-xs">
            Loading tasks…
          </div>
        ) : selectedTask ? (
          <TaskPanel key={selectedTask.id} task={selectedTask} />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-[#6c7086] text-xs gap-2">
            <span className="text-3xl">🤖</span>
            <p>Select a task from the sidebar to begin.</p>
          </div>
        )}
      </main>

      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
    </div>
  );
}

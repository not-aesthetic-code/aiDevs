import { create } from 'zustand';
import type { TaskDef } from '../types.ts';

interface TaskStore {
  tasks: TaskDef[];
  selectedTaskId: string | null;
  loading: boolean;
  fetchTasks: () => Promise<void>;
  setSelected: (id: string) => void;
}

export const useTaskStore = create<TaskStore>((set) => ({
  tasks: [],
  selectedTaskId: null,
  loading: true,

  fetchTasks: async () => {
    try {
      const res = await fetch('/api/tasks');
      const data = await res.json();
      set({ tasks: data.tasks, loading: false, selectedTaskId: data.tasks[0]?.id ?? null });
    } catch {
      set({ loading: false });
    }
  },

  setSelected: (id) => set({ selectedTaskId: id }),
}));

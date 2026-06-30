import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api } from "./api";
import type { Task } from "../../shared/types";

export const useAreas = () =>
  useQuery({ queryKey: ["areas"], queryFn: api.listAreas });

export const useLabels = () =>
  useQuery({ queryKey: ["labels"], queryFn: api.listLabels });

export const useProjects = (areaId?: string) =>
  useQuery({
    queryKey: ["projects", areaId ?? "all"],
    queryFn: () => api.listProjects(areaId),
  });

export const useView = (name: string) =>
  useQuery({ queryKey: ["view", name], queryFn: () => api.view(name) });

export const useTasks = (params: Record<string, string>) =>
  useQuery({
    queryKey: ["tasks", params],
    queryFn: () => api.listTasks(params),
  });

// Invalidate everything task-shaped after a write (cheap for a personal app).
export function useTaskInvalidate() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["view"] });
    qc.invalidateQueries({ queryKey: ["tasks"] });
  };
}

export function useCreateTask() {
  const invalidate = useTaskInvalidate();
  return useMutation({
    mutationFn: (b: Record<string, unknown>) => api.createTask(b),
    onSuccess: invalidate,
  });
}

export function useCompleteTask() {
  const invalidate = useTaskInvalidate();
  return useMutation({
    mutationFn: ({ id, done }: { id: string; done: boolean }) =>
      api.completeTask(id, done),
    onSuccess: invalidate,
  });
}

export function useUpdateTask() {
  const invalidate = useTaskInvalidate();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api.updateTask(id, body),
    onSuccess: invalidate,
  });
}

export function useDeleteTask() {
  const invalidate = useTaskInvalidate();
  return useMutation({
    mutationFn: (id: string) => api.deleteTask(id),
    onSuccess: invalidate,
  });
}

export const PRIORITY_LABEL: Record<number, string> = {
  1: "P1 urgent",
  2: "P2 this week",
  3: "P3 flexible",
  4: "P4 backlog",
};

export function sortTasks(a: Task, b: Task) {
  return a.priority - b.priority;
}

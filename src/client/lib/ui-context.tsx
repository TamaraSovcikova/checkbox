import { createContext, useContext } from "react";
import type { Task } from "../../shared/types";
import type { Me } from "./api";

export const TaskUIContext = createContext<{ open: (t: Task) => void }>({
  open: () => {},
});

export const useTaskUI = () => useContext(TaskUIContext);

export const MeContext = createContext<Me | null>(null);
export const useMe = () => useContext(MeContext);

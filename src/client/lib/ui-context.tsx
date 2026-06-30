import { createContext, useContext } from "react";
import type { Task } from "../../shared/types";

export const TaskUIContext = createContext<{ open: (t: Task) => void }>({
  open: () => {},
});

export const useTaskUI = () => useContext(TaskUIContext);

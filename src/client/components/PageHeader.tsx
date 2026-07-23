import type { ReactNode } from "react";
import { TopBar, type Tab, type MenuChoice } from "./TopBar";

// Thin generic wrapper over TopBar, used as the page header across every page.
// Kept as its own component so page files can share it without pulling in the
// rest of pages.tsx.
export function Header<T extends string>(props: {
  title: string;
  icon?: ReactNode;
  tabs?: Tab<T>[];
  activeTab?: T;
  onTab?: (id: T) => void;
  sort?: MenuChoice[];
  group?: MenuChoice[];
  filter?: MenuChoice[];
  menu?: MenuChoice[];
  actions?: ReactNode;
  below?: ReactNode;
}) {
  return <TopBar {...props} />;
}

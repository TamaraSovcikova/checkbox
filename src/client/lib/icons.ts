// One icon vocabulary for the whole app — replaces the emoji scattered across
// the sidebar, view titles, and calendar. Call sites import named aliases from
// here (never the lucide barrel directly) so the icon set stays consistent and
// imports stay per-icon / tree-shakeable.
export {
  Sun as TodayIcon,
  CalendarDays as CalendarIcon,
  ArrowRight as UpcomingIcon,
  AlertTriangle as OverdueIcon,
  Inbox as BacklogIcon,
  CheckCheck as LogbookIcon,
  Settings as SettingsIcon,
  LayoutGrid as GridIcon,
  List as ListIcon,
  ArrowUpDown as SortIcon,
  Columns as GroupIcon,
  MoreHorizontal as MoreIcon,
  Check as CheckIcon,
  Plus as AddIcon,
  X as CloseIcon,
  CheckSquare as LogoIcon,
  GripVertical as DragIcon,
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
  ChevronDown as ChevronDownIcon,
  RefreshCw as RefreshIcon,
  LogOut as LogOutIcon,
} from "lucide-react";

// A shared default size class so icons read consistently across the app.
export const ICON_SIZE = "h-[18px] w-[18px]";

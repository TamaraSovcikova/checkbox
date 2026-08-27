// One icon vocabulary for the whole app: replaces the emoji scattered across
// the sidebar, view titles, and calendar. Call sites import named aliases from
// here (never the lucide barrel directly) so the icon set stays consistent and
// imports stay per-icon / tree-shakeable.

// The brand mark is ours, not lucide's, but it is exported from here so call
// sites keep importing LogoIcon from one place.
export { LogoMark as LogoIcon } from "../components/LogoMark";

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
  Kanban as BoardIcon,
  ArrowUpDown as SortIcon,
  Columns as GroupIcon,
  MoreHorizontal as MoreIcon,
  Check as CheckIcon,
  Plus as AddIcon,
  X as CloseIcon,
  Info as InfoIcon,
  Menu as MenuIcon,
  GripVertical as DragIcon,
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
  ChevronDown as ChevronDownIcon,
  RefreshCw as RefreshIcon,
  LogOut as LogOutIcon,
  Repeat as RepeatIcon,
  Search as SearchIcon,
  Filter as FilterIcon,
  Trash2 as TrashIcon,
  CalendarClock as RescheduleIcon,
  // Tier 2
  Sparkles as PlanIcon,
  ClipboardCheck as ReviewIcon,
  Flame as StreakIcon,
  BarChart3 as StatsIcon,
  Timer as TimerIcon,
  Play as PlayIcon,
  Square as StopIcon,
  Clock as ClockIcon,
  Moon as SnoozeIcon,
  Ban as BlockedIcon,
  LayoutTemplate as TemplateIcon,
  Paperclip as AttachIcon,
  Link2 as LinkIcon,
  Upload as UploadIcon,
  ExternalLink as ExternalLinkIcon,
  Pencil as EditIcon,
  FileText as NotesIcon,
  ListChecks as SubtaskIcon,
  CircleDot as DoingIcon,
  CornerUpLeft as BackIcon,
  Mail as MailIcon,
  AlertCircle as AttentionIcon,
  Pin as PinIcon,
  StickyNote as PinsIcon,
  // Cadence trackers read as a gauge ("how far through the interval am I"),
  // which is exactly what the page draws.
  Gauge as CadenceIcon,
  // A checkpoint is a pulse along the way to the due date: a flag on the route.
  Flag as CheckpointIcon,
  // The Flow tab draws the project as connected stations; so does this glyph.
  Waypoints as FlowIcon,
  // "Whenever I have the chance": no deadline, done when there is room. A
  // coffee cup reads as unhurried, which is the whole claim.
  Coffee as WheneverIcon,
  // "Take me to where this task actually lives": the sheet's jump-to-its-page
  // button. A crosshair reads as locate, which is what it does.
  Crosshair as NavigateIcon,
} from "lucide-react";

// Home is also an AREA icon below; re-exported under its nav name for the
// dashboard page without colliding with that import.
export { Home as HomeIcon } from "lucide-react";

// Curated icon set an area can be tagged with (the picker offers these by name;
// the DB stores the name string). Kept small + generic so the grid stays scannable.
import {
  Briefcase,
  Home,
  Heart,
  Dumbbell,
  BookOpen,
  Code2,
  Palette,
  DollarSign,
  Plane,
  ShoppingCart,
  Users,
  Target,
  Leaf,
  Music,
  Coffee,
  Star,
  type LucideIcon,
} from "lucide-react";

export const AREA_ICONS: Record<string, LucideIcon> = {
  briefcase: Briefcase,
  home: Home,
  heart: Heart,
  dumbbell: Dumbbell,
  book: BookOpen,
  code: Code2,
  palette: Palette,
  money: DollarSign,
  plane: Plane,
  cart: ShoppingCart,
  users: Users,
  target: Target,
  leaf: Leaf,
  music: Music,
  coffee: Coffee,
  star: Star,
};

// Resolve an area's stored icon name to a component (or null if unset/unknown).
export function areaIcon(name: string | null | undefined): LucideIcon | null {
  if (!name) return null;
  return AREA_ICONS[name] ?? null;
}

// A shared default size class so icons read consistently across the app.
export const ICON_SIZE = "h-[18px] w-[18px]";

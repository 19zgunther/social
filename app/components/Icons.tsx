import type { CSSProperties } from "react";
import {
  Aperture,
  ArrowLeft,
  ArrowRight,
  Bell,
  Bot,
  Brush,
  Bug,
  Calendar,
  Camera,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  CircleUserRound,
  Clock,
  Contrast,
  Crop,
  Droplets,
  Eraser,
  Gamepad2,
  Hand,
  HardDrive,
  Heart,
  Image,
  ImagePlus,
  LayoutList,
  ListChecks,
  LogOut,
  MessageCirclePlus,
  MessageSquare,
  MoreHorizontal,
  Palette,
  Pencil,
  PhoneOff,
  Play,
  Plus,
  Redo2,
  RefreshCw,
  RotateCcw,
  Rss,
  Send,
  Settings,
  Smile,
  Square,
  Sun,
  Thermometer,
  Trash2,
  Undo2,
  Users,
  Video,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

export type { LucideIcon } from "lucide-react";

/** Navigate back */
export const BackIcon = ArrowLeft;
/** Navigate forward / continue */
export const ForwardIcon = ArrowRight;
/** Dismiss / close a surface */
export const CloseIcon = X;
/** Confirm / selected / resolved */
export const CheckIcon = Check;
/** Create / add item */
export const AddIcon = Plus;
/** Edit content */
export const EditIcon = Pencil;
/** Delete / remove */
export const DeleteIcon = Trash2;
/** Reload / refresh data */
export const RefreshIcon = RefreshCw;
/** Overflow / more actions menu */
export const MoreIcon = MoreHorizontal;
/** Expand / collapse disclosure */
export const ChevronDownIcon = ChevronDown;
/** Step previous */
export const ChevronLeftIcon = ChevronLeft;
/** Step next / drill in */
export const ChevronRightIcon = ChevronRight;

/** Like a post */
export const LikeIcon = Heart;
/** Placeholder when no profile photo */
export const UserPlaceholderIcon = CircleUserRound;
/** Messages / feedback entry */
export const MessageIcon = MessageSquare;
/** Poll content indicator */
export const PollIcon = ListChecks;
/** Tier list content indicator */
export const TierListIcon = LayoutList;
/** Play media */
export const PlayIcon = Play;
/** Games / gamepad */
export const GamepadIcon = Gamepad2;
/** Settings / gear */
export const SettingsIcon = Settings;
/** Push notifications */
export const NotificationsIcon = Bell;
/** Debug tools */
export const DebugIcon = Bug;
/** Local storage / cache */
export const StorageIcon = HardDrive;
/** Sign out */
export const LogOutIcon = LogOut;
/** Appearance / theme */
export const ThemeIcon = Palette;
/** Personal bots */
export const BotIcon = Bot;
/** RSS feeds / syndication */
export const RssIcon = Rss;
/** Open emoji picker */
export const EmojiIcon = Smile;
/** Take a photo */
export const CameraIcon = Camera;
/** Image / photo attachment */
export const ImageIcon = Image;
/** Add / upload an image */
export const AddImageIcon = ImagePlus;
/** People / contributors */
export const PeopleIcon = Users;
/** Start a new chat/thread */
export const NewChatIcon = MessageCirclePlus;
/** Date picker */
export const CalendarIcon = Calendar;
/** Time picker */
export const ClockIcon = Clock;
/** Video call / video media */
export const VideoIcon = Video;
/** End call */
export const HangUpIcon = PhoneOff;
/** Send message / photo */
export const SendIcon = Send;
/** Capture shutter */
export const ShutterIcon = Circle;
/** Rotate / flip camera or image */
export const RotateIcon = RotateCcw;
/** Undo last action */
export const UndoIcon = Undo2;
/** Redo last action */
export const RedoIcon = Redo2;
/** Draw tool */
export const BrushIcon = Brush;
/** Erase tool */
export const EraserIcon = Eraser;
/** Pan / move canvas */
export const PanIcon = Hand;
/** Zoom in */
export const ZoomInIcon = ZoomIn;
/** Zoom out */
export const ZoomOutIcon = ZoomOut;
/** Crop adjustment */
export const CropIcon = Crop;
/** Brightness adjustment */
export const BrightnessIcon = Sun;
/** Contrast adjustment */
export const ContrastIcon = Contrast;
/** Saturation adjustment */
export const SaturationIcon = Droplets;
/** Warmth adjustment */
export const WarmthIcon = Thermometer;
/** Tint adjustment */
export const TintIcon = Palette;
/** Vignette adjustment */
export const VignetteIcon = Aperture;
/** Unresolved / open status */
export const UnresolvedIcon = Square;

type NavRgbIconProps = {
  active?: boolean;
  className?: string;
};

const HOUSE_MASK =
  `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8'/%3E%3Cpath d='M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'/%3E%3C/svg%3E")`;

const USERS_MASK =
  `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2'/%3E%3Cpath d='M16 3.128a4 4 0 0 1 0 7.744'/%3E%3Cpath d='M22 21v-2a4 4 0 0 0-3-3.87'/%3E%3Ccircle cx='9' cy='7' r='4'/%3E%3C/svg%3E")`;

const IMAGES_MASK =
  `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m22 11-1.296-1.296a2.4 2.4 0 0 0-3.408 0L11 16'/%3E%3Cpath d='M4 8a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2'/%3E%3Ccircle cx='13' cy='7' r='1' fill='white'/%3E%3Crect x='8' y='2' width='14' height='14' rx='2'/%3E%3C/svg%3E")`;

const USER_ROUND_MASK =
  `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='8' r='5'/%3E%3Cpath d='M20 21a8 8 0 0 0-16 0'/%3E%3C/svg%3E")`;

const MESSAGE_SQUARE_MASK =
  `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z'/%3E%3C/svg%3E")`;

const CALENDAR_MASK =
  `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M8 2v4'/%3E%3Cpath d='M16 2v4'/%3E%3Crect width='18' height='18' x='3' y='4' rx='2'/%3E%3Cpath d='M3 10h18'/%3E%3C/svg%3E")`;

function NavRgbIcon({
  mask,
  active,
  className,
}: NavRgbIconProps & { mask: string }) {
  return (
    <span
      aria-hidden
      className={`nav-rgb-icon${active ? " nav-rgb-icon-active" : ""}${className ? ` ${className}` : ""}`}
      style={{ "--nav-rgb-mask": mask } as CSSProperties}
    />
  );
}

/** Bottom nav: Feed */
export function NavFeedIcon(props: NavRgbIconProps) {
  return <NavRgbIcon mask={HOUSE_MASK} {...props} />;
}

/** Bottom nav: Groups */
export function NavGroupsIcon(props: NavRgbIconProps) {
  return <NavRgbIcon mask={USERS_MASK} {...props} />;
}

/** Bottom nav: Shared event posts */
export function NavSharedPostsIcon(props: NavRgbIconProps) {
  return <NavRgbIcon mask={IMAGES_MASK} {...props} />;
}

/** Bottom nav: Profile */
export function NavProfileIcon(props: NavRgbIconProps) {
  return <NavRgbIcon mask={USER_ROUND_MASK} {...props} />;
}

/** Bottom nav: Feedback */
export function NavFeedbackIcon(props: NavRgbIconProps) {
  return <NavRgbIcon mask={MESSAGE_SQUARE_MASK} {...props} />;
}

/** Bottom nav: Events (hidden) */
export function NavEventsIcon(props: NavRgbIconProps) {
  return <NavRgbIcon mask={CALENDAR_MASK} {...props} />;
}

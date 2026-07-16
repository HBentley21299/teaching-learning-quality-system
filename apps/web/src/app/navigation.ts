import {
  Activity,
  Building2,
  ClipboardCheck,
  GraduationCap,
  LayoutDashboard,
  Lightbulb,
  ListChecks,
  MessagesSquare,
  Sparkles,
  Settings,
  UserRound,
  Users,
  UsersRound
} from "lucide-react";

export const navigationItems = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { key: "staff", label: "Staff", icon: Users },
  { key: "team", label: "My Team", icon: UsersRound },
  { key: "admin", label: "Admin Centre", icon: Settings },
  { key: "learning", label: "Learning Walks", icon: Activity },
  { key: "liv", label: "LIV", icon: Lightbulb },
  { key: "elevate", label: "Elevate Environments", icon: Building2 },
  { key: "practice", label: "Elevate Learning and Innovation", icon: Sparkles },
  { key: "coaching", label: "Coaching & Mentoring", icon: MessagesSquare },
  { key: "scrutiny", label: "Work Scrutiny", icon: ClipboardCheck },
  { key: "cpd", label: "CPD", icon: GraduationCap },
  { key: "profile", label: "Staff Profile", icon: UserRound },
  { key: "actions", label: "Actions", icon: ListChecks }
] as const;

export type AppRoute = (typeof navigationItems)[number]["key"];

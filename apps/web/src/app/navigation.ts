import {
  Activity,
  Building2,
  ClipboardCheck,
  GraduationCap,
  LayoutDashboard,
  Lightbulb,
  ListChecks,
  Sparkles,
  Settings,
  ShieldCheck,
  UserRound,
  Users
} from "lucide-react";

export const navigationItems = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { key: "staff", label: "Staff", icon: Users },
  { key: "admin", label: "Admin Centre", icon: Settings },
  { key: "learning", label: "Learning Walks", icon: Activity },
  { key: "liv", label: "LIV", icon: Lightbulb },
  { key: "elevate", label: "Elevate Environments", icon: Building2 },
  { key: "practice", label: "Elevate Your Practice", icon: Sparkles },
  { key: "scrutiny", label: "Work Scrutiny", icon: ClipboardCheck },
  { key: "cpd", label: "CPD", icon: GraduationCap },
  { key: "profile", label: "Staff Profile", icon: UserRound },
  { key: "actions", label: "Actions", icon: ListChecks },
  { key: "security", label: "Permissions", icon: ShieldCheck }
] as const;

export type AppRoute = (typeof navigationItems)[number]["key"];

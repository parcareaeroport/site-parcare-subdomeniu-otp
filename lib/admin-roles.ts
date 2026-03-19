export const DEFAULT_ADMIN_EMAIL = "contact.parcareaeroport@gmail.com"

export const ADMIN_ROLES = ["admin", "employee", "entriesOperator"] as const

export type AdminRole = (typeof ADMIN_ROLES)[number]

const ROLE_DEFAULT_ROUTES: Record<AdminRole, string> = {
  admin: "/admin/dashboard",
  employee: "/admin/dashboard/bookings",
  entriesOperator: "/admin/dashboard/entries-exits",
}

const ROLE_ALLOWED_PATHS: Record<AdminRole, string[]> = {
  admin: [
    "/admin/dashboard",
    "/admin/dashboard/bookings",
    "/admin/dashboard/entries-exits",
    "/admin/dashboard/ocupare",
    "/admin/dashboard/prices",
    "/admin/dashboard/whitelist",
    "/admin/dashboard/api-test",
    "/admin/dashboard/statistics",
    "/admin/dashboard/recovery",
    "/admin/dashboard/users/create",
  ],
  employee: [
    "/admin/dashboard/bookings",
    "/admin/dashboard/entries-exits",
    "/admin/dashboard/ocupare",
  ],
  entriesOperator: ["/admin/dashboard/entries-exits"],
}

export function isAdminRole(value: unknown): value is AdminRole {
  return typeof value === "string" && ADMIN_ROLES.includes(value as AdminRole)
}

export function normalizeAdminRole(rawRole?: unknown, email?: string | null): AdminRole {
  const normalizedEmail = String(email || "").trim().toLowerCase()
  if (normalizedEmail === DEFAULT_ADMIN_EMAIL) {
    return "admin"
  }

  if (isAdminRole(rawRole)) {
    return rawRole
  }

  return "employee"
}

export function getDefaultAdminRoute(role: AdminRole): string {
  return ROLE_DEFAULT_ROUTES[role]
}

export function canAccessAdminPath(pathname: string, role: AdminRole): boolean {
  return ROLE_ALLOWED_PATHS[role].includes(pathname)
}

export function getAdminRoleLabel(role: AdminRole): string {
  switch (role) {
    case "admin":
      return "Administrator"
    case "entriesOperator":
      return "Operator Intrări/Ieșiri"
    default:
      return "Angajat"
  }
}

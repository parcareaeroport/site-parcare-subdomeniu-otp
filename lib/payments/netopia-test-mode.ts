const DEFAULT_NETOPIA_TEST_AMOUNT = 3

function parseBooleanEnv(value: string | undefined): boolean {
  if (!value) return false
  const normalized = value.trim().toLowerCase()
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on"
}

function parseAmountEnv(value: string | undefined): number {
  const parsed = Number.parseFloat(String(value ?? DEFAULT_NETOPIA_TEST_AMOUNT))
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_NETOPIA_TEST_AMOUNT
  }
  return Math.round(parsed * 100) / 100
}

export type NetopiaForcedTestConfig = {
  enabled: boolean
  amount: number
}

export function getNetopiaForcedTestConfig(): NetopiaForcedTestConfig {
  return {
    enabled: parseBooleanEnv(process.env.NETOPIA_FORCE_TEST_AMOUNT),
    amount: parseAmountEnv(process.env.NETOPIA_FORCE_TEST_AMOUNT_VALUE),
  }
}


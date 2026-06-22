export interface StrengthResult {
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  entropy: number;
  checks: { length: boolean; upper: boolean; lower: boolean; number: boolean; symbol: boolean };
}

export function scorePassword(pw: string): StrengthResult {
  const checks = {
    length: pw.length >= 12,
    upper: /[A-Z]/.test(pw),
    lower: /[a-z]/.test(pw),
    number: /[0-9]/.test(pw),
    symbol: /[^A-Za-z0-9]/.test(pw),
  };
  const passed = Object.values(checks).filter(Boolean).length;
  let score: 0 | 1 | 2 | 3 | 4 = 0;
  if (pw.length === 0) score = 0;
  else if (pw.length < 6) score = 1;
  else if (passed <= 2) score = 1;
  else if (passed === 3) score = 2;
  else if (passed === 4) score = 3;
  else score = 4;
  
  let pool = 0;
  if (checks.upper) pool += 26;
  if (checks.lower) pool += 26;
  if (checks.number) pool += 10;
  if (checks.symbol) pool += 32;
  const entropy = Math.round(pw.length * Math.log2(Math.max(pool, 2)));
  const labels = ["Empty", "Very weak", "Weak", "Good", "Strong"];
  return { score, label: labels[score], entropy, checks };
}

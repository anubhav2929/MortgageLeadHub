const RESTRICTED_PATTERNS: Array<[RegExp, string]> = [
  [/\b\d{3}[- ]?\d{2}[- ]?\d{4}\b/g, "[REDACTED SSN]"],
  [/(\b(?:date of birth|dob)\s*(?:is|:|-)?\s*)\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/gi, "$1[REDACTED DOB]"],
  [/(\b(?:account|routing|card)\s*(?:number|no\.?|#)?\s*(?:is|:|-)?\s*)(?:\d[ -]?){8,19}\b/gi, "$1[REDACTED ACCOUNT]"],
  [/\b(?:\d[ -]?){13,19}\b/g, "[REDACTED ACCOUNT]"],
  [/(\b(?:credit score|fico)\s*(?:is|:|-)?\s*)\d{3}\b/gi, "$1[REDACTED CREDIT DETAIL]"],
];

export function redactRestrictedText(input: string): { text: string; redacted: boolean } {
  let text = input;
  for (const [pattern, replacement] of RESTRICTED_PATTERNS) text = text.replace(pattern, replacement);
  return { text, redacted: text !== input };
}

export function allowsAiPdfAssist(mode: FormDataEntryValue | null) {
  return mode !== "recovery-v1";
}

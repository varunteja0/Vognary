"use client";

import type { ComponentProps } from "react";
import { RecoveryDialog } from "../recovery-dialog";

export function RecoveryOverlay(props: ComponentProps<typeof RecoveryDialog>) {
  return <RecoveryDialog {...props} />;
}
